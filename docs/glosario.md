# Glosario

Vocabulario del producto y su correspondencia con el modelo de datos. Cuando un término tiene un
nombre en el código, se indica entre paréntesis con el identificador real de `@vega/shared`.

## Los dos trabajos de Vega

Vega reacciona a **actividades de Moodle** con un único motor, pero hace dos trabajos distintos:

| Trabajo | `ActivityKind` | ¿Se califica? | Qué llega al alumno |
|---|---|---|---|
| Corregir entregas | `assignment` | Sí | Nota y feedback publicados en Moodle |
| Responder dudas de foro | `forum` | **Nunca** | Sólo feedback cualitativo; el LMS no recibe ninguna calificación |

Los dos comparten contexto de corrección, cola de revisión, validación, autonomía y métricas de
coste. Lo que cambia es que la entrega trae un fichero del alumno —y por tanto pasa por
transcripción— y que el foro no se puntúa.

**La materia no forma parte del núcleo.** Vega sirve a un Moodle de matemáticas igual que a uno de
lengua castellana. Todo lo específico de una asignatura vive en los ficheros Markdown de
`contexts/`, que edita el profesorado: **los prompts son la personalización**. El OCR y el LaTeX
existen porque hay trabajo manuscrito, no porque el dominio sea matemático.

## Términos del dominio docente

**Actividad** (`Activity`)
La unidad de trabajo de Vega: una actividad de Moodle a la que la aplicación reacciona. Guarda todo
lo necesario para corregir sus entregas: tipo, curso, si se puntúa y con cuánto, reparto de puntos,
solución de referencia, grado de autonomía y ficheros adjuntos. Se identifica por un `slug` único
—`tema04`, `problema12`—, que es también la `key` de su contexto de corrección; al importar de
Moodle se deriva de `moodleRef`. **Sustituye por completo al antiguo «buzón»** (`Mailbox`), que ya no
existe ni en el código ni en la base de datos.

**Tipo de actividad** (`ActivityKind`)
Los dos únicos valores son `assignment` y `forum`. Sustituye a `TaskType`, eliminado en la migración
`0002_activities.sql`.

| `ActivityKind` | Etiqueta en la UI | Trae fichero del alumno | Se puntúa |
|---|---|---|---|
| `assignment` | Entrega | Sí | Normalmente sí |
| `forum` | Foro | No | Normalmente no |

La función que decide lo primero es `hasStudentFile(kind)`, y hoy devuelve `true` sólo para
`assignment`. Es la que gobierna si la entrega pasa por transcripción.

**Entrega** (actividad de tipo `assignment`)
Actividad en la que el alumno sube un documento: un examen escaneado, un trabajo, un PDF. Es el
caso que se califica: Vega propone nota y feedback, y lo publicado en Moodle incluye la
calificación.

**Foro** (actividad de tipo `forum`)
Actividad en la que el alumno escribe directamente en Moodle. No hay fichero: lo que llega es
`Submission.textContent`. Vega responde con feedback cualitativo y **no envía ninguna calificación
al LMS**. Un foro puede marcarse como puntuable desde la ficha de la actividad, pero no es el caso
para el que está pensado y el valor por defecto al importarlo es `graded = false`.

**Curso** (`Activity.courseName`)
El curso de Moodle al que pertenece la actividad, para que el profesor la reconozca en un listado.
Hoy es **texto libre**, no una entidad: no hay tabla de cursos, ni filtro por curso, ni forma de
agrupar actividades por él más allá de comparar cadenas. Es una limitación conocida; si el producto
necesita listados por curso o permisos por curso, hará falta modelarlo.

**Actividad puntuable** (`Activity.graded`, `Activity.maxScore`)
La nota es opcional y se decide por actividad. `graded` dice si se puntúa; `maxScore` es la nota
máxima y es `null` cuando no se puntúa. La restricción `activities_graded_needs_max_score` impide la
combinación absurda: **si `graded`, tiene que haber `maxScore`**. La API devuelve un 422 explicable
antes de que salte, y al desmarcar `graded` la nota máxima se pone a `null`.

