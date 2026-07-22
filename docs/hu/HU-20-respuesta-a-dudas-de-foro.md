# HU-20 — Respuesta a dudas de foro

| | |
|---|---|
| **Id** | HU-20 |
| **Épica** | Corrección |
| **Estado** | borrador |
| **Prioridad** | Must |
| **Estimación** | 8 |
| **Depende de** | HU-08, HU-12, HU-16 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** profesor
**quiero** que Vega redacte una respuesta a lo que un alumno ha preguntado en el foro, y poder
editarla y publicarla desde la misma pantalla en la que reviso las entregas
**para** contestar el mismo día en lugar de acumular dudas hasta el fin de semana.

Es el **segundo caso de uso del producto** y hasta ahora no estaba escrito en ninguna parte. Vega no
es sólo un corrector de exámenes: `docs/hitos.md` lo define como «un motor de corrección **y de
respuesta a dudas de foro**». El mecanismo es el mismo —contexto de tres niveles, una llamada al
modelo, revisión del profesor, publicación— y la diferencia lo decide todo: **en un foro no hay
nota**.

Esa diferencia ya está en el código y en el esquema. `ActivityKind` distingue `assignment` de
`forum`; `hasStudentFile(kind)` es `false` para un foro, de modo que no hay fichero, no hay descarga
y no hay OCR; `Activity.graded` es `false` y `Activity.maxScore` es `null`, así que no hay apartados
que puntuar; y `corrections.ai_latex` —la corrección redactada— pasa a ser la **única** salida. Lo
que falta es decir qué se espera de todo eso, y garantizar de forma explícita lo que hace seguro el
caso de uso: que **ningún camino de código escriba una calificación** cuando la actividad no se
puntúa.

Lo que esta HU **no** puede dar por hecho es la publicación real: el conector de Moodle 3 ni
siquiera lee las intervenciones de un foro hoy. Está reflejado sin adornos en las notas de
implementación y en las preguntas abiertas.

## Criterios de aceptación

### Escenario 1: la intervención entra sin fichero

```gherkin
Dado que existe una Activity con kind "forum", graded false y maxScore null
Y el conector devuelve un RemoteSubmission con filename null y textContent no vacío
Cuando se ejecuta la ingesta de esa actividad
Entonces se crea una Submission con status "pending"
Y submission.originalFilename es null
Y submission.textContent contiene el texto que escribió el alumno
Y submission.pageCount es 0
Y no se ha llamado a download() del conector
```

### Escenario 2: un foro no pasa por transcripción

```gherkin
Dado que existe una Submission en "pending" de una actividad con kind "forum"
Cuando el lote la procesa
Entonces la entrega pasa por "grading" y termina en "graded"
Y NO pasa en ningún momento por "transcribing" ni por "transcribed"
Y no se crea ninguna fila en transcriptions
Y GET /api/submissions/{id} devuelve transcription null y scanUrls vacío
```

### Escenario 3: la salida es una respuesta redactada, no un desglose

```gherkin
Dado que se ha corregido una intervención de una actividad con graded false
Cuando consulto GET /api/submissions/{id}
Entonces correction.items está vacío
Y correction.maxScore es null
Y correction.aiLatex contiene la respuesta redactada
Y correction.aiSummary contiene un resumen breve
Y correction.annotatedFileUrl es null
Y el QueueItem de esa entrega tiene score null y maxScore null
```

### Escenario 4: el profesor reescribe la respuesta

```gherkin
Dado que una corrección de foro tiene aiLatex escrito por la IA y teacherLatex null
Cuando envío PATCH /api/submissions/{id}/correction con items vacío
        y teacherLatex "El 0 que te sale no es un error: la integral definida no es el área…"
Entonces recibo 200 con CorrectionResponse
Y aiLatex se conserva sin cambios
Y teacherLatex queda guardado
Y effectiveLatex devuelve el texto del profesor
Y submission.status sigue siendo "graded"
```

### Escenario 5: volver a la propuesta de la IA

```gherkin
Dado que una corrección de foro tiene teacherLatex escrito
Cuando envío PATCH con teacherLatex null
Entonces recibo 200
Y teacherLatex vuelve a ser null
Y effectiveLatex devuelve aiLatex
```

