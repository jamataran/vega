# HU-06 — Editor de contextos de corrección en tres niveles

| | |
|---|---|
| **Id** | HU-06 |
| **Épica** | Buzones y contexto de corrección |
| **Estado** | borrador |
| **Prioridad** | Must |
| **Estimación** | 8 |
| **Depende de** | HU-04 |
| **Bloquea a** | HU-07, HU-12 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** escribir en Markdown las instrucciones con las que la IA corrige, en tres niveles
—generales, por tipo de examen y por buzón—
**para** ajustar el criterio de corrección sin depender de nadie y sin esperar a un despliegue.

Este es el mecanismo por el que Vega deja de ser una caja negra. Lo que se escribe aquí determina
las notas de los alumnos: es el equivalente a la reunión de departamento donde se acuerdan los
criterios de evaluación, sólo que escrito y aplicado con literalidad.

Los tres niveles y su razón de ser están decididos en el
[ADR 0003](../decisiones/0003-contexto-tres-niveles.md); aquí se especifica cómo se editan. El
juego por defecto está en `contexts/` del repositorio y es lo que siembra la base de datos la
primera vez.

## Criterios de aceptación

### Escenario 1: listar todos los contextos

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío GET /api/contexts
Entonces recibo 200 con ContextListResponse
Y "items" incluye el contexto de nivel "global" con key "global"
Y los contextos de nivel "task_type" con key "simulacro_problema" y "simulacro_tema"
Y un contexto de nivel "mailbox" por cada buzón que tenga instrucciones propias
```

### Escenario 2: leer un contexto concreto

```gherkin
Dado que existe contexto de nivel "mailbox" con key "tema04"
Cuando envío GET /api/contexts/mailbox/tema04
Entonces recibo 200 con un GradingContext
Y "content" es el Markdown completo
Y "updatedAt" y "updatedBy" reflejan la última edición
```

### Escenario 3: editar el contexto global

```gherkin
Dado que he iniciado sesión como "teacher" con id X
Cuando envío PUT /api/contexts/global/global con un content nuevo
Entonces recibo 200 con el GradingContext actualizado
Y updatedBy es X
Y updatedAt es la fecha actual
Y las correcciones que se ejecuten a partir de ahora usan el content nuevo
```

### Escenario 4: crear un contexto que no existía

```gherkin
Dado que no existe contexto de nivel "mailbox" con key "problema12"
Cuando envío PUT /api/contexts/mailbox/problema12 con un content
Entonces recibo 200 y el contexto queda creado
Y la restricción UNIQUE (level, key) impide que se duplique
```

### Escenario 5: clave inválida en el nivel de tipo de tarea

```gherkin
Dado que he iniciado sesión
Cuando envío PUT /api/contexts/task_type/examen_final con cualquier content
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.message indica que la clave debe ser un TaskType válido
```

### Escenario 6: clave de buzón inexistente

```gherkin
Dado que no existe ningún buzón con slug "tema99"
Cuando envío PUT /api/contexts/mailbox/tema99 con cualquier content
Entonces recibo 422 con error.code = "UNPROCESSABLE"
```

### Escenario 7: nivel inválido

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/contexts/departamento/mates
Entonces recibo 400 con error.code = "BAD_REQUEST"
```

### Escenario 8: vista previa con KaTeX

```gherkin
Dado que estoy editando un contexto que contiene "$\lim_{x \to 0} \frac{\sin x}{x} = 1$"
Cuando activo la vista previa
Entonces veo el Markdown renderizado con la expresión en KaTeX
Y puedo volver al modo de edición sin perder cambios
```

### Escenario 9: siembra desde el repositorio

```gherkin
Dado que la tabla grading_contexts está vacía
Y el repositorio contiene contexts/global.md y contexts/task-types/simulacro_tema.md
Cuando arranca el API
Entonces se crean las filas correspondientes con el contenido de esos ficheros
Y updatedBy queda a NULL, porque no las ha editado ningún usuario
```

### Escenario 10: la siembra no pisa lo editado

```gherkin
Dado que ya existe una fila para (global, global) editada por un profesor
Y el fichero contexts/global.md del repositorio tiene otro contenido
Cuando arranca el API
Entonces la fila NO se sobrescribe
Y se conserva el contenido editado por el profesor
```

### Escenario 11: cambios sin guardar

```gherkin
Dado que estoy editando un contexto y he escrito cambios
Cuando intento salir de la pantalla
Entonces se me advierte de que hay cambios sin guardar
Y puedo cancelar la salida
```

## Reglas de negocio

