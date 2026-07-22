# Arquitectura

## Los dos trabajos

Vega reacciona a **actividades** de Moodle (`Activity`), y hay dos tipos (`ActivityKind`):

| | `assignment` — entrega | `forum` — foro |
|---|---|---|
| Qué manda el alumno | Un fichero (examen escaneado) | Texto escrito en el foro |
| Dónde llega | `submissions.original_filename` + páginas | `submissions.text_content` |
| ¿Transcripción? | Sí: `pending → transcribing → transcribed → grading` | No: `pending → grading` |
| ¿Se puntúa? | Normalmente sí (`graded = true`, `max_score` con valor) | Normalmente no (`graded = false`, `max_score = null`) |
| Qué produce | Apartados en `correction_items` + `corrections.ai_latex` | Sólo `corrections.ai_latex` |
| Qué se publica | Nota y feedback | Feedback, **sin nota** |

Quien decide es `hasStudentFile(kind)` de `@vega/shared`: devuelve `true` sólo para `assignment`, y
es la única bifurcación real del pipeline. Todo lo demás —resolución de contexto, motor, autonomía,
cola de revisión, publicación— es el mismo código para los dos.

**La nota es opcional, no un detalle de configuración.** `graded: boolean` y `maxScore: number |
null` son campos independientes con un `CHECK` que los ata (`activities_graded_needs_max_score`: si
se puntúa, tiene que haber nota máxima). Cuando `graded` es `false` el motor no alinea apartados, no
calcula nota y `RemoteGrade.score` viaja a `null`; el conector de Moodle traduce ese `null` a `-1`,
que es como Moodle representa «sin calificación».

## Vista de componentes

```mermaid
graph TB
  subgraph cliente["Cliente"]
    PWA["apps/frontend<br/>React 18 + Vite + Tailwind<br/>PWA · KaTeX · mobile-first"]
  end

  subgraph servidor["Servidor"]
    API["apps/api<br/>Node 22 + Fastify<br/>auth JWT · validación Zod<br/>aplica migraciones al arrancar"]
    CORE["packages/core<br/>motor de corrección<br/>puro · sin HTTP · sin LMS<br/>ejecutable por CLI"]
    SCHED["Planificador de lotes<br/>dentro de apps/api"]
  end

  SHARED["packages/shared<br/>esquemas Zod + tipos<br/>+ objeto routes"]

  subgraph conectores["connectors/"]
    LMSIF["interfaz LmsConnector<br/>8 operaciones"]
    MOCK["mock<br/>(por defecto)"]
    FS["filesystem"]
    M3["moodle3<br/>sin verificar contra Moodle real"]
  end

  subgraph ia["Proveedor de IA"]
    AIIF["interfaz AiProvider"]
    AIMOCK["mock<br/>(por defecto)"]
    ANTH["anthropic<br/>Messages · prompt caching"]
  end

  DB[("PostgreSQL 16<br/>Drizzle ORM")]
  SEED["pnpm db:demo<br/>script de desarrollo"]
  CTX[["contexts/<br/>Markdown versionado en git"]]
  FILES[["Almacén de ficheros<br/>STORAGE_ROOT: las entregas descargadas<br/>los ficheros de texto del contexto<br/>siguen en activity_files.content"]]
  LMS(["LMS de la academia<br/>Moodle 3.x"])

  PWA -->|"HTTPS · /api/*"| API
  PWA -.->|tipos y rutas| SHARED
  API -.->|tipos y validación| SHARED
  CORE -.->|tipos| SHARED

  API --> DB
  API --> CORE
  SCHED --> CORE
  API -->|"entregas descargadas"| FILES
  SEED --> CTX
  SEED --> DB
  CORE --> AIIF
  AIIF --> AIMOCK
  AIIF --> ANTH
  API -->|"catálogo: cursos y actividades"| LMSIF
  API -->|"ingesta y publicación"| LMSIF
  LMSIF --> MOCK
  LMSIF --> FS
  LMSIF --> M3
  M3 --> LMS
```