### Escenario 6: validar sin puntuaciones

```gherkin
Dado que estoy revisando una intervención en "graded" de una actividad con graded false
Cuando envío POST /api/submissions/{id}/validate con items vacío,
        teacherSummary null y teacherLatex con mi versión
Entonces recibo 200
Y correction.validatedBy es mi id de usuario
Y correction.validatedAt es la fecha actual
Y submission.status es "validated"
Y correction.items sigue vacío
```

### Escenario 7: al LMS no llega ninguna calificación

```gherkin
Dado que una intervención de una actividad con graded false está en "validated"
Cuando se publica
Entonces el RemoteGrade que recibe el conector tiene score null
Y tiene maxScore null
Y tiene items vacío
Y summary con el texto efectivo de la respuesta
Y ninguna llamada al LMS escribe una calificación en el libro de notas
```

### Escenario 8: se publica como intervención del hilo

```gherkin
Dado que una intervención de foro está en "validated"
Cuando se publica
Entonces la respuesta aparece en el foro como un mensaje nuevo dentro del hilo del alumno
Y no se modifica ni se borra ninguna intervención existente
Y correction.publishedAt queda relleno
Y submission.status es "published"
```

### Escenario 9: varias intervenciones del mismo alumno en el hilo

```gherkin
Dado que un alumno ha escrito tres mensajes en el mismo hilo del foro
Cuando el conector lista las intervenciones de esa actividad
Entonces devuelve un único RemoteSubmission para ese studentRef
Y su textContent contiene los tres mensajes concatenados en orden cronológico
Y se crea una única Submission
Y la respuesta redactada atiende a la duda completa, no sólo al último mensaje
```

### Escenario 10: la IA no sabe responder

```gherkin
Dado que un alumno plantea una duda que el contexto de la actividad no cubre
Cuando se corrige la intervención
Entonces la entrega termina en "graded" igualmente
Y correction.confidence es menor que 0,75
Y aiLatex dice explícitamente qué parte de la duda no ha sabido resolver
Y no inventa una respuesta con aspecto de segura
Y el QueueItem aparece destacado en la cola por confianza baja
```

### Escenario 11: lo que ha escrito el alumno no es una duda

```gherkin
Dado que la intervención de un alumno es publicidad, un saludo o un mensaje ajeno a la materia
Cuando se corrige
Entonces la entrega termina en "graded", no en "error"
Y aiLatex declara que la intervención no plantea una duda académica
Y correction.confidence es menor que 0,75
Y no se publica nada por iniciativa de Vega
```

### Escenario 12: el profesor rechaza la respuesta entera

```gherkin
Dado que una intervención está en "graded" y la respuesta propuesta no me sirve
Cuando envío POST /api/submissions/{id}/reprocess
Entonces recibo 200 con queued true
Y submission.status vuelve a "pending"
Y en el siguiente lote la corrección anterior se sustituye por una nueva
Y nada ha llegado al alumno
```

### Escenario 13: intervención vacía

```gherkin
Dado que una Submission de una actividad con kind "forum" tiene textContent vacío o sólo espacios
Cuando el lote la procesa
Entonces la entrega queda en status "error"
Y errorMessage dice en español que la intervención está vacía y no hay nada que corregir
Y no se crea ninguna corrección
Y no se ha gastado ninguna llamada al proveedor de IA
```

### Escenario 14: la garantía cuelga de `graded`, no de `kind`

```gherkin
Dado que existe una Activity con kind "forum", graded true y maxScore 2
Y tiene pointsAllocation con dos apartados
Cuando se corrige una intervención de esa actividad
Entonces se crean dos CorrectionItem
Y correction.maxScore es 2
Y al publicar, RemoteGrade.score lleva la nota efectiva
Y el comportamiento es el de HU-12, no el de esta HU
```

### Escenario 15: no se envía el nombre del alumno

```gherkin
Dado que una Submission de foro tiene studentAlias "María G."
Cuando se llama al proveedor de IA para redactar la respuesta
Entonces el contenido enviado no incluye studentAlias ni ningún nombre real
Y textContent viaja tal cual, sin las firmas que Moodle añade al mensaje
```

## Reglas de negocio

