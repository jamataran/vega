# Glosario

Vocabulario de la academia y su correspondencia con el modelo de datos. Cuando un término tiene
un nombre en el código, se indica entre paréntesis con el identificador real de `@vega/shared`.

## Términos de la academia

**Oposición**
Proceso selectivo para acceder a un cuerpo de la función pública. Las academias preparan a los
opositores para un temario cerrado y unas pruebas de formato fijo. Vega no modela la oposición
como entidad: el temario se refleja indirectamente en los buzones (`tema04`, `tema07`…).

**Opositor / alumno**
Persona que prepara la oposición y entrega los exámenes. Vega **no almacena su nombre real**: usa
`Submission.studentRef` (identificador interno, el que llega del LMS) y, opcionalmente, un
`Submission.studentAlias` que sólo ve el profesor dentro de Vega. A la API de IA nunca viaja más
que `studentRef`.

**Simulacro**
Examen de entrenamiento que reproduce el formato y el tiempo de la prueba real. En Vega hay dos
formatos, y son los únicos valores de `TaskType`:

| Término de la academia | `TaskType` | Etiqueta en la UI |
|---|---|---|
| Simulacro de problema | `simulacro_problema` | Simulacro de problema |
| Simulacro de tema | `simulacro_tema` | Simulacro de tema |

**Simulacro de problema**
Prueba compuesta por problemas independientes con enunciado cerrado y solución numérica o
simbólica única. Se corrige por pasos: planteamiento, desarrollo, resultado. El error de cálculo
pesa; la exposición pesa menos.

**Simulacro de tema**
Exposición escrita de un tema del temario (definiciones, teoremas con demostración, ejemplos).
Se corrige por cobertura y rigor: qué contenido aparece, si las demostraciones están completas,
si la estructura es la esperada. La presentación y el orden pesan más que en un problema.

**Buzón** (`Mailbox`)
Unidad de trabajo de Vega. Un buzón agrupa todas las entregas de un mismo examen y guarda todo lo
necesario para corregirlas: tipo de tarea, nota máxima, solución de referencia, reparto de puntos
e indicaciones específicas. Se identifica por un `slug` corto tal y como lo nombra la academia
(`tema04`, `problema12`). Un buzón se corresponde normalmente con una tarea del LMS
(`Mailbox.lmsRef`), pero puede existir sin LMS.

**Entrega** (`Submission`)
El examen de un alumno concreto en un buzón concreto: el PDF o las imágenes escaneadas, más su
estado en el circuito de corrección. Es la unidad que se transcribe, se corrige, se valida y se
publica.

**Apartado** (`PointsAllocation` en el buzón, `CorrectionItem` en la corrección)
La unidad mínima de puntuación. Un apartado tiene una etiqueta corta (`1a`, `2`, `Desarrollo`),
un enunciado breve y unos puntos máximos. El reparto de puntos del buzón define los apartados
esperados; la corrección de cada entrega genera un `CorrectionItem` por apartado.

**Reparto de puntos** (`Mailbox.pointsAllocation`)
Lista de apartados con su valor máximo. La suma **debería** dar `Mailbox.maxScore`, pero no se
fuerza: hay enunciados con apartados opcionales o con puntos de presentación fuera del reparto.

**Rúbrica**
El criterio con el que se reparten los puntos dentro de un apartado: qué vale el planteamiento,
qué vale el desarrollo, qué vale el resultado, qué se descuenta por falta de justificación. En
Vega la rúbrica **no es una entidad**: vive escrita en Markdown dentro del contexto de corrección
(nivel de tipo de tarea para lo genérico, nivel de buzón para lo específico).

**Solución de referencia** (`Mailbox.referenceSolution`)
La resolución del profesor, en LaTeX o texto. Es la vara de medir principal. No es la única
solución aceptable: ver *método alternativo*.

**Método alternativo** (`CorrectionItem.alternativeMethod`)
Resolución correcta que no sigue el camino de la solución de referencia. Vega debe evaluarla por
sus propios méritos y marcarla, no penalizarla por no coincidir. Es una de las señales que hacen
que una entrega merezca más atención del profesor en la revisión.

**Error de arrastre**
Error cometido en un paso que contamina los resultados de los pasos siguientes. La política de
Vega (definida en `contexts/global.md`) es penalizarlo **una sola vez**, en el punto donde se
comete, y evaluar el resto del desarrollo con el valor erróneo como si fuera correcto.

