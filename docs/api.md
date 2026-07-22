# API HTTP

Referencia derivada del objeto `routes` de `packages/shared/src/api.ts`. **El contrato manda**: si
esta página y `api.ts` discrepan, el error está aquí.

- Base: todo cuelga de `/api`. El front nunca escribe rutas a mano; las toma de `routes`.
- Formato: JSON en petición y respuesta, `Content-Type: application/json`, UTF-8.
- Fechas: ISO 8601 con offset (`IsoDate`), en UTC.
- Identificadores: UUID v4 (`Id`).
- Validación: la misma definición Zod valida en el cliente antes de enviar y en el servidor al
  recibir. Un cuerpo o una query que no validen devuelven **`422 UNPROCESSABLE`** con `error.fields`
  — lo produce `parseOrThrow`, y **no es 400**.
- Tamaño de cuerpo: **2 MiB** (`bodyLimit` de Fastify, fijado explícitamente en `server.ts`). Por eso
  la subida de ficheros va troceada.

## Autenticación y permisos

Autenticación por **JWT en cabecera**: `Authorization: Bearer <token>`. El token se obtiene en
`POST /api/auth/login` y caduca según `JWT_EXPIRES_IN` (12 h por defecto). No hay refresh token en
el contrato actual — ver [Huecos del contrato](#huecos-del-contrato).

Dos roles (`UserRole`), y la regla es simple: **el profesor hace todo lo relativo a corregir; el
administrador además gestiona usuarios, ajustes de instalación y lo ve todo.**

| Nivel | Significado |
|---|---|
| Público | Sin token |
| Autenticado | Token válido de usuario con `active = true` |
| Profesor | Rol `teacher` o `admin` |
| Administrador | Rol `admin` únicamente |

Un usuario desactivado desde que se emitió su token recibe `401 UNAUTHORIZED` al rehidratar la
sesión, y no puede iniciarla.

### Alcance por curso

Desde `0004_course_access.sql`, **el rol no es lo único que filtra**. Un `teacher` sólo alcanza:

- las actividades de los cursos en los que Moodle le ha visto (`course_teachers`, que se rellena al
  llamar a `GET /api/courses/discover`), y
- las que él mismo importó (`activities.imported_by`), como respaldo para lo anterior a la migración.

Un `admin` no se filtra por nada. La regla vive en `apps/api/src/auth/scope.ts` y afecta a
`GET /api/activities`, a toda la cola de revisión, a los recuentos y **a los agregados del panel**:
un profesor ve su gasto y su desviación, no los del claustro. **Pedir la actividad o la entrega de
otro devuelve `403 FORBIDDEN`, no 404**: dentro de una academia, decirle a un profesor que existe
pero es de otro le ahorra pensar que ha perdido su trabajo.

## Envoltorio de error

Todas las respuestas de error tienen la misma forma (`ApiError`):

```json
{
  "error": {
    "code": "UNPROCESSABLE",
    "message": "La selección no es válida.",
    "fields": { "moodleRefs": "Selecciona al menos una actividad" }
  }
}
```

`code` es un valor estable de un enum cerrado, pensado para hacer `switch` en el front.
`message` va en español y es apto para mostrarse tal cual. `fields` sólo aparece en errores de
validación.

| `code` | HTTP | Cuándo |
|---|---|---|
| `BAD_REQUEST` | 400 | Regla de negocio simple incumplida (desactivarse a uno mismo…). **La validación de esquema no pasa por aquí** |
| `UNAUTHORIZED` | 401 | Falta el token, está mal formado, ha caducado, o el usuario ya no está activo |
| `FORBIDDEN` | 403 | Token válido pero rol insuficiente, o recurso fuera del alcance del usuario |
| `NOT_FOUND` | 404 | El recurso no existe |
| `CONFLICT` | 409 | La operación contradice el estado actual (publicar sin validar, correo duplicado, subida ya cerrada…) |
| `UNPROCESSABLE` | 422 | Cuerpo o query que no validan, o contenido inválido para el dominio |
| `LMS_AUTH` | **422** | **El LMS ha rechazado la credencial**, o falta configurarla. Es configuración, no sesión |
| `LMS_UNAVAILABLE` | **502** | **El LMS no responde** o devuelve algo ininteligible. Se puede reintentar sin cambiar nada |
| `INTERNAL` | 500 | Fallo no previsto. `message` genérico; el detalle va al log |

> **`LMS_AUTH` no es 401 a propósito.** El cliente cierra la sesión al recibir un 401, y echar al
> profesor de Vega porque su token de Moodle ha caducado sería absurdo: el problema está en Ajustes,
> no en su sesión. La UI lleva allí y **no ofrece reintentar**. `LMS_UNAVAILABLE`, al revés, sí
> ofrece reintentar y no cambia nada de la configuración. Ver
> [ADR 0009](decisiones/0009-interfaz-lms-siete-operaciones.md).

## Paginación

Los listados paginados devuelven `{ items, meta }` con `PageMeta`:

```json
{ "items": [], "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 } }
```

Los parámetros `page` y `pageSize` viajan en query string y se coercen a número.
`pageSize` tiene tope 100.

---

## Salud

### `GET /api/health`

`routes.health` · **Público**

Sonda para el proxy inverso y fuente de la pantalla de estado del sistema.

**Respuesta 200** — `HealthResponse`

| Campo | Tipo | Notas |
|---|---|---|
| `status` | `'ok' \| 'degraded'` | `degraded` si la base de datos no responde |
| `version` | `string` | Versión de la imagen desplegada |
| `database` | `'up' \| 'down'` | Resultado de un `SELECT 1` real |
| `aiProvider` | `string` | `mock`, `anthropic`. El valor **efectivo** de la configuración |
| `lmsConnector` | `string` | `mock`, `filesystem`, `moodle3` |
| `uptimeSeconds` | `number` | Segundos desde el arranque del proceso |

Responde **503** con el mismo cuerpo cuando la base de datos está caída, para que el orquestador deje
de mandarle tráfico. `aiProvider` y `lmsConnector` son el valor configurado, **no una comprobación**:
no dicen nada sobre si la clave o el token de alguien sirven.

---

## Autenticación

### `POST /api/auth/login`

`routes.login` · **Público**

**Petición** — `LoginRequest`: `email` (formato de correo) y `password` (no vacío).

**Respuesta 200** — `LoginResponse`: `{ token, expiresAt, user }`.

**Errores**: 422 (el cuerpo no valida); **401 `UNAUTHORIZED`** con el **mismo mensaje** tanto si el
correo no existe como si la contraseña falla, y también si el usuario está inactivo — no se filtra
qué correos están dados de alta ni cuáles siguen activos. Se gasta el tiempo de un hash aunque el
usuario no exista, para no filtrarlo por tiempo de respuesta.

Efecto lateral: actualiza `users.last_login_at`.

### `GET /api/auth/me`

`routes.me` · **Autenticado**

Rehidrata la sesión al abrir la PWA y comprueba contra base de datos que el usuario sigue activo: el
JWT puede sobrevivir a la baja.

**Respuesta 200** — `MeResponse`: `{ user }`. Incluye `moodleTokenConfigured`, que es lo único que se
publica del token.

**Errores**: 401 (token ausente, inválido, caducado, o usuario ya no activo).

### `PUT /api/auth/me/moodle-token`

`routes.myMoodleToken` · **Autenticado** · sólo el suyo

El token de Moodle es **de cada profesor, no de la instalación**:
`core_enrol_get_users_courses` devuelve los cursos del dueño del token, así que la credencial decide
qué cursos ofrece la aplicación. Ver
[ADR 0010](decisiones/0010-credencial-moodle-por-usuario.md).

**Petición** — `UpdateMoodleTokenRequest`: `{ "token": "…" }`. **`null` borra el token guardado.**

**Respuesta 200** — `MeResponse`. El valor **no vuelve nunca**; sólo `user.moodleTokenConfigured`.

**Errores**: 422, 401.

### `POST /api/auth/me/moodle-token/test`

`routes.testMyMoodleConnection` · **Autenticado** · sólo el suyo

**Sin cuerpo.** Prueba el token guardado contra Moodle.

**Respuesta 200** — `MoodleConnectionResponse`

| Campo | Tipo | Notas |
|---|---|---|
| `ok` | `boolean` | |
| `message` | `string` | Qué ha fallado, en lenguaje que lleve a la solución |
| `siteName` | `string \| null` | Sólo si `ok`. Contra qué Moodle se ha conectado |
| `username` | `string \| null` | Sólo si `ok`. **Como quién** |
| `courseCount` | `number \| null` | Cursos que alcanza ese token |

> **Un token inválido responde 200 con `ok: false`, no un código de error.** No es un fallo de esta
> ruta: es su respuesta, y el profesor está justo comprobando si funciona — necesita leer *por qué*
> no en el mismo sitio donde acaba de pegarlo. `siteName` y `username` existen porque **un token
> válido pero del profesor equivocado no da ningún error**, y leerlos es la única forma de
> detectarlo antes de dar de alta media programación en el curso que no era.

---

## Cola de revisión y entregas

Todas estas rutas están **acotadas por curso**: un `teacher` sólo ve las entregas de sus
actividades.

### `GET /api/submissions`

`routes.queue` · **Profesor**

**Query** — `QueueQuery`

| Parámetro | Tipo | Por defecto | Notas |
|---|---|---|---|
| `status` | `SubmissionStatus` | — | Sin él, se devuelven los estados revisables (`graded`, `validated`, `error`) |
| `activityId` | `Id` | — | Filtra por actividad |
| `kind` | `ActivityKind` | — | `assignment` o `forum` |
| `q` | `string` | — | Búsqueda libre sobre `studentAlias` y `studentRef` |
| `page` | `number` | `1` | Entero positivo |
| `pageSize` | `number` | `20` | Máximo 100 |
| `sort` | `'submittedAt' \| 'confidence' \| 'score'` | `submittedAt` | |
| `order` | `'asc' \| 'desc'` | `desc` | |

**Respuesta 200** — `QueueResponse` = `paginated(QueueItem)`. Cada `QueueItem` trae lo justo para
pintar la fila sin cargar la corrección entera:

| Campo | Tipo | Notas |
|---|---|---|
| `submission` | `Submission` | Entidad completa |
| `activity` | objeto reducido | `id`, `slug`, `name`, `kind`, `courseName`, `graded`, `maxScore` |
| `score` | `number \| null` | Nota **efectiva** propuesta. `null` si no hay corrección o no se puntúa |
| `maxScore` | `number \| null` | `null` en actividad no puntuable |
| `confidence` | `number \| null` | Confianza global de la corrección |
| `flagCount` | `number` | Marcas `[ILEGIBLE]` + `[DUDA]` de la transcripción |
| `lowConfidenceItems` | `number` | Apartados con confianza baja |

**Errores**: 422 (query inválida), 401.

### `GET /api/submissions/counts`

`routes.queueCounts` · **Profesor**

**Respuesta 200** — `QueueCounts`: diccionario `SubmissionStatus → number`, **siempre con todas las
claves**, para que el front no distinga entre «cero» y «no vino». Acotado por curso igual que la
cola.

```json
{ "pending": 0, "transcribing": 0, "transcribed": 0, "grading": 2,
  "graded": 14, "validated": 3, "published": 128, "error": 1 }
```

### `GET /api/submissions/{id}`

`routes.submission(id)` · **Profesor**

Todo lo necesario para la pantalla de revisión, en una sola llamada.

**Respuesta 200** — `SubmissionDetail`

| Campo | Tipo | Notas |
|---|---|---|
| `submission` | `Submission` | |
| `activity` | `Activity` | Completa: incluye `referenceSolution`, `pointsAllocation` y `files` |
| `student` | `Student \| null` | Ficha del alumno. `null` en entregas sembradas o si el LMS no deja leer perfiles |
| `transcription` | `Transcription \| null` | `null` en foros y antes de transcribir |
| `correction` | `Correction \| null` | `null` antes de `graded`. `items` ordenados por `position` |
| `scanUrls` | `string[]` | Páginas escaneadas originales. Vacío en foros |

**Errores**: 401, 403 (fuera de su alcance), 404.

> **`student` es lo que Vega guarda, no lo que el modelo ve.** La ficha sale entera hacia el
> profesor —es quien tiene que saber de quién es lo que firma—, pero al prompt sólo viaja el recorte
> de `studentContextFor()`: nombre, comunidad autónoma, provincia y población. Correo, teléfono,
> NIF, DNI validado, dirección y código postal **no salen nunca**, aunque estén en esta respuesta.
> Ver [ADR 0013](decisiones/0013-ficha-del-alumno-y-contexto-al-modelo.md).

### `GET /api/submissions/{id}/feedback.pdf`

`routes.feedbackFile(id)` · **Profesor**

Genera el PDF al vuelo: el original del alumno seguido de las páginas de corrección. Devuelve
`application/pdf` con `Content-Disposition: attachment`, no JSON.

**Errores**: 401, 403, 404; **409 `CONFLICT`** si la entrega todavía no tiene corrección.

### `PATCH /api/submissions/{id}/correction`

`routes.saveCorrection(id)` · **Profesor**

Guarda las ediciones del profesor **sin validar**. Es el guardado de trabajo en curso.

**Petición** — `SaveCorrectionRequest`

| Campo | Tipo | Semántica |
|---|---|---|
| `items[].id` | `Id` | Debe pertenecer a la corrección de esta entrega |
| `items[].teacherPoints` | `number \| null` | `>= 0`. **`null` devuelve el apartado a la puntuación de la IA** |
| `items[].teacherFeedback` | `string \| null` | `null` devuelve el apartado al feedback de la IA |
| `teacherSummary` | `string \| null` | `null` devuelve el resumen al de la IA |
| `teacherLatex` | `string \| null` | `null` deja el LaTeX de la IA |

Es un `PATCH` parcial: los apartados no incluidos en `items` se quedan como estaban.

**Respuesta 200** — `CorrectionResponse`: `{ correction, submission }`.

**Errores**: 422, 401, 403, 404; **409** si la corrección ya está publicada.

### `POST /api/submissions/{id}/validate`

`routes.validate(id)` · **Profesor**

Guarda los cambios que se le pasen **y** valida, de modo que el botón «Validar» no necesite guardar
antes. **El cuerpo es el mismo `SaveCorrectionRequest`** — no hay un `ValidateRequest` propio en el
contrato.

**Respuesta 200** — `CorrectionResponse`, con `validatedBy`, `validatedAt` y
`submission.status = 'validated'`.

**Errores**: 422, 401, 403; 404 si la entrega no tiene corrección; **409** si ya está publicada.

### `POST /api/submissions/{id}/publish`

`routes.publish(id)` · **Profesor** · sin cuerpo

**Respuesta 200** — `CorrectionResponse` con `publishedAt` relleno y `status = 'published'`.

Llama de verdad al conector: `publishGrade` con la nota y el feedback **efectivos**
(`teacherPoints ?? aiPoints`) y, en una entrega con fichero, `publishFeedbackFile` con el PDF de
corrección. Se publica con la credencial de **quien importó la actividad**, no con la de quien pulsa
el botón: es la misma con la que se ingirió, y en un curso co-impartido puede que sólo una tenga
permiso de calificación en Moodle.

**Errores**: 401, 403, 404; **409 `CONFLICT`** si la entrega no está en `validated` ni en `error`, o
si no tiene `remote_id` —una entrega sembrada no viene del LMS y no hay dónde publicarla—. Publicar
sin validar es imposible por diseño ([ADR 0004](decisiones/0004-validacion-humana-obligatoria.md));
la excepción son los modos de autonomía, que publican desde el lote y no por esta ruta. `422`/`502`
si el conector devuelve `LMS_AUTH` o `LMS_UNAVAILABLE` al publicar la nota; la entrega queda en
`error` y se reintenta **sin volver a validar**.

> **Publicar son dos operaciones y puede quedarse a medias** ([ADR 0012](decisiones/0012-ingesta-almacen-y-publicacion-en-dos-fases.md)).
> Si falla la nota, no ha llegado nada al alumno y la entrega va a `error`. Si falla **sólo** el
> fichero —el caso de Moodle 3, que no expone `assignfeedback_file`—, la entrega llega igualmente a
> `published` y el motivo viaja en `correction.publishNotice`, que la pantalla de revisión enseña.
> Un reintento reenvía sólo lo que falta: la nota no se republica.

### `POST /api/submissions/{id}/reprocess`

`routes.reprocess(id)` · **Profesor** · sin cuerpo

Devuelve la entrega a `pending` para que el siguiente lote la recoja: para recuperarse de un `error`,
o para recorregir tras cambiar el contexto, la solución de referencia o el reparto.

**Errores**: 401, 403, 404; **409** si la entrega está en `published`.

> **Hueco del contrato**: `api.ts` no define esquema de petición para el alcance del reproceso
> (¿desde el OCR o sólo la corrección?). Ver las preguntas abiertas de `HU-11`.

---

## Actividades

### `GET /api/activities`

`routes.activities` · **Profesor**

**Respuesta 200** — `ActivityListResponse`: `{ items: Activity[] }`. **Sin paginar**, y **acotado por
curso**: un `teacher` ve las de sus cursos más las que él importó; un `admin`, todas. Cada `Activity`
llega con sus `files` (sólo los de subida cerrada).

### `GET /api/courses/discover`

`routes.discoverCourses` · **Autenticado**

**Primer paso del alta de actividades.** Pregunta a Moodle qué cursos ve **el token del usuario en
sesión**. El catálogo entero de un Moodle de departamento no cabe en una pantalla, así que se elige
curso y luego se ven sus actividades.

**Respuesta 200** — `DiscoverCoursesResponse`: `{ items: DiscoveredCourse[] }`, cada uno con
`moodleCourseId`, `name` y `shortName`.

Efecto lateral, y no menor: **da de alta los cursos en `courses` y registra el acceso del profesor**
en `course_teachers`. Listar cursos es el único momento en que Moodle dice la verdad sobre a qué
alcanza cada uno.

**Errores**: 401; **422 `LMS_AUTH`** (sin token, token inválido, o instalación sin URL de Moodle);
**502 `LMS_UNAVAILABLE`**.

### `GET /api/activities/discover`

`routes.discoverActivities` · **Autenticado**

**Query** — `DiscoverActivitiesQuery`

| Parámetro | Tipo | Notas |
|---|---|---|
| `moodleCourseId` | `string` | **Obligatorio.** Mensaje: «Elige primero un curso» |

**Respuesta 200** — `DiscoverActivitiesResponse`: `{ items: DiscoveredActivity[] }`

| Campo | Tipo | Notas |
|---|---|---|
| `moodleRef` | `string` | **Con prefijo de tipo**: `assign-42`, `forum-42` |
| `name` | `string` | |
| `kind` | `ActivityKind` | |
| `moodleCourseId` / `courseName` | `string` | El curso del que cuelga |
| `pendingCount` | `number` | **Orientativo**: en una entrega son entregas y en un foro son debates. Ninguna decisión del sistema depende de él, y en `moodle3` el de las entregas es siempre `0` |
| `alreadyImported` | `boolean` | **Lo decide Vega, no el conector** |

**Errores**: 401; **422 `UNPROCESSABLE`** si falta `moodleCourseId`; 422 `LMS_AUTH`;
502 `LMS_UNAVAILABLE`.

### `POST /api/activities/import`

`routes.importActivities` · **Autenticado**

**Petición** — `ImportActivitiesRequest`: `moodleCourseId` (no vacío) y `moodleRefs` (al menos uno).

**Respuesta 200** — `ImportActivitiesResponse`: `{ items: Activity[] }`, con **todas** las pedidas,
estuvieran ya dadas de alta o no, para que el cliente no distinga casos.

El alta es **idempotente y no destructiva**: no duplica ni pisa nombre, `graded`, `maxScore`,
reparto, contexto ni autonomía. El curso se crea si no existía, y su nombre **sí** se refresca. Cada
actividad guarda `imported_by`: la credencial con la que se ingerirán sus entregas.

**Errores**: 401; **422 `UNPROCESSABLE`** con `error.fields` por `moodleRef` si alguna ya no existe
en Moodle — se comprueba volviendo a preguntar, y entonces **no se importa ninguna**; 422 `LMS_AUTH`;
502 `LMS_UNAVAILABLE`.

### `GET /api/activities/{id}` · `PATCH /api/activities/{id}`

`routes.activity(id)` · **Profesor**

**Petición del `PATCH`** — `UpdateActivityRequest`. Todos los campos opcionales; sólo se aplica lo
enviado: `name`, `enabled`, `graded`, `maxScore`, `pointsAllocation`, `referenceSolution`,
`autonomy`.

`slug`, `kind`, `moodleRef`, `courseId` y `importedBy` **no son modificables**: no aparecen en el
esquema.

**Respuesta 200** — `ActivityResponse`.

**Errores**: 422 (cuerpo inválido, o actividad puntuable sin nota máxima — misma regla que el `CHECK`
`activities_graded_needs_max_score`, comprobada antes para devolver algo explicable), 401, 403, 404.

---

## Ficheros de contexto de una actividad

Los ficheros **de texto** (`.tex`, `.md`, `.markdown`, `.txt`, según `isTextFile()`) guardan su
contenido y entran en el contexto. El resto se registran como referencia del profesor y
**`hasContent` va a `false`**: decir que llegan al modelo sería mentira.

La subida va **troceada**, y no por capricho: delante hay un proxy inverso —Cloudflare en el
despliegue real— con su propio tope de cuerpo, y el `bodyLimit` de Fastify está en 2 MiB. Mandar un
fichero mediano de una vez daría un 413 que el profesor no puede arreglar.

```
POST   .../files                  reserva el fichero, devuelve su id
PUT    .../files/{fileId}/chunk   manda un trozo (UPLOAD_CHUNK_BYTES = 256 KiB)
POST   .../files/{fileId}/complete  cierra la subida
```

Hasta que se cierra, `upload_complete` es `false` y el fichero **no se lista ni entra en el
contexto**: una subida cortada a medias no debe acabar en un prompt. Las huérfanas se barren tras una
hora, al empezar otra subida en la misma actividad.

| Ruta | Método | Clave en `routes` | Petición | Respuesta |
|---|---|---|---|---|
| `/api/activities/{id}/files` | GET | `activityFiles` | — | `ActivityFileListResponse` |
| `/api/activities/{id}/files` | POST | `activityFiles` | `BeginActivityFileUploadRequest` | `ActivityFileResponse` (201) |
| `/api/activities/{id}/files/{fileId}/chunk` | PUT | `activityFileChunk` | `AppendActivityFileChunkRequest` | `AppendActivityFileChunkResponse` |
| `/api/activities/{id}/files/{fileId}/complete` | POST | `activityFileComplete` | — | `ActivityFileResponse` |
| `/api/activities/{id}/files/{fileId}/content` | GET | `activityFileContent` | — | `ActivityFileContentResponse` |
| `/api/activities/{id}/files/{fileId}` | GET | `activityFile` | — | `text/plain` |
| `/api/activities/{id}/files/{fileId}` | DELETE | `activityFile` | — | 204 |

`BeginActivityFileUploadRequest`: `filename`, `mimeType` (por defecto `text/plain`), `sizeBytes`
(tope `MAX_FILE_CONTENT_BYTES` = 4 MiB, anunciado para rechazar antes de subir nada) y `hasContent`
(`false` en binarios: se registra sin trozos y **nace cerrado**).

El tamaño que acaba en `ActivityFile.sizeBytes` **lo mide el servidor** conforme llegan los trozos;
no se acepta el que anuncie el cliente.

La descarga de un fichero sin contenido no finge: devuelve un texto explicando que Vega no guardó el
contenido y qué formatos sí se almacenan.

**Errores propios**: **409 `CONFLICT`** al mandar un trozo a una subida ya cerrada; **422** si el
total supera 4 MiB —y entonces la fila se borra, porque nadie va a reanudar una subida que no
cabe— o si al cerrar no ha llegado contenido; 404 si el fichero no pertenece a esa actividad.

---

## Contextos de corrección

### `GET /api/contexts`

`routes.contexts` · **Profesor**

Todos los contextos de los tres niveles. **Respuesta 200** — `ContextListResponse`.

### `PUT /api/contexts/{level}/{key}`

`routes.context(level, key)` · **Profesor**

Crea o sustituye el contenido. Es un *upsert*: la restricción `UNIQUE (level, key)` garantiza que no
haya duplicados.

| Parámetro | Valores |
|---|---|
| `level` | `global` · `activity_kind` · `activity` |
| `key` | `global` para el nivel global · el `ActivityKind` para el nivel de tipo · el `slug` de la actividad para el nivel más específico |

Ejemplos: `/api/contexts/global/global`, `/api/contexts/activity_kind/forum`,
`/api/contexts/activity/tema04`.

**Petición** — `UpdateContextRequest`: `{ "content": "…markdown…" }`.

**Respuesta 200** — `ContextResponse`, con `updatedAt` y `updatedBy` al día.

**Errores**: 422 (`level` no válido o cuerpo inválido), 401.

> **Tres huecos aquí, y el tercero importa.** `routes.context()` existe en el contrato pero **no hay
> `GET` de un contexto suelto**: sólo el listado completo y el `PUT`. La `key` **no se valida** contra
> un `ActivityKind` ni contra un `slug` existente, así que se acepta cualquiera y se crea la fila. Y
> **el alcance por curso no se aplica a los contextos**: `GET /api/contexts` devuelve los de todas las
> actividades y el `PUT` deja a cualquier profesor reescribir el contexto de nivel `activity` de un
> curso que no imparte — y con él, el criterio con el que se corrige a alumnos que no son suyos. El
> contexto `global` es común por diseño; el de nivel `activity` no debería serlo.

### `GET /api/contexts/resolved/{activityId}`

`routes.resolvedContext(activityId)` · **Profesor**

Los tres niveles ya resueltos, más la concatenación final. Sirve para que el profesor vea lo que lee
el modelo antes de gastar tokens. **Es la misma función que usa el motor** (`resolveContext` de
`@vega/core`), y tenerla en un solo sitio es lo que evita que las dos cosas se separen.

**Respuesta 200** — `ResolvedContextResponse`

| Campo | Contenido |
|---|---|
| `global` | Contenido del nivel `global` |
| `activityKind` | Contenido del nivel del `ActivityKind` de la actividad |
| `activity` | Contenido del nivel `activity` para su `slug` |
| `merged` | Lo que realmente se enviaría al modelo |
| `files` | Ficheros que acompañan al contexto |

`merged` añade, después de los tres niveles, una sección con la solución de referencia —titulada
**«Solución de referencia»** si la actividad se puntúa y **«Material asociado»** si no, porque en un
foro ese campo no es la respuesta correcta sino el material del que preguntan— y una sección
**«Material adjunto · *nombre*»** por cada fichero de texto.

> **Ojo: `merged` promete más de lo que ocurre.** El lote (`apps/api/src/routes/batch.ts`) monta el
> contexto que manda al motor con **sólo los tres niveles de Markdown**: no le pasa
> `referenceSolution` ni el contenido de los ficheros. Lo que se ve aquí y lo que lee el modelo al
> corregir **no coinciden hoy**. Ver HU-05, RN-8.

Un nivel sin contenido devuelve cadena vacía, no error, y no genera cabecera en `merged`.

**Errores**: 401, 404 (la actividad no existe).

---

## Usuarios

Toda esta sección es **sólo administrador**. Un `teacher` recibe `403 FORBIDDEN`.

| Ruta | Método | Petición | Respuesta |
|---|---|---|---|
| `/api/users` | GET | — | `UserListResponse` (sin paginar) |
| `/api/users` | POST | `CreateUserRequest` | `UserResponse` (201) |
| `/api/users/{id}` | PATCH | `UpdateUserRequest` | `UserResponse` |
| `/api/users/{id}/moodle-token` | PUT | `UpdateMoodleTokenRequest` | `UserResponse` |
| `/api/users/{id}/moodle-token/test` | POST | — | `MoodleConnectionResponse` |

`CreateUserRequest`: `email` (único), `name`, `password` (mínimo 8) y `role`.
`UpdateUserRequest`: `name?`, `role?`, `active?`, `password?`.

**Salvaguardas**: **400 `BAD_REQUEST`** al desactivarse a uno mismo o al quitarse a uno mismo el rol
de administrador. **409 `CONFLICT`** al crear con un correo que ya existe.

**El token de otro usuario se escribe y no se lee**, tampoco para el administrador que lo acaba de
guardar. Existe porque en Moodle un administrador sí puede emitir tokens a nombre de terceros y
porque un token mal pegado no da la cara hasta que su dueño intenta importar algo, cuando el
administrador ya no está delante. Ver
[ADR 0010](decisiones/0010-credencial-moodle-por-usuario.md).

> **No existe `GET /api/users/{id}` ni `DELETE /api/users/{id}`.** `routes.user(id)` sólo se sirve
> con `PATCH`. La política del modelo de datos es **desactivar, no borrar**. Ver `HU-02`.

---

## Ajustes

### `GET /api/settings` · `PATCH /api/settings`

`routes.settings` · **Administrador**

Configuración de la **instalación**, guardada en `app_settings`, que **manda sobre el fichero de
entorno**.

**Respuesta 200** — `SettingsResponse`: `{ settings: AppSettings }`, con `anthropic`, `moodle`,
`smtp`, `schedule` y `branding`.

**Petición del `PATCH`** — `UpdateSettingsRequest`. Todos los grupos y campos son opcionales.

**Los secretos se escriben pero no se leen.** La clave de Anthropic y la contraseña de SMTP salen
como los booleanos `apiKeyConfigured` y `passwordConfigured`; enviar `null` los borra y omitirlos los
deja como están.

> **`moodle` aquí es sólo `baseUrl` y `connector`.** **No hay token de instalación**: la clave
> `moodle.token` existió y la migración `0003` la borra. El token es de cada usuario y se gestiona
> por las rutas de `/api/auth/me/moodle-token` o `/api/users/{id}/moodle-token`.

**Errores**: 422, 401, 403.

---

## Panel

Ambas rutas están **acotadas por curso**: un profesor ve sus números, no los del claustro. Para un
`admin` son los totales de la instalación. `lastBatchRun` sólo lo ve un `admin`: un lote es de todo
el sistema y no se puede recortar a los cursos de nadie.

### `GET /api/stats/overview`

`routes.overview` · **Profesor · por curso**

**Respuesta 200** — `OverviewResponse`

| Campo | Tipo | Significado |
|---|---|---|
| `counts` | `QueueCounts` | Entregas por estado |
| `gradedLast30Days` | `number` | Entregas corregidas en 30 días |
| `usageThisMonth` | `UsageMetrics` | Tokens y coste del mes en curso |
| `avgCostCentsPerCorrection` | `number` | Coste medio por corrección, en céntimos |
| `avgTeacherDeviation` | `number` | Desviación media en puntos entre la nota de la IA y la validada. **Positiva = el profesor sube la nota** |
| `untouchedRatio` | `number` | Proporción 0–1 de correcciones validadas que el profesor no tocó |
| `lastBatchRun` | `BatchRun \| null` | Última ejecución del lote. **`null` siempre para un `teacher`**: `batch_runs` no guarda de qué corrección sale cada número, así que la tarjeta o se enseña entera o no se enseña, y entera le diría el gasto de la academia sin darle nada sobre lo suyo |

### `GET /api/stats/cost`

`routes.costBreakdown` · **Profesor · por curso**

Desglose del gasto de una ventana por un eje. Ver
[HU-18](hu/HU-18-panel-coste-y-desviacion.md).

**Query**

| Parámetro | Tipo | Por defecto | Valores |
|---|---|---|---|
| `period` | `CostPeriod` | `this_month` | `this_month`, `last_30_days`, `this_quarter`, `all_time` |
| `dimension` | `CostDimension` | `activity_kind` | `activity_kind`, `course`, `activity` |

**Respuesta 200** — `CostBreakdownResponse`: `period`, `from`/`to` (extremos reales de la ventana),
`dimension`, `usage`, `corrections`, `avgCostCents` y `groups`.

`CostGroup`: `key`, `label`, `activityId` (sólo con `dimension = activity`), `kind` (`null` al
agrupar por curso), `costCents`, `corrections`, `avgCostCents`. Ordenados **de más caro a menos**, y
sólo entran filas con gasto en la ventana.

**Errores**: 401, 422 (`period` o `dimension` fuera de los valores admitidos).

---

## Lotes

### `GET /api/batch/runs`

`routes.batchRuns` · **Profesor**

**Respuesta 200** — `BatchRunListResponse`, más recientes primero, **limitado a 20**.

### `POST /api/batch/run`

`routes.triggerBatch` · **Administrador** · sin cuerpo

Lanza el proceso a mano, sin esperar a la hora programada. Queda registrado quién lo forzó
(`batch_runs.triggered_by`); el planificador deja `null`.

El proceso hace **dos cosas, en este orden**: ingerir del LMS las entregas nuevas de todas las
actividades activas con `moodle_ref`, y corregir lo que quede en `pending` (tope de 25 por
ejecución, `MAX_PER_RUN`). Que la ingesta falle no cancela la corrección: lo que ya estaba pendiente
se corrige aunque Moodle no responda.

**Respuesta 200** — `TriggerBatchResponse`: `{ run, queued }`. El `BatchRun` trae
`submissionsIngested` y `activitiesFailed` además de los recuentos de corrección.

**Errores**: 401; **403** si no eres administrador; **409 `CONFLICT`** si ya hay un lote en
`running`. Sin ese cerrojo, dos disparos seguidos corrigen las mismas entregas dos veces y **pagan
dos veces**.

La ruta responde **202** con el `BatchRun` abierto y el trabajo continúa en segundo plano. Las
llamadas quedan trazadas por intento en `ai_calls`.

---

## Resumen de rutas

| Clave en `routes` | Método | Ruta | Permiso | Petición | Respuesta |
|---|---|---|---|---|---|
| `health` | GET | `/api/health` | Público | — | `HealthResponse` |
| `login` | POST | `/api/auth/login` | Público | `LoginRequest` | `LoginResponse` |
| `me` | GET | `/api/auth/me` | Autenticado | — | `MeResponse` |
| `myMoodleToken` | PUT | `/api/auth/me/moodle-token` | Autenticado | `UpdateMoodleTokenRequest` | `MeResponse` |
| `testMyMoodleConnection` | POST | `/api/auth/me/moodle-token/test` | Autenticado | — | `MoodleConnectionResponse` |
| `queue` | GET | `/api/submissions` | Profesor · por curso | `QueueQuery` (query) | `QueueResponse` |
| `queueCounts` | GET | `/api/submissions/counts` | Profesor · por curso | — | `QueueCounts` |
| `submission` | GET | `/api/submissions/{id}` | Profesor · por curso | — | `SubmissionDetail` |
| `feedbackFile` | GET | `/api/submissions/{id}/feedback.pdf` | Profesor · por curso | — | `application/pdf` |
| `saveCorrection` | PATCH | `/api/submissions/{id}/correction` | Profesor · por curso | `SaveCorrectionRequest` | `CorrectionResponse` |
| `validate` | POST | `/api/submissions/{id}/validate` | Profesor · por curso | `SaveCorrectionRequest` | `CorrectionResponse` |
| `publish` | POST | `/api/submissions/{id}/publish` | Profesor · por curso | — | `CorrectionResponse` |
| `reprocess` | POST | `/api/submissions/{id}/reprocess` | Profesor · por curso | `ReprocessSubmissionRequest` | `{ queued }` |
| `park` | POST | `/api/submissions/{id}/park` | Profesor · por curso | `ParkSubmissionRequest` | `{ queued: false }` |
| `original` | GET | `/api/submissions/{id}/original` | Profesor · por curso | — | Fichero original con su MIME real |
| `activities` | GET | `/api/activities` | Profesor · por curso | — | `ActivityListResponse` |
| `discoverCourses` | GET | `/api/courses/discover` | Autenticado | — | `DiscoverCoursesResponse` |
| `discoverActivities` | GET | `/api/activities/discover` | Autenticado | `DiscoverActivitiesQuery` (query) | `DiscoverActivitiesResponse` |
| `importActivities` | POST | `/api/activities/import` | Autenticado | `ImportActivitiesRequest` | `ImportActivitiesResponse` |
| `activity` | GET | `/api/activities/{id}` | Profesor · por curso | — | `ActivityResponse` |
| `activity` | PATCH | `/api/activities/{id}` | Profesor · por curso | `UpdateActivityRequest` | `ActivityResponse` |
| `activityFiles` | GET | `/api/activities/{id}/files` | Profesor · por curso | — | `ActivityFileListResponse` |
| `activityFiles` | POST | `/api/activities/{id}/files` | Profesor · por curso | `BeginActivityFileUploadRequest` | `ActivityFileResponse` (201) |
| `activityFileChunk` | PUT | `/api/activities/{id}/files/{fileId}/chunk` | Profesor · por curso | `AppendActivityFileChunkRequest` | `AppendActivityFileChunkResponse` |
| `activityFileComplete` | POST | `/api/activities/{id}/files/{fileId}/complete` | Profesor · por curso | — | `ActivityFileResponse` |
| `activityFileContent` | GET | `/api/activities/{id}/files/{fileId}/content` | Profesor · por curso | — | `ActivityFileContentResponse` |
| `activityFile` | GET | `/api/activities/{id}/files/{fileId}` | Profesor · por curso | — | `text/plain` |
| `activityFile` | DELETE | `/api/activities/{id}/files/{fileId}` | Profesor · por curso | — | 204 |
| `contexts` | GET | `/api/contexts` | Profesor · por nivel/curso | — | `ContextListResponse` |
| `context` | PUT | `/api/contexts/{level}/{key}` | Profesor · por nivel/curso | `UpdateContextRequest` | `ContextResponse` |
| `resolvedContext` | GET | `/api/contexts/resolved/{activityId}` | Profesor · por curso | — | `ResolvedContextResponse` |
| `users` | GET | `/api/users` | Admin | — | `UserListResponse` |
| `users` | POST | `/api/users` | Admin | `CreateUserRequest` | `UserResponse` (201) |
| `user` | PATCH | `/api/users/{id}` | Admin | `UpdateUserRequest` | `UserResponse` |
| `userMoodleToken` | PUT | `/api/users/{id}/moodle-token` | Admin | `UpdateMoodleTokenRequest` | `UserResponse` |
| `testUserMoodleConnection` | POST | `/api/users/{id}/moodle-token/test` | Admin | — | `MoodleConnectionResponse` |
| `settings` | GET | `/api/settings` | Admin | — | `SettingsResponse` |
| `settings` | PATCH | `/api/settings` | Admin | `UpdateSettingsRequest` | `SettingsResponse` |
| `overview` | GET | `/api/stats/overview` | Profesor · por curso | — | `OverviewResponse` |
| `costBreakdown` | GET | `/api/stats/cost` | Profesor · por curso | *query* | `CostBreakdownResponse` |
| `batchRuns` | GET | `/api/batch/runs` | Profesor | — | `BatchRunListResponse` |
| `triggerBatch` | POST | `/api/batch/run` | **Administrador** | — | `TriggerBatchResponse` |
| `prompts` | GET | `/api/prompts` | Admin | — | `PromptListResponse` |
| `prompt` | PUT | `/api/prompts/{key}` | Admin | `UpdatePromptRequest` | `PromptResponse` |
| `aiCalls` | GET | `/api/ai-calls` | Admin | `AiCallQuery` | `AiCallListResponse` |
| `aiCall` | GET | `/api/ai-calls/{id}` | Admin | — | `AiCallResponse` |

El original real se sirve por `GET /api/submissions/{id}/original`, con autenticación y alcance por
curso. La interfaz lo descarga con `Authorization` y renderiza sus páginas con pdf.js.

## Huecos del contrato

Cosas que `api.ts` **no** define hoy y que hay que decidir. Cada una está enlazada desde la HU que
la necesita; no se implementa ninguna sin ampliar antes el contrato.

| Hueco | Impacto | Dónde se discute |
|---|---|---|
| No hay ruta de **alta de actividad local** (`POST /api/activities`) | Una actividad sólo nace importándola de Moodle o de la semilla, aunque `moodle_ref` sea nullable | `HU-19` |
| No hay **`GET /api/courses`** que lea la tabla | Los cursos sólo se enumeran preguntando a Moodle. Sin conexión no hay lista de cursos | `HU-19` |
| El **borrado de usuario** no existe | Falta decidir borrado real vs. desactivación | `HU-02` |
| No hay **`GET` de un contexto suelto** ni validación de la `key` | Se puede crear un contexto de nivel `activity` para un `slug` que no existe | `HU-06` |
| No existe endpoint para **editar la transcripción** | El profesor no puede arreglar un `[ILEGIBLE]` y recorregir con su lectura | `HU-11` |
| No hay **cierre de sesión** ni refresh token | La sesión muere con el JWT; sin revocación en servidor | `HU-01` |
| El destinatario del resumen nocturno no es un ajuste | Falta decidir destinatarios por instalación | `HU-03` |
| No hay **validación en bloque** | Validar 20 entregas de alta confianza exige 20 llamadas | `HU-16` |
| No hay **exportación CSV** de métricas | Prevista en la hoja de ruta | `HU-18` |