**RN-1.** Hay exactamente tres niveles (`ContextLevel`), y la `key` está determinada por el nivel:
`global` para el nivel global; el valor de `TaskType` para `task_type`; el `slug` del buzón para
`mailbox`. Cualquier otra combinación es 422.

**RN-2.** `UNIQUE (level, key)` en `grading_contexts`: un contexto por par. `PUT` es un *upsert*.

**RN-3.** La combinación es **concatenación en orden general → específico**. Lo específico añade y
matiza; nunca sustituye. El resultado se consulta en HU-07.

**RN-4.** Los ficheros de `contexts/` **siembran** la base de datos cuando no existe la fila
correspondiente. Si la fila existe, el fichero se ignora: **el fichero siembra, la base de datos
manda**.

**RN-5.** Editar desde la UI escribe **sólo en la base de datos**. El fichero del repositorio no se
modifica. Consecuencia asumida y conocida: tras la primera edición, el fichero queda
desactualizado. Ver preguntas abiertas.

**RN-6.** Cualquier usuario autenticado (`teacher` o `admin`) puede editar cualquier contexto,
incluido el global. No hay permiso diferenciado.

**RN-7.** `updatedBy` guarda quién editó por última vez, `updatedAt` cuándo. Es la única traza:
**no hay historial de versiones**.

**RN-8.** El contenido es Markdown libre. No se valida ni se transforma: se guarda tal cual y se
envía tal cual al modelo.

**RN-9.** Un cambio de contexto **afecta a las correcciones que se ejecuten a partir de ese
momento**. Las ya hechas no cambian ni se marcan. Para aplicar el criterio nuevo a una entrega ya
corregida hay que reprocesarla (HU-11).

**RN-10.** Un contexto vacío o inexistente es válido: se resuelve como cadena vacía, no como error.

## Casos límite

| Caso | Qué se hace |
|---|---|
| El fichero del repositorio y la fila divergen | Manda la fila (RN-4). Nadie avisa. Ver preguntas abiertas |
| Se borra un buzón que tenía contexto | El contexto sobrevive: no hay FK entre `grading_contexts` y `mailboxes`. Queda huérfano. Si el `slug` se reutiliza, el contexto reaparece |
| Dos profesores editan el mismo contexto a la vez | Último en escribir gana. Se pierde el trabajo del primero **sin aviso**. Es el caso más doloroso de esta HU: ver preguntas abiertas |
| Contexto larguísimo (decenas de miles de caracteres) | Se guarda. Encarece cada llamada. La UI muestra el tamaño y avisa por encima de un umbral |
| Markdown con LaTeX mal formado | Se guarda igual. La vista previa señala lo que no puede renderizar; el guardado nunca se bloquea por eso |
| Contexto editado mientras un lote está corriendo | Las entregas ya enviadas al modelo usan el contexto anterior; las siguientes, el nuevo. Un mismo lote puede quedar corregido con dos criterios |
| Se cambia el `taskType` de un buzón | Pasa a resolverse otro contexto de nivel `task_type`. El de nivel `mailbox` no cambia |

## Fuera de alcance

- **Historial de versiones y diff.** No hay tabla. El backlog original (T03) proponía commit
  automático a git; hoy no está decidido. Ver preguntas abiertas.
- **Commit automático a `contexts/` al editar.** RN-5.
- **Permisos diferenciados por nivel.** RN-6: cualquier profesor puede tocar el contexto global.
- **Plantillas o herencia configurable.** Los tres niveles son fijos y su orden también.
- **Validar que el contexto «tiene sentido».** Es texto libre para un modelo de lenguaje.
- **Probar un contexto contra una entrega antes de guardarlo.** Ver pregunta abierta 5.

## Notas de implementación

**Entidades** (`@vega/shared`): `GradingContext` (`level`, `key`, `content`, `updatedAt`,
`updatedBy`), `ContextLevel`, `CONTEXT_LEVEL_LABEL` («Instrucciones globales», «Tipo de tarea»,
«Buzón»).

**Contrato**: `ContextListResponse`, `UpdateContextRequest` (`{ content }`).

**Endpoints** (`routes`): `contexts` → `GET /api/contexts`; `context(level, key)` → `GET`/`PUT
/api/contexts/{level}/{key}`.

**Esquema**: `grading_contexts` con `CHECK (level IN ('global','task_type','mailbox'))`,
`UNIQUE (level, key)`, `updated_by uuid REFERENCES users(id) ON DELETE SET NULL`.

