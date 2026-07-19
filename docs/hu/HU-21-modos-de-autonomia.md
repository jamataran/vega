# HU-21 — Modos de autonomía por actividad

| | |
|---|---|
| **Id** | HU-21 |
| **Épica** | Revisión y validación |
| **Estado** | borrador |
| **Prioridad** | Should |
| **Estimación** | 8 |
| **Depende de** | HU-12, HU-16, HU-17, HU-18 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** profesor
**quiero** decidir, actividad a actividad, cuánto puede publicar Vega sin que yo lo mire
**para** dejar de revisar lo que llevo semanas validando sin cambiar una coma, y quedarme sólo con
lo dudoso.

Es la HU que decide si el producto **ahorra tiempo de verdad**. El
[ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) reconoce el problema en su propia
lista de contras: «el profesor es el cuello de botella, y eso es una decisión de producto, no un
accidente». Con 200 entregas una noche hay 200 validaciones. HU-15 ataca el problema haciendo que
validar cueste segundos; esta HU lo ataca por el otro lado, permitiendo no validar lo que ya no hace
falta validar.

Se decide **por actividad** porque la confianza se gana actividad a actividad. Un profesor que lleva
tres exámenes de `tema04` sin tocar una puntuación tiene motivos para soltar ese, y ninguno para
soltar el foro de didáctica que estrena esta semana. `AutonomyMode` está en el esquema desde
`0002_activities.sql`, con su `CHECK` y su valor por defecto `review_all`, y sus etiquetas y textos
de ayuda están en `enums.ts` (`AUTONOMY_MODE_LABEL`, `AUTONOMY_MODE_HELP`). Lo que no existe es la
especificación de qué significa cada modo, qué garantías se pierden al subir de nivel y **cómo se le
dice eso al profesor sin ambigüedad**.

Porque hay una tensión que esta HU no puede esquivar. `CLAUDE.md` fija como no negociable que la
interfaz «nunca presente una corrección de IA como decisión definitiva cuando existe intervención
docente», y el ADR 0004 va más lejos: «ninguna nota ni ningún feedback llega al alumno sin un acto
explícito de validación por parte de un usuario identificado». En modo `autonomous` **no hay
intervención docente y no hay usuario identificado**. Eso no es un matiz de interfaz: es un cambio
de régimen, y la HU tiene que especificar cómo se comunica al activarlo y cómo se marca después todo
lo que salió por ese camino.

## Criterios de aceptación

### Escenario 1: `review_all` es el comportamiento por defecto

```gherkin
Dado que existe una actividad recién dada de alta
Cuando consulto GET /api/activities/{id}
Entonces activity.autonomy es "review_all"
Y al corregirse una entrega suya, termina en status "graded"
Y correction.publishedAt es null
Y correction.publishedAutomatically es false
Y aparece en la cola de revisión
```

### Escenario 2: `review_low_confidence` publica lo seguro

```gherkin
Dado que una actividad tiene autonomy "review_low_confidence"
Y se corrige una entrega con confianza global 0,91
Y su transcripción no tiene ninguna marca [ILEGIBLE] ni [DUDA]
Cuando termina el lote
Entonces submission.status es "published"
Y correction.publishedAutomatically es true
Y correction.publishedAt está relleno
Y correction.validatedBy es null
Y correction.validatedAt es null
Y esa entrega NO aparece en la cola de revisión por defecto
```

### Escenario 3: `review_low_confidence` retiene lo dudoso

```gherkin
Dado que una actividad tiene autonomy "review_low_confidence"
Y se corrige una entrega con confianza global 0,62
Cuando termina el lote
Entonces submission.status es "graded"
Y correction.publishedAutomatically es false
Y la entrega espera al profesor en la cola
```

### Escenario 4: el umbral es estricto

```gherkin
Dado que una actividad tiene autonomy "review_low_confidence"
Y se corrige una entrega con confianza global exactamente 0,75
Cuando termina el lote
Entonces submission.status es "graded"
Y no se publica sola
```