Dos flechas que no son sólidas y conviene leer despacio:

- **`contexts/` no lo lee el API en tiempo de ejecución.** Los Markdown del repositorio los lee el
  script de siembra (`apps/api/src/db/demo.ts`) y los vuelca en la tabla `grading_contexts`. A
  partir de ahí manda la base de datos: `readContextLevel()` consulta la tabla y nada más. Ver
  [`contexts/README.md`](../contexts/README.md).
- **El API usa ya las ocho operaciones del conector.** El catálogo entró en H2
  (`GET /api/courses/discover`, `GET /api/activities/discover`, `POST /api/activities/import`); la
  ingesta y la publicación, en el ADR 0012. Lo que **no** ha ocurrido todavía es ejecutar nada de
  esto contra un Moodle real: `connectors/moodle3` sigue probado sólo con `fetchImpl` inyectado y
  sigue siendo el riesgo principal del proyecto. Ver «Estado real» al final.
- **El conector se construye por usuario, no por instalación.** La URL y el nombre del conector salen
  de `app_settings`; el token, de `users.moodle_token` del usuario en sesión, porque
  `core_enrol_get_users_courses` devuelve los cursos del dueño del token. Ver
  [ADR 0010](decisiones/0010-credencial-moodle-por-usuario.md).

**Lo que no aparece en el diagrama a propósito**: no hay cola de mensajes externa, ni Redis, ni
worker separado. El planificador de lotes vive dentro del proceso de `apps/api` y se protege con
`pg_try_advisory_lock`, de modo que si algún día hay dos réplicas sólo una ejecute el lote. Para el
volumen de una academia (decenas de entregas por noche, no miles) una segunda pieza de
infraestructura sería coste sin beneficio. El día que deje de serlo, la frontera por la que partir
ya está dibujada: `packages/core` no depende de Fastify, así que se puede sacar a un proceso propio
sin tocar la lógica.

## Flujo de una entrega, de principio a fin

```mermaid
sequenceDiagram
  autonumber
  participant LMS as LMS (Moodle)
  participant CN as Conector
  participant API as apps/api
  participant DB as PostgreSQL
  participant CORE as packages/core
  participant AI as Proveedor de IA
  participant PROF as Profesor (PWA)

  rect rgb(245, 245, 245)
    Note over LMS,DB: Ingesta — la ejecuta el lote antes de corregir (ADR 0012)
    API->>CN: listSubmissions(activityRef)
    CN->>LMS: consulta entregas
    LMS-->>CN: entregas nuevas
    CN-->>API: RemoteSubmission[]
    API->>CN: download(ref)
    CN-->>API: DownloadedFile
    API->>DB: INSERT submission (pending)
    Note right of DB: UNIQUE (activity_id, remote_id) evita duplicados,<br/>también en foros. Sólo se descarga si el INSERT creó fila
  end

  Note over API: Lote — se crea un BatchRun
  API->>DB: status = transcribing
  API->>CORE: gradeSubmission({ activityKind: 'assignment', pages, context, … })
  CORE->>AI: transcribe — visión, manuscrito a texto con fórmulas
  AI-->>CORE: páginas + marcas [ILEGIBLE]/[DUDA] + confianza

  CORE->>AI: grade — corrección sobre la transcripción
  Note right of CORE: context = global + tipo de actividad + actividad,<br/>concatenados por resolveContext()
  AI-->>CORE: items (aiPoints, aiFeedback, confidence,<br/>alternativeMethod) + aiLatex + usage
  CORE-->>API: GradeSubmissionResult
  API->>DB: INSERT transcription + correction + correction_items
  API->>DB: status = graded (o published, si la autonomía lo permite)

  Note over PROF: La entrega entra en la cola de revisión
  PROF->>API: GET /api/submissions/{id}
  API-->>PROF: SubmissionDetail (escaneo + transcripción + corrección)
  PROF->>API: PATCH .../correction (teacherPoints, teacherFeedback, teacherLatex)
  API->>DB: UPDATE correction_items
  PROF->>API: POST .../validate
  API->>DB: validated_by, validated_at · status = validated

  PROF->>API: POST .../publish
  rect rgb(245, 245, 245)
    Note over API,LMS: Dos operaciones, dos marcas: el reintento no republica la nota
    API->>CN: publishGrade(RemoteGrade)
    API->>CN: publishFeedbackFile(PDF)
    CN->>LMS: escribe nota y fichero
  end
  API->>DB: published_at · status = published
  API-->>PROF: CorrectionResponse
```