**RN-1.** Una actividad con `kind = 'forum'` **no trae fichero del alumno**: `hasStudentFile('forum')`
es `false`. Su entrega es `Submission.textContent`; `originalFilename` es `null` y `pageCount` es 0.

**RN-2.** La máquina de estados de un foro es `pending → grading → graded`. **Nunca pasa por
`transcribing` ni por `transcribed`**, y no se crea `Transcription`. `SubmissionDetail.transcription`
es `null` y `scanUrls` va vacío.

**RN-3.** En una actividad con `graded = false` la corrección se guarda con `items: []` y
`maxScore: null`. La **única** salida es `Correction.aiLatex` / `Correction.teacherLatex`.

**RN-4. En una actividad no puntuable, ningún camino de código escribe una nota en el LMS.** Es la
garantía que hace seguro este caso de uso, y se hace cumplir en tres sitios a la vez:

1. `Correction.maxScore` es `null` y `Correction.items` está vacío, así que no hay nota que calcular.
2. `RemoteGrade.score` y `RemoteGrade.maxScore` son `null` y `RemoteGrade.items` va vacío.
3. La publicación de una actividad no puntuable **no usa la operación de nota del conector**: usa la
   de publicar una intervención en el foro (ver notas de implementación y pregunta 1).

**RN-5.** La garantía de RN-4 cuelga de **`Activity.graded`, no de `Activity.kind`**. El esquema
admite un foro puntuable (`activities_graded_needs_max_score` sólo exige que, si se puntúa, haya
nota máxima), y entonces sí hay nota y se aplica HU-12. Escribir la regla sobre `kind` la haría
falsa el día que alguien puntúe un foro.

**RN-6.** El profesor edita `teacherLatex` y `teacherSummary`. `CorrectionItemPatch` **no aplica**:
`SaveCorrectionRequest.items` va vacío. `teacherLatex: null` devuelve la respuesta a la propuesta de
la IA, igual que `teacherPoints: null` en HU-16 (RN-2).

**RN-7.** Validar es **el mismo acto** de HU-16 y del
[ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md): estado `graded`, escritura de
`validatedBy` y `validatedAt`, y transición a `validated`. Que no haya nota no rebaja la firma: lo
que se publica lo lee un alumno igual.

**RN-8.** `Correction.confidence` en una actividad sin apartados **es la del documento redactado**,
no una media: `overallConfidence` sin items y sin transcripción devuelve la que declara el
proveedor. El umbral de baja confianza sigue siendo 0,75 (HU-13, RN-3).

**RN-9.** `Correction.annotatedFileUrl` es `null` en una actividad sin fichero. **No se genera PDF de
feedback**: la respuesta a una duda se publica como texto en el foro, no como documento adjunto.

**RN-10.** Todas las intervenciones de un mismo alumno en la actividad son **una sola `Submission`**,
con `textContent` ya concatenado por el conector en orden cronológico. Concatenar es trabajo del
conector, no de Vega (`RemoteSubmission.textContent`, «sus mensajes del foro ya concatenados»).

**RN-11.** La respuesta se publica como **una intervención nueva** del hilo. Vega **no edita ni borra
intervenciones existentes**, ni las del alumno ni las suyas anteriores.

**RN-12.** Rechazar la respuesta entera se hace con `POST /api/submissions/{id}/reprocess`, que
devuelve la entrega a `pending` para que el siguiente lote la sustituya. **No hay endpoint de
descartar sin publicar**: una intervención sin respuesta se queda en `graded` y sigue en la cola.

**RN-13.** El nivel `activity_kind` del contexto de un foro es la clave `forum`, es decir
`contexts/activity-kinds/forum.md`. Es donde vive todo lo específico de responder a una duda: tono,
extensión, qué hacer con lo que no se sabe, y qué **no** se contesta.

**RN-14.** Al proveedor se le envía el contexto resuelto de los tres niveles y `textContent`.
**Nunca `studentAlias` ni ningún dato personal** (HU-12, RN-9).

**RN-15.** Una intervención que **no plantea una duda académica** (spam, saludo, off-topic) se
corrige igualmente y termina en `graded`, con `aiLatex` diciéndolo y confianza baja. **Vega no
decide sola que algo no merece respuesta**: filtrar es una decisión del profesor, y dejarla en la
cola cuesta un vistazo, mientras que descartarla en silencio esconde una duda real mal formulada.