### Escenario 5: una marca de OCR frena la publicación aunque la confianza sea alta

```gherkin
Dado que una actividad tiene autonomy "review_low_confidence"
Y se corrige una entrega con confianza global 0,93
Y su transcripción tiene 1 marca [ILEGIBLE]
Cuando termina el lote
Entonces submission.status es "graded"
Y no se publica sola
```

### Escenario 6: `autonomous` publica también lo dudoso

```gherkin
Dado que una actividad tiene autonomy "autonomous"
Y se corrige una entrega con confianza global 0,41
Cuando termina el lote
Entonces submission.status es "published"
Y correction.publishedAutomatically es true
Y correction.validatedBy es null
Y el resultado del motor incluye un ReviewFlag con reason "autonomy_below_threshold"
Y ese aviso queda registrado y consultable después
```

### Escenario 7: activar `autonomous` exige confirmación

```gherkin
Dado que estoy configurando una actividad con autonomy "review_all"
Cuando selecciono "Sin revisión" en el modo de autonomía
Entonces veo una advertencia que dice que Vega publicará sin que nadie lo revise
Y la advertencia nombra a quién llega: al alumno, en Moodle, sin paso intermedio
Y no puedo guardar sin una confirmación explícita distinta de seleccionar la opción
Y si cancelo, el modo vuelve al que estaba
```

### Escenario 8: lo publicado sin revisión se marca

```gherkin
Dado que existe una corrección con publishedAutomatically true
Cuando la abro en la pantalla de revisión
Entonces veo un aviso, en texto y no sólo en color, de que se publicó sin revisión docente
Y ese aviso dice que nadie la revisó antes de que llegara al alumno
Y NO aparece ningún elemento que sugiera que un profesor la validó
```

### Escenario 9: la actividad enseña su modo

```gherkin
Dado que hay actividades en los tres modos
Cuando abro el listado de actividades
Entonces cada una muestra su modo de autonomía con la etiqueta de AUTONOMY_MODE_LABEL
Y las que están en "autonomous" se distinguen de las demás sin abrirlas
```

### Escenario 10: cambiar de modo con entregas en vuelo

```gherkin
Dado que una actividad está en autonomy "review_all"
Y tiene cinco entregas en "pending" y tres ya en "graded"
Cuando cambio el modo a "autonomous"
Y se ejecuta el siguiente lote
Entonces las cinco entregas de "pending" se corrigen y se publican solas
Y las tres que ya estaban en "graded" siguen en "graded"
Y ninguna entrega ya corregida se publica de forma retroactiva
```

### Escenario 11: volver a `review_all` tras un mal resultado

```gherkin
Dado que una actividad está en autonomy "autonomous"
Y se han publicado solas cuatro correcciones
Cuando cambio el modo a "review_all"
Y se ejecuta el siguiente lote
Entonces las entregas nuevas terminan en "graded" y esperan al profesor
Y las cuatro ya publicadas siguen publicadas
Y siguen marcadas con publishedAutomatically true
Y la aplicación deja claro que cambiar de modo no retira nada de lo ya publicado
```

### Escenario 12: la autonomía no cambia la corrección

```gherkin
Dado que dos actividades idénticas salvo en autonomy corrigen la misma entrega
Cuando termina el lote
Entonces las dos correcciones tienen los mismos aiPoints, el mismo aiLatex
        y la misma confidence
Y sólo difieren en status, publishedAt y publishedAutomatically
```

### Escenario 13: el lote cuenta lo que ha publicado solo

```gherkin
Dado que un lote corrige 12 entregas y 5 se publican solas
Cuando consulto GET /api/batch/runs
Entonces el BatchRun tiene submissionsProcessed 12
Y submissionsAutoPublished 5
Y la pantalla de procesos lo dice en texto, no sólo como cifra
```

### Escenario 14: la señal para subir de modo

```gherkin
Dado que una actividad tiene al menos el mínimo de correcciones validadas
Y el profesor no ha tocado ninguna de ellas
Cuando consulto las métricas de esa actividad
Entonces untouchedRatio es 1
Y avgTeacherDeviation es 0
Y la aplicación puede sugerir subir de modo apoyándose en esas dos cifras
```

