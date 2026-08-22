---
name: vega-prompt-debug
description: Depura una corrección que ha salido mal en un entorno desplegado: lee el registro de llamadas de IA de esa entrega, decide si la culpa es del prompt, del contexto, de la configuración o del propio software, propone el cambio y lo sube por API tras aprobación explícita. Úsalo cuando una corrección, una transcripción o una respuesta de foro no dan el resultado esperado.
argument-hint: "<entrega> · qué salió · qué se esperaba"
---

Depura `$ARGUMENTS` con el cliente `scripts/vega-admin.sh`. El ciclo completo y sus
costes están en `docs/depuracion-prompts.md`.

## Antes de empezar

Necesitas tres cosas. **Si falta el resultado esperado, pregúntalo y para**: sin
criterio no hay diagnóstico, solo opinión sobre la salida de un modelo.

1. Qué entrega. Un id sirve; «el simulacro de X del martes» también: búscala con
   `vega-admin.sh queue 'status=needs_review'` y confirma cuál es antes de seguir.
2. Qué salió mal, concreto. «Puntuó 1,5 el apartado b» vale; «corrige mal» no.
3. Qué debería haber salido, y por qué. La regla que se incumplió es lo que hay
   que poder citar luego en el cambio.

Confirma también **contra qué entorno** trabajas. Por defecto es el de
`scripts/.vega-admin.env`; si vas a tocar producción, dilo en voz alta antes del
primer comando.

## 1 · Reunir la evidencia: el registro de IA

La fuente es el **registro de llamadas de IA** (`ai_calls`), no los logs del
contenedor. De cada llamada guarda el prompt y el contexto exactos que salieron,
la respuesta cruda, la versión de prompt que se aplicó, el `stopReason`, si se
pudo parsear, la latencia y el coste. No opines sobre el prompt hasta haberlo
leído.

```bash
scripts/vega-admin.sh raw GET /api/submissions/<id>      # estado, nota, apartados, banderas
scripts/vega-admin.sh calls 'submissionId=<id>'          # qué llamadas hubo y cuáles fallaron
scripts/vega-admin.sh sent <id-llamada>                  # el prompt y el contexto reales
scripts/vega-admin.sh received <id-llamada>              # la respuesta cruda
scripts/vega-admin.sh resolved <id-actividad>            # el contexto efectivo de esa actividad
```

Las operaciones del registro son `reading_a` / `reading_b` (doble transcripción),
`grade`, `triage`, `verify` y `forum_answer`. Empieza por la que produjo el
síntoma, no por la última.

**Si no hay ninguna llamada**, el fallo es anterior al motor —ingesta, descarga
del PDF, credencial de Moodle— y ahí sí hacen falta los logs del contenedor
(`docker compose -p vega-prod logs api`) y `POST /api/users/{id}/moodle-token/test`.
No es un problema de prompt; si resulta ser del conector o de la ingesta, sigue
por el apartado 2b.

## 2 · Localizar la capa culpable

Es el paso que decide si el trabajo sale bien. La mayoría de «la IA corrige mal»
no son fallos de prompt.

| Lo que ves en la evidencia | Capa | Dónde se arregla |
|---|---|---|
| La cita del descuento no coincide con lo que escribió el alumno | Transcripción | `transcription.system`, o nada: mira si venía marcado `[ILEGIBLE]` / `DUDA` |
| El criterio que se incumple es de esta asignatura, este examen o esta comunidad | Contexto | El nivel que toque: `global`, `activity_kind`, `template`, `course`, `activity` |
| El reparto de puntos no cuadra con el enunciado | Configuración de la actividad | Solución de referencia y reparto de puntos, en la pantalla de la actividad |
| El fallo se repetiría con cualquier asignatura y cualquier profesor | **Prompt** | La clave del motor que corresponda |
| La respuesta llegó cortada o sin parsear | Ajustes | `maxTokens` en Ajustes; mira `stopReason` en `received` |
| **El dato que haría falta no aparece en `sent`** | **Código** | El motor no lo envía. Ningún prompt lo arregla |
| La respuesta del modelo era correcta y algo posterior la rechazó, recortó o no la guardó | **Código** | Comprobación mecánica, parseo o persistencia |
| Lo que se pide no cabe en el modelo de datos ni en la interfaz | **Código** | Cambio de producto, no de configuración |

**La regla:** un prompt es del motor y lo comparten todas las actividades y todos
los profesores de la instalación. Toca un prompt **solo** si el fallo se repetiría
en cualquier curso. Si es propio de este examen, de esta materia o de este
tribunal, va en el contexto — que es donde vive la personalización.

Qué prompt corresponde a cada caso (`packages/core/src/ai/provider.ts`, función
`gradePromptKey`):

| Caso | Clave |
|---|---|
| Entrega con plantilla que contiene «tema» | `grading.topic.system` |
| Resto de entregas | `grading.problem.system` |
| Foro, ruta estándar | `forum.answer.simple.system` |
| Foro, ruta experta | `forum.answer.expert.system` |
| Transcripción, triaje, verificación | `transcription.system`, `triage.system`, `verify.system` |
| Regla que afecta a todas las llamadas | `global.system` |

Esas ocho son **las únicas claves que el motor pide**. La pantalla de Prompts
lista además `pd.regulation.system`, que hoy no lo reclama ningún camino de
ejecución: editarlo no cambia ninguna corrección. Si el diagnóstico apunta ahí,
di que el prompt está huérfano en lugar de proponer un cambio inútil.