En una actividad no puntuable no hay apartados ni nota: la corrección es sólo el documento redactado
(`ai_latex` / `teacher_latex`). Mandarle puntos por `PATCH` devuelve 422.

**Modo de autonomía** (`AutonomyMode`)
Cuánta intervención docente exige una actividad. Se decide **por actividad**, porque la confianza se
gana actividad a actividad.

| Valor | Etiqueta | Qué hace |
|---|---|---|
| `review_all` | Reviso todas | El profesor valida todo. Es el valor por defecto al importar. |
| `review_low_confidence` | Sólo las dudosas | Se publica solo lo que la IA da por seguro; el resto espera en la cola. |
| `autonomous` | Sin revisión | Se publica todo sin intervención. |

`review_low_confidence` publica sola una corrección sólo si la confianza global supera **0,75** *y*
la transcripción no ha dejado ninguna marca. Una marca de `[ILEGIBLE]` significa que hay papel que
nadie ha leído, y eso no se publica sin profesor por muy alta que sea la confianza.

**Entrega del alumno** (`Submission`)
Lo que un alumno concreto ha entregado en una actividad concreta, más su estado en el circuito. En
un `assignment` es el fichero (`originalFilename`, `pageCount`); en un `forum` es el texto
(`textContent`), y ahí `originalFilename` es `null`.

**Alumno** (`Submission.studentRef`, `Submission.studentAlias`)
Vega **no almacena el nombre real**. Usa `studentRef`, el identificador interno que llega del LMS, y
opcionalmente un `studentAlias` que sólo ve el profesor dentro de Vega. A la API de IA nunca viaja
más que `studentRef`.

**Contenido textual** (`Submission.textContent`)
Lo que el alumno escribió cuando no hay fichero: sus mensajes del foro, ya concatenados por el
conector. Es lo que se corrige en lugar de la transcripción. Si llega vacío, la entrega pasa a
`error`: no hay nada que corregir.

**Apartado** (`PointsAllocation` en la actividad, `CorrectionItem` en la corrección)
La unidad mínima de puntuación. Tiene una etiqueta corta (`1a`, `2`, `Desarrollo`), un enunciado
breve y unos puntos máximos. El reparto de puntos de la actividad define los apartados esperados; la
corrección de cada entrega genera un `CorrectionItem` por apartado. **Sólo existe en actividades
puntuables.**

**Reparto de puntos** (`Activity.pointsAllocation`)
Lista de apartados con su valor máximo. La suma **debería** dar `maxScore`, pero no se fuerza: hay
enunciados con apartados opcionales o con puntos fuera del reparto. Cuando no cuadra, el motor emite
un aviso de revisión (`allocation_mismatch`); no bloquea.

Si una actividad puntuable no tiene reparto, la entrega se corrige como un único bloque con los
apartados que devuelva la IA.

**Rúbrica**
El criterio con el que se reparten los puntos dentro de un apartado: qué se exige, qué se descuenta,
qué se acepta. En Vega la rúbrica **no es una entidad**: vive escrita en Markdown dentro del contexto
de corrección, en el nivel de tipo de actividad para lo genérico y en el de actividad para lo
específico.

**Solución de referencia** (`Activity.referenceSolution`)
La resolución del profesor, en LaTeX o texto. Es la vara de medir principal, y no es la única
solución aceptable (ver *método alternativo*).

Limitación conocida: hoy el campo se guarda y se edita desde la ficha de la actividad, pero **no se
envía al modelo**. `GradeInput` no tiene ningún campo para él y el lote no se lo pasa. Quien quiera
que la IA vea la solución tiene que pegarla en el contexto de nivel `activity`.

**Ficheros de contexto** (`ActivityFile`, tabla `activity_files`)
Lo que el profesor adjunta a una actividad: enunciado, solución escaneada, criterios del
departamento. Limitación conocida: **el almacenamiento no existe todavía**. Se guardan los metadatos
(`filename`, `mimeType`, `sizeBytes`), `storage_path` se queda a `null`, la descarga devuelve un
marcador de texto y el contenido tampoco llega al modelo.