### Escenario 15: la autonomía no abre la puerta trasera de `publish`

```gherkin
Dado que una actividad tiene autonomy "autonomous"
Y una entrega suya está en status "graded"
Cuando envío POST /api/submissions/{id}/publish
Entonces recibo 409 con error.code = "CONFLICT"
Y nada llega al alumno
```

### Escenario 16: la autonomía no rescata una corrección fallida

```gherkin
Dado que una actividad tiene autonomy "autonomous"
Y la corrección de una entrega falla
Cuando termina el lote
Entonces submission.status es "error"
Y no se publica nada
Y el modo de autonomía no altera el tratamiento del error
```

## Reglas de negocio

**RN-1.** `Activity.autonomy` se decide **por actividad**, no por instalación ni por curso. Valor por
defecto `review_all` (`0002_activities.sql`: `DEFAULT 'review_all'`).

**RN-2.** **`review_all`**: toda corrección termina en `graded` y espera al profesor. Es el
comportamiento del [ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) sin excepciones.

**RN-3.** **`review_low_confidence`**: una corrección se publica sola si y sólo si
`confidence > 0,75` **y** el número de marcas de transcripción es **0**. Las dos condiciones, no
una. Una marca `[ILEGIBLE]` significa que hay papel que nadie ha leído, y eso no se publica sin
profesor por muy alta que sea la confianza declarada.

**RN-4.** El umbral es **estrictamente mayor**: una confianza de 0,75 exacta **no** se autopublica.
Es coherente con HU-13 (RN-3 y su caso límite de «confianza exactamente 0,75»).

**RN-5.** **`autonomous`**: se publica todo, **sin mirar confianza ni marcas**. No es
`review_low_confidence` con el umbral a cero: es la renuncia explícita a la salvaguarda.

**RN-6.** El modo que se aplica es el **vigente cuando termina la corrección**, no el que había al
ingerir la entrega ni al configurar la actividad. Cambiar de modo **no reprocesa nada** ni publica
de forma retroactiva lo que ya está en `graded`.

**RN-7.** Toda corrección publicada sin profesor lleva **`publishedAutomatically = true`,
`validatedBy = null` y `validatedAt = null`**. Es el rastro, y es estructural: no se puede publicar
sola y a la vez parecer validada.

**RN-8. Lo publicado sin revisión se marca de forma explícita y permanente**, en texto y no sólo con
un color o un icono, allí donde alguien pueda tomarlo por una corrección firmada: en el detalle de
la entrega, en la cola y en el resumen del lote. **No es un detalle de interfaz**: es la
contrapartida del ADR 0004 y del no negociable de `CLAUDE.md` sobre no presentar una corrección de
IA como decisión definitiva.

**RN-9. Activar `autonomous` exige una confirmación explícita**, distinta de seleccionar la opción
en el desplegable, con una advertencia que diga a quién llega lo que se publique y que nadie lo
revisará. Subir a `review_low_confidence` no la exige: ahí sigue habiendo salvaguarda. Bajar de modo
nunca la exige.

**RN-10.** **Cambiar de modo no retira nada.** Lo publicado sigue publicado: `published` es terminal
y no hay endpoint de despublicación (HU-17, pregunta 3). La aplicación debe decirlo al cambiar de
modo, para que nadie crea que volver a `review_all` deshace algo.

**RN-11.** La autonomía **no cambia la corrección**. Se corrige exactamente igual, con el mismo
contexto, el mismo prompt y el mismo coste. Sólo decide qué ocurre después.

**RN-12.** La autonomía **no altera el tratamiento del error**. Una corrección que falla queda en
`error` en los tres modos.

**RN-13.** La autonomía **no abre un camino alternativo en el API**. `POST /api/submissions/{id}/publish`
sigue exigiendo estado `validated` y devolviendo 409 desde cualquier otro. La publicación automática
ocurre **dentro del lote**, no por esa ruta.