**RN-16.** Una intervención con `textContent` vacío o sólo espacios queda en `error` con mensaje
legible, **sin llamar al proveedor**. No es lo mismo que RN-15: ahí hay texto que valorar; aquí no
hay nada.

## Casos límite

| Caso | Qué se hace |
|---|---|
| El alumno edita su mensaje después de que Vega haya respondido | Vega no se entera: la ingesta no relee lo ya ingerido. La respuesta publicada se queda como está. Ver pregunta 3 |
| Dos alumnos preguntan lo mismo en el mismo hilo | Dos `Submission` y dos respuestas independientes, una por `studentRef`. No se agrupan ni se detecta la repetición |
| Un alumno responde a otro alumno correctamente | Se trata como una intervención más de quien la escribe: se le redacta una respuesta a él. Es el caso de `foro-dudas-analisis` en los datos de semilla, y hoy sale raro. Ver pregunta 5 |
| La duda no es de la materia sino de la plataforma («no me deja subir el PDF») | RN-15: se redacta diciendo que no es una duda académica, con confianza baja. Lo resuelve el profesor |
| El hilo tiene 40 intervenciones del mismo alumno | Se concatenan todas. Si el texto no cabe en la ventana del modelo, la corrección falla y la entrega queda en `error`. No se trocea |
| La respuesta lleva LaTeX | `aiLatex` es la convención de `TranscriptionPage.latex`: prosa con `$…$` y `$$…$$`. Moodle **no renderiza LaTeX sin el filtro MathJax activado**. Ver pregunta 6 |
| El profesor ya ha contestado a mano en el foro | Vega no lo detecta: no lee lo que hay publicado, sólo las intervenciones de alumnos. Publicaría una segunda respuesta. Ver pregunta 4 |
| La actividad de foro tiene `pointsAllocation` con apartados y `graded false` | El reparto se ignora: sin `graded` no hay items (`gradeSubmission` corta antes de `alignItems`). No es un error, pero la pantalla de configuración no debería ofrecerlo |
| Se publica y el foro está cerrado o el alumno se ha dado de baja | Fallo de publicación con mensaje que lo nombra, entrega a `error`, reintentable. Es un fallo de configuración, no de red (ADR 0006) |
| Se reintenta la publicación de una respuesta que ya salió | No se reenvía: `grade_published_at` marca «esto ya está en el LMS». Dos respuestas a la misma duda, quizá distintas, son peores que ninguna (ADR 0014) |
| Al servicio web del token le falta `mod_forum_add_discussion_post` | Ajustes lo señala **por su nombre** antes de que nadie valide nada. No se comprueba llamándola —publicaría un mensaje de verdad— sino leyendo el catálogo de funciones del token (ADR 0014) |
| La misma intervención se ingiere dos veces | Se descarta contra el índice único parcial `(activity_id, remote_id)`, que en un foro es `<foro>:<debate>:<mensaje>` (ADR 0012). Antes se duplicaba: la clave natural no protegía nada con `original_filename` a `NULL` |
| No existe `contexts/activity-kinds/forum.md` | `readContextLevel` devuelve cadena vacía **sin avisar**: el foro se corrige sólo con el contexto global y el de la actividad. Hoy es exactamente lo que pasa. Ver pregunta 7 |

## Fuera de alcance

- **Puntuar una intervención de foro.** Un foro puntuable es HU-12 sin cambios (RN-5).
- **Generar un PDF de feedback.** RN-9: la respuesta va como texto en el foro. HU-17 cubre el PDF de
  las entregas.
- **Transcripción y OCR.** No hay fichero (RN-1). HU-10 y HU-11 no tocan este camino.
- **Abrir un hilo nuevo en el foro.** Vega sólo responde dentro de un hilo existente.
- **Moderar el foro**: borrar, ocultar o editar intervenciones (RN-11).
- **Responder a varios alumnos con un solo mensaje**, aunque pregunten lo mismo.
- **Detectar que el profesor ya ha contestado a mano.** Ver pregunta 4.
- **Modo autónomo sobre un foro.** Es HU-21, y allí está la pregunta de si debe permitirse.
- **Notificar al alumno.** Lo hace Moodle con sus propios avisos de foro.
- **Leer las intervenciones del profesor** o de otros participantes como contexto de la respuesta.
  Ver pregunta 5.