## Términos del sistema

**Contexto de corrección** (`GradingContext`)
Instrucciones en Markdown que se envían al modelo junto con la entrega. Se organiza en tres
niveles (`ContextLevel`), de más general a más específico, y se concatenan en ese orden:

| Nivel | `key` | Fichero por defecto |
|---|---|---|
| `global` | `global` | `contexts/global.md` |
| `task_type` | el `TaskType` | `contexts/task-types/<taskType>.md` |
| `mailbox` | el `slug` del buzón | `contexts/mailboxes/<slug>.md` |

**Contexto efectivo / resuelto** (`ResolvedContextResponse`)
El resultado de concatenar los tres niveles para un buzón concreto: literalmente lo que se manda
al modelo. Es consultable desde la UI para que el profesor vea qué está leyendo la IA.

**Transcripción** (`Transcription`)
El manuscrito convertido a LaTeX, página a página, con la imagen escaneada de cada página al lado
y una confianza global de 0 a 1.

**Marca de transcripción** (`TranscriptionFlag`, `TranscriptionFlagKind`)
Señal que el OCR deja sobre un fragmento problemático del manuscrito:

- `[ILEGIBLE]` — no se ha podido leer el fragmento.
- `[DUDA]` — se ha leído una interpretación, pero hay otra plausible.

**Corrección** (`Correction`)
La propuesta de la IA para una entrega: un `CorrectionItem` por apartado con puntos y feedback,
más un resumen global, la confianza, el modelo usado y el consumo de tokens.

**Puntos de la IA / puntos del profesor** (`aiPoints` / `teacherPoints`)
Se guardan por separado a propósito. `teacherPoints` es `null` mientras el profesor no toque el
apartado; los puntos efectivos son `teacherPoints ?? aiPoints` (`effectivePoints`). La diferencia
entre ambos es lo que alimenta la métrica de desviación del panel. Ver
[ADR 0008](decisiones/0008-separar-puntos-ia-y-profesor.md).

**Confianza** (`confidence`)
Número de 0 a 1 que el modelo declara sobre su propio trabajo. Existe a nivel de transcripción,
de corrección y de apartado. Por debajo de **0,75** la UI lo señala visualmente (umbral fijado en
el comentario de `Transcription.confidence`).

**Cola de revisión** (`QueueItem`, `QueueResponse`)
La lista de entregas que esperan acción del profesor. Su criterio de pertenencia es
`REVIEWABLE_STATUSES = ['graded', 'validated', 'error']`.

**Validar** (`Correction.validatedBy` / `validatedAt`)
Acto explícito del profesor por el que asume la corrección como suya. Es la frontera del circuito:
nada se publica sin ella. Ver [ADR 0004](decisiones/0004-validacion-humana-obligatoria.md).

**Publicar** (`Correction.publishedAt`)
Envío de la nota y del PDF de feedback al LMS a través del conector del buzón.

**Lote** (`BatchRun`)
Ejecución del procesamiento por tandas — normalmente nocturna — que descarga entregas nuevas, las
transcribe y las corrige. Se ordena por buzón para aprovechar el prompt caching.

**Conector** (`Mailbox.connector`)
Adaptador que habla con el origen de las entregas y el destino de las notas: `mock`,
`filesystem`, `moodle3`. Ver [ADR 0006](decisiones/0006-conectores-lms-interfaz-minima.md).

**HU — Historia de usuario**
Unidad de especificación funcional en [`hu/`](hu/). Una HU describe una capacidad desde el punto
de vista de quien la usa, con criterios de aceptación verificables en Gherkin. No es una tarea
técnica: una HU puede requerir varias tareas, y una tarea puede no corresponder a ninguna HU
(deuda técnica, infraestructura).

**Épica**
Agrupación temática de HU. Vega tiene ocho: Acceso y usuarios, Buzones y contexto de corrección,
Ingesta, Transcripción, Corrección, Revisión y validación, Publicación, Observabilidad y coste.

**Entrega mockeada**
La primera versión desplegable: todas las pantallas navegables y el API respondiendo con datos
simulados (`AI_PROVIDER=mock`, `LMS_CONNECTOR=mock`). Sirve para cerrar el diseño del producto
antes de gastar un euro en tokens.