**RN-14.** `BatchRun.submissionsAutoPublished` cuenta cuántas correcciones publicó solo cada lote. Es
la única cifra agregada de autonomía que existe hoy en el contrato.

**RN-15. La autonomía cuesta medición.** `avgTeacherDeviation` y el porcentaje de validadas sin
edición se calculan **sobre lo validado** (HU-18, RN-1 y escenario 4). Una corrección autopublicada
no aporta ninguna señal: nadie la comparó con nada. Es exactamente la tercera razón del ADR 0004
—«sin bucle humano no hay medición»— y significa que **cuanta más autonomía, menos sabe la academia
de si Vega sigue funcionando bien**. Subir de modo tiene que ser una decisión informada, y la
información deja de llegar en cuanto se sube.

**RN-16.** La señal que justifica subir de modo es la combinación de `untouchedRatio` alto y
`avgTeacherDeviation` cercana a cero **sobre un número suficiente de correcciones validadas** de esa
actividad. Ninguna de las dos por separado basta: una desviación media de cero puede significar
acuerdo perfecto o que nadie ha tocado nada (HU-18, casos límite).

**RN-17.** El modo se cambia con `PATCH /api/activities/{id}` (`UpdateActivityRequest.autonomy`),
que ya está en el contrato.

## Casos límite

| Caso | Qué se hace |
|---|---|
| La actividad se desactiva (`enabled false`) estando en `autonomous` | No se procesa nada: el lote sólo coge actividades activas. La autonomía no la reactiva |
| Actividad no puntuable (`graded false`) en `autonomous` | Publicaría una respuesta de foro a un alumno sin que nadie la lea. Técnicamente funciona; ver pregunta 5 |
| Confianza exactamente 0,75 en `review_low_confidence` | No se autopublica (RN-4) |
| Corrección sin transcripción (foro) en `review_low_confidence` | El recuento de marcas es 0 porque no hay transcripción, así que la condición de marcas **se cumple siempre**: decide sólo la confianza. Es correcto, pero significa que un foro es más fácil de autopublicar que una entrega |
| Se cambia el modo mientras el lote está corriendo | El lote ya leyó la actividad al empezar a procesar la entrega. Puede aplicarse el modo antiguo a las entregas de ese lote. No hay bloqueo |
| El profesor sube a `autonomous` sin correcciones validadas previas | Se permite. Nada lo impide hoy, y no hay dato en el que apoyarse. Ver pregunta 4 |
| Una corrección autopublicada resulta estar mal | No hay despublicación ni reapertura (HU-17, pregunta 3; HU-16, pregunta 2). Se corrige a mano en Moodle y Vega queda desactualizado |
| Todas las correcciones de una actividad en `autonomous` durante un mes | `avgTeacherDeviation` de esa actividad no se mueve: no hay nada validado que medir (RN-15). El panel no lo distingue de «va todo bien» |
| Dos actividades del mismo curso con modos distintos | Es lo esperado: la unidad de decisión es la actividad (RN-1) |
| El proveedor es `mock` y la actividad está en `autonomous` | Se publican correcciones simuladas. En la entrega mockeada no llegan a ningún LMS real, pero **la cola aparece vacía**, que es justo lo que hay que enseñar al cliente para que entienda el modo |
| Se activa `autonomous` en una actividad con entregas en `error` | Siguen en `error`. Reprocesarlas las devuelve a `pending` y el siguiente lote sí las publicará solas |

## Fuera de alcance

- **Publicar de verdad en el LMS desde el lote.** Es HU-17, y hoy la autopublicación **no llama al
  conector** (ver notas de implementación y pregunta 3).
- **Despublicar o retirar una corrección autopublicada.** No hay ruta. HU-17, pregunta 3.
- **Umbral configurable desde la interfaz.** Es constante. Ver pregunta 2.
- **Modo de autonomía global o por curso.** La unidad es la actividad (RN-1).
- **Sugerir automáticamente el cambio de modo.** El escenario 14 sólo exige que las cifras existan y
  se puedan enseñar; decidir lo sigue haciendo una persona.