## Notas de implementación

**Entidades** (`@vega/shared`): `ActivityKind` (`'forum'`), `hasStudentFile`, `Activity.graded`,
`Activity.maxScore`, `Submission.textContent`, `Submission.originalFilename`, `Correction.aiLatex`,
`Correction.teacherLatex`, `effectiveLatex`, `Correction.items` (vacío), `Correction.maxScore`
(`null`), `Correction.annotatedFileUrl` (`null`).

**Estados** (`SubmissionStatus`): `pending → grading → graded → validated → published`, o `→ error`.
**Sin `transcribing` ni `transcribed`** (RN-2). Ya está implementado así en
`apps/api/src/routes/batch.ts`: `status: withFile ? 'transcribing' : 'grading'`.

**Contrato**: `SaveCorrectionRequest` ya trae `teacherLatex` nullable, así que **editar la respuesta
no necesita ampliar el contrato**. `ValidateRequest = SaveCorrectionRequest` y `CorrectionResponse`
valen tal cual. `QueueQuery.kind` permite filtrar la cola por `forum`.

**Endpoints** (`routes`): se reutilizan los de HU-16 y HU-17 sin cambios — `saveCorrection(id)`,
`validate(id)`, `publish(id)`, `reprocess(id)`. **No hace falta ninguna ruta nueva.**

**Motor** (`packages/core/src/grading/engine.ts`): `gradeSubmission` ya distingue el camino. Con
`hasStudentFile(kind)` a `false` no llama a `transcribe`; con `graded: false` devuelve
`items: []`, `score: null` y `maxScore: null`; y `overallConfidence` sin items ni transcripción usa
la confianza que declara el proveedor (RN-8).

**La interfaz de conector ya tiene el otro camino.** `LmsConnector` gana `publishForumReply(ref,
reply)` como octava operación, con su tipo propio `RemoteReply`. Publicar con `publishGrade` y
`score: null` funcionaría en Moodle —`mod_assign_save_grade` con `grade: -1`— pero escribiría en el
libro de notas de una tarea, que es justo lo que RN-4 prohíbe: ahora los conectores lo **rechazan**
en las dos direcciones en lugar de apañárselas. Ver
[ADR 0014](../decisiones/0014-publicar-en-foro-y-verificar-la-escritura.md).

**Lo que falta en el conector de Moodle 3: ya no es la entrada, es la salida.**
`listSubmissions` **ya lee** las intervenciones (`mod_forum_get_forum_discussions_paginated` más los
mensajes de cada debate) y produce **como mucho una entrega por debate**: la del mensaje raíz, y sólo
si nadie distinto del autor ha respondido. Sigue **sin verificarse contra un Moodle real**, y con dos
supuestos gordos: `mod_forum_get_forum_discussion_posts` quedó obsoleta en Moodle 3.8 en favor de
`mod_forum_get_discussion_posts`, que devuelve otra forma; y la paginación asume que el sitio respeta
`perpage`.

**Publicar la respuesta ya está**, y lo que había antes era peor que un hueco.
`publishToLms()` no bifurcaba: llamaba a `publishGrade()` para cualquier actividad, y como el
`remoteId` de una duda —`<foro>:<debate>:<mensaje>`— tiene la misma forma que el de una entrega
—`<tarea>:<usuario>:<intento>`—, la respuesta se publicaba como **nota de la tarea cuyo id coincidía
con el del foro, a un alumno cualquiera**, sin error y sin aviso. Hoy hay una operación propia,
`publishForumReply()`, `mod_forum_add_discussion_post` está declarada, y los conectores rechazan el
cruce en las dos direcciones. Ver [ADR 0014](../decisiones/0014-publicar-en-foro-y-verificar-la-escritura.md).

