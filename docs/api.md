# API HTTP

Referencia derivada del objeto `routes` de `packages/shared/src/api.ts`. **El contrato manda**: si
esta página y `api.ts` discrepan, el error está aquí.

- Base: todo cuelga de `/api`. El front nunca escribe rutas a mano; las toma de `routes`.
- Formato: JSON en petición y respuesta, `Content-Type: application/json`, UTF-8.
- Fechas: ISO 8601 con offset (`IsoDate`), en UTC.
- Identificadores: UUID v4 (`Id`).
- Validación: la misma definición Zod valida en el cliente antes de enviar y en el servidor al
  recibir. Un cuerpo que no valide devuelve `400 BAD_REQUEST` con `error.fields`.

## Autenticación y permisos

Autenticación por **JWT en cabecera**: `Authorization: Bearer <token>`. El token se obtiene en
`POST /api/auth/login` y caduca según `JWT_EXPIRES_IN` (12 h por defecto). No hay refresh token en
el contrato actual — ver [Huecos del contrato](#huecos-del-contrato).

Dos roles (`UserRole`), y la regla es simple: **el profesor hace todo lo relativo a corregir; el
administrador además gestiona usuarios y operaciones del sistema.**

| Nivel | Significado |
|---|---|
| Público | Sin token |
| Autenticado | Token válido de usuario con `active = true` |
| Profesor | Rol `teacher` o `admin` |
| Administrador | Rol `admin` únicamente |

Un usuario con `active = false` recibe `403 FORBIDDEN` en cualquier ruta autenticada, y también al
intentar iniciar sesión.

## Envoltorio de error

Todas las respuestas de error tienen la misma forma (`ApiError`):

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "El reparto de puntos no puede estar vacío",
    "fields": { "pointsAllocation": "Debe incluir al menos un apartado" }
  }
}
```

`code` es un valor estable de un enum cerrado, pensado para hacer `switch` en el front.
`message` va en español y es apto para mostrarse tal cual. `fields` sólo aparece en errores de
validación.

| `code` | HTTP | Cuándo |
|---|---|---|
| `BAD_REQUEST` | 400 | El cuerpo o los parámetros no validan contra el esquema |
| `UNAUTHORIZED` | 401 | Falta el token, está mal formado o ha caducado |
| `FORBIDDEN` | 403 | Token válido pero rol insuficiente, o usuario desactivado |
| `NOT_FOUND` | 404 | El recurso no existe (o no es visible para quien pregunta) |
| `CONFLICT` | 409 | La operación contradice el estado actual (publicar sin validar, email duplicado…) |
| `UNPROCESSABLE` | 422 | Sintaxis correcta pero contenido inválido para el dominio (apartado que no pertenece a la corrección…) |
| `INTERNAL` | 500 | Fallo no previsto. `message` genérico; el detalle va al log |

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
| `aiProvider` | `string` | `mock`, `anthropic`… El valor efectivo de `AI_PROVIDER` |
| `lmsConnector` | `string` | `mock`, `filesystem`, `moodle3` |
| `uptimeSeconds` | `number` | Segundos desde el arranque del proceso |

```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": "up",
  "aiProvider": "mock",
  "lmsConnector": "mock",
  "uptimeSeconds": 3421
}
```

**Errores**: ninguno. Si la base de datos está caída responde 200 con `status: "degraded"` y
`database: "down"`; nunca 500. Un 500 aquí significa que el proceso está roto de verdad.

---

## Autenticación

### `POST /api/auth/login`

`routes.login` · **Público**

**Petición** — `LoginRequest`

| Campo | Tipo | Validación |
|---|---|---|
| `email` | `string` | Formato de correo. Mensaje: «Introduce un correo válido» |
| `password` | `string` | No vacío. Mensaje: «La contraseña es obligatoria» |

**Respuesta 200** — `LoginResponse`: `{ token, expiresAt, user }`, donde `user` es un `User`
completo (sin `password_hash`, que nunca sale de la base de datos).

**Errores**

| Código | Causa |
|---|---|
| 400 `BAD_REQUEST` | El cuerpo no valida (`fields` señala el campo) |
| 401 `UNAUTHORIZED` | Credenciales incorrectas. **Mismo mensaje** tanto si el correo no existe como si la contraseña falla, para no filtrar qué correos están dados de alta |
| 403 `FORBIDDEN` | Credenciales correctas pero `active = false` |

Efecto lateral: actualiza `users.last_login_at`.

### `GET /api/auth/me`

`routes.me` · **Autenticado**

Rehidrata la sesión al abrir la PWA y comprueba que el token sigue siendo válido.

**Respuesta 200** — `MeResponse`: `{ user }`.

**Errores**: 401 `UNAUTHORIZED` (token ausente, inválido o caducado), 403 `FORBIDDEN` (usuario
desactivado desde que se emitió el token).

---

## Cola de revisión y entregas

### `GET /api/submissions`

`routes.queue` · **Profesor**

**Query** — `QueueQuery`

| Parámetro | Tipo | Por defecto | Notas |
|---|---|---|---|
| `status` | `SubmissionStatus` | — | Sin él, se devuelven los estados revisables (`graded`, `validated`, `error`) |
| `mailboxId` | `Id` | — | Filtra por buzón |
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
| `mailbox` | objeto reducido | `id`, `slug`, `name`, `taskType`, `maxScore` |
| `score` | `number \| null` | Nota **efectiva** propuesta (`totalScore` sobre los items). `null` si aún no hay corrección |
| `maxScore` | `number` | |
| `confidence` | `number \| null` | Confianza global de la corrección |
| `flagCount` | `number` | Marcas `[ILEGIBLE]` + `[DUDA]` de la transcripción |
| `lowConfidenceItems` | `number` | Apartados con `confidence < 0,75` |

**Errores**: 400 (query inválida), 401, 403.

### `GET /api/submissions/counts`

`routes.queueCounts` · **Profesor**

Recuentos para las pestañas de la cola.

**Respuesta 200** — `QueueCounts`: diccionario `SubmissionStatus → number`.

```json
{ "pending": 0, "transcribing": 0, "transcribed": 0, "grading": 2,
  "graded": 14, "validated": 3, "published": 128, "error": 1 }