## Flujo de una intervención de foro

El mismo motor, con dos pasos menos. No hay fichero que descargar, no hay OCR y no hay nota que
publicar.

```mermaid
sequenceDiagram
  autonumber
  participant LMS as LMS (Moodle)
  participant CN as Conector
  participant API as apps/api
  participant DB as PostgreSQL
  participant CORE as packages/core
  participant AI as Proveedor de IA
  participant PROF as Profesor (PWA)

  rect rgb(245, 245, 245)
    Note over LMS,DB: Ingesta — cableada; en moodle3, sólo la primera duda sin responder de cada debate
    API->>CN: listSubmissions({ kind: 'forum' })
    CN->>LMS: mensajes del debate
    CN-->>API: RemoteSubmission[] con textContent y filename = null
    API->>DB: INSERT submission (pending, text_content, original_filename = null)
  end

  Note over API: Lote — hasStudentFile('forum') es false
  API->>DB: status = grading
  Note right of API: No pasa por `transcribing`:<br/>no hay nada que transcribir
  API->>CORE: gradeSubmission({ activityKind: 'forum', textContent, graded: false, maxScore: null })
  CORE->>AI: grade — sobre el texto del alumno, sin transcripción
  AI-->>CORE: aiLatex + aiSummary + confianza (items vacío)
  CORE-->>API: GradeSubmissionResult (transcription = null, score = null)
  API->>DB: INSERT correction (ai_latex, max_score = null, sin correction_items)
  API->>DB: status = graded

  PROF->>API: POST .../validate
  PROF->>API: POST .../publish
  rect rgb(245, 245, 245)
    API->>CN: publishForumReply(RemoteReply)
    CN->>LMS: mod_forum_add_discussion_post, colgando del mensaje del alumno
  end
  API->>DB: published_at · status = published
```

Detalles que sólo se ven mirando el código:

- **`corrections.ai_latex` es la única salida de una actividad no puntuable.** No hay apartados que
  guardar, así que `correction_items` se queda vacío y `corrections.max_score` a `null`. Todo el
  valor está en el documento redactado. `effectiveLatex()` decide cuál vale: el del profesor si lo
  ha editado, si no el de la IA.
- **La confianza se calcula distinto.** Con transcripción, `overallConfidence()` pondera OCR (0,4) y
  corrección (0,6) y resta 0,05 por cada marca. Sin transcripción no hay nada que ponderar: manda la
  corrección. Y sin apartados que promediar, se usa la confianza que reporta el propio proveedor
  sobre el documento que ha redactado.
- **El PDF de feedback no aplica.** `annotatedFileUrl` se guarda a `null` cuando no hay fichero del
  alumno: no hay original que anteponer a las páginas de corrección.
- **La regla de publicación no cambia.** Un foro pasa por `validated` igual que una entrega, y
  `POST /api/submissions/{id}/publish` responde `409 CONFLICT` si la entrega no está validada. Ver
  [ADR 0004](decisiones/0004-validacion-humana-obligatoria.md).

## Notas sobre el flujo

1. **La transcripción y la corrección son dos llamadas separadas.** Transcribir es un problema de
   visión; corregir es un problema de razonamiento sobre texto. Separarlas permite reintentar sólo
   la parte que falló, cachear el contexto de corrección entre entregas de la misma actividad, y
   —lo más importante— enseñar al profesor la transcripción para que juzgue si la corrección parte
   de una lectura correcta del manuscrito. En un foro sólo hay la segunda llamada.