**Siembra**: al arrancar, tras aplicar migraciones. Lee `contexts/global.md`,
`contexts/task-types/*.md` y `contexts/mailboxes/*.md` y hace `INSERT ... ON CONFLICT (level, key)
DO NOTHING`, que implementa RN-4 y el escenario 10 en una sola sentencia.

**Ficheros de referencia**: los de este repositorio son el juego por defecto y están escritos para
usarse tal cual: `contexts/global.md`, `contexts/task-types/simulacro_problema.md`,
`contexts/task-types/simulacro_tema.md`, `contexts/mailboxes/{tema04,problema12,tema07}.md`.

**UI**: pestaña «Contextos» de la navegación inferior, con los tres niveles como secciones. Editor
de Markdown con vista previa conmutable y KaTeX. En móvil, barra de herramientas mínima: negrita,
LaTeX en línea, lista. Indicador de cambios sin guardar y aviso al salir (escenario 11). El
contexto de nivel `mailbox` es alcanzable también desde el detalle del buzón (HU-04).

**Mock**: completa. La siembra desde `contexts/` es real desde el primer día — es la forma de que
la demo tenga contenido creíble sin escribirlo dos veces.

## Preguntas abiertas

1. **¿Qué relación definitiva hay entre `contexts/` y `grading_contexts`?** Hoy la regla es «el
   fichero siembra, la base de datos manda» (RN-4), y su consecuencia es que el repositorio miente
   en cuanto alguien edita desde el móvil. Opciones: (a) dejarlo así y aceptar que `contexts/` es
   sólo semilla, documentándolo con claridad; (b) commit automático a git al guardar, con el
   usuario como autor —era la propuesta del backlog original, y da historial y diff gratis, pero
   obliga a que el contenedor del API tenga un repositorio escribible y credenciales de push—;
   (c) eliminar el almacén en base de datos y editar directamente los ficheros, lo que hace la
   edición desde el móvil dependiente del sistema de ficheros del contenedor. **`[bloqueante]`: es
   la decisión estructural de esta HU.**

2. **¿Hace falta historial de versiones?** Un cambio de contexto cambia notas. Si tras una noche de
   correcciones raras el profesor quiere saber qué cambió y volver atrás, hoy **no puede**: RN-7
   sólo guarda quién y cuándo. Opciones: (a) resolverlo con git, si se responde (b) a la pregunta
   1; (b) tabla `grading_context_versions`, que exige migración; (c) nada. La (a) sale gratis si se
   toma esa decisión, y es un argumento fuerte a su favor.

3. **¿Cómo se evita que dos profesores se pisen?** Hoy el último en escribir gana **sin aviso**, y
   un contexto es un documento largo que cuesta una tarde escribir. Opciones: (a) bloqueo optimista
   con `updatedAt` como versión, devolviendo 409 si ha cambiado desde que se cargó —barato y
   suficiente—; (b) bloqueo pesimista con reserva del documento; (c) nada, porque la academia tiene
   dos profesores. La (a) cuesta poco y evita el peor caso. **`[bloqueante]` si hay más de un
   profesor editando.**

4. **¿Debe el contexto global ser editable por cualquier profesor?** RN-6 dice que sí. Pero el
   contexto global es la política de evaluación del departamento: que cualquiera pueda cambiar cómo
   se penaliza el arrastre para toda la academia, sin revisión ni historial, es mucho poder. ¿Se
   restringe el nivel `global` a rol `admin`? Eso convertiría el rol de administrador en algo más
   que un gestor de usuarios.

5. **¿Debería poder probarse un contexto antes de guardarlo?** El bucle actual para ajustar un
   criterio es: editar, guardar, reprocesar una entrega, mirar el resultado. Lento y con efectos
   sobre datos reales. Un «probar contra esta entrega» que devuelva la corrección sin persistirla
   sería el mejor acelerador de calidad del sistema, pero exige un endpoint nuevo, gasta tokens y
   no está en el contrato.

6. **¿Cuánto contexto es demasiado?** Los tres niveles más la solución de referencia viajan en cada
   llamada. Los ficheros de ejemplo de este repositorio suman ya varios miles de tokens por buzón.
   ¿Se avisa a partir de un umbral? ¿Se mide el coste por buzón y se enseña en la pantalla de
   contextos (HU-18)?

7. **¿Qué pasa con el contexto de un buzón cuando el `slug` se reutiliza?** El examen del tema 04
   del curso siguiente podría querer llamarse `tema04` otra vez. Como no hay FK, heredaría el
   contexto del buzón anterior — que puede ser justo lo que se quiere o justo lo contrario. ¿Se
   avisa al crear un buzón cuyo `slug` ya tiene contexto?
