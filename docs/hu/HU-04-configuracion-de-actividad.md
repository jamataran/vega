# HU-04 — Configuración de una actividad

| | |
|---|---|
| **Id** | HU-04 |
| **Épica** | Actividades y contexto de corrección |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 5 |
| **Depende de** | HU-01, HU-19 |
| **Bloquea a** | HU-05, HU-06, HU-08 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** ver las actividades que Vega vigila, agrupadas por curso, y configurar de cada una el
nombre, si está activa, si se puntúa, la nota máxima y cuánta autonomía tiene Vega
**para** que Vega sepa qué está corrigiendo y qué puede publicar sin mí antes de gastar un token.

La **actividad** (`Activity`) es la unidad de trabajo de Vega y sustituye al antiguo «buzón»: ya no
es un contenedor abstracto sino la actividad real de Moodle a la que la aplicación reacciona. Hay
dos tipos (`ActivityKind`): `assignment`, que trae fichero del alumno y pasa por transcripción, y
`forum`, que trae texto escrito y no pasa por ella (`hasStudentFile()`).

Dos cosas están decididas y no se discuten aquí. La primera: **la nota es opcional**. `graded`
dice si la actividad se puntúa y `maxScore` sólo existe cuando se puntúa
(`activities_graded_needs_max_score`). La segunda: **el alta de actividades no es de esta HU**. Las
actividades entran en Vega importándolas de Moodle (HU-19); aquí sólo se configuran las que ya
están dadas de alta. Lo caro de preparar —la solución de referencia y el reparto de puntos— va en
HU-05, aunque viaje en el mismo `UpdateActivityRequest`.

## Criterios de aceptación

### Escenario 1: listado de actividades

```gherkin
Dado que he iniciado sesión como "teacher"
Y existen tres actividades dadas de alta
Cuando envío GET /api/activities
Entonces recibo 200 con ActivityListResponse
Y "items" contiene las tres actividades ordenadas por slug ascendente
Y cada una trae slug, name, kind, courseName, moodleRef, enabled, graded,
  maxScore, pointsAllocation, referenceSolution, autonomy, files y createdAt
Y la respuesta no viene paginada: es { items: Activity[] }
```

### Escenario 2: la lista agrupa por curso y distingue tipo y estado

```gherkin
Dado que existen "tema04" (kind assignment, enabled true, courseName "Matemáticas I"),
  "foro-dudas" (kind forum, enabled true, courseName "Matemáticas I")
  y "tema01" (kind assignment, enabled false, courseName "Lengua II")
Cuando abro la pantalla de actividades
Entonces veo dos grupos encabezados por "Matemáticas I" y "Lengua II", ordenados alfabéticamente
Y "tema04" y "foro-dudas" muestran distintivos de tipo distintos, con las etiquetas
  de ACTIVITY_KIND_LABEL: "Entrega" y "Foro"
Y "tema01" aparece marcado como inactivo
Y cada fila indica si se puntúa y sobre cuánto, o "Sin nota" si graded es false
```

### Escenario 3: cambiar el nombre y la nota máxima

```gherkin
Dado que existe la actividad "tema04" con graded true y maxScore 10
Cuando envío PATCH /api/activities/{id} con name "Tema 04 — Derivadas (marzo)" y maxScore 20
Entonces recibo 200 con ActivityResponse y la Activity actualizada
Y las correcciones ya existentes conservan su propio maxScore, que no cambia
```

### Escenario 4: marcar una entrega como no puntuable

```gherkin
Dado que existe la actividad "practica-lectura" con kind "assignment", graded true y maxScore 10
Cuando envío PATCH /api/activities/{id} con graded false
Entonces recibo 200
Y la Activity devuelta trae graded false y maxScore null
Y no se me exige enviar maxScore
Y la pantalla de la actividad oculta el campo de nota máxima y el reparto de puntos
```

### Escenario 5: marcar como puntuable sin nota máxima