2. **El lote se ordena por actividad**, no por fecha (`ORDER BY activity_id, submitted_at`). Todas
   las entregas de `tema04` seguidas comparten el mismo prefijo de prompt —los tres niveles de
   contexto—, que es exactamente lo que el prompt caching abarata. Ordenar por fecha invalidaría la
   caché en cada salto de actividad. El contexto resuelto se memoriza además por actividad dentro
   del lote, y el proveedor de IA se instancia una sola vez para todo el lote.
3. **La publicación es un paso explícito**, separado de la validación. Validar es un acto del
   profesor; publicar es una operación de red que puede fallar (LMS caído, token caducado) y se
   puede reintentar sin volver a molestar al profesor.
4. **Nada llega al alumno sin `validated_at`**, salvo por la vía de la autonomía, que es explícita y
   se decide actividad a actividad.
5. **Tope de 25 entregas por ejecución** (`MAX_PER_RUN`), para que un lote lanzado a mano no se coma
   la tarde. Un fallo en una entrega la deja en `error` con el mensaje truncado a 500 caracteres y
   el lote continúa con la siguiente.

## Autonomía por actividad

`AutonomyMode` se guarda en `activities.autonomy` y decide qué pasa con una corrección recién hecha:

| Modo | Qué hace |
|---|---|
| `review_all` | El profesor valida todo. Es el valor por defecto. |
| `review_low_confidence` | Se publica sola si la confianza global supera 0,75 **y** el OCR no dejó ninguna marca. El resto espera en la cola. |
| `autonomous` | Se publica sin intervención. |

La conjunción de `review_low_confidence` no es redundante: una marca `[ILEGIBLE]` significa que hay
papel que nadie ha leído, y eso no se publica sin profesor por muy alta que sea la confianza.

Lo que se publica solo queda marcado (`corrections.published_automatically`) y se cuenta aparte en
el lote (`batch_runs.submissions_auto_published`). El motor añade además un aviso
`autonomy_below_threshold` cuando el modo permitiría publicar sin supervisión pero la confianza
global no da para tanto.

La métrica que dice cuándo una actividad está lista para más autonomía es `avgTeacherDeviation` de
`GET /api/stats/overview`: la desviación media entre lo que propuso la IA y lo que validó el
profesor. Ver [ADR 0008](decisiones/0008-separar-puntos-ia-y-profesor.md).

## Por qué el monorepo está partido así

```
apps/
  api/          servidor Fastify + migraciones SQL + planificador de lotes
  frontend/     PWA React (paquete @vega/frontend, imagen vega-frontend)
packages/
  core/         motor de corrección: transcribir y corregir
  shared/       esquemas Zod, tipos y objeto routes
connectors/
  lms/          la interfaz LmsConnector, el registro y el conector mock
  filesystem/   carpeta local como si fuera un LMS
  moodle3/      Moodle 3.x por web services
contexts/       contextos de corrección en Markdown, versionados con git
deploy/         ficheros compose de test y de producción
docs/           esta carpeta
```

`pnpm-workspace.yaml` declara `apps/*`, `packages/*` y `connectors/*`.

### `packages/shared` — el contrato, no una librería de utilidades

Es el único paquete del que dependen todos los demás, y a propósito no contiene lógica de negocio:
sólo esquemas Zod, los tipos inferidos de ellos, un puñado de funciones puras derivadas del modelo
(`effectivePoints`, `effectiveSource`, `effectiveLatex`, `totalScore`, `hasStudentFile`), las
etiquetas en español (`ACTIVITY_KIND_LABEL`, `AUTONOMY_MODE_LABEL`…) y el objeto `routes`.

El valor está en que **el mismo esquema valida en los dos extremos del cable**. El front no
escribe rutas a mano ni redefine formas de datos; el API valida la entrada contra el mismo objeto
que el front usó para construirla. Un cambio de contrato rompe la compilación en ambos lados a la
vez, que es cuando se quiere que rompa.