- **Programar la autonomía** («autónomo a partir de la quinta entrega», «autónomo sólo de noche»).
- **Métricas de autonomía por actividad en el panel.** `OverviewResponse` es global. Ver HU-18,
  pregunta 1 y esta HU, pregunta 4.
- **Avisar a alguien de que se ha autopublicado** (correo, notificación). Ver pregunta 6.
- **Validación en bloque.** Es la otra respuesta al cuello de botella y va por HU-16, pregunta 1.

## Notas de implementación

**Entidades** (`@vega/shared`): `AutonomyMode`, `AUTONOMY_MODE_LABEL`, `AUTONOMY_MODE_HELP`,
`Activity.autonomy`, `Correction.publishedAutomatically`, `Correction.validatedBy`,
`Correction.validatedAt`, `Correction.publishedAt`, `BatchRun.submissionsAutoPublished`.

**Contrato**: `UpdateActivityRequest.autonomy` ya existe. `OverviewResponse.untouchedRatio` y
`OverviewResponse.avgTeacherDeviation` son las dos cifras de RN-16, **pero son globales**: no se
pueden pedir por actividad.

**Esquema**: `activities.autonomy text NOT NULL DEFAULT 'review_all'` con
`activities_autonomy_check`; `corrections.published_automatically boolean NOT NULL DEFAULT false`;
`batch_runs.submissions_auto_published integer NOT NULL DEFAULT 0`. **No hace falta migración.**

**Decisión**: `autonomyDecision(autonomy, confidence, flagCount)` en `apps/api/src/routes/batch.ts`
implementa ya RN-2 a RN-5. Es una función exportada y pura: es donde se prueban estas reglas.

**El umbral está escrito dos veces.** `AUTONOMY_CONFIDENCE_THRESHOLD = 0.75` vive en
`apps/api/src/routes/batch.ts`; `LOW_CONFIDENCE_THRESHOLD = 0.75` vive en
`packages/core/src/grading/engine.ts`. Son el mismo número con dos nombres y dos sitios, y HU-13
(notas de implementación) ya pide **una sola constante exportada desde `@vega/shared`**: «dos
definiciones del umbral divergirán». Aquí divergirían con consecuencias peores, porque una de las
dos decide qué llega al alumno sin que nadie lo mire.

**La autopublicación de hoy no publica.** `processOne` marca `status: 'published'`, `publishedAt` y
`publishedAutomatically: true` **en base de datos y nada más**: `apps/api/src/routes/batch.ts` no
importa ningún conector LMS. La ruta manual tiene el mismo agujero, y allí al menos está declarado
—`TODO(vega): aquí irá la llamada real al conector LMS (publishGrade + publishFeedbackFile)`—. El
efecto es que una actividad en `autonomous` **vacía la cola sin que el alumno reciba nada**, que es
el peor fallo posible de este modo: parece que funciona. Ver pregunta 3, `[bloqueante]`.

**El aviso `autonomy_below_threshold` se calcula y se tira.** `detectReviewFlags` genera un
`ReviewFlag` cuando el modo permitiría publicar sin revisión pero la confianza no acompaña —«la
salvaguarda que impide que el modo autónomo publique justo la corrección que no debía»—, con un
texto ya redactado en español. Pero `gradeSubmission` lo devuelve en `result.review`, `processOne`
**no lo lee**, y no hay columna, tabla ni campo de contrato donde guardarlo. El escenario 6 no se
puede verificar hoy. Ojo además a la asimetría: el aviso se emite para `review_low_confidence` **y**
para `autonomous`, pero `autonomyDecision` en `autonomous` publica igual. El aviso existe para que
alguien lo lea después; hoy no lo lee nadie.

**No se puede ver lo autopublicado desde la cola.** `QueueItem` no trae `publishedAutomatically` y
`QueueQuery` no puede filtrar por él. Un profesor que quiera revisar a posteriori lo que se publicó
solo puede pedir `GET /api/submissions?status=published`, pero en esa lista **no distingue** lo que
validó él de lo que salió solo sin abrir cada entrega. Es una carencia del contrato, y es
precisamente la trazabilidad que RN-8 exige. Ver pregunta 4.