**Método alternativo** (`CorrectionItem.alternativeMethod`)
Resolución correcta que no sigue el camino de la solución de referencia: otra demostración, otro
enfoque, otro orden de argumentación. Vega debe evaluarla por sus propios méritos y marcarla, no
penalizarla por no coincidir. Es una de las señales que hacen que una entrega merezca más atención
del profesor en la revisión.

**Políticas de la materia**
Las reglas que dependen de la asignatura no son parte del núcleo: se escriben en `contexts/`. El
despliegue de ejemplo del repositorio es de matemáticas y define ahí, por citar dos, el *error de
arrastre* (un fallo en un paso contamina los siguientes: se penaliza una sola vez, donde se comete,
y el resto del desarrollo se evalúa con el valor erróneo como si fuera correcto) y los pesos con los
que se reparte la nota dentro de un apartado. Otra materia escribirá otras reglas en el mismo sitio,
y Vega no necesita enterarse.

## Términos del sistema

**Contexto de corrección** (`GradingContext`)
Instrucciones en Markdown que se envían al modelo junto con la entrega. Se organiza en tres niveles
(`ContextLevel`), de más general a más específico, y se concatenan en ese orden. Un nivel vacío no
genera cabecera.

| Nivel | `key` | Fichero por defecto |
|---|---|---|
| `global` | `global` | `contexts/global.md` |
| `activity_kind` | el `ActivityKind` | `contexts/activity-kinds/<kind>.md` |
| `activity` | el `slug` de la actividad | `contexts/activities/<slug>.md` |

El orden no es estético: es el de especificidad, y también el que aprovecha el prompt caching, ya
que lo que menos cambia va primero.

**Contexto efectivo / resuelto** (`ResolvedContextResponse`)
El resultado de concatenar los tres niveles para una actividad concreta: literalmente lo que se
manda al modelo, calculado con la misma función que usa el lote (`resolveContext`). Es consultable
desde la UI para que el profesor vea qué está leyendo la IA.

**Transcripción** (`Transcription`)
El fichero del alumno convertido a texto con fórmulas delimitadas, página a página, con la imagen
escaneada de cada página al lado y una confianza global de 0 a 1. **Sólo existe en actividades con
fichero**: un foro no se transcribe, y su `SubmissionDetail.transcription` es `null`.

**Marca de transcripción** (`TranscriptionFlag`, `TranscriptionFlagKind`)
Señal que el OCR deja sobre un fragmento problemático del manuscrito:

- `[ILEGIBLE]` — no se ha podido leer el fragmento.
- `[DUDA]` — se ha leído una interpretación, pero hay otra plausible.

**Corrección** (`Correction`)
Lo que Vega produce para una entrega. Siempre incluye la corrección redactada, el resumen, la
confianza, el modelo y el consumo de tokens. En una actividad puntuable incluye además un
`CorrectionItem` por apartado y una nota; en una no puntuable, `items` viene vacío y `maxScore` es
`null`.

**Corrección redactada** (`Correction.aiLatex` / `teacherLatex`)
El documento de corrección en LaTeX: lo que el profesor edita y lo que se convierte en las páginas
de feedback del PDF. Está siempre, se puntúe o no la actividad, y es la **única salida de una
actividad no puntuable**. Manda el del profesor si lo ha tocado: `effectiveLatex(correction)`.

**Puntos de la IA / puntos del profesor** (`aiPoints` / `teacherPoints`)
Se guardan por separado a propósito. `teacherPoints` es `null` mientras el profesor no toque el
apartado; los puntos efectivos son `teacherPoints ?? aiPoints` (`effectivePoints`). La diferencia
entre ambos es lo que alimenta la métrica de desviación del panel. Ver
[ADR 0008](decisiones/0008-separar-puntos-ia-y-profesor.md).

**Confianza** (`confidence`)
Número de 0 a 1 que el modelo declara sobre su propio trabajo. Existe a nivel de transcripción, de
corrección y de apartado. Por debajo de **0,75** la UI lo señala y la autonomía deja de publicar
sola. Sin transcripción (foros) la confianza global es la de la corrección; sin apartados que
promediar (actividad no puntuable) es la que reporta el proveedor sobre el documento redactado.

