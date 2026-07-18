# Modelo de datos

Derivado de `apps/api/migrations/0001_init.sql` y de `packages/shared/src/domain.ts`. El SQL manda:
si algo aquí no cuadra con la migración, el error está en este documento.

## Diagrama entidad-relación

```mermaid
erDiagram
  users ||--o{ corrections : "valida"
  users ||--o{ grading_contexts : "edita"
  mailboxes ||--o{ submissions : "agrupa"
  submissions ||--o| transcriptions : "tiene"
  submissions ||--o| corrections : "tiene"
  corrections ||--o{ correction_items : "desglosa en"

  users {
    uuid id PK
    text email UK
    text name
    text password_hash
    text role "teacher | admin"
    boolean active "default true"
    timestamptz created_at
    timestamptz last_login_at "nullable"
  }

  mailboxes {
    uuid id PK
    text slug UK "tema04, problema12"
    text name
    text task_type "simulacro_problema | simulacro_tema"
    numeric max_score "> 0"
    text reference_solution "nullable · LaTeX o texto"
    text grading_notes "nullable · Markdown"
    jsonb points_allocation "PointsAllocation[]"
    text connector "default mock"
    text lms_ref "nullable"
    boolean active "default true"
    timestamptz created_at
  }

  submissions {
    uuid id PK
    uuid mailbox_id FK
    text student_ref "id interno, nunca el nombre"
    text student_alias "nullable · sólo para el profesor"
    text status "SubmissionStatus"
    text original_filename
    integer page_count
    text error_message "nullable"
    timestamptz submitted_at
    timestamptz updated_at
  }

  transcriptions {
    uuid id PK
    uuid submission_id FK,UK "1:1"
    jsonb pages "TranscriptionPage[]"
    jsonb flags "TranscriptionFlag[]"
    numeric confidence "0..1"
    text model
    timestamptz created_at
  }

  corrections {
    uuid id PK
    uuid submission_id FK,UK "1:1"
    numeric max_score "> 0"
    text ai_summary
    text teacher_summary "nullable"
    numeric confidence "0..1"
    text model
    integer input_tokens
    integer output_tokens
    integer cached_input_tokens
    numeric cost_cents
    uuid validated_by FK "nullable"
    timestamptz validated_at "nullable"
    timestamptz published_at "nullable"
    timestamptz created_at
  }

  correction_items {
    uuid id PK
    uuid correction_id FK
    text label "1a, 2, Desarrollo"
    text statement
    numeric max_points
    numeric ai_points
    text ai_feedback
    numeric teacher_points "nullable"
    text teacher_feedback "nullable"
    numeric confidence "0..1"
    boolean alternative_method
    integer position
  }

  batch_runs {
    uuid id PK
    timestamptz started_at
    timestamptz finished_at "nullable"
    text status "running | done | failed"
    integer submissions_processed
    integer submissions_failed
    integer input_tokens
    integer output_tokens
    integer cached_input_tokens
    numeric cost_cents
  }

  grading_contexts {
    uuid id PK
    text level "global | task_type | mailbox"
    text key "global | TaskType | slug del buzón"
    text content "Markdown"
    timestamptz updated_at
    uuid updated_by FK "nullable"
    string _uk "UNIQUE (level, key)"
  }
```

`batch_runs` y `grading_contexts` aparecen sin aristas porque no tienen clave foránea hacia el
resto del grafo. La relación existe, pero es lógica, no referencial:

- `grading_contexts.key` apunta al `TaskType` o al `mailboxes.slug` según el nivel. **No hay FK a
  propósito**: un contexto de buzón puede existir antes de que el buzón se cree (por ejemplo, el
  que viene del repositorio en `contexts/mailboxes/`), y borrar un buzón no debe llevarse por
  delante unas instrucciones que costaron escribir.
- `batch_runs` agrega el consumo de una ejecución; qué entregas procesó se deduce por ventana
  temporal. Si esa trazabilidad hace falta, requiere una columna `batch_run_id` en `submissions`
  y una migración nueva — está en las preguntas abiertas de `HU-09`.

## Cardinalidades y restricciones que importan

| Regla | Dónde vive | Consecuencia |
|---|---|---|
| Una entrega tiene **como mucho una** transcripción | `transcriptions.submission_id UNIQUE` | Reprocesar sustituye, no acumula. No hay historial de transcripciones. |
| Una entrega tiene **como mucho una** corrección | `corrections.submission_id UNIQUE` | Idem: no hay historial de correcciones. |
| No se importa dos veces la misma entrega | `UNIQUE (mailbox_id, student_ref, original_filename)` | La ingesta es idempotente y se puede relanzar sin miedo. Si el alumno re-sube el examen con **otro** nombre de fichero, entra como entrega nueva. |
| Borrar un buzón borra sus entregas | `ON DELETE CASCADE` | Y en cascada, sus transcripciones y correcciones. Operación destructiva. |
| Borrar un usuario no borra lo que validó | `validated_by ... ON DELETE SET NULL` | Se pierde el quién, no el qué. Por eso los usuarios se **desactivan** (`active = false`) en lugar de borrarse. |
| Los puntos nunca son negativos | `CHECK (ai_points >= 0)`, `CHECK (teacher_points >= 0)` | No existe la penalización con puntos negativos a nivel de apartado. |
| Las confianzas están en `[0, 1]` | `CHECK (confidence BETWEEN 0 AND 1)` | En transcripción, corrección y apartado. |
| El coste se guarda en céntimos | `cost_cents numeric(10,4)` | Nada de flotantes para dinero. `UsageMetrics.costCents`. |

### Lo que el esquema *no* impone

- **`SUM(points_allocation.maxPoints)` no tiene por qué ser `max_score`.** Es deliberado
  (`domain.ts` lo dice explícitamente): hay enunciados con apartados opcionales. La UI avisa de la
  discrepancia; no la bloquea.
