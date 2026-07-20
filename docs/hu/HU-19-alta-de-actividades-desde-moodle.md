# HU-19 — Alta de actividades desde Moodle

| | |
|---|---|
| **Id** | HU-19 |
| **Épica** | Actividades y contexto de corrección |
| **Estado** | implementada · sin verificar contra un Moodle real |
| **Prioridad** | Must |
| **Estimación** | 8 |
| **Depende de** | HU-01, HU-03 |
| **Bloquea a** | HU-04, HU-05, HU-06, HU-08 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** elegir uno de mis cursos de Moodle, ver sus entregas y sus foros, y marcar cuáles vigila
Vega
**para** poder empezar a trabajar sin que nadie tenga que crearme las actividades por detrás.

Esta HU cierra el agujero que HU-04 declaraba como bloqueante: **no había forma de crear una
actividad desde la aplicación.** El conector de Moodle lista cursos
(`core_enrol_get_users_courses`), tareas (`mod_assign_get_assignments`) y foros
(`mod_forum_get_forums_by_courses`), y el API los sirve en `GET /api/courses/discover` y
`GET /api/activities/discover?moodleCourseId=`.

**El curso es el primer paso, y por eso es una entidad.** El diálogo volcaba antes el catálogo
entero agrupado por la cadena `courseName`, que funciona con siete actividades de ejemplo y no
funciona con el Moodle de un departamento. Ahora el profesor elige curso y sólo entonces se piden
sus actividades; el curso se guarda en la tabla `courses` con su identificador de Moodle, de modo
que renombrarlo allí no parte el grupo en dos ni mezcla dos cursos homónimos.

El alta es **idempotente y no destructiva**: volver a sincronizar no duplica actividades ni pisa lo
que el profesor haya configurado. Es la condición para que el profesor pueda pulsar el botón sin
miedo, que es lo que hace que lo use.

Lo que la actividad importada trae es el mínimo: nombre, tipo, curso y referencia de Moodle. Todo
lo demás —si se puntúa, sobre cuánto, con qué reparto, con qué contexto y con cuánta autonomía— se
configura después, en HU-04 y HU-05.

## Criterios de aceptación

### Escenario 1: elegir curso y ver sus actividades

```gherkin
Dado que he iniciado sesión como "teacher"
Y tengo mi token de Moodle configurado en Ajustes
Y el conector configurado responde con dos cursos
Cuando abro el alta de actividades desde la pantalla de actividades
Entonces se envía GET /api/courses/discover y veo primero la lista de mis cursos
Y al elegir un curso se envía GET /api/activities/discover?moodleCourseId={id de ese curso}
Y veo sólo sus actividades, separadas en entregas y foros
Y cada actividad muestra su nombre, su tipo según ACTIVITY_KIND_LABEL y su recuento de pendientes
  con la unidad nombrada: "6 entregas pendientes" en una entrega, "3 debates" en un foro
Y puedo volver al listado de cursos sin perder lo que llevo seleccionado
```

### Escenario 2: importar las actividades marcadas

```gherkin
Dado que he elegido un curso y veo sus cinco actividades
Y ninguna está dada de alta en Vega
Cuando marco dos de ellas y confirmo la importación
Entonces se envía POST /api/activities/import con ImportActivitiesRequest
  conteniendo el moodleCourseId del curso elegido y los moodleRef de las dos marcadas
Y el curso se da de alta en la tabla courses si aún no existía
Y recibo 200 con ImportActivitiesResponse conteniendo las dos Activity creadas
Y aparecen en GET /api/activities agrupadas bajo el courseName de ese curso
Y la pantalla me dice que revise su configuración antes del próximo proceso
```

### Escenario 3: valores con los que nace una actividad

```gherkin
Dado que importo una entrega y un foro del mismo curso
Cuando consulto las dos Activity creadas
Entonces la entrega trae kind "assignment", graded true, maxScore 10 y autonomy "review_all"
Y el foro trae kind "forum", graded false, maxScore null y autonomy "review_all"
Y ambas traen enabled true, pointsAllocation vacío y referenceSolution null
Y ambas traen su moodleRef con prefijo de tipo ("assign-42", "forum-42")
Y ambas traen el courseId del curso elegido y su courseName copiado
Y ambas traen importedBy con mi usuario: mi token es el que ingerirá sus entregas
```