```

**Errores**: 401, 403.

### `GET /api/submissions/{id}`

`routes.submission(id)` · **Profesor**

Todo lo necesario para la pantalla de revisión, en una sola llamada.

**Respuesta 200** — `SubmissionDetail`

| Campo | Tipo | Notas |
|---|---|---|
| `submission` | `Submission` | |
| `mailbox` | `Mailbox` | Completo: incluye `referenceSolution` y `pointsAllocation` |
| `transcription` | `Transcription \| null` | `null` antes de `transcribed` |
| `correction` | `Correction \| null` | `null` antes de `graded`. Incluye `items` ordenados por `position` |
| `scanUrls` | `string[]` | Páginas escaneadas originales, en orden |

**Errores**: 401, 403, 404 `NOT_FOUND`.

### `PATCH /api/submissions/{id}/correction`

`routes.saveCorrection(id)` · **Profesor**

Guarda las ediciones del profesor **sin validar**. Es el guardado de trabajo en curso: el profesor
puede salir de la pantalla y volver más tarde.

**Petición** — `SaveCorrectionRequest`

```json
{
  "items": [
    { "id": "…uuid…", "teacherPoints": 1.5, "teacherFeedback": "Falta justificar la regla de la cadena." },
    { "id": "…uuid…", "teacherPoints": null, "teacherFeedback": null }
  ],
  "teacherSummary": "Buen planteamiento general; cuida el arrastre del signo."
}
```

| Campo | Tipo | Semántica |
|---|---|---|
| `items[].id` | `Id` | Debe pertenecer a la corrección de esta entrega |
| `items[].teacherPoints` | `number \| null` | `>= 0`. **`null` devuelve el apartado a la puntuación de la IA** |
| `items[].teacherFeedback` | `string \| null` | `null` devuelve el apartado al feedback de la IA |
| `teacherSummary` | `string \| null` | `null` devuelve el resumen al de la IA |

Es un `PATCH` parcial: los apartados no incluidos en `items` se quedan como estaban.

**Respuesta 200** — `CorrectionResponse`: `{ correction, submission }`, ambos ya actualizados. El
front repinta con esto y recalcula la nota total con `totalScore`.

**Errores**

| Código | Causa |
|---|---|
| 400 `BAD_REQUEST` | Cuerpo inválido; `teacherPoints` negativo |
| 401 / 403 | |
| 404 `NOT_FOUND` | La entrega no existe |
| 409 `CONFLICT` | La entrega está en `published`: ya no se edita |
| 422 `UNPROCESSABLE` | Algún `items[].id` no pertenece a esta corrección, o la entrega aún no tiene corrección |

### `POST /api/submissions/{id}/validate`

`routes.validate(id)` · **Profesor**

Guarda los cambios que se le pasen **y** valida en la misma operación atómica. El cuerpo es el
mismo esquema que el de guardado (`ValidateRequest = SaveCorrectionRequest`), de modo que el botón
«Validar» de la pantalla de revisión no necesita guardar antes.

**Petición** — `ValidateRequest` (idéntica a `SaveCorrectionRequest`).

**Respuesta 200** — `CorrectionResponse`. Tras la llamada:
`correction.validatedBy` = usuario autenticado, `correction.validatedAt` = ahora,
`submission.status` = `validated`.

**Errores**

| Código | Causa |
|---|---|
| 400 / 401 / 403 / 404 | Como en el guardado |
| 409 `CONFLICT` | La entrega no está en `graded` (ya validada, ya publicada, o todavía en proceso) |
| 422 `UNPROCESSABLE` | La corrección no existe, o algún item no pertenece a ella |

### `POST /api/submissions/{id}/publish`

`routes.publish(id)` · **Profesor**

Publica nota y PDF de feedback en el LMS a través del conector del buzón. Sin cuerpo.

**Respuesta 200** — `CorrectionResponse` con `publishedAt` relleno y `submission.status` =
`published`.

**Errores**

| Código | Causa |
|---|---|
| 401 / 403 / 404 | |
| 409 `CONFLICT` | La entrega no está en `validated`. **Publicar sin validar es imposible por diseño** (ADR 0004) |
| 500 `INTERNAL` | El conector falló (LMS caído, token caducado, permiso denegado). La entrega pasa a `error` con `errorMessage` legible y se puede reintentar |

### `POST /api/submissions/{id}/reprocess`

`routes.reprocess(id)` · **Profesor**

Vuelve a lanzar el procesamiento de una entrega: para recuperarse de un `error`, o para recorregir
tras haber cambiado el contexto, la solución de referencia o el reparto de puntos. Sin cuerpo.

**Respuesta 200** — `CorrectionResponse`. La entrega vuelve a un estado de proceso (`transcribing`
o `grading`), de modo que `correction` puede ser la anterior mientras se recalcula.

**Errores**: 401, 403, 404; 409 `CONFLICT` si la entrega está en `published` o ya hay un proceso
en curso sobre ella.

> **Hueco del contrato**: `api.ts` no define esquema propio para el alcance del reproceso (¿desde
> el OCR o sólo la corrección?) ni para su respuesta. Ver [Huecos](#huecos-del-contrato) y las
> preguntas abiertas de `HU-11`.

---

## Buzones

### `GET /api/mailboxes`

`routes.mailboxes` · **Profesor**

**Respuesta 200** — `MailboxListResponse`: `{ items: Mailbox[] }`. **Sin paginar**: una academia
maneja decenas de buzones, no miles.

**Errores**: 401, 403.

### `GET /api/mailboxes/{id}`

`routes.mailbox(id)` · **Profesor**

**Respuesta 200** — `Mailbox` completo.

**Errores**: 401, 403, 404.

### `PATCH /api/mailboxes/{id}`

`routes.mailbox(id)` · **Profesor**

**Petición** — `UpdateMailboxRequest`. Todos los campos opcionales; sólo se aplica lo enviado.

| Campo | Tipo | Validación |
|---|---|---|
| `name` | `string` | No vacío |
| `taskType` | `TaskType` | `simulacro_problema` \| `simulacro_tema` |
| `maxScore` | `number` | `> 0` |
| `referenceSolution` | `string \| null` | LaTeX o texto |
| `gradingNotes` | `string \| null` | Markdown |
| `pointsAllocation` | `PointsAllocation[]` | Cada uno con `label` no vacío y `maxPoints >= 0` |
| `active` | `boolean` | Un buzón inactivo no admite ingesta |

`slug`, `connector` y `lmsRef` **no son modificables** por este endpoint: no aparecen en
`UpdateMailboxRequest`.

**Respuesta 200** — `Mailbox` actualizado.

**Errores**: 400, 401, 403, 404; 409 `CONFLICT` si se intenta cambiar `taskType` en un buzón con
entregas ya publicadas.

> Cambiar `taskType` cambia qué contexto de nivel `task_type` se resuelve para el buzón, y por
> tanto el criterio con el que se corrige. Cambiar `pointsAllocation` no reescribe las
> correcciones ya hechas: sólo afecta a las siguientes. Ver `HU-05`.

---

## Contextos de corrección

### `GET /api/contexts`

`routes.contexts` · **Profesor**

Todos los contextos de los tres niveles.

**Respuesta 200** — `ContextListResponse`: `{ items: GradingContext[] }`.

**Errores**: 401, 403.

### `GET /api/contexts/{level}/{key}`

`routes.context(level, key)` · **Profesor**

| Parámetro | Valores |
|---|---|
| `level` | `global` \| `task_type` \| `mailbox` |
| `key` | `global` para el nivel global · el `TaskType` para nivel de tarea · el `slug` del buzón para nivel de buzón |

Ejemplos: `/api/contexts/global/global`, `/api/contexts/task_type/simulacro_tema`,
`/api/contexts/mailbox/tema04`.

**Respuesta 200** — `GradingContext`.

**Errores**: 400 (`level` no válido), 401, 403, 404 (no existe ese par `level`/`key`).

### `PUT /api/contexts/{level}/{key}`

`routes.context(level, key)` · **Profesor**

Crea o sustituye el contenido. Es un *upsert*: la restricción `UNIQUE (level, key)` del esquema
garantiza que no haya duplicados.

**Petición** — `UpdateContextRequest`: `{ "content": "…markdown…" }`.

**Respuesta 200** — `GradingContext` con `updatedAt` y `updatedBy` puestos al día.

**Errores**: 400, 401, 403; 422 `UNPROCESSABLE` si `key` no corresponde a un `TaskType` válido
(nivel `task_type`) o a un `slug` de buzón existente (nivel `mailbox`).

### `GET /api/contexts/resolved/{mailboxId}`

`routes.resolvedContext(mailboxId)` · **Profesor**

Los tres niveles ya resueltos para un buzón, más la concatenación final. Sirve para que el
profesor vea **exactamente** lo que lee el modelo antes de gastar tokens.

**Respuesta 200** — `ResolvedContextResponse`

| Campo | Contenido |
|---|---|
| `global` | Contenido del nivel `global` |
| `taskType` | Contenido del nivel `task_type` correspondiente al `taskType` del buzón |
| `mailbox` | Contenido del nivel `mailbox` para el `slug` del buzón |
| `merged` | Lo que realmente se enviaría al modelo |

Un nivel sin contenido devuelve cadena vacía, no error.

**Errores**: 401, 403, 404 (el buzón no existe).

---

## Usuarios

Toda esta sección es **sólo administrador**. Un `teacher` recibe `403 FORBIDDEN`.

### `GET /api/users`

`routes.users` · **Administrador**

**Respuesta 200** — `UserListResponse`: `{ items: User[] }`. Sin paginar.

### `POST /api/users`

`routes.users` · **Administrador**

**Petición** — `CreateUserRequest`

| Campo | Tipo | Validación |
|---|---|---|
| `email` | `string` | Formato de correo. Único en el sistema |
| `name` | `string` | No vacío |
| `password` | `string` | Mínimo 8 caracteres. Mensaje: «Mínimo 8 caracteres» |
| `role` | `UserRole` | `teacher` \| `admin` |

**Respuesta 201** — `User` creado. La contraseña se almacena hasheada y no vuelve nunca.

**Errores**: 400, 401, 403; 409 `CONFLICT` si el correo ya existe.

### `GET /api/users/{id}`

`routes.user(id)` · **Administrador**

**Respuesta 200** — `User`. **Errores**: 401, 403, 404.

### `PATCH /api/users/{id}`

`routes.user(id)` · **Administrador**

**Petición** — `UpdateUserRequest`: `name?`, `role?`, `active?`, `password?` (mínimo 8). Todos
opcionales.

**Respuesta 200** — `User` actualizado.

**Errores**: 400, 401, 403, 404; 409 `CONFLICT` al desactivarse a uno mismo o al quitar el rol
`admin` del último administrador activo.

### `DELETE /api/users/{id}`

`routes.user(id)` · **Administrador**

> **Hueco del contrato**: `api.ts` no define respuesta para el borrado. La política del modelo de
> datos es **desactivar, no borrar** (`validated_by ... ON DELETE SET NULL` haría perder la
> trazabilidad de quién validó). Ver `HU-02`.

---

## Panel

### `GET /api/stats/overview`

`routes.overview` · **Profesor**

**Respuesta 200** — `OverviewResponse`

| Campo | Tipo | Significado |
|---|---|---|
| `counts` | `QueueCounts` | Entregas por estado |
| `gradedLast30Days` | `number` | Entregas corregidas en 30 días |
| `usageThisMonth` | `UsageMetrics` | `inputTokens`, `outputTokens`, `cachedInputTokens`, `costCents` del mes en curso |
| `avgCostCentsPerCorrection` | `number` | Coste medio por corrección, en céntimos |
| `avgTeacherDeviation` | `number` | Desviación media en puntos entre la nota de la IA y la validada. **Positiva = el profesor sube la nota** |
| `lastBatchRun` | `BatchRun \| null` | Última ejecución del lote |

**Errores**: 401, 403.

---

## Lotes

### `GET /api/batch/runs`

`routes.batchRuns` · **Profesor**

**Respuesta 200** — `BatchRunListResponse`: `{ items: BatchRun[] }`, más recientes primero
(`batch_runs_started_at_idx`).

**Errores**: 401, 403.

### `POST /api/batch/run`

`routes.triggerBatch` · **Administrador**

Lanza el lote a mano, sin esperar a la hora programada. Sin cuerpo.

**Respuesta 202** — `TriggerBatchResponse`

| Campo | Tipo | Significado |
|---|---|---|
| `run` | `BatchRun` | La ejecución recién creada, en `running` |
| `queued` | `number` | Entregas encoladas para procesar |

Es asíncrono: responde en cuanto encola. El progreso se sigue con `GET /api/batch/runs`.

**Errores**: 401, 403; 409 `CONFLICT` si ya hay un `BatchRun` en estado `running`.

---

## Resumen de rutas

| Clave en `routes` | Método | Ruta | Permiso | Petición | Respuesta |
|---|---|---|---|---|---|
| `health` | GET | `/api/health` | Público | — | `HealthResponse` |
| `login` | POST | `/api/auth/login` | Público | `LoginRequest` | `LoginResponse` |
| `me` | GET | `/api/auth/me` | Autenticado | — | `MeResponse` |
| `queue` | GET | `/api/submissions` | Profesor | `QueueQuery` (query) | `QueueResponse` |
| `queueCounts` | GET | `/api/submissions/counts` | Profesor | — | `QueueCounts` |
| `submission` | GET | `/api/submissions/{id}` | Profesor | — | `SubmissionDetail` |
| `saveCorrection` | PATCH | `/api/submissions/{id}/correction` | Profesor | `SaveCorrectionRequest` | `CorrectionResponse` |
| `validate` | POST | `/api/submissions/{id}/validate` | Profesor | `ValidateRequest` | `CorrectionResponse` |
| `publish` | POST | `/api/submissions/{id}/publish` | Profesor | — | `CorrectionResponse` |
| `reprocess` | POST | `/api/submissions/{id}/reprocess` | Profesor | — | `CorrectionResponse` |
| `mailboxes` | GET | `/api/mailboxes` | Profesor | — | `MailboxListResponse` |
| `mailbox` | GET | `/api/mailboxes/{id}` | Profesor | — | `Mailbox` |
| `mailbox` | PATCH | `/api/mailboxes/{id}` | Profesor | `UpdateMailboxRequest` | `Mailbox` |
| `contexts` | GET | `/api/contexts` | Profesor | — | `ContextListResponse` |
| `context` | GET | `/api/contexts/{level}/{key}` | Profesor | — | `GradingContext` |
| `context` | PUT | `/api/contexts/{level}/{key}` | Profesor | `UpdateContextRequest` | `GradingContext` |
| `resolvedContext` | GET | `/api/contexts/resolved/{mailboxId}` | Profesor | — | `ResolvedContextResponse` |
| `users` | GET | `/api/users` | Admin | — | `UserListResponse` |
| `users` | POST | `/api/users` | Admin | `CreateUserRequest` | `User` (201) |
| `user` | GET | `/api/users/{id}` | Admin | — | `User` |
| `user` | PATCH | `/api/users/{id}` | Admin | `UpdateUserRequest` | `User` |
| `user` | DELETE | `/api/users/{id}` | Admin | — | *sin definir* |
| `overview` | GET | `/api/stats/overview` | Profesor | — | `OverviewResponse` |
| `batchRuns` | GET | `/api/batch/runs` | Profesor | — | `BatchRunListResponse` |
| `triggerBatch` | POST | `/api/batch/run` | Admin | — | `TriggerBatchResponse` (202) |

## Huecos del contrato

Cosas que `api.ts` **no** define hoy y que hay que decidir. Cada una está enlazada desde la HU que
la necesita; no se implementa ninguna sin ampliar antes el contrato.

| Hueco | Impacto | Dónde se discute |
|---|---|---|
| No hay ruta de **alta de buzón** (`POST /api/mailboxes`), sólo `UpdateMailboxRequest` | Los buzones sólo pueden nacer del conector o de la semilla | `HU-04` |
| El **borrado de usuario** no tiene esquema de respuesta | Falta decidir borrado real vs. desactivación | `HU-02` |
| **`reprocess`** no tiene esquema de petición | No se puede elegir el alcance (OCR completo vs. sólo corrección) | `HU-11` |
| No existe endpoint para **editar la transcripción** | El profesor no puede arreglar un `[ILEGIBLE]` y recorregir con su lectura | `HU-11` |
| No hay **cierre de sesión** ni refresh token | La sesión muere con el JWT; sin revocación en servidor | `HU-01` |
| No hay ruta de **ajustes** de la aplicación | La hora del lote y los umbrales de confianza son variables de entorno | `HU-03` |
| No hay **validación en bloque** | Validar 20 entregas de alta confianza exige 20 llamadas | `HU-16` |
| `scanUrls` e `imageUrl` son `string` sin política de acceso definida | Hay que decidir si son URLs firmadas, rutas protegidas por JWT o públicas por oscuridad | `HU-15` |
| No hay **exportación CSV** de métricas | Prevista en la hoja de ruta | `HU-18` |