- **`SUM(correction_items.max_points)` tampoco.** Y por tanto la nota total efectiva puede superar
  `max_score` si el profesor sube puntuaciones sin criterio. Es responsabilidad de la UI avisar.
- **No hay transiciones de estado en la base de datos.** El `CHECK` de `submissions.status` sólo
  valida el conjunto de valores, no el orden. La máquina de estados se hace cumplir en `apps/api`.

## Ciclo de vida de una entrega

```mermaid
stateDiagram-v2
  [*] --> pending : ingesta — descargada del conector

  pending --> transcribing : arranca el OCR (lote o reproceso)
  transcribing --> transcribed : OCR terminado, hay Transcription
  transcribing --> error : fallo de visión, PDF corrupto, timeout

  transcribed --> grading : arranca la corrección
  grading --> graded : hay Correction con items — espera al profesor
  grading --> error : fallo del modelo, respuesta no parseable

  graded --> graded : el profesor guarda cambios (PATCH correction)
  graded --> validated : el profesor valida
  graded --> transcribing : reproceso desde el OCR
  graded --> grading : reproceso sólo de la corrección

  validated --> published : publicación en el LMS correcta
  validated --> error : el LMS rechaza la publicación
  validated --> graded : el profesor reabre para seguir editando

  error --> transcribing : reproceso
  error --> grading : reproceso
  error --> pending : reintento desde cero

  published --> [*]
```

### Qué dispara cada transición

| Origen | Destino | Disparador | Efecto en datos |
|---|---|---|---|
| — | `pending` | `LMSConnector.download()` completado durante la ingesta | `INSERT submissions`, se guarda el escaneo y `page_count` |
| `pending` | `transcribing` | El lote toma la entrega, o `POST /api/submissions/{id}/reprocess` | `status`, `updated_at` |
| `transcribing` | `transcribed` | `core.transcribe()` devuelve una `Transcription` válida | `INSERT`/`UPDATE transcriptions` |
| `transcribed` | `grading` | El lote encadena la corrección | `status` |
| `grading` | `graded` | `core.grade()` devuelve una `Correction` con al menos un item | `INSERT corrections` + `correction_items`, `usage` |
| `graded` | `graded` | `PATCH /api/submissions/{id}/correction` | `teacher_points`, `teacher_feedback`, `teacher_summary`. **No** toca `validated_*` |
| `graded` | `validated` | `POST /api/submissions/{id}/validate` | Guarda los cambios pendientes + `validated_by`, `validated_at` |
| `validated` | `published` | `POST /api/submissions/{id}/publish` con éxito en el conector | `published_at` |
| `validated` | `graded` | Reapertura por el profesor | Limpia `validated_by` y `validated_at` |
| cualquiera | `error` | Excepción no recuperable en el paso en curso | `error_message` con texto legible en español |
| `error` | `transcribing` / `grading` / `pending` | `POST /api/submissions/{id}/reprocess` | Limpia `error_message` |

### Invariantes de estado

1. `status = 'graded'` implica que existe fila en `corrections` con al menos un `correction_item`.
2. `status = 'validated'` implica `corrections.validated_at IS NOT NULL` y `validated_by IS NOT NULL`.
3. `status = 'published'` implica `published_at IS NOT NULL` **y** `validated_at IS NOT NULL`.
   Nunca se publica sin validar: no existe arista `graded -> published`.
4. `status = 'error'` implica `error_message IS NOT NULL`.
5. `published` es terminal. Republicar exige reabrir explícitamente, y eso no está resuelto —
   ver preguntas abiertas de `HU-17`.
6. `REVIEWABLE_STATUSES = ['graded', 'validated', 'error']` es lo que la cola muestra por defecto.
   `pending`, `transcribing`, `transcribed` y `grading` son estados de máquina: se ven filtrando
   explícitamente, no en la bandeja de trabajo del profesor.

## Correspondencia SQL ↔ TypeScript

El SQL usa `snake_case`; el contrato HTTP, `camelCase`. La capa de acceso a datos traduce.

| Tabla | Tipo de `@vega/shared` | Observaciones |
|---|---|---|
| `users` | `User` | `password_hash` **nunca** sale por la API |
| `mailboxes` | `Mailbox` | `points_allocation` (jsonb) ↔ `PointsAllocation[]` |
| `submissions` | `Submission` | 1:1 en columnas |
| `transcriptions` | `Transcription` | `pages` y `flags` son jsonb ↔ `TranscriptionPage[]` / `TranscriptionFlag[]` |
| `corrections` | `Correction` | Las cuatro columnas de consumo se agrupan en `usage: UsageMetrics` |
| `correction_items` | `CorrectionItem` | Se sirven ordenados por `position` |
| `grading_contexts` | `GradingContext` | |
| `batch_runs` | `BatchRun` | Mismo agrupamiento de `usage` |

Las fechas se guardan como `timestamptz` y viajan como ISO 8601 con offset (`IsoDate`). Los
`numeric` se serializan como `number`; los importes en céntimos con hasta cuatro decimales.

## Cálculos derivados

No se persisten: se calculan a partir de los items, siempre con las funciones de `domain.ts`.

```ts
effectivePoints(item) = item.teacherPoints ?? item.aiPoints
effectiveSource(item) = item.teacherPoints === null ? 'ai' : 'teacher'
totalScore(items)     = redondeo a 2 decimales de la suma de effectivePoints
```

Y la desviación que alimenta el panel (`OverviewResponse.avgTeacherDeviation`), sobre correcciones
ya validadas: media de `SUM(effectivePoints) - SUM(aiPoints)`. Positiva significa que el profesor
sube la nota respecto a la IA.