Lo que **sigue faltando es el formato**: el cuerpo de la respuesta es hoy el documento de corrección
(`teacherLatex ?? aiLatex`), que es LaTeX/markdown porque nació para una entrega de matemáticas, y un
mensaje de foro es prosa. El transporte está; **la decisión de qué se manda es de H3**, cuando el
motor gane su operación para responder dudas ([ADR 0011](../decisiones/0011-cuatro-operaciones-y-verificacion-mecanica.md)).

Lo que **sí** funciona: el conector `mock` genera intervenciones realistas
(`connectors/lms/src/mock.ts`, `FORUM_POSTS`) y el `filesystem` deduce `kind: 'forum'` de los
ficheros de texto. Los dos rechazan `download()` sobre un foro con un mensaje que lo explica.

**Identidad de una intervención: resuelta.** `submissions_natural_key` —`(activity_id,
student_ref, original_filename)`— no protegía nada en un foro, porque con `original_filename` a
`NULL` Postgres considera distintos dos `NULL` y reingerir el mismo foro duplicaba todas las
intervenciones. La migración `0005` añade `submissions.remote_id` con índice único parcial sobre
`(activity_id, remote_id)`, y en `moodle3` el `remoteId` de una duda es `<foro>:<debate>:<mensaje>`.
La idempotencia que HU-08 (RN-2) da por garantizada **ya se cumple también en el camino de foro**.
Ver [ADR 0012](../decisiones/0012-ingesta-almacen-y-publicacion-en-dos-fases.md).

**Contexto.** Falta `contexts/activity-kinds/forum.md`. El directorio sólo tiene `assignment.md` y
`assignment-tema.md`, y `readContextLevel` devuelve `''` cuando no encuentra la fila, sin error y sin
aviso. Hoy un foro se corrige con dos niveles de tres y nadie se entera.

**UI**: la pantalla de revisión (HU-15) ya se adapta — `CorrectionView` recibe `graded` y, con
`false`, no pinta apartados, muestra la insignia «Actividad sin nota» y deja el
`PreviewEditor` del documento de corrección como único editor. La barra de nota total no tiene nada
que mostrar y no debe ocupar sitio. El copy de la pantalla debe hablar de **responder**, no de
corregir: es un trabajo distinto aunque el mecanismo sea el mismo.

**Mock**: parcial. El proveedor `mock` ya redacta respuestas de foro deterministas por
`submissionId` (`packages/core/src/ai/mock.ts`, `FORUM_TOPICS`), con confianza derivada de la
longitud del texto del alumno. Los datos de semilla incluyen dos foros con intervenciones largas y
verosímiles. Lo que queda fuera de la entrega mockeada es la publicación real.

## Preguntas abiertas

1. **~~¿Cómo publica Vega una respuesta en un foro?~~ Resuelto** por el
   [ADR 0014](../decisiones/0014-publicar-en-foro-y-verificar-la-escritura.md): opción (a), una
   operación propia `publishForumReply(ref, reply)` con su tipo `RemoteReply`, implementada en
   `moodle3` con `mod_forum_add_discussion_post`, en `filesystem` escribiendo `respuesta.txt` y en
   el `mock` en memoria. Se descartó (b) —generalizar `publishGrade`— porque mete una decisión de
   dominio en el conector, y (c) —copiar y pegar— porque deja la HU sin cerrar. El coste aceptado es
   la octava operación de la interfaz. **Queda abierto el formato del mensaje**, que decide H3.

2. **¿Se puede leer un foro de Moodle 3 con un coste razonable?**
   `mod_forum_get_forum_discussions_paginated` devuelve debates, y los mensajes de cada debate son
   otra llamada por debate. Un foro de curso con 30 hilos son 31 peticiones por ingesta, y hay que
   repetirlas en cada lote para detectar lo nuevo. Además falta decidir cómo se filtran las
   intervenciones del profesor y las de Vega para no responderse a sí misma. Necesita un spike
   contra un Moodle real, igual que `assignfeedback_file` en HU-17.
   **Parcialmente resuelto**: `listSubmissions` de un foro ya no lanza, y el coste de N+1 peticiones
   se acota respondiendo sólo a la primera duda sin responder de cada debate. Lo que sigue sin
   decidirse es cómo se filtran las intervenciones del profesor y las de la propia Vega.