```gherkin
Dado que existe la actividad "foro-dudas" con graded false y maxScore null
Cuando envío PATCH /api/activities/{id} con graded true y sin maxScore
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.message dice que una actividad puntuable necesita nota máxima
Y error.fields.maxScore indica que hay que darla o marcar la actividad como no puntuable
Y la actividad no cambia: sigue con graded false
```

### Escenario 6: un foro puede puntuarse; el tipo no lo decide

```gherkin
Dado que existe la actividad "foro-participacion" con kind "forum", graded false y maxScore null
Cuando envío PATCH /api/activities/{id} con graded true y maxScore 2
Entonces recibo 200
Y la Activity devuelta trae kind "forum", graded true y maxScore 2
Y el kind de la actividad no ha cambiado y no era editable
```

### Escenario 7: nota máxima inválida

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío PATCH /api/activities/{id} con maxScore 0
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.fields.maxScore señala el campo
Y la actividad no cambia
```

### Escenario 8: cambiar el modo de autonomía

```gherkin
Dado que existe la actividad "tema04" con autonomy "review_all"
Cuando envío PATCH /api/activities/{id} con autonomy "autonomous"
Entonces recibo 200 y la Activity trae autonomy "autonomous"
Y las entregas que ya estaban esperando revisión siguen esperándola
Y antes de guardar, la pantalla advierte de que Vega publicará sin que nadie lo revise
```

### Escenario 9: desactivar una actividad

```gherkin
Dado que existe la actividad "tema04" con enabled true
Cuando envío PATCH /api/activities/{id} con enabled false
Entonces recibo 200
Y el siguiente proceso de corrección no descarga entregas nuevas de esa actividad
Y las entregas ya existentes siguen siendo revisables, validables y publicables
```

### Escenario 10: campos no modificables

```gherkin
Dado que existe la actividad "tema04" con slug "tema04", kind "assignment",
  courseName "Matemáticas I" y moodleRef "1042"
Cuando envío PATCH /api/activities/{id} incluyendo slug, kind, courseName o moodleRef en el cuerpo
Entonces esos campos se ignoran, porque no forman parte de UpdateActivityRequest
Y la Activity devuelta conserva su slug, su kind, su courseName y su moodleRef
```

### Escenario 11: quitar la puntuación con entregas ya publicadas

```gherkin
Dado que la actividad "tema04" tiene graded true
Y al menos una de sus entregas está en estado "published"
Cuando envío PATCH /api/activities/{id} con graded false
Entonces recibo 409 con error.code = "CONFLICT"
Y error.message explica que ya hay notas publicadas bajo el criterio anterior
Y la actividad conserva graded true y su maxScore
```

### Escenario 12: actividad inexistente

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/activities/{id de una actividad que no existe}
Entonces recibo 404 con error.code = "NOT_FOUND"
```

### Escenario 13: sin sesión no se ve ni se toca nada

```gherkin
Dado que no envío cabecera Authorization
Cuando envío GET /api/activities o PATCH /api/activities/{id}
Entonces recibo 401 con error.code = "UNAUTHORIZED"
```

## Reglas de negocio

**RN-1.** El `slug` identifica a la actividad dentro de Vega, es único (`activities.slug UNIQUE`) y
**es inmutable**: sirve de `key` del `GradingContext` de nivel `activity` y de nombre de fichero en
`contexts/activities/`. Cambiarlo desconectaría a la actividad de sus instrucciones. Por eso no
está en `UpdateActivityRequest`.

**RN-2.** `kind` (`ActivityKind`: `assignment` o `forum`) **viene de Moodle y no se edita**. Decide
dos cosas: qué contexto de nivel `activity_kind` se resuelve, y si la entrega pasa por
transcripción (`hasStudentFile(kind)`). Una actividad mal tipada no se arregla aquí: se da de baja
y se vuelve a importar.

**RN-3.** **`kind` no determina `graded`.** El tipo sólo fija el valor por defecto razonable en el
alta —una entrega se puntúa, un foro no (HU-19, RN-4)—, pero el profesor puede cambiarlo en ambos
sentidos: hay entregas de práctica que no llevan nota y hay foros cuya participación se califica.

