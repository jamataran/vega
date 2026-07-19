# HU-19 — Alta de actividades desde Moodle

| | |
|---|---|
| **Id** | HU-19 |
| **Épica** | Actividades y contexto de corrección |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 8 |
| **Depende de** | HU-01, HU-03 |
| **Bloquea a** | HU-04, HU-05, HU-06, HU-08 |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** profesor
**quiero** elegir uno de mis cursos de Moodle, ver sus entregas y sus foros, y marcar cuáles vigila
Vega
**para** poder empezar a trabajar sin que nadie tenga que crearme las actividades por detrás.

Esta HU cierra el agujero que HU-04 declaraba como bloqueante: **hasta ahora no había forma de
crear una actividad desde la aplicación.** El conector de Moodle ya sabe listar cursos
(`core_enrol_get_users_courses`), tareas (`mod_assign_get_assignments`) y foros
(`mod_forum_get_forums_by_courses`), y en el API ya existen `GET /api/activities/discover`,
`POST /api/activities/import` y el diálogo `DiscoverActivitiesDialog`. Lo que falta es el paso de
arriba: **elegir curso primero**. Hoy el diálogo vuelca el catálogo entero agrupado por curso, que
funciona con siete actividades de ejemplo y no funciona con el Moodle de un departamento.

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
Y el conector configurado en Ajustes responde con dos cursos
Cuando abro el alta de actividades desde la pantalla de actividades
Entonces veo primero la lista de mis cursos, no la lista de actividades
Y al elegir un curso veo sólo sus actividades, separadas en entregas y foros
Y cada actividad muestra su nombre, su tipo según ACTIVITY_KIND_LABEL y su recuento de pendientes
Y puedo volver al listado de cursos sin perder lo que llevo seleccionado
```

### Escenario 2: importar las actividades marcadas

```gherkin
Dado que he elegido un curso y veo sus cinco actividades
Y ninguna está dada de alta en Vega
Cuando marco dos de ellas y confirmo la importación
Entonces se envía POST /api/activities/import con ImportActivitiesRequest
  y los moodleRef de las dos marcadas
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
Y ambas traen el moodleRef de Moodle y el courseName del curso elegido
```

### Escenario 4: actividad ya importada

```gherkin
Dado que la actividad con moodleRef "1042" ya está dada de alta en Vega
Cuando abro el alta de actividades y elijo su curso
Entonces "1042" aparece en la lista marcada como ya importada
Y su casilla está deshabilitada: no puedo volver a seleccionarla
Y el recuento de seleccionables no la cuenta
```

### Escenario 5: re-sincronizar no duplica ni pisa la configuración

```gherkin
Dado que la actividad con moodleRef "1042" está dada de alta, con name "Tema 04 (marzo)",
  graded false, autonomy "autonomous" y un reparto de puntos definido
Cuando envío POST /api/activities/import incluyendo "1042" entre los moodleRefs
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
Entonces veo un estado de error que dice que no se ha podido consultar Moodle
Y se me ofrece reintentar sin salir de la pantalla
Y no se crea ninguna actividad
```

### Escenario 8: credenciales inválidas

```gherkin
Dado que el token de Moodle configurado en Ajustes está caducado o es inválido
Cuando abro el alta de actividades
Entonces el mensaje distingue este caso del de "Moodle no responde":
  el problema es la configuración, no la red