**La transición de estados que el modo autónomo produce no está documentada.** Una corrección
autopublicada nace directamente en `published`: no pasa por `graded` ni por `validated`. El punto 1
del ADR 0004 dice que el ciclo de vida «no tiene arista `graded -> published`», y es cierto —lo que
hay es una arista `grading -> published` que el ADR no contempla. `modelo-de-datos.md` tampoco la
tiene. Ver pregunta 1.

**UI**: la sección «Autonomía» de `ActivityDetailPage` ya existe, con el desplegable de los tres
modos y el texto de ayuda de `AUTONOMY_MODE_HELP`. Al seleccionar `autonomous` muestra un `Alert`
de advertencia — **pero es informativo, no una confirmación**: se puede guardar sin ratificar nada.
RN-9 exige el paso explícito. `CorrectionView` ya pinta el aviso «Publicada sin revisión docente»
cuando `publishedAutomatically` es `true`, y `ProcessesPage` ya explica en texto cuántas se
publicaron solas en cada lote: las dos cumplen RN-8 y son el patrón a seguir. Falta el distintivo en
la cola y el aviso al cambiar de modo (RN-10).

**Mock**: parcial. Los datos de semilla ya reparten las cinco actividades entre los tres modos —dos
en `review_all`, dos en `review_low_confidence` y una en `autonomous`— y siembran correcciones con
`publishedAutomatically: true`, `validatedBy: null` y `validatedAt: null`, exactamente como exige
RN-7. Es suficiente para enseñar la interfaz y las marcas. Lo que no se puede demostrar en la
entrega mockeada es el efecto real: que algo llegue al alumno sin que nadie lo mire.

## Preguntas abiertas

1. **¿Se modifica el ADR 0004 o se restringe la autonomía?** Es la pregunta de fondo y no admite
   respuesta técnica. El ADR dice, en negrita, que **ninguna** nota ni feedback llega al alumno sin
   un acto explícito de validación por un usuario identificado, y lo justifica con tres razones que
   siguen siendo válidas: el 5 % de errores se ceba con quien más perjudica, la responsabilidad no
   es delegable, y sin bucle humano no hay medición (RN-15). El modo `autonomous` contradice esa
   decisión de forma directa; `review_low_confidence` la contradice con salvaguardas. Opciones: (a)
   enmendar el ADR 0004 con un ADR nuevo que documente en qué condiciones se admite la excepción y
   quién responde entonces de una nota mal puesta; (b) restringir la autonomía a actividades **no
   puntuables**, donde no hay nota que reclamar, y prohibirla en las puntuables; (c) restringir
   `autonomous` a lo que ya cumple el umbral, con lo que se convierte en un alias de
   `review_low_confidence` y sobra como modo; (d) quitar `autonomous` del producto. **`[bloqueante]`:
   sin decidirlo, esta HU implementa algo que el ADR vigente prohíbe.**

2. **¿Quién fija el umbral de `review_low_confidence` y dónde vive?** Hoy es `0.75` escrito a mano en
   `batch.ts`, duplicado en `engine.ts`, y no configurable. Y no es el mismo número que el de HU-13
   aunque valga lo mismo: allí decide **qué se destaca en la cola**, aquí decide **qué llega al
   alumno sin que nadie lo mire**. Que un cambio pensado para la primera cosa mueva la segunda es un
   accidente esperando a ocurrir. Opciones: (a) una constante exportada de `@vega/shared` compartida
   por los dos usos, que es lo que pide HU-13 pero acopla las dos decisiones; (b) dos constantes
   distintas con el mismo valor inicial y nombres que digan para qué es cada una; (c) umbral por
   actividad, editable junto al modo, lo que exige columna y migración y pone en manos del profesor
   un número que no tiene datos para elegir; (d) umbral global en `AppSettings`, editable por
   `admin`. **`[bloqueante]`: hoy el número que decide qué se publica solo no está en ningún sitio
   que alguien vaya a mirar.**