## 2b · Cuando el arreglo es de código

No todo lo que pide José se resuelve escribiendo mejor un prompt, y hay que
detectarlo **antes** de proponer una redacción nueva.

**La señal decisiva: si el dato que haría falta no está en `sent`, no existe
redacción que lo arregle.** Un prompt solo puede pedirle algo al modelo sobre lo
que se le ha enviado. Compruébalo mirando el `requestParams` de verdad, no
suponiendo que el motor manda lo que parecería lógico que mandase. Lo mismo vale
al revés: si el modelo respondió bien y el resultado guardado no se corresponde,
el fallo está en lo que pasa después de la respuesta.

Dónde mirar según el síntoma:

| Sospecha | Fichero |
|---|---|
| Qué se monta y se envía en cada llamada | `packages/core/src/ai/anthropic.ts` |
| Qué capas de contexto entran en la mezcla | `packages/core/src/context/resolve.ts` |
| Qué se hace con la respuesta: comprobación mecánica, normalización | `packages/core/src/grading/engine.ts` |
| Dónde se guarda —o falta sitio donde guardarlo— | `apps/api/src/db/schema.ts` |

Cuando la conclusión sea código, **no lo implementes dentro del ciclo de
depuración**. Preséntalo en el plan del paso 3 marcado como cambio de software,
con cuatro cosas: qué falta, en qué fichero y función, si es un fallo o una
capacidad que nunca existió, y qué alternativa hay mientras tanto —muchas veces
la hay: escribirlo en el contexto de la actividad, o ajustar el reparto de puntos.

Y di el plazo con honestidad, porque es la razón de que la distinción importe:
**un prompt entra al instante por API; un cambio de código pasa por CI, imagen
nueva, validación en test y promoción manual a producción.** Prometer «lo arreglo
ahora» cuando es código es mentir sobre el plazo.

Termina preguntando qué prefiere: abrirlo como cambio en una rama, o dejarlo
escrito como historia de usuario en `docs/hu/`. Si además cambia una regla del
producto —qué se publica, qué decide la IA, qué ve el alumno—, eso es un ADR en
`docs/decisiones/`, no un commit suelto.

## 3 · Presentar el plan y esperar aprobación

No subas nada todavía. Presenta, en este orden y sin relleno:

1. **Diagnóstico**, con la cita literal de la evidencia que lo sostiene: el
   fragmento del `sent` o del `received` que demuestra qué pasó. Sin cita, es una
   hipótesis, y hay que decir que lo es.
2. **El cambio**, y dónde va, que son tres sitios distintos con tres plazos
   distintos: un **prompt** se sube por API al instante y lo presentas como diff
   del texto exacto; un **contexto** lo edita el profesor en la aplicación, no tú;
   un cambio de **código** sale de este ciclo y entra en el de despliegue (2b).
   Si el arreglo necesita más de uno, sepáralos: casi siempre uno se puede aplicar
   hoy y el otro no.
3. **A qué más afecta.** Un prompt es global: nombra qué otras actividades o tipos
   de entrega pasan por esa misma clave.
4. **Cómo se verifica.** Reprocesar esta entrega, y **entregas de control**: una o
   dos que hoy salgan bien y pasen por el mismo prompt, para ver que no se rompen.
   Di lo que cuesta cada vuelta y deja que José decida cuántas.
5. **Cómo se deshace.** La versión activa antes del cambio y el fichero de
   `var/prompts/<host>/` que la contiene.

Si el diagnóstico no es concluyente, dilo y propone qué evidencia falta. Es
preferible a un cambio de prompt escrito a ojo, que además cuesta dinero probar.

## 4 · Aplicar, solo con el visto bueno

```bash
scripts/vega-admin.sh pull                    # guarda la versión actual: es el rollback
scripts/vega-admin.sh diff  <clave>           # confirma que se va a cambiar lo acordado
scripts/vega-admin.sh push  <clave>
scripts/vega-admin.sh reprocess <id-entrega>  # grade_only por defecto
scripts/vega-admin.sh calls 'submissionId=<id-entrega>'
```

Después compara la corrección nueva con la anterior **apartado a apartado**, no
solo la nota final: una nota que coincide por compensación de dos errores no es un
arreglo. Y comprueba las entregas de control antes de dar el cambio por bueno.

## Reglas que no se saltan

- **Nada de `validate` ni `publish` mientras depuras.** Publicar escribe la nota en
  Moodle y el alumno la ve. El flujo de depuración termina en `reprocess`.
- **Cada reproceso cuesta dinero real** (0,35-1,00 € por entrega según las medidas
  del entorno de test). Usa `grade_only`, que reaprovecha la transcripción, salvo
  que lo que estés depurando sea precisamente la transcripción.
- **`restore` vuelve a la semilla del código, no a la versión anterior.** Para
  deshacer un cambio tuyo, haz `push` del fichero que guardó el `pull` previo.
- **Una entrega validada o publicada no se reprocesa** — la API lo rechaza. Elige
  otra o pide que se descarte la corrección primero.
- **Un prompt guardado afecta al siguiente lote**, que lanza el planificador a la
  hora configurada en Ajustes. Si el cambio queda a medio verificar, avísalo.
- No edites `apps/api/src/prompts/seeds.ts` para arreglar un entorno en marcha: esa
  semilla solo alimenta instalaciones nuevas y las restauraciones.