3. **~~¿Cuál es la identidad de una intervención de foro?~~ Resuelto** por el
   [ADR 0012](../decisiones/0012-ingesta-almacen-y-publicacion-en-dos-fases.md): la identidad es
   `(activity_id, remote_id)`, con índice único parcial, y en `moodle3` el `remoteId` de una duda es
   `<foro>:<debate>:<mensaje>`. Se conserva abajo el razonamiento original porque explica por qué se
   descartaron las otras dos opciones. Con `original_filename` a `NULL`, la clave
   única de `submissions` no impedía duplicados y la ingesta **dejaba de ser idempotente**, que es la
   propiedad que HU-08 llama «aburrida» y considera la principal garantía del esquema. Opciones: (a)
   usar el `remoteId` del conector como parte de la clave, lo que exige columna nueva y migración; (b)
   guardar en `original_filename` un identificador sintético del hilo (`discussion-4711`), que abusa
   de una columna que significa otra cosa; (c) clave `(activity_id, student_ref)` para foros, lo que
   impide que un alumno pregunte dos veces en la misma actividad. La (a) es la limpia y la más cara,
   y es la que se implementó.

4. **¿Qué pasa si el profesor ya ha contestado a mano?** Vega no lee las intervenciones del
   profesorado, así que publicaría una segunda respuesta a una duda ya resuelta —y el alumno vería
   dos, quizá contradictorias. Opciones: (a) leer también los mensajes del profesor y no proponer
   respuesta si el hilo ya tiene una posterior a la duda; (b) que el profesor descarte a mano desde
   la cola, lo que exige el «descartar sin publicar» que RN-12 dice que no existe; (c) asumirlo. La
   (a) resuelve el problema y encarece la pregunta 2.

5. **¿Se responde por alumno o por hilo?** RN-10 fija una `Submission` por alumno, que es lo que
   hace el conector `mock`. Pero un hilo de foro es una **conversación**: en
   `foro-dudas-analisis` de los datos de semilla, un alumno pregunta y otros dos le contestan bien.
   Responder a cada uno por separado, sin ver lo que han dicho los demás, produce respuestas
   redundantes y a veces absurdas —contestar a quien ya ha dado la respuesta correcta. Opciones: (a)
   una `Submission` por alumno con el hilo entero como contexto, sin puntuar a los demás; (b) una
   `Submission` por hilo, lo que rompe `student_ref` como identidad de una entrega; (c) dejarlo como
   está y aceptar la redundancia. Es la pregunta de producto más importante de esta HU.

6. **¿Cómo llega el LaTeX al foro?** `aiLatex` lleva fórmulas delimitadas con `$…$` y `$$…$$`.
   Moodle no las renderiza salvo que el filtro MathJax o TeX esté activado en la instalación, y en
   ese caso la sintaxis esperada suele ser `\( \)` / `\[ \]`. Publicar `$\frac{1}{2}$` en crudo a un
   alumno es exactamente lo que HU-17 (RN-9) prohíbe en el PDF. Opciones: (a) exigir MathJax
   activado y documentarlo como requisito de instalación; (b) convertir los delimitadores al
   publicar; (c) renderizar las fórmulas a imagen, que es caro y accesible sólo con texto
   alternativo. Es una decisión de despliegue con consecuencias visibles para el alumno.

7. **¿Qué dice `contexts/activity-kinds/forum.md`?** El fichero no existe y hay que escribirlo antes
   de la primera llamada real. Y no es un trámite: es donde se decide la extensión de la respuesta,
   si se resuelve el ejercicio o se guía hasta él, qué se hace con una duda que expone un error
   conceptual grave, y si se responde a lo que no es de la materia. Escrito flojo, Vega dará
   respuestas correctas e inútiles. Además conviene que `readContextLevel` **avise** cuando un nivel
   falta, en lugar de devolver cadena vacía en silencio.

8. **¿Debe una respuesta de foro llevar la nota de que la ha redactado una IA?** Es la misma
   pregunta de transparencia de HU-17 (pregunta 4), pero aquí es más aguda: un mensaje de foro es
   una conversación entre personas, y el alumno responderá al mensaje esperando que le conteste
   quien lo firmó. Si se publica con la cuenta del profesor sin advertencia, el alumno cree que le
   ha escrito él. Tiene lectura de transparencia y de RGPD.