**RN-4.** Si `graded` es `true`, `maxScore` no puede ser nulo y debe ser mayor que cero. Lo
garantizan `activities_graded_needs_max_score` y `activities_max_score_check`, y el API lo
comprueba antes para poder devolver un 422 explicable en vez de un error de Postgres en crudo.

**RN-5.** Si `graded` es `false`, `maxScore` se guarda a `null` **aunque el cuerpo traiga un
número**. Es un invariante del dominio, no una validación: sin puntuación no hay nota máxima que
valga.

**RN-6.** En una actividad no puntuable Vega **no produce nota ni desglose por apartados**: la
corrección es sólo el texto redactado (`Correction.aiLatex`), con `items` vacío y `maxScore` a
`null`. Es el caso normal del foro: responder una duda, no calificarla.

**RN-7.** Marcar `graded` en un foro afecta a **cómo corrige Vega**, no a cómo publica. La
publicación de una respuesta de foro es un camino distinto —sin calificación— y se especifica en
HU-17. Ver pregunta abierta 2.

**RN-8.** `enabled = false` **impide la ingesta** de entregas nuevas (HU-08), pero no bloquea nada
de lo ya existente: las entregas de esa actividad siguen siendo revisables, validables y
publicables.

**RN-9.** `autonomy` (`AutonomyMode`) se decide **por actividad**, porque la confianza se gana
actividad a actividad. El valor de alta es siempre `review_all` (HU-19, RN-4). Cambiarlo afecta a
lo que se procese a partir de ese momento; nunca republica ni reprocesa nada ya existente.

**RN-10.** `courseName` es **texto libre** copiado de Moodle en el momento del alta. No se edita
desde aquí y no es una entidad: hoy no existe tabla `courses`. Es una limitación conocida —ver
pregunta abierta 4 y HU-19.

**RN-11.** Cambiar `maxScore` **no altera las correcciones ya hechas**: `corrections.max_score` es
columna propia de la corrección, copiada de la actividad en el momento de corregir. Una corrección
antigua sigue valiendo sobre la escala con la que se hizo.

**RN-12.** Con al menos una entrega en `published`, **cambiar `graded` se rechaza con 409**. Ya hay
alumnos con notas puestas bajo un criterio; quitar o poner la puntuación dejaría la actividad
incoherente consigo misma. Es la adaptación de la regla que antes protegía el cambio de tipo de
tarea, que ya no es editable (RN-2).

**RN-13.** La lista no se pagina: `ActivityListResponse` es `{ items: Activity[] }`, ordenada por
`slug`. El agrupado por `courseName` lo hace la UI. Un departamento maneja decenas de actividades,
no miles.

**RN-14.** Cualquier usuario autenticado (`teacher` o `admin`) puede ver y editar actividades: el
contexto de corrección es del profesor. Sin sesión válida, 401.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Actividad sin contexto de nivel `activity` | Permitido. `ResolvedContextResponse.activity` devuelve cadena vacía y se corrige sólo con el contexto global y el del tipo. La pantalla lo señala |
| Actividad puntuable sin `pointsAllocation` | Permitido (`points_allocation` por defecto `'[]'`), pero la corrección no puede desglosarse y la IA decide sola el reparto. Ver HU-05 |
| Actividad con `moodleRef` a `null` | Permitido: es una actividad local, sin origen en Moodle. La ingesta de HU-08 no la toca y la pantalla lo indica |
| Se desactiva una actividad con entregas en `graded` | Permitido. Esas entregas siguen en la cola: lo contrario dejaría trabajo del profesor colgado |
| Se pone `graded = false` en una actividad con reparto de puntos definido | El reparto se conserva en base de datos pero deja de usarse y de mostrarse. Si se vuelve a puntuar, reaparece. Ver HU-05, pregunta abierta 1 |
| Se baja `maxScore` por debajo de la suma del reparto | Permitido con aviso. El esquema no lo impide a propósito, porque hay enunciados con apartados opcionales. Ver HU-05 |
| Se pasa a `autonomous` una actividad recién importada, sin contexto ni solución | Permitido, con advertencia explícita antes de guardar. Vega no lo bloquea: la decisión es del profesor y es reversible |
| Dos profesores editan la misma actividad a la vez | Último en escribir gana. Sin bloqueo optimista |
| La actividad ha desaparecido de Moodle | Sigue existiendo en Vega y se puede configurar. La ingesta fallará y lo dirá; nada se borra solo. Ver HU-19 |
| Nombre de actividad vacío | 422: `name` es `z.string().min(1)` |