### Escenario 4: actividad ya importada

```gherkin
Dado que la actividad con moodleRef "assign-1042" ya está dada de alta en Vega
Cuando abro el alta de actividades y elijo su curso
Entonces "assign-1042" aparece en la lista marcada como ya importada
Y su casilla está deshabilitada: no puedo volver a seleccionarla
Y el recuento de seleccionables no la cuenta
Y el foro "forum-1042" del mismo curso, si existe, aparece como no importado:
  el prefijo de tipo impide que se confundan
```

### Escenario 5: re-sincronizar no duplica ni pisa la configuración

```gherkin
Dado que la actividad con moodleRef "assign-1042" está dada de alta, con name "Tema 04 (marzo)",
  graded false, autonomy "autonomous" y un reparto de puntos definido
Cuando envío POST /api/activities/import incluyendo "assign-1042" entre los moodleRefs
Entonces recibo 200
Y no se crea una segunda actividad: GET /api/activities sigue devolviendo una sola con ese moodleRef
Y esa actividad conserva su name, su graded, su autonomy y su reparto tal y como estaban
Y la respuesta la incluye igualmente, para que el cliente no tenga que distinguir casos
```

### Escenario 6: curso sin actividades

```gherkin
Dado que he elegido un curso que no tiene ni tareas ni foros
Cuando se cargan sus actividades
Entonces veo un estado vacío que dice que ese curso no tiene actividades que Vega pueda vigilar
Y se me ofrece volver a la lista de cursos
Y el botón de importar queda deshabilitado
```

### Escenario 7: Moodle no responde

```gherkin
Dado que el conector está configurado como "moodle3"
Y Moodle no responde o devuelve un error de servidor
Cuando abro el alta de actividades
Entonces recibo 502 con error.code = "LMS_UNAVAILABLE"
Y veo un estado de error que dice que no se ha podido consultar Moodle
Y se me ofrece reintentar sin salir de la pantalla
Y no se crea ninguna actividad
```

### Escenario 8: credenciales inválidas

```gherkin
Dado que mi token de Moodle está caducado, revocado o sin poner
Cuando abro el alta de actividades
Entonces recibo 422 con error.code = "LMS_AUTH", nunca 401
Y el mensaje distingue este caso del de "Moodle no responde":
  el problema es mi credencial, no la red
Y se me enlaza a Ajustes para pegar mi token
Y no se me ofrece reintentar sin cambiar nada
Y mi sesión en Vega no se cierra
```

### Escenario 8 bis: la instalación no tiene URL de Moodle

```gherkin
Dado que el conector está configurado como "moodle3"
Y ningún administrador ha indicado la URL de Moodle en Ajustes
Cuando abro el alta de actividades
Entonces recibo 422 con error.code = "LMS_AUTH"
Y el mensaje dice que es un administrador quien tiene que indicar la URL,
  no yo quien tiene que revisar su token
```

### Escenario 9: una actividad ha desaparecido de Moodle entre listar e importar

```gherkin
Dado que tengo la lista de actividades de un curso cargada en pantalla
Y una de las marcadas se borra en Moodle antes de que yo confirme
Cuando envío POST /api/activities/import incluyéndola
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.fields identifica el moodleRef que ya no existe
Y no se importa ninguna de la selección
```

### Escenario 10: selección vacía

```gherkin
Dado que he elegido un curso y no he marcado ninguna actividad
Cuando intento confirmar
Entonces el botón de importar está deshabilitado
Y si la petición se envía igualmente, recibo 422 con error.code = "UNPROCESSABLE"
  porque ImportActivitiesRequest exige al menos un moodleRef
```

### Escenario 11: sin sesión

```gherkin
Dado que no envío cabecera Authorization
Cuando envío GET /api/courses/discover, GET /api/activities/discover
  o POST /api/activities/import
Entonces recibo 401 con error.code = "UNAUTHORIZED"
Y no se crea ninguna actividad
```