La regla que mantiene esto sano: **`shared` no importa nada de `api`, `frontend`, `core` ni
`connectors`.** Si algo necesita ir en la dirección contraria, no pertenece a `shared`.

### `packages/core` — el motor, sin saber que existe la web

`gradeSubmission()` recibe el proveedor de IA, el contexto sin resolver, el reparto de puntos y si
la actividad se puntúa; devuelve transcripción (o `null`), corrección, nota (o `null`), contexto
resuelto, consumo y la lista de avisos de revisión. No conoce Fastify, ni la base de datos, ni el
LMS.

Aquí vive todo lo que es regla de negocio y no puede duplicarse: la normalización a cuartos de punto
(`POINT_STEP`), el emparejamiento de lo que devuelve la IA con el reparto del profesor
(`alignItems`, donde manda el reparto y no la IA), el cálculo de la confianza global y la detección
de lo que el profesor tiene que mirar sí o sí (`detectReviewFlags`).

Tres razones concretas para tenerlo aparte:

- **Se ejecuta por CLI**, que es como se ajustan los prompts sin levantar toda la aplicación ni
  ensuciar la base de datos:

  ```
  pnpm --filter @vega/core cli grade --actividad tema04 --pdf examen.pdf
  pnpm --filter @vega/core cli grade --actividad foro-didactica --tipo foro
  ```

  La CLI lee los contextos directamente de la carpeta `contexts/` (`--contextos <ruta>`), no de la
  base de datos: es el único sitio donde los ficheros del repositorio se usan para corregir de
  verdad.
- **Se testea con el proveedor de IA en modo mock**, sin red y sin coste.
- **Se puede sacar a un proceso propio** si el volumen lo pide, porque la frontera ya está trazada.

### `apps/api` — el que sí sabe de todo

Orquesta: autentica, consulta la base de datos, resuelve el contexto de los tres niveles, llama a
`core`, persiste el resultado, expone HTTP y aplica las migraciones al arrancar. También aloja el
planificador de lotes. Es el único que escribe en Postgres.

Genera además el PDF de feedback al vuelo en `GET /api/submissions/{id}/feedback.pdf`, con `pdf-lib`
(JS puro, para que la imagen del API siga siendo Node sin compilador). **El LaTeX no se compila**:
se vuelca como texto legible y paginado. Cuando haya compilación real sólo cambia
`renderCorrectionPages`.

### `apps/frontend` — mobile-first de verdad

El profesor corrige de pie, entre clases, con una mano. La pantalla de revisión se diseña primero
para 375 px y luego se ensancha, no al revés. Consume exclusivamente el contrato de `shared` y
renderiza LaTeX con KaTeX. Es instalable como PWA.

El paquete se llama `@vega/frontend` y su imagen `vega-frontend`.

### `connectors/` — fuera de `packages/` a propósito

Están al mismo nivel que `apps` y `packages` porque son **puntos de extensión de terceros**: la
invitación es que quien tenga otro LMS añada un directorio aquí, implemente siete métodos y abra
un PR, sin entender el resto del monorepo. Enterrarlos en `packages/` los haría parecer detalle
interno. Ver [ADR 0009](decisiones/0009-interfaz-lms-siete-operaciones.md), que sustituye al
[ADR 0006](decisiones/0006-conectores-lms-interfaz-minima.md).

La interfaz `LmsConnector` son ocho operaciones: `listCourses`, `verifyConnection`,
`listActivities`, `listSubmissions`, `download`, `publishGrade`, `publishFeedbackFile` y
`publishForumReply`. Las dos primeras y el filtro por curso de la tercera entraron en H2, cuando el
alta de actividades pasó de un catálogo simulado a un Moodle real; la última, con el
[ADR 0014](decisiones/0014-publicar-en-foro-y-verificar-la-escritura.md). Los tipos que cruzan esa
frontera son deliberadamente pobres (`ActivityRef`, `SubmissionRef`, `RemoteSubmission`,
`RemoteGrade`, `RemoteReply`): un conector mueve ficheros, textos y notas; corregir no es asunto
suyo.