## Fuera de alcance

- **Dar de alta actividades.** Es HU-19: elegir curso en Moodle, ver sus actividades e importarlas.
- **Borrar actividades.** No hay ruta, y `ON DELETE CASCADE` se llevaría por delante entregas,
  transcripciones y correcciones. Se desactivan con `enabled = false`.
- **Editar `kind`, `courseName`, `slug` o `moodleRef`.** RN-1, RN-2 y RN-10. No están en
  `UpdateActivityRequest`.
- **Solución de referencia y reparto de puntos.** Es HU-05, aunque viajen en el mismo `PATCH`.
- **Contextos de corrección en Markdown y ficheros de contexto.** Es HU-06.
- **Cómo se publica una respuesta de foro.** Es HU-17.
- **La semántica completa de los tres modos de autonomía** —qué se considera «poca confianza», qué
  se publica solo y cuándo. Aquí sólo se elige el modo; el comportamiento se especifica en H5.
- **Entidad `courses`.** Ver HU-19, pregunta abierta 1.
- **Asignar actividades a profesores concretos.** Ver HU-02.

## Notas de implementación

**Entidades** (`@vega/shared`): `Activity` (`slug`, `name`, `kind`, `courseName`, `moodleRef`,
`enabled`, `graded`, `maxScore`, `pointsAllocation`, `referenceSolution`, `autonomy`, `files`,
`createdAt`), `ActivityKind`, `AutonomyMode`, `ACTIVITY_KIND_LABEL`, `AUTONOMY_MODE_LABEL`,
`AUTONOMY_MODE_HELP`, `hasStudentFile()`.

**Contrato** (`packages/shared/src/api.ts`): `ActivityListResponse`, `ActivityResponse`,
`UpdateActivityRequest` (todos los campos opcionales: `name`, `enabled`, `graded`, `maxScore`,
`pointsAllocation`, `referenceSolution`, `autonomy`).

**Endpoints** (`routes`): `activities` → `GET /api/activities`; `activity(id)` →
`GET` / `PATCH /api/activities/{id}`. Ambos con `preHandler: app.authenticate`, sin `requireRole`:
de ahí RN-14.

**Códigos de error**: `parseOrThrow` devuelve **422 `UNPROCESSABLE`**, no 400, y rellena
`error.fields` a partir de los `issues` de Zod. Cualquier criterio que espere 400 en una validación
de cuerpo está mal escrito.

**Esquema** (`0002_activities.sql`): tabla `activities` con `slug UNIQUE`,
`activities_kind_check CHECK (kind IN ('assignment','forum'))`, `activities_autonomy_check`,
`activities_max_score_check CHECK (max_score IS NULL OR max_score > 0)` y
`activities_graded_needs_max_score CHECK (NOT graded OR max_score IS NOT NULL)`. La columna
`grading_notes` **ya no existe**: la 0002 la eliminó y las indicaciones del profesor viven en
`grading_contexts` de nivel `activity`.

**Relación con los contextos**: `activities.slug` es la `key` del `GradingContext` de nivel
`activity`, y `kind` la del nivel `activity_kind`. No hay FK entre `grading_contexts` y
`activities`, así que la coherencia la mantiene el API.

**UI**: `apps/frontend/src/pages/ActivitiesPage.tsx` (lista agrupada por `courseName`, con
distintivo de tipo, distintivo de autonomía, nota y conmutador de activa/inactiva por fila) y
`apps/frontend/src/pages/ActivityDetailPage.tsx` (secciones «Identidad», «Puntuación», «Reparto de
puntos», «Autonomía», «Solución de referencia», «Contexto de esta actividad» y «Ficheros de
contexto»). Los campos de nota máxima y reparto sólo se pintan cuando `graded` está activo, y al
guardar con `graded = false` el formulario envía `pointsAllocation: []`.