**Avisos de revisión** (`ReviewFlag`, `ReviewReason`)
Lo que el profesor tiene que mirar sí o sí antes de validar, calculado en el motor y no en la UI
para que el lote pueda contarlos sin duplicar la regla: confianza baja, método alternativo, marcas
de transcripción sobre la página de un apartado, apartado que la IA no devolvió, reparto que no
suma, y autonomía por debajo del umbral.

**Cola de revisión** (`QueueItem`, `QueueResponse`)
La lista de entregas que esperan acción del profesor. Su criterio de pertenencia es
`REVIEWABLE_STATUSES = ['graded', 'validated', 'error']`. Se filtra por estado, actividad, tipo de
actividad y búsqueda libre sobre el alias o la referencia del alumno.

**Validar** (`Correction.validatedBy` / `validatedAt`)
Acto explícito del profesor por el que asume la corrección como suya. Es la frontera del circuito en
`review_all`: por la ruta manual, nada se publica sin ella. Ver
[ADR 0004](decisiones/0004-validacion-humana-obligatoria.md).

**Publicar** (`Correction.publishedAt`)
Envío del feedback al LMS —y de la nota, **sólo si la actividad se puntúa**. En una actividad no
puntuable el `RemoteGrade` viaja con `score` y `maxScore` a `null` y el LMS no recibe calificación
ninguna. Una vez publicada, la corrección no se puede editar ni reprocesar.

**Publicación automática** (`Correction.publishedAutomatically`)
`true` cuando la corrección se publicó desde el lote sin pasar por el profesor, por el modo de
autonomía de la actividad. Es lo que distingue una publicación autónoma de una validada a mano, y lo
que cuenta `BatchRun.submissionsAutoPublished`.

**Lote** (`BatchRun`)
Ejecución del procesamiento por tandas que recoge las entregas en `pending` de las actividades
activas, las corrige y aplica la autonomía. Lo dispara el planificador (`triggeredBy = null`) o el
profesor a mano desde Ajustes. Se ordena por actividad para aprovechar el prompt caching, y procesa
como mucho 25 entregas por ejecución.

**Conector** (`moodle.connector` en los ajustes)
Adaptador que habla con el origen de las entregas y el destino de las notas: `mock`, `filesystem`,
`moodle3`. **Es una configuración global**, no un campo de la actividad: la columna `connector` de
los antiguos buzones desapareció en la migración `0002`. Ver
[ADR 0006](decisiones/0006-conectores-lms-interfaz-minima.md).

**Ajustes** (`AppSettings`, tabla `app_settings`)
Configuración editable desde la aplicación por el administrador: proveedor y modelos de IA, conector
y URL de Moodle, SMTP, frecuencia del proceso y nombre de marca. Se guarda en clave/valor
(`anthropic.gradingModel`, `schedule.everyMinutes`…) y **manda sobre el `.env`**, que es sólo el
valor de arranque de una instalación nueva. Los secretos se marcan con `is_secret` y **nunca salen
por la API**: se escriben, pero sólo se lee si están configurados.

**HU — Historia de usuario**
Unidad de especificación funcional en [`hu/`](hu/). Una HU describe una capacidad desde el punto de
vista de quien la usa, con criterios de aceptación verificables en Gherkin. No es una tarea técnica:
una HU puede requerir varias tareas, y una tarea puede no corresponder a ninguna HU (deuda técnica,
infraestructura).

**Épica**
Agrupación temática de HU. Vega tiene ocho: Acceso y usuarios, Actividades y contexto de corrección,
Ingesta, Transcripción, Corrección, Revisión y validación, Publicación, Observabilidad y coste.

**Entrega mockeada**
La primera versión desplegable: todas las pantallas navegables y el API respondiendo con datos
simulados (`AI_PROVIDER=mock`, `LMS_CONNECTOR=mock`). Sirve para cerrar el diseño del producto antes
de gastar un euro en tokens. Sigue habiendo partes mockeadas dentro del propio código: el catálogo de
actividades de Moodle, el almacenamiento de ficheros de contexto y la publicación real en el LMS.