**Las tres últimas escriben, y no son intercambiables.** Un foro no tiene libro de notas: una
respuesta validada se publica con `publishForumReply` y **nunca** con `publishGrade`, que los
conectores rechazan sobre una actividad de foro. No es una precaución teórica — antes de la
bifurcación, el `remoteId` de una duda (`<foro>:<debate>:<mensaje>`) se leía sin error como el de una
entrega (`<tarea>:<usuario>:<intento>`) y la respuesta acababa como nota de otra actividad, a otro
alumno. Ver ADR 0014.

**Los modos de fallo sí son parte del contrato**, y no lo eran: `LmsAuthError` («tu credencial no
vale, pasa por Ajustes») y `LmsUnavailableError` («el LMS no responde, reinténtalo») se reconocen por
su `code` y no con `instanceof` —entre dos copias del paquete `instanceof` falla en silencio— y
llegan al cliente como `LMS_AUTH` (422) y `LMS_UNAVAILABLE` (502).

Dos decisiones de esa frontera que sostienen el caso del foro:

- `RemoteSubmission.filename` es `nullable` y `RemoteSubmission.textContent` lleva el texto ya
  concatenado del alumno. `download()` sólo tiene sentido en `assignment`; el mock y el conector de
  filesystem lanzan un error explícito si se les pide para un foro.
- `RemoteGrade.score` y `RemoteGrade.maxScore` son `nullable`, e `items` puede venir vacío. Así una
  actividad no puntuable publica feedback sin que el LMS reciba ninguna calificación.

### `contexts/` — en el repositorio, no en la base de datos

Los contextos de corrección son ficheros Markdown versionados con git. El repositorio guarda el
juego por defecto, que es el que `pnpm db:demo` vuelca en la tabla `grading_contexts`. A partir de
ahí, la aplicación lee siempre de la base de datos y la edición desde la UI escribe allí.

El motivo de tener los dos: git da historial, diff y revisión por pares sobre unas instrucciones
que **determinan las notas de los alumnos** — un cambio en `contexts/global.md` es un cambio de
criterio de evaluación y merece el mismo escrutinio que un cambio de código. La base de datos da
edición inmediata desde el móvil, que es lo que el profesor necesita a las once de la noche.

> La reconciliación entre ambos (¿qué gana si el fichero y la fila divergen?, ¿se hace commit
> automático al editar desde la UI?) es una pregunta abierta: ver `HU-06` y
> [`contexts/README.md`](../contexts/README.md).

**Los prompts son el modelo de personalización del producto.** Vega no sabe de matemáticas: sabe de
corregir. Lo que la hace servir a un departamento de lengua o a uno de física está en estos
Markdown, que edita el profesorado. El OCR y KaTeX existen porque hay trabajo manuscrito, no porque
el dominio sea matemático.

## Estado real

Lo que funciona de punta a punta hoy, con `LMS_CONNECTOR=mock` y `AI_PROVIDER=mock`: **ingerir**
entregas del conector con su fichero, corregir por lotes (entregas y foros), revisar, editar,
validar, **publicar contra el conector** y ver el consumo. Un repaso completo de en qué estado queda
cada pieza de cara al motor de IA está en
[`revision/h2-preparacion-motor-ia.md`](revision/h2-preparacion-motor-ia.md). Lo que no:

| Qué | Dónde | Estado |
|---|---|---|
| Ingesta desde el LMS | `apps/api/src/ingest/` | **Cableada** (ADR 0012). El lote llama a `listSubmissions()` y a `download()` antes de corregir, con la credencial de `activities.imported_by`. Idempotente por `UNIQUE (activity_id, remote_id)`. **Sin verificar contra un Moodle real.** |
| Ficha del alumno | `apps/api/src/ingest/` · `students` | **Implementada** (ADR 0013). La ingesta trae el perfil de Moodle —nombre, correo, centro y campos personalizados— y lo refresca en cada pasada. Al modelo viaja **sólo** el recorte de `studentContextFor()`: nombre, comunidad autónoma, provincia y población. NIF, DNI, dirección y código postal se guardan y **no salen nunca**. |
| Publicación en el LMS · entregas | `routes/submissions.ts` · `publish/publish.ts` | **Cableada** (ADR 0012). `POST .../publish` llama a `publishGrade` y a `publishFeedbackFile` con lo **efectivo**, y registra cada una por separado para que el reintento no republique la nota. Un conector sin fichero de feedback no es un fallo: se publica la nota y se explica en `corrections.publish_notice`. **Sin verificar contra un Moodle real.** |
| Publicación en el LMS · foros | `publish/publish.ts` · `connectors/moodle3` | **Cableada** (ADR 0014). `publishForumReply` cuelga la respuesta del mensaje del alumno con `mod_forum_add_discussion_post`, una sola operación y una sola marca. Corrige un fallo que escribía notas en el sitio equivocado sin dar error. **Lo que falta es el formato**: hoy se manda el documento de corrección, que es LaTeX/markdown, y un mensaje de foro es prosa. Lo decide H3. **Sin verificar contra un Moodle real.** |
| Verificación del token | `connectors/moodle3` · Ajustes | **Ampliada** (ADR 0014). Las funciones de lectura se prueban llamándolas; las de escritura (`mod_assign_save_grade`, `mod_forum_add_discussion_post`) **no se pueden ensayar** —calificarían a un alumno o publicarían un mensaje— y se comprueban contra el catálogo de funciones del token. Eso dice si la función está en el servicio, no si el usuario tiene la capacidad. |
| Catálogo de actividades de Moodle | `routes/activities.ts` · `lms/factory.ts` | **Cableado.** `GET /api/courses/discover`, `GET /api/activities/discover` y `POST /api/activities/import` llaman al conector de verdad; `MOODLE_CATALOGUE` ha desaparecido. `apps/api` depende ya de `@vega/connector-{lms,moodle3,filesystem}`. |
| `moodle3` · listar cursos, tareas y foros | `connectors/moodle3` | **Implementado, sin verificar contra un Moodle real.** Usa `core_enrol_get_users_courses`, `mod_assign_get_assignments` y `mod_forum_get_forums_by_courses`, y ya conserva el id del curso. Tiene tests unitarios con `fetchImpl` inyectado y varios `TODO(vega)` abiertos. `pendingCount` de una entrega se devuelve a 0 a propósito: contarlo obligaría a bajarse todas las entregas. **Sigue siendo el riesgo principal del proyecto.** |
| `moodle3` · comprobar la credencial | `connectors/moodle3` | **Implementado**, sin verificar contra un Moodle real. `verifyConnection()` usa `core_webservice_get_site_info` y devuelve sitio, usuario y número de cursos. No distingue «no tienes cursos» de «al servicio le falta habilitar `core_enrol_get_users_courses`». |
| `moodle3` · leer intervenciones de un foro | `connectors/moodle3` | **Implementado, sin verificar.** `mod_forum_get_forum_discussions_paginated` más los mensajes de cada debate. Produce **como mucho una entrega por debate**: la del mensaje raíz, y sólo si nadie distinto del autor ha respondido —Vega contesta la primera duda sin responder, no todas—. Dos supuestos por confirmar: `mod_forum_get_forum_discussion_posts` quedó obsoleta en Moodle 3.8, y la paginación asume que el sitio respeta `perpage`. |
| `moodle3` · subir el PDF de feedback | `connectors/moodle3` | **Sin resolver, y ya no bloquea.** `publishFeedbackFile()` sigue rechazando siempre —Moodle 3 no expone un web service limpio para `assignfeedback_file`—, pero desde el ADR 0012 eso deja la entrega en `published` con un aviso en vez de en `error`: la nota y el feedback en HTML llegan igual. Falta el spike contra un Moodle real (HU-17, pregunta 1). |
| Ficheros de contexto · texto | `routes/activities.ts` | **Implementado.** `.tex`, `.md`, `.markdown` y `.txt` guardan su contenido en `activity_files.content`. Subida troceada de 256 KiB, tope de 4 MiB, y `upload_complete` para que una subida a medias no se liste ni entre en el contexto. |
| Almacén de binarios | `apps/api/src/storage/` | **Implementado para las entregas** (ADR 0012): el fichero descargado se guarda en `STORAGE_ROOT` y su ruta relativa en `submissions.storage_path`; `page_count` se cuenta del PDF de verdad con `pdf-lib`. **Los ficheros de contexto de una actividad siguen sin almacén** (`activity_files.storage_path` sigue a `null`). Las páginas escaneadas de la UI siguen siendo SVG generados al vuelo (`routes/scans.ts`): enseñar el original exigiría rasterizar. |
| Compilación de LaTeX | `feedback/pdf.ts` | **Simulada.** Se vuelca el LaTeX como texto legible; el «original del alumno» del PDF se reconstruye a partir de la transcripción y va etiquetado como reproducción. |
| `referenceSolution` y ficheros en el prompt | `packages/core` · `routes/batch.ts` | **Cerrado.** `resolveContext()` monta la sección —«Solución de referencia» si se puntúa, **«Material asociado»** si no— y `batch.ts:232-245` le pasa `referenceSolution`, `graded` y el contenido de los ficheros de texto completos. Lo que el profesor ve en la pantalla de contexto efectivo **es** lo que lee el modelo. Esta fila decía lo contrario y era falsa: quien leyera sólo la documentación concluiría que Vega corrige a ciegas. |
| Alcance por curso | `auth/scope.ts` | **Implementado.** Un `teacher` sólo alcanza las actividades, las entregas y los agregados del panel de sus cursos (`course_teachers`) más lo que él importó; un `admin` lo ve todo, y sólo él ve `lastBatchRun`. Antes `GET /api/activities` devolvía todo a cualquier autenticado. **Nada limpia `course_teachers`**: el acceso se anota al listar cursos y no caduca. |
| `POST /api/batch/run` | `routes/batch.ts` | **Sigue siendo síncrono**: espera a que el lote termine, y con llamadas reales la petición puede colgarse minutos. Es el hueco de orquestación que queda (HU-09, RN-8). Lo que sí está resuelto: es de **administración**, y devuelve `409` si ya hay un lote en `running`. |
| `GET /api/health` | `routes/health.ts` | Verifica **sólo la base de datos** (`SELECT 1`, y 503 si falla). `aiProvider` y `lmsConnector` son el valor de configuración, no una comprobación, y no dicen nada del token de nadie. |

## Despliegue

Dos entornos, **test** y **prod**, cada uno gobernado por su propia instancia de Portainer
apuntando a un fichero compose distinto en `deploy/`. CI/CD publica las imágenes en GHCR y
actualiza los stacks. Los cambios de esquema viajan dentro de la imagen del API: las migraciones
SQL se aplican de forma idempotente al arrancar el contenedor, así que el despliegue no tiene
pasos manuales. Ver [ADR 0002](decisiones/0002-migraciones-sql-planas.md) y
[ADR 0007](decisiones/0007-dos-entornos-portainer.md).

```mermaid
graph LR
  DEV[push a main] --> GHA[GitHub Actions<br/>lint · tests · build]
  GHA --> GHCR[(GHCR<br/>vega-api · vega-frontend)]
  GHCR --> PT[Portainer test<br/>deploy/test/docker-compose.yml]
  GHCR --> PP[Portainer prod<br/>deploy/prod/docker-compose.yml]
  PT --> DBT[(Postgres test)]
  PP --> DBP[(Postgres prod)]
```

Endpoints de salud para el proxy inverso: `GET /api/health` y `/health.txt` en el front.
