# HU-08 — Ingesta de entregas desde el conector

| | |
|---|---|
| **Id** | HU-08 |
| **Épica** | Ingesta |
| **Estado** | borrador |
| **Prioridad** | Must |
| **Estimación** | 8 |
| **Depende de** | HU-04 |
| **Bloquea a** | HU-09, HU-10 |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** sistema
**quiero** descargar del LMS las entregas nuevas de cada buzón activo y registrarlas
**para** que estén listas para transcribir y corregir sin que nadie tenga que mover ficheros a
mano.

Es el punto donde Vega toca el mundo exterior, y por tanto donde fallan las cosas que no dependen
de nosotros: el Moodle está caído, el token ha caducado, un alumno ha subido un vídeo en lugar de
un PDF, otro ha subido el examen tres veces. La ingesta tiene que ser **idempotente y aburrida**:
poder ejecutarse muchas veces sin duplicar nada y sin romperse por una entrega mala.

El esquema ya trae la garantía principal: `UNIQUE (mailbox_id, student_ref, original_filename)`.
La interfaz de conector está fijada en el
[ADR 0006](../decisiones/0006-conectores-lms-interfaz-minima.md) y es deliberadamente pequeña.

## Criterios de aceptación

### Escenario 1: entregas nuevas

```gherkin
Dado que el buzón "tema04" está activo, con connector "mock" y lmsRef definido
Y el conector reporta tres entregas que Vega no tiene
Cuando se ejecuta la ingesta de ese buzón
Entonces se crean tres filas en submissions con status "pending"
Y cada una tiene mailboxId, studentRef, originalFilename, pageCount y submittedAt
Y el fichero descargado queda guardado y accesible por scanUrls
```

### Escenario 2: la ingesta es idempotente

```gherkin
Dado que ya se ingirieron tres entregas del buzón "tema04"
Y el conector sigue reportando las mismas tres
Cuando se ejecuta la ingesta otra vez
Entonces no se crea ninguna fila nueva
Y no se produce ningún error
Y las tres entregas conservan su estado actual
```

### Escenario 3: el mismo alumno con otro fichero

```gherkin
Dado que ya existe una entrega de studentRef "A-0417" con originalFilename "examen.pdf"
Y el conector reporta una entrega de "A-0417" con originalFilename "examen_v2.pdf"
Cuando se ejecuta la ingesta
Entonces se crea una entrega NUEVA, porque la clave única incluye el nombre del fichero
Y ambas aparecen en la cola
Y la UI señala que ese alumno tiene más de una entrega en el buzón
```

### Escenario 4: buzón inactivo

```gherkin
Dado que el buzón "tema01" tiene active = false
Cuando se ejecuta la ingesta general
Entonces no se consulta el conector para ese buzón
Y no se crea ninguna entrega suya
```

### Escenario 5: el LMS no responde

```gherkin
Dado que el buzón "tema04" tiene connector "moodle3"
Y el servidor de Moodle no responde
Cuando se ejecuta la ingesta de ese buzón
Entonces se reintenta con espera creciente hasta el número máximo de intentos
Y si sigue fallando, la ingesta de ESE buzón se marca como fallida
Y la ingesta de los demás buzones continúa con normalidad
Y el fallo queda registrado en el BatchRun
```

### Escenario 6: fichero de la entrega ilegible

```gherkin
Dado que el conector reporta una entrega cuyo fichero está corrupto o no es un PDF ni una imagen
Cuando se ejecuta la ingesta
Entonces la entrega se registra igualmente con status "error"
Y errorMessage explica en español qué ha pasado
Y aparece en la cola filtrando por estado "error"
Y las demás entregas del mismo buzón se ingieren con normalidad
```

### Escenario 7: buzón sin lmsRef

```gherkin
Dado que el buzón "tema04" tiene connector "moodle3" y lmsRef null
Cuando se ejecuta la ingesta de ese buzón
Entonces no se consulta el LMS
Y se registra un fallo de configuración, no de red
Y la pantalla del buzón muestra que le falta la referencia al LMS
```

### Escenario 8: no se envía el nombre del alumno

```gherkin
Dado que el conector devuelve el nombre real del alumno junto con su identificador
Cuando se crea la entrega
Entonces submissions.student_ref guarda el identificador interno del LMS
Y el nombre real NO se guarda en student_ref
Y si se guarda algo legible, va en student_alias, que nunca sale hacia la API de IA
```

### Escenario 9: conector desconocido

