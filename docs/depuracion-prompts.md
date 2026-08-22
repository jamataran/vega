# Depurar prompts contra un entorno desplegado

Los prompts del motor viven en la base de datos de cada entorno, versionados, y
se editan desde la pantalla «Prompts». Para iterar deprisa —y para que quede
rastro en git de lo que se probó— hay un cliente de terminal:
[`scripts/vega-admin.sh`](../scripts/vega-admin.sh).

No añade nada al producto: usa los mismos endpoints de administración que la
interfaz. Lo único que aporta es el login, la caché del token y una salida
legible.

## Puesta en marcha

```bash
cp scripts/vega-admin.env.example scripts/.vega-admin.env   # ignorado por git
$EDITOR scripts/.vega-admin.env                             # URL y credenciales
scripts/vega-admin.sh whoami
```

Usa un **administrador dedicado a depuración**, no el tuyo: `prompts.updated_by`
guarda quién editó cada versión, y conviene distinguir a una persona de una
herramienta. Para tener varios entornos a mano:

```bash
VEGA_ADMIN_ENV=~/.config/vega/test.env scripts/vega-admin.sh prompts
```

El token dura 12 h (`JWT_EXPIRES_IN`) y se cachea en `~/.cache/vega/`.

## El ciclo

```bash
scripts/vega-admin.sh pull                       # todos los prompts a var/prompts/<host>/
$EDITOR var/prompts/<host>/grading.problem.system.md
scripts/vega-admin.sh diff  grading.problem.system     # qué va a cambiar
scripts/vega-admin.sh push  grading.problem.system     # guarda una versión nueva

scripts/vega-admin.sh queue 'status=needs_review'      # elige una entrega
scripts/vega-admin.sh reprocess <id-entrega>           # vuelve a corregirla
scripts/vega-admin.sh calls 'submissionId=<id-entrega>'
scripts/vega-admin.sh sent <id-llamada>                # lo que se envió al modelo
scripts/vega-admin.sh received <id-llamada>            # lo que devolvió
```

`push` lee la versión activa del servidor en el momento de guardar y la manda
como `expectedVersion`. Si alguien tocó ese prompt por la interfaz desde tu
último `pull`, la API rechaza el guardado en lugar de pisarlo. `restore` devuelve
el prompt a la semilla del código (`apps/api/src/prompts/seeds.ts`), no a tu
versión anterior.

`var/` está fuera de git a propósito: un prompt de producción no debería acabar
commiteado sin querer. Si quieres versionar una tanda de cambios, cópiala a
`docs/` o a una rama con intención, no por descuido.

## Lo que cuesta y lo que toca

- **`reprocess` gasta dinero de verdad.** Por eso el `scope` por defecto es
  `grade_only`, que reaprovecha la transcripción ya hecha: al iterar un prompt de
  corrección no hace falta volver a pasar el examen por el modelo de visión.
  `full` rehace la transcripción y multiplica el coste de cada vuelta.
- **Los datos son de alumnos reales.** Ata la depuración a una actividad de
  pruebas siempre que puedas, y no encadenes `validate` ni `publish` mientras
  estés iterando: publicar escribe la nota en Moodle.
- **Un prompt guardado afecta al siguiente lote**, que lo lanza el planificador
  del propio API a la hora configurada en Ajustes. Si estás a mitad de una
  tanda de pruebas, revisa la programación antes de irte.

## Dónde mirar cuando algo no cuadra

| Síntoma | Sitio |
|---|---|
| La corrección sale rara pero no falla | `sent <id>` — el contexto efectivo va dentro del propio `requestParams` |
| El motor no aplicó una regla que escribiste | `resolved <idActividad>` — comprueba que la capa que la contiene entra en la mezcla |
| La llamada falla o vuelve sin parsear | `calls 'errorsOnly=true'`, y luego `received <id>` |
| No aparece ninguna llamada | El fallo es anterior al motor (ingesta, descarga del PDF): `docker compose -p vega-prod logs api` |

El registro de llamadas se purga según `ai.logRetentionDays` (180 días por
defecto), así que las trazas de una tanda de pruebas siguen ahí semanas después.

## No todo se arregla con un prompt

Hay cuatro sitios donde puede estar la causa, y solo uno se toca por API:

| Causa | Dónde se arregla | Cuándo entra en vigor |
|---|---|---|
| Instrucción del motor mal escrita | Prompt, con `push` | Al instante |
| Criterio propio de esta asignatura o examen | Contexto, en la aplicación | Al instante |
| Reparto de puntos o solución de referencia | Pantalla de la actividad | Al instante |
| El motor no envía el dato, o descarta una respuesta buena | Código | Tras CI, test y promoción a prod |

La señal para distinguir el último: **si el dato que haría falta no aparece en
`sent`, ninguna redacción lo arregla** — el modelo solo puede razonar sobre lo que
se le manda. Igual al revés: si la respuesta era correcta y lo guardado no se
corresponde, el fallo está después del modelo, en la comprobación mecánica o en la
persistencia.

La skill `/vega-prompt-debug` recorre este mismo circuito de forma guiada: reúne la
evidencia, decide la capa, propone el cambio y solo sube tras aprobación.

## Un aviso sobre la CLI del motor

`pnpm --filter @vega/core cli grade` **no usa los prompts de la base de datos**:
`aiConfigFromEnv` no rellena `systemPrompts` y el proveedor cae a un texto
mínimo embebido (`packages/core/src/ai/anthropic.ts`). Sirve para probar el
motor, no para validar un prompt antes de subirlo. Para eso, levanta la API en
local —los prompts se siembran igual que en producción— o depura contra el
entorno de test.