**Lo que hoy NO está implementado y esta HU exige**:

- **RN-12 (409 con entregas publicadas)**: el `PATCH` de `apps/api/src/routes/activities.ts` no
  consulta el estado de las entregas. Hay que añadir la comprobación antes de aplicar el parche.
- **Contador de entregas por actividad en la lista**: no está en `Activity` ni en
  `ActivityListResponse`, y `GET /api/submissions/counts` no acepta filtro por `activityId`. Ver
  pregunta abierta 3.

**Mock**: completa. La pantalla y el contrato funcionan enteros contra los datos sembrados; la
lógica de esta HU es la definitiva.

## Preguntas abiertas

1. **¿Qué pasa al cambiar `graded` cuando hay correcciones en `graded` sin publicar?** RN-12 sólo
   bloquea con `published`. Pero quitar la puntuación deja correcciones hechas con apartados y nota
   que el profesor validará sin darse cuenta de que ya no se van a publicar como nota. Opciones:
   (a) bloquear también con entregas en `graded` o `validated`; (b) permitirlo y marcar esas
   correcciones como hechas bajo el criterio anterior, lo que exige guardar `graded` en la
   corrección —columna nueva—; (c) permitirlo, avisar y confiar. Consecuencia: con (c) el profesor
   puede firmar notas que nunca llegarán al alumno. **`[bloqueante]`: afecta a la fiabilidad de
   notas que el profesor va a firmar.**

2. **Un foro puntuable, ¿cómo publica la nota?** RN-3 permite `graded = true` en un `forum`, pero
   el camino de publicación de foro es `mod_forum_add_discussion_post`, que **no lleva
   calificación**, y `publishGrade` está ahora explícitamente prohibido sobre un foro
   ([ADR 0014](../decisiones/0014-publicar-en-foro-y-verificar-la-escritura.md)). Con lo
   implementado, la conducta de hecho es la opción (a): **se publica la respuesta y la nota se queda
   dentro de Vega, en silencio**. Opciones: (a) dejarlo así y **decirlo en la UI**, que es lo que
   falta; (b) publicar la nota contra el ítem de calificación del foro, lo que exige una llamada
   nueva al conector y verificarla contra un Moodle real; (c) prohibir `graded = true` en `forum` y
   cerrar el caso. **`[bloqueante]`: hoy la UI ofrece una opción cuyo efecto no se explica, y el
   profesor puede firmar una nota que nadie va a publicar.**

3. **¿Debe la lista mostrar cuántas entregas hay en cada estado por actividad?** Es la información
   que decide dónde ponerse a trabajar. Opciones: (a) añadir un contador a `Activity` o a
   `ActivityListResponse`, ampliando el contrato; (b) añadir filtro por `activityId` a
   `GET /api/submissions/counts` y hacer una llamada extra; (c) no mostrarlo y entrar por la cola
   (HU-14). Consecuencia: (a) engorda una entidad que se usa en muchos sitios; (b) multiplica
   llamadas si hay muchas actividades.

4. **¿Debe `courseName` dejar de ser texto libre?** Hoy dos actividades del mismo curso agrupan
   bien sólo si Moodle devuelve exactamente la misma cadena, y renombrar un curso en Moodle parte
   el grupo en dos. Se decide en HU-19, pregunta abierta 1, porque es allí donde el conector aplana
   el curso y pierde su identificador. Aquí sólo se sufre la consecuencia.

5. **¿Hace falta duplicar una actividad?** El examen del tema 04 del curso siguiente reutiliza
   reparto, contexto y a menudo la solución, pero es otra actividad de Moodle con otras entregas.
   Opciones: (a) acción de duplicar que copie configuración y contexto con un `slug` nuevo; (b)
   importar de Moodle y copiar a mano; (c) copiar la configuración desde otra actividad al
   importar (HU-19). Consecuencia: sin ello, cada curso nuevo cuesta una tarde de trabajo repetido.