```gherkin
Dado que un buzón tiene connector "canvas" y no existe esa implementación
Cuando se ejecuta la ingesta de ese buzón
Entonces se registra un fallo de configuración con un mensaje que nombra el conector
Y los demás buzones se procesan con normalidad
```

## Reglas de negocio

**RN-1.** Sólo se ingieren buzones con `active = true` y `connector` resoluble.

**RN-2.** La identidad de una entrega es `(mailbox_id, student_ref, original_filename)`, garantizada
por la clave única del esquema. La ingesta **debe poder repetirse sin duplicar**.

**RN-3.** Una entrega recién ingerida nace en `pending` con `errorMessage` a `null`. Si el fichero
no se puede procesar, nace en `error` con mensaje legible (RN-8).

**RN-4.** **Nunca se guarda el nombre real del alumno en `student_ref`.** Ese campo lleva el
identificador interno del LMS. `student_alias` es opcional, sólo para que el profesor reconozca la
entrega dentro de Vega, y **nunca se envía a la API de IA**. Es lo que el README llama minimizar la
exposición.

**RN-5.** Un fallo en un buzón **no interrumpe la ingesta de los demás**. Cada buzón se procesa de
forma aislada.

**RN-6.** Los fallos se clasifican en **transitorios** (red, 5xx del LMS, timeout: se reintentan
con espera creciente) y **de configuración** (`lmsRef` ausente, conector inexistente, credenciales
inválidas: no se reintentan y exigen intervención). Es la distinción mínima que el
[ADR 0006](../decisiones/0006-conectores-lms-interfaz-minima.md) exige a todo conector.

**RN-7.** `pageCount` se calcula al ingerir, contando las páginas del PDF o los ficheros de imagen.

**RN-8.** Una entrega ilegible se registra igualmente en `error`, no se descarta. Descartarla la
haría invisible: el alumno habría entregado y nadie lo sabría.

**RN-9.** La ingesta la ejecuta el lote (HU-09) o el disparo manual del lote. **No hay endpoint de
ingesta por buzón** en el contrato.

**RN-10.** Los ficheros descargados se guardan y quedan accesibles por `SubmissionDetail.scanUrls`.
El almacenamiento no está en el esquema: es sistema de ficheros o almacén de objetos, decisión de
despliegue.

## Casos límite

| Caso | Qué se hace |
|---|---|
| El alumno reentrega con el **mismo** nombre de fichero | No se crea entrega nueva (RN-2). **La entrega antigua se queda y la nueva se pierde en silencio**: es el peor caso conocido de esta HU. Ver pregunta abierta 1 |
| El alumno entrega con **otro** nombre de fichero | Dos entregas del mismo alumno en el buzón. Ambas se corrigen y ambas hay que revisarlas. Ver pregunta abierta 1 |
| Entrega vacía (0 páginas) | Se registra con `pageCount = 0` y estado `error`, con mensaje explícito |
| Entrega enorme (60 páginas) | Se ingiere. El problema aparece en la transcripción (HU-10), no aquí |
| El fichero no es PDF ni imagen (docx, vídeo) | Estado `error` con mensaje que nombra el formato recibido |
| El conector devuelve dos entregas idénticas en la misma llamada | La segunda choca con la clave única y se ignora. Sin error |
| El buzón cambia de `connector` con entregas ya ingeridas | Las antiguas conservan su fichero. Las nuevas vienen del conector nuevo. Publicar (HU-17) usa el conector **actual** del buzón, lo que puede fallar para las antiguas |
| Ingesta ejecutada dos veces a la vez | La clave única protege. La segunda ve conflictos y los ignora |
| El LMS devuelve una entrega borrada después | Vega la conserva. No hay borrado en cascada desde el LMS |

## Fuera de alcance

- **Descubrir tareas del LMS para crear buzones.** La interfaz de conector no tiene
  `listAssignments`. Ver HU-04, pregunta abierta 1.
- **Ingesta a demanda desde la UI por buzón.** No hay endpoint. Se lanza el lote completo (HU-09).
- **Subir una entrega a mano desde la aplicación.** No hay endpoint de subida.
- **Sincronización bidireccional con el LMS.** Vega lee entregas y escribe notas; nada más.
- **Borrar entregas.** No hay ruta.
- **Notificar al alumno de que su entrega se ha recibido.** No es cosa de Vega.
- **Detectar entregas duplicadas por contenido.** Sólo por nombre de fichero.

## Notas de implementación