3. **¿Cuándo llama la autopublicación al conector?** Hoy no llama: marca `published` en base de datos
   y el alumno no recibe nada. Mientras siga así, `autonomous` es una forma silenciosa de perder
   correcciones. Además hay que decidir qué pasa si el LMS falla en mitad de un lote: (a) la entrega
   queda en `error` y la autonomía se reintenta en el siguiente lote, lo que exige distinguir «no se
   corrigió» de «se corrigió y no se publicó»; (b) la corrección se guarda en `graded` y cae en la
   cola del profesor, que es degradar con elegancia al modo seguro; (c) se reintenta dentro del
   mismo lote, lo que puede alargarlo mucho. La (b) es la más honesta: si no se puede publicar sin
   supervisión, se supervisa. **`[bloqueante]`: es la diferencia entre un modo que funciona y uno que
   lo aparenta.**

4. **¿Cómo se ve después lo que se publicó sin que nadie lo mirara?** RN-8 exige rastro y el dato
   existe (`publishedAutomatically`), pero **no viaja en `QueueItem` ni se puede filtrar con
   `QueueQuery`**. Un jefe de estudios que quiera auditar un mes de modo autónomo no tiene por dónde
   empezar. Opciones: (a) añadir `publishedAutomatically` a `QueueItem` y un filtro a `QueueQuery`,
   que es barato y resuelve el 90 %; (b) además, desagregar `untouchedRatio` y
   `avgTeacherDeviation` por actividad, que es lo que hace falta para decidir subir o bajar de modo
   (RN-16) y es la misma pregunta 1 de HU-18; (c) una pantalla propia de auditoría de lo
   autopublicado. Sin la (a), RN-8 se cumple sólo si alguien abre las entregas de una en una.

5. **¿Debe permitirse `autonomous` en una actividad no puntuable?** Es el caso más tentador —una
   respuesta de foro no pone nota a nadie, así que el riesgo parece menor— y a la vez el más
   expuesto: lo que se publica es un **texto redactado que el alumno leerá como si lo hubiera escrito
   su profesor** (HU-20, pregunta 8), en un hilo donde puede contestar. Un error en una nota se
   reclama; un consejo didáctico equivocado firmado por el profesor se queda ahí. Y hay un detalle
   técnico que lo empeora: en un foro no hay transcripción, así que la condición de «cero marcas» de
   RN-3 se cumple siempre y **un foro es estructuralmente más fácil de autopublicar que una
   entrega**. Opciones: (a) permitirlo igual; (b) exigir umbral más alto en actividades no
   puntuables; (c) prohibirlo hasta tener datos.

6. **¿Se avisa a alguien de que se ha publicado algo solo?** Hoy la única señal es que el lote lo
   cuenta y la cola aparece más vacía de lo esperado. Nadie recibe nada. El caso incómodo: la
   actividad lleva tres semanas en `autonomous`, el profesor cambia el enunciado y no toca el
   contexto, y las correcciones empiezan a salir mal — nadie se entera hasta que un alumno reclama.
   Opciones: (a) nada, y confiar en que alguien mire el panel; (b) resumen por correo tras cada lote
   con lo autopublicado, lo que exige SMTP configurado; (c) frenar la autonomía sola cuando la
   confianza media de la actividad cae por debajo de un umbral en las últimas N correcciones, que es
   la opción más útil y la que más lógica nueva introduce.

7. **¿Quién puede cambiar el modo?** `PATCH /api/activities/{id}` sólo exige estar autenticado, así
   que cualquier `teacher` puede poner en `autonomous` una actividad que corrige otro. Con
   `UserRole` de dos valores, la pregunta es si esto es una operación de `admin`. Va con la pregunta
   3 de HU-02 (nadie es dueño de una actividad) y con RN-11 de HU-16 (cualquiera valida cualquier
   cosa). Cambiar el régimen de publicación de una actividad es una decisión de más peso que validar
   una entrega, y hoy cuesta lo mismo.