Y se me enlaza a Ajustes para revisar la URL y el token
Y no se me ofrece reintentar sin cambiar nada
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
Cuando envío GET /api/activities/discover o POST /api/activities/import
Entonces recibo 401 con error.code = "UNAUTHORIZED"
Y no se crea ninguna actividad
```

## Reglas de negocio

**RN-1.** El catálogo de lo que hay en Moodle **lo produce el conector** (`LmsConnector.listActivities()`)
y Vega **no lo almacena**. Cada apertura de la pantalla es una foto del momento; lo único que se
persiste es lo que el profesor importa.

**RN-2.** El **curso es el primer paso, no un agrupador**. El profesor elige curso y luego ve sus
actividades. Es lo que hace que la pantalla siga siendo usable con un Moodle real de decenas de
cursos.

**RN-3.** El alta es **idempotente por `moodleRef`**: importar una actividad ya dada de alta la
devuelve tal cual, sin duplicarla. La respuesta incluye siempre todas las actividades pedidas,
estuvieran ya o no, para que el cliente no tenga que distinguir casos.

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
creado no cambia nunca.

**RN-8.** `alreadyImported` **lo decide Vega, no el conector**: el conector no sabe qué hay dado de
alta y devuelve siempre `false`. La capa de aplicación lo corrige comparando con los `moodleRef`
existentes.

**RN-9.** El curso se guarda como `courseName`, **texto libre copiado en el momento del alta**. Hoy
no existe entidad `courses` y el conector pierde el identificador del curso al aplanarlo. Es una
limitación conocida: ver pregunta abierta 1.

**RN-10.** **Nada se borra automáticamente.** Una actividad que desaparece de Moodle sigue en Vega
con sus entregas y sus correcciones. La ingesta fallará y lo dirá (HU-08); la actividad se desactiva
a mano.

**RN-11.** Sin conector configurado —conector `moodle3` sin URL o sin token— el error es **de
configuración, no de red**, y el mensaje lleva a Ajustes (HU-03). Es el fallo más probable en
producción y merece un mensaje propio.

**RN-12.** Cualquier usuario autenticado (`teacher` o `admin`) puede descubrir e importar
actividades, igual que puede configurarlas (HU-04, RN-14).

**RN-13.** El recuento de pendientes que se muestra es **orientativo**: lo da el LMS con la
precisión que puede y no es comparable entre entregas y foros. No se toma ninguna decisión del
sistema a partir de él.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Una entrega y un foro de Moodle con el mismo identificador numérico | Colisionan: `Moodle3Connector.listActivities()` construye el `moodleRef` como `String(id)` y los ids de `mod_assign` y `mod_forum` son de tablas distintas. Hay que prefijar el `moodleRef` por tipo. Ver pregunta abierta 2 |
| Dos profesores importan la misma actividad a la vez | El índice único de `slug` decide y la segunda inserción no rompe: se resuelve con `ON CONFLICT DO NOTHING` y ambas respuestas devuelven la misma actividad |
| Moodle devuelve el nombre de curso vacío | La actividad se importa con `courseName` vacío y se agrupa bajo un encabezado «Sin curso». No se bloquea el alta por un nombre |
| El curso se renombra en Moodle después del alta | Las actividades antiguas conservan el nombre viejo y las nuevas traen el nuevo: el mismo curso aparece como dos grupos. Es la consecuencia directa de RN-9 y la pregunta abierta 1 |
| La actividad se renombra en Moodle después del alta | Vega conserva su nombre (RN-4). La pantalla puede señalar la discrepancia, pero no la resuelve sola |
| El token sólo ve un curso de los varios que imparte el profesor | Se listan los cursos que el token ve. No se distingue de «no tiene más cursos»: el mensaje del estado vacío menciona los permisos del token |
| Curso con cientos de actividades | Se listan todas las del curso elegido, que es precisamente lo que RN-2 hace manejable. La búsqueda por nombre dentro del curso queda para cuando haga falta |
| Se importa una actividad de un curso y luego se cambia el conector en Ajustes | Las actividades importadas se quedan. Sus `moodleRef` dejan de resolver contra el nuevo conector y la ingesta fallará con error de configuración |
| Se importa una actividad que ya existe pero con el `moodleRef` a `null` (actividad local) | No se empareja: se crea una actividad nueva. Emparejar a mano una actividad de Vega con una de Moodle está fuera de alcance |

## Fuera de alcance

- **Configurar la actividad importada.** Nombre, puntuación, nota máxima, reparto, contexto y
  autonomía son HU-04 y HU-05. Aquí sólo nace con valores por defecto.
- **Descargar entregas.** Es HU-08. Importar una actividad no trae ni una sola entrega.
- **Borrar actividades**, ni las que hayan desaparecido de Moodle (RN-10).
- **Sincronización automática programada** del catálogo. El alta la dispara el profesor.
- **Emparejar a mano** una actividad ya existente en Vega con una actividad de Moodle.
- **Crear actividades que no existan en Moodle** (actividades locales). El esquema lo permite
  —`moodle_ref` es nullable— pero no hay pantalla ni endpoint, y esta HU no los añade.
- **Entidad `courses` y su migración.** Es la decisión que abre el hito; ver pregunta abierta 1.
- **Importar el reparto de puntos o la rúbrica desde Moodle.** La interfaz `LmsConnector` no lo
  contempla.

## Notas de implementación

**Entidades** (`@vega/shared`): `DiscoveredActivity` (`moodleRef`, `name`, `kind`, `courseName`,
`pendingCount`, `alreadyImported`), `Activity`, `ActivityKind`, `ACTIVITY_KIND_LABEL`.

**Contrato** (`packages/shared/src/api.ts`): `DiscoverActivitiesResponse`,
`ImportActivitiesRequest` (`moodleRefs: z.array(z.string()).min(1)`), `ImportActivitiesResponse`.

**Endpoints** (`routes`): `discoverActivities` → `GET /api/activities/discover`;
`importActivities` → `POST /api/activities/import`. Ambos con `preHandler: app.authenticate`.

**Conector**: `LmsConnector.listActivities(): Promise<DiscoveredActivity[]>` ya está en la interfaz
(`connectors/lms/src/connector.ts`) y `Moodle3Connector` ya la implementa: pide los cursos con
`core_enrol_get_users_courses`, las tareas con `mod_assign_get_assignments` y los foros con
`mod_forum_get_forums_by_courses`, y **aplana el curso a `courseName`, perdiendo el `course.id`**.

**UI**: `apps/frontend/src/components/activity/DiscoverActivitiesDialog.tsx`, abierto desde el botón
«Buscar en Moodle» de `ActivitiesPage.tsx`. Hoy pinta el catálogo entero agrupado por `courseName`,
con casilla por actividad, distintivo «Ya importada» y recuento de seleccionadas en el pie. Lo que
esta HU añade es el **paso previo de curso**: primero la lista de cursos, después las actividades
de uno solo, con vuelta atrás que conserva la selección.

**Lo que hoy NO está implementado y esta HU exige**:

- **El paso de selección de curso** no existe, ni en la pantalla ni en el contrato.
- **`GET /api/activities/discover` devuelve un catálogo constante** (`MOODLE_CATALOGUE`, definido en
  `apps/api/src/routes/activities.ts`) y **no llama al conector**. El comentario del propio fichero
  lo marca como pendiente. La forma de `DiscoveredActivity` ya es la definitiva, así que el cambio
  queda confinado a esa ruta.
- **`DiscoveredActivity` no tiene identificador de curso**, sólo `courseName`. Sin él no se puede
  filtrar por curso de forma fiable ni construir un selector estable. Es el centro de la pregunta
  abierta 1.
- **No hay `GET /api/courses`** ni ningún endpoint que enumere cursos, y `discover` no acepta
  parámetros de consulta. Con el contrato de hoy, el selector de curso sólo puede construirse
  agrupando en el cliente por la cadena `courseName`.
- **`activities.moodle_ref` no tiene índice único** (`0001_init.sql` lo creó como `lms_ref text`, sin
  `UNIQUE`). La idempotencia de RN-3 se apoya hoy en una consulta previa por `moodleRef` más el
  `UNIQUE` de `slug`, que la salva por accidente. Ver pregunta abierta 2.
- **Los escenarios 7 y 8 no se distinguen**: el conector lanza un `Error` genérico y la pantalla
  muestra siempre el mismo estado de fallo. Hace falta que el error de credenciales llegue
  diferenciado hasta el cliente.
- **`pendingCount` de una entrega es siempre `0`** en `Moodle3Connector`: contar pendientes exigiría
  `mod_assign_get_submissions`, que se trae las entregas enteras. Ver pregunta abierta 5.

**Mock**: parcial. La pantalla y el contrato funcionan enteros contra el catálogo simulado, con
alta idempotente real; lo que queda pendiente es que `discover` llame al conector y que el conector
se verifique contra un Moodle de verdad.

## Preguntas abiertas

1. **¿Hace falta la entidad `courses`?** Hoy el conector aplana el curso a `courseName` y pierde el
   `course.id`, y `Activity.courseName` es texto libre. Opciones: (a) **nada**, y construir el
   selector agrupando por la cadena `courseName` — sin migración y sin cambios de contrato, pero
   renombrar un curso en Moodle parte el grupo en dos, dos cursos homónimos se mezclan y el desglose
   por curso del panel (H1.d) hereda el mismo defecto; (b) **añadir `courseId` a
   `DiscoveredActivity` y `Activity`** sin tabla nueva, arrastrándolo desde el conector y filtrando
   `discover` por él — una columna y un campo de contrato, agrupación estable, pero el nombre del
   curso sigue sin poder actualizarse y hay que consultar Moodle para listar cursos en cada carga;
   (c) **tabla `courses`** (`id`, `moodle_course_id UNIQUE`, `name`) con FK desde `activities`, más
   `GET /api/courses` — agrupación estable, renombrado propagable, cursos listables sin depender de
   Moodle y base para el panel por curso, a cambio de una migración, un endpoint nuevo y decidir qué
   pasa cuando un curso desaparece de Moodle. Consecuencia: con (a) el selector de curso de esta HU
   se construye sobre una cadena que Moodle puede cambiar en cualquier momento.
   **`[bloqueante]`: es la decisión de diseño que abre el hito y condiciona el paso 1 del flujo.**

2. **¿`moodleRef` debe llevar el tipo y ser único?** `Moodle3Connector` construye el `moodleRef`
   como `String(assignment.id)` y `String(forum.id)`, de tablas distintas de Moodle: una tarea con
   id 5 y un foro con id 5 producen el mismo `moodleRef` y el mismo `slug`, y la segunda importación
   se pierde en silencio por el `ON CONFLICT DO NOTHING`. Opciones: (a) prefijar por tipo
   (`assign-5`, `forum-5`), como ya hace el catálogo simulado, y añadir
   `UNIQUE (moodle_ref)` — exige migración de datos si ya hay actividades importadas; (b) sólo
   prefijar, sin índice único, dejando la idempotencia apoyada en el `slug`; (c) dejarlo como está y
   asumir la colisión. Consecuencia: con (c) hay pérdida silenciosa de datos en cuanto los ids
   coincidan. **`[bloqueante]`: es un fallo de corrección, no una mejora.**

3. **¿Cómo se enumeran los cursos?** Opciones: (a) `GET /api/courses` nuevo, que delega en el
   conector o lee la tabla `courses` según se resuelva la pregunta 1; (b) `GET /api/activities/discover`
   acepta `?courseId=` y sin él devuelve sólo los cursos; (c) el cliente pide el catálogo entero una
   vez y deriva los cursos en memoria, que es lo único posible con el contrato de hoy. Consecuencia:
   (c) no requiere contrato nuevo pero trae todas las actividades de todos los cursos en cada
   apertura, que es justo lo que RN-2 quiere evitar.

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
   Consecuencia: hoy la pantalla dice «Sin entregas pendientes» de actividades que sí las tienen.

6. **¿Debe poder copiarse la configuración de otra actividad al importar?** El caso real es el curso
   siguiente: mismas actividades, mismo reparto, mismo contexto. Opciones: (a) nada, y configurar
   desde cero; (b) elegir en el alta una actividad existente de la que copiar reparto, solución y
   contexto; (c) resolverlo con la acción de duplicar de HU-04, pregunta abierta 5. Consecuencia:
   (b) y (c) son la misma funcionalidad entrando por dos sitios; conviene elegir uno.