**Entidades** (`@vega/shared`): `Submission` (`mailboxId`, `studentRef`, `studentAlias`, `status`,
`originalFilename`, `pageCount`, `submittedAt`, `errorMessage`), `Mailbox.connector`,
`Mailbox.lmsRef`, `BatchRun`.

**Estados** (`SubmissionStatus`): la ingesta produce `pending` o, si el fichero es inutilizable,
`error`.

**Interfaz de conector** (ADR 0006): `listSubmissions(mailboxRef)` y `download(submissionRef)`. Los
otros dos métodos son de publicación (HU-17).

**Esquema**: `submissions` con `UNIQUE (mailbox_id, student_ref, original_filename)` — el
mecanismo de RN-2. Índices `submissions_status_idx`, `submissions_mailbox_idx`,
`submissions_submitted_at_idx`.

**Implementación de RN-2**: `INSERT ... ON CONFLICT DO NOTHING`, y descargar el fichero **sólo si
el INSERT ha creado fila**. Al revés se descarga todo cada noche para tirarlo.

**Almacenamiento**: los escaneos no están en el esquema. Convención: un directorio por entrega, una
imagen por página, servidas por `scanUrls`. La política de acceso a esas URL está sin decidir (ver
HU-15).

**Mock**: parcial. El conector `mock` genera un conjunto fijo de entregas por buzón —con PDFs de
fixture reales, varias páginas, y al menos una entrega deliberadamente ilegible para que el camino
de error del escenario 6 se vea en la demo—. El conector `moodle3` real queda fuera de la primera
entrega.

## Preguntas abiertas

1. **¿Qué se hace con las reentregas?** Es el hueco más serio de esta HU. La clave única incluye
   `original_filename`, así que reentregar con el mismo nombre **no crea entrega nueva y la versión
   nueva se pierde sin que nadie lo sepa**; reentregar con otro nombre crea una segunda entrega, y
   el profesor tiene que corregir dos y adivinar cuál vale. Opciones: (a) dejar la clave como está y
   documentar que Vega corrige la primera entrega; (b) añadir una columna de versión y quedarse con
   la última, marcando las anteriores como superadas —migración y cambio en la cola—; (c) usar la
   fecha de entrega del LMS para detectar la reentrega y sustituir el fichero conservando la misma
   fila, lo que invalida la corrección ya hecha. **`[bloqueante]`: hoy hay pérdida de datos
   silenciosa en un caso frecuente.**

2. **¿Dónde se guardan los escaneos y cómo se sirven?** No hay tabla ni columna. Opciones: (a)
   volumen del contenedor del API, sencillo pero atado a esa máquina y a su copia de seguridad; (b)
   almacén de objetos S3-compatible, que añade una dependencia de infraestructura a una academia que
   sólo quería Docker; (c) dentro de Postgres como `bytea`, que hincha la base de datos. Arrastra la
   pregunta de HU-15 sobre cómo se protegen esas URL. **`[bloqueante]`: sin esto no hay HU-15.**

3. **¿Cuánto tiempo se conservan las entregas de los alumnos?** Son datos personales bajo RGPD.
   Hoy no hay política de retención ni forma de borrarlas (no hay endpoint de borrado). ¿Se borran
   los escaneos al publicar? ¿Al cabo de un curso? ¿Se conservan indefinidamente porque son la
   prueba de la nota? Cada respuesta implica trabajo distinto, y la última tiene consecuencias
   legales para quien despliega.

4. **¿Debe poderse lanzar la ingesta de un solo buzón?** Hoy sólo existe el lote completo
   (`POST /api/batch/run`). El caso real: el profesor sabe que los alumnos acaban de subir el
   simulacro y no quiere esperar a la noche ni procesar los otros seis buzones. Exige un endpoint
   nuevo.

5. **¿Qué se hace si el conector devuelve un `studentRef` que cambia entre ejecuciones?** Algunos
   LMS reidentifican usuarios. Si el identificador cambia, la clave única no protege y la entrega se
   duplica. ¿Se asume, se detecta por nombre de fichero, o se exige al conector estabilidad del
   identificador como parte del contrato?

6. **¿Se rellena `studentAlias`, y con qué?** RN-4 permite un alias legible sólo para el profesor,
   pero no dice de dónde sale. Si sale del nombre real del LMS, entonces el nombre real **sí** está
   en la base de datos de Vega, lo que tiene lectura de RGPD aunque nunca se envíe a la IA. ¿Se deja
   vacío? ¿Iniciales? ¿Lo escribe el profesor a mano?