### Escenario 12: descubrir actividades sin decir de qué curso

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/activities/discover sin el parámetro moodleCourseId
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.fields señala moodleCourseId con "Elige primero un curso"
Y no se consulta el catálogo completo de Moodle
```

## Reglas de negocio

**RN-1.** El catálogo de lo que hay en Moodle **lo produce el conector**
(`LmsConnector.listCourses()` y `LmsConnector.listActivities(moodleCourseId)`) y Vega **no lo
almacena**. Cada apertura de la pantalla es una foto del momento; lo único que se persiste es el
curso del que se importa y las actividades que el profesor importa.

**RN-2.** El **curso es el primer paso, no un agrupador**. El profesor elige curso y luego ve sus
actividades. `GET /api/activities/discover` **exige** `?moodleCourseId=`: sin curso no hay catálogo,
y así la pantalla sigue siendo usable con un Moodle real de decenas de cursos.

**RN-3.** El alta es **idempotente por `moodleRef`**: importar una actividad ya dada de alta la
devuelve tal cual, sin duplicarla. La respuesta incluye siempre todas las actividades pedidas,
estuvieran ya o no, para que el cliente no tenga que distinguir casos. Lo sostienen el índice único
parcial `activities_moodle_ref_key` y un `ON CONFLICT DO NOTHING` con relectura de lo que el índice
haya rechazado por una carrera.

**RN-4.** El alta **nunca pisa configuración existente**. Ni el nombre, ni `graded`, ni `maxScore`,
ni el reparto, ni el contexto, ni la autonomía. Si Moodle ha renombrado la actividad, el nombre de
Vega manda: es el que el profesor eligió. Ver pregunta abierta 4.

**RN-5.** Valores con los que nace una actividad: `enabled = true`; `graded = true` y
`maxScore = 10` si `kind` es `assignment`; `graded = false` y `maxScore = null` si es `forum`;
`autonomy = 'review_all'` siempre; `pointsAllocation = []`; `referenceSolution = null`. Son valores
por defecto razonables, **no reglas**: el profesor los cambia en HU-04 y `kind` no determina
`graded` (HU-04, RN-3).

**RN-6.** **Nadie estrena una actividad en modo autónomo.** `autonomy` nace en `review_all` sin
excepción, incluso si el profesor tiene el resto de sus actividades en `autonomous`. La confianza
se gana actividad a actividad.

**RN-7.** El `slug` se deriva del `moodleRef` de forma estable —minúsculas, sin acentos, con
guiones— y es único. Es la `key` del contexto de nivel `activity` (HU-04, RN-1), así que una vez
creado no cambia nunca. Como el `moodleRef` lleva prefijo de tipo, el `slug` de una tarea
(`assign-42`) y el de un foro (`forum-42`) tampoco colisionan.

**RN-8.** `alreadyImported` **lo decide Vega, no el conector**: el conector no sabe qué hay dado de
alta y devuelve siempre `false`. La capa de aplicación lo corrige comparando con los `moodleRef`
existentes.

**RN-9.** El curso es una **entidad**, no una cadena. Se guarda en `courses`
(`moodle_course_id UNIQUE`, `name`) y `activities.course_id` lo referencia; `activities.course_name`
se conserva como copia resuelta para que un listado pueda agrupar sin una segunda consulta. Al
re-sincronizar, **el nombre del curso sí se refresca** con lo que diga Moodle —nadie lo edita en
Vega—, al revés que el de la actividad (RN-4).

**RN-9 bis.** El `moodleRef` lleva **prefijo de tipo** (`assign-42`, `forum-42`) y tiene índice
único **parcial**: `activities_moodle_ref_key ... WHERE moodle_ref IS NOT NULL`. Parcial porque dos
actividades locales (`moodle_ref` a `NULL`) no deben colisionar entre sí. Sin el prefijo, los ids de
`mod_assign` y `mod_forum` —de tablas distintas de Moodle— producían el mismo `moodleRef` y la
segunda importación se perdía en silencio.

**RN-10.** **Nada se borra automáticamente.** Una actividad que desaparece de Moodle sigue en Vega
con sus entregas y sus correcciones. La ingesta fallará y lo dirá (HU-08); la actividad se desactiva
a mano.

**RN-11.** Sin conector utilizable —`moodle3` sin URL de instalación o sin token del usuario— el
error es **de configuración, no de red**: `422 LMS_AUTH`, y el mensaje lleva a Ajustes (HU-03). Un
Moodle que no responde es `502 LMS_UNAVAILABLE` y sí se puede reintentar. **`LMS_AUTH` no es 401 a
propósito**: el cliente cierra la sesión al recibir un 401, y echar al profesor de Vega porque su
token de Moodle ha caducado sería absurdo.

**RN-12.** Cualquier usuario autenticado (`teacher` o `admin`) puede descubrir e importar
actividades, igual que puede configurarlas (HU-04, RN-14).

**RN-13.** El recuento de pendientes que se muestra es **orientativo**: lo da el LMS con la
precisión que puede y no es comparable entre entregas y foros. La pantalla **nombra la unidad** —«3
debates», «6 entregas pendientes»— en lugar de fingir que son la misma cifra. No se toma ninguna
decisión del sistema a partir de él. Ver pregunta abierta 5, que sigue abierta.

**RN-14.** El alta **usa el token del usuario que la hace**, y `activities.imported_by` lo registra:
es la credencial con la que se ingerirán las entregas de esa actividad. Dos profesores del mismo
curso importan cada uno con el suyo. Ver
[ADR 0010](../decisiones/0010-credencial-moodle-por-usuario.md).

**RN-14 bis.** **Listar cursos registra a qué alcanza el profesor.** `GET /api/courses/discover` da
de alta los cursos que devuelve Moodle y anota el acceso en `course_teachers`: es el único momento en
que Moodle dice la verdad sobre qué imparte cada uno. A partir de ahí, `GET /api/activities` sólo
devuelve lo de sus cursos —más lo que él mismo importara— y un `admin` lo ve todo. Sin esto, un
compañero que importara antes que él le dejaría fuera de su propia asignatura. Ver
[ADR 0010](../decisiones/0010-credencial-moodle-por-usuario.md).

**RN-15.** Antes de crear nada, el API **vuelve a preguntar a Moodle**. No se fía de lo que el
cliente tuviera en pantalla: entre listar y confirmar una actividad puede haberse borrado, y crearla
en Vega dejaría una actividad que no ingiere nada y falla cada noche sin explicar por qué.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Una entrega y un foro de Moodle con el mismo identificador numérico | Resuelto: el `moodleRef` lleva prefijo de tipo (`assign-5`, `forum-5`) y son dos actividades distintas, con dos `slug` distintos (RN-9 bis) |
| Ya había actividades importadas con `moodle_ref` numérico, de antes del prefijo | La migración `0003` las normaliza (`^[0-9]+$` → `assign-`/`forum-` según su `kind`) para que re-sincronizar las reconozca en vez de duplicarlas |
| Ya había una colisión provocada por el bug anterior | La migración se queda con la más antigua y pone `moodle_ref = NULL` en las demás, que pasan a ser actividades locales. **No se borra nada**: sus entregas y correcciones siguen ahí; simplemente dejan de decir que vienen de Moodle, y el profesor puede volver a importarlas |
| Dos profesores importan la misma actividad a la vez | Los índices únicos de `slug` y `moodle_ref` deciden y la segunda inserción no rompe: `ON CONFLICT DO NOTHING`, y lo que el índice rechace se relee para que ambas respuestas devuelvan la misma actividad (RN-3) |
| Moodle devuelve el nombre de curso vacío | El curso se crea igual, con `name` vacío, y las actividades se agrupan bajo un encabezado «Sin curso». No se bloquea el alta por un nombre |
| El curso se renombra en Moodle después del alta | Se propaga: `upsertCourse()` refresca el `name` por `moodle_course_id` al re-sincronizar. El grupo no se parte en dos (RN-9) |
| Cursos importados antes de la migración `0003` | Se rescatan como cursos con `moodle_course_id` sintético (`legacy:<nombre>`): desde una cadena no hay forma de recuperar el id real de Moodle. Al re-sincronizar, el curso entra con su id verdadero y las actividades viejas se quedan en el curso heredado |
| Un curso desaparece de Moodle | La fila de `courses` se queda. `activities.course_id` es `ON DELETE SET NULL`, pero nada borra cursos automáticamente (RN-10) |
| La actividad se renombra en Moodle después del alta | Vega conserva su nombre (RN-4). La pantalla puede señalar la discrepancia, pero no la resuelve sola. Ver pregunta abierta 4 |
| El token sólo ve un curso de los varios que imparte el profesor | Se listan los cursos que **su** token ve. No se distingue de «no tiene más cursos»: el mensaje del estado vacío menciona los permisos del token y la función `core_enrol_get_users_courses` |
| Curso con cientos de actividades | Se listan todas las del curso elegido, que es precisamente lo que RN-2 hace manejable. La búsqueda por nombre dentro del curso queda para cuando haga falta |
| Se importa una actividad de un curso y luego se cambia el conector en Ajustes | Las actividades importadas se quedan. Sus `moodleRef` dejan de resolver contra el nuevo conector y la ingesta fallará con error de configuración |
| Se importa una actividad que ya existe pero con el `moodleRef` a `null` (actividad local) | No se empareja: se crea una actividad nueva. Emparejar a mano una actividad de Vega con una de Moodle está fuera de alcance |
| El profesor que importó la actividad se da de baja | `activities.imported_by` pasa a `NULL` (`ON DELETE SET NULL`). La actividad sobrevive, pero su ingesta se queda sin credencial. Por eso los usuarios se **desactivan**, no se borran. Ver ADR 0010 |

## Fuera de alcance

- **Configurar la actividad importada.** Nombre, puntuación, nota máxima, reparto, contexto y
  autonomía son HU-04 y HU-05. Aquí sólo nace con valores por defecto.
- **Descargar entregas.** Es HU-08. Importar una actividad no trae ni una sola entrega.
- **Borrar actividades**, ni las que hayan desaparecido de Moodle (RN-10).
- **Sincronización automática programada** del catálogo. El alta la dispara el profesor.
- **Emparejar a mano** una actividad ya existente en Vega con una actividad de Moodle.
- **Crear actividades que no existan en Moodle** (actividades locales). El esquema lo permite
  —`moodle_ref` es nullable, y el índice único es parcial precisamente para eso— pero no hay
  pantalla ni endpoint, y esta HU no los añade.
- **Listar los cursos ya guardados en Vega.** `GET /api/courses/discover` pregunta al LMS; no existe
  un `GET /api/courses` que lea la tabla. El desglose por curso del panel se apoya en
  `activities.course_name`, no en un listado de cursos.
- **Borrar o desactivar cursos**, ni los que hayan desaparecido de Moodle.
- **Importar el reparto de puntos o la rúbrica desde Moodle.** La interfaz `LmsConnector` no lo
  contempla ni se amplía por esto.
- **Guardar el token de Moodle.** Es HU-03, enmendada: `PUT /api/auth/me/moodle-token`. Esta HU lo
  consume, no lo configura.

## Notas de implementación

**Entidades** (`@vega/shared`): `DiscoveredCourse` (`moodleCourseId`, `name`, `shortName`),
`DiscoveredActivity` (`moodleRef`, `name`, `kind`, `moodleCourseId`, `courseName`, `pendingCount`,
`alreadyImported`), `Course`, `Activity` (con `courseId` nullable), `ActivityKind`,
`ACTIVITY_KIND_LABEL`.

**Contrato** (`packages/shared/src/api.ts`): `DiscoverCoursesResponse`, `DiscoverActivitiesQuery`
(`moodleCourseId: z.string().min(1, 'Elige primero un curso')`), `DiscoverActivitiesResponse`,
`ImportActivitiesRequest` (`moodleCourseId` + `moodleRefs: z.array(z.string()).min(1)`),
`ImportActivitiesResponse`. Códigos de error nuevos en `ApiErrorCode`: `LMS_AUTH` y
`LMS_UNAVAILABLE`.

**Endpoints** (`routes`): `discoverCourses` → `GET /api/courses/discover`; `discoverActivities` →
`GET /api/activities/discover?moodleCourseId=`; `importActivities` → `POST /api/activities/import`.
Los tres con `preHandler: app.authenticate`.

**Conector**: `LmsConnector` pasa de cinco operaciones a siete. Nuevas: `listCourses()` y
`verifyConnection()`; `listActivities(moodleCourseId?)` cambia de firma. `Moodle3Connector` pide los
cursos con `core_enrol_get_users_courses`, las tareas con `mod_assign_get_assignments` y los foros
con `mod_forum_get_forums_by_courses`, y **conserva el `course.id`** en
`DiscoveredActivity.moodleCourseId`. Ver
[ADR 0009](../decisiones/0009-interfaz-lms-siete-operaciones.md).

**Construcción del conector**: `apps/api/src/lms/factory.ts`. La URL y el conector salen de
`app_settings` (o del `.env` como respaldo) y el token, de `users.moodle_token` del usuario en
sesión. `withLms()` envuelve cada operación y traduce `LmsAuthError`/`LmsUnavailableError` a
`LMS_AUTH` (422) y `LMS_UNAVAILABLE` (502).

**Esquema** (`0003_courses.sql`): tabla `courses`; `activities.course_id` (`ON DELETE SET NULL`),
`activities.imported_by` (`ON DELETE SET NULL`), índice `activities_course_idx`; normalización de
`moodle_ref` y índice único parcial `activities_moodle_ref_key`.

**UI**: `apps/frontend/src/components/activity/DiscoverActivitiesDialog.tsx`, abierto desde el botón
«Buscar en Moodle» de `ActivitiesPage.tsx`. Dos pasos —`'courses'` y `'activities'`— con vuelta
atrás que conserva la selección, casilla por actividad, distintivo «Ya importada» y recuento de
seleccionadas en el pie. El recuento de pendientes se rotula con su unidad según el `kind`. Los
estados de error enlazan a `/ajustes` cuando el fallo es `LMS_AUTH`.

**Lo que sigue sin resolverse**:

- **`moodle3` no se ha verificado nunca contra un Moodle real.** Tiene tests unitarios con
  `fetchImpl` inyectado y varios `TODO(vega)` abiertos: si un profesor ve aquí los cursos que
  *imparte* y no sólo aquellos en los que figura como alumno, qué pasa con los cursos ocultos o
  archivados, y el formato de `duedate`.
- **`pendingCount` de una entrega es siempre `0`** en `Moodle3Connector`: contarlo exigiría
  `mod_assign_get_submissions`, que se trae las entregas enteras. En los foros es `numdiscussions`,
  que cuenta **debates**, no mensajes. Nombrar la unidad evita comparar peras con manzanas, pero el
  `0` de las entregas sigue siendo falso. Ver pregunta abierta 5.
- **`verifyConnection()` no distingue «no tienes cursos» de «al servicio le falta habilitar
  `core_enrol_get_users_courses`».** Devuelve `courseCount: 0` y el mensaje menciona las dos
  posibilidades, que es lo único honesto que se puede decir.
- **El token se guarda en claro** en `users.moodle_token`. La API no lo devuelve nunca, pero no hay
  cifrado en reposo. Ver [ADR 0010](../decisiones/0010-credencial-moodle-por-usuario.md).
- **Preguntas abiertas 4 y 6**, sobre el renombrado en Moodle y la copia de configuración entre
  actividades.

**Mock**: completa. La pantalla y el contrato funcionan enteros contra los conectores `mock` y
`filesystem`, con alta idempotente real y los dos pasos del flujo.

## Preguntas abiertas

1. ~~**¿Hace falta la entidad `courses`?**~~ **Resuelta: opción (c), tabla `courses`.**
   `0003_courses.sql` crea `courses` (`id`, `moodle_course_id UNIQUE`, `name`) con FK desde
   `activities.course_id`. Se eligió sobre (a) —agrupar por la cadena `courseName`— porque renombrar
   un curso en Moodle partía el grupo en dos y dos cursos homónimos se mezclaban, y el desglose por
   curso del panel heredaba el mismo defecto; y sobre (b) —sólo un `courseId` en `Activity`— porque
   sin tabla el nombre del curso no se podía refrescar. El coste previsto se ha pagado: una
   migración, con rescate de los cursos antiguos como `legacy:<nombre>`. Lo que **no** se ha hecho es
   el `GET /api/courses` que enumeraba la opción (c): el endpoint que existe es
   `GET /api/courses/discover`, que pregunta al LMS. Listar los cursos ya guardados sin depender de
   Moodle sigue sin estar.

2. ~~**¿`moodleRef` debe llevar el tipo y ser único?**~~ **Resuelta: opción (a), prefijo de tipo más
   índice único.** Era un fallo de corrección, no una mejora: una tarea con id 5 y un foro con id 5
   producían el mismo `moodleRef` y el mismo `slug`, y la segunda importación se perdía en silencio.
   El índice es **parcial** (`WHERE moodle_ref IS NOT NULL`), matiz que la pregunta no contemplaba:
   sin él, dos actividades locales colisionarían entre sí. La migración de datos que la opción (a)
   anunciaba está escrita: normaliza los refs numéricos y, para las colisiones que el bug ya hubiera
   dejado, conserva la más antigua y pone `moodle_ref = NULL` en las demás. No se borra nada.

3. ~~**¿Cómo se enumeran los cursos?**~~ **Resuelta: opción (a), endpoint propio.**
   `GET /api/courses/discover` delega en `LmsConnector.listCourses()`. Se descartó (c) —derivar los
   cursos en el cliente a partir del catálogo entero— porque es justo lo que RN-2 quiere evitar, y
   (b) —una sola ruta con dos significados según lleve o no parámetro— porque devolver cursos o
   actividades desde el mismo sitio obliga al cliente a mirar la forma de la respuesta para saber
   qué le han dado. Como contrapartida, `GET /api/activities/discover` pasa a **exigir**
   `?moodleCourseId=`: ya no existe forma de pedir el catálogo completo desde el API.

4. **¿Qué se hace cuando Moodle renombra una actividad ya importada?** RN-4 dice que el nombre de
   Vega manda. Opciones: (a) ignorar el cambio; (b) mostrar el nombre de Moodle junto al de Vega en
   la pantalla de descubrimiento, para que el profesor decida; (c) ofrecer una acción explícita de
   «actualizar desde Moodle» que sólo toque el nombre y el curso. Consecuencia: con (a), a mitad de
   curso el profesor ve en Vega nombres que ya no existen en Moodle.

5. **¿De dónde sale el recuento de pendientes?** Hoy es `0` en las entregas de `Moodle3Connector` y
   `numdiscussions` en los foros, que cuenta debates y no mensajes: los dos números no son
   comparables y uno de ellos es falso. Opciones: (a) no mostrar recuento en el alta y quitarlo de
   `DiscoveredActivity`; (b) mostrarlo sólo donde el LMS lo dé fiable, con la unidad explícita
   («3 debates», «6 entregas»); (c) calcularlo de verdad, que en una entrega significa
   `mod_assign_get_submissions` completo por actividad y es una petición cara sólo para contar.
   **Media (b) está hecha**: la UI nombra la unidad en vez de decir siempre «entregas pendientes»,
   y `DiscoveredActivity.pendingCount` se documenta como orientativo. Lo que falta es la otra mitad:
   **la pantalla sigue diciendo «Sin entregas pendientes» de actividades que sí las tienen**, porque
   el `0` de `moodle3` es un valor por defecto y no una medida. Elegir entre callarlo en las entregas
   o pagar la petición cara sigue pendiente.

6. **¿Debe poder copiarse la configuración de otra actividad al importar?** El caso real es el curso
   siguiente: mismas actividades, mismo reparto, mismo contexto. Opciones: (a) nada, y configurar
   desde cero; (b) elegir en el alta una actividad existente de la que copiar reparto, solución y
   contexto; (c) resolverlo con la acción de duplicar de HU-04, pregunta abierta 5. Consecuencia:
   (b) y (c) son la misma funcionalidad entrando por dos sitios; conviene elegir uno.
