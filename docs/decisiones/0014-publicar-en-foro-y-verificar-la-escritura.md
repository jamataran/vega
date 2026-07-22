# ADR 0014 — Responder en el foro es una operación propia, y las de escritura se verifican sin ejecutarse

**Estado**: Aceptado

**Resuelve**: la pregunta abierta 1 de [HU-20](../hu/HU-20-respuesta-a-dudas-de-foro.md), marcada
`[bloqueante]`.

**Estira**: el [ADR 0009](0009-interfaz-lms-siete-operaciones.md), que a su vez estiraba la promesa
de interfaz mínima del [ADR 0006](0006-conectores-lms-interfaz-minima.md). Van ocho operaciones.

## Contexto

Vega llevaba desde el principio prometiendo dos cosas que no podía cumplir. El README pinta el
circuito acabando en «forum reply posted to Moodle»; HU-20 RN-4 prohíbe expresamente publicar la
respuesta a una duda por el camino de la nota. Ninguna de las dos era cierta en el código:
`mod_forum_add_discussion_post` no estaba declarada y `LmsConnector` no tenía por dónde escribir en
un foro.

Lo que sí había era peor que un hueco.

**La bifurcación no existía.** `publishToLms()` llamaba a `publishGrade()` para cualquier actividad.
En Moodle, el `remoteId` de una entrega es `<tarea>:<usuario>:<intento>` y el de una duda de foro es
`<foro>:<debate>:<mensaje>`: **tres números separados por dos puntos, los dos**. `parseRemoteId` los
acepta indistintamente. Publicar una respuesta validada de foro llamaba por tanto a
`mod_assign_save_grade` con `assignmentid` = el id del foro y `userid` = el id del debate: una nota
puesta a un alumno cualquiera en una actividad cualquiera, **sin error, sin aviso y sin forma de
enterarse** salvo que alguien lo mirara en Moodle. No era una carencia; era una escritura silenciosa
en el sitio equivocado.

Y en paralelo, un segundo agujero del mismo tipo: **la pantalla de Ajustes sólo comprobaba funciones
`get_*`**. Un profesor configuraba su servicio web, veía todo en verde y descubría que faltaba
`mod_assign_save_grade` la primera noche que corría el proceso, cuando ya nadie estaba mirando.

## Decisión

### 1. `publishForumReply()` es la octava operación de `LmsConnector`

Con su tipo propio, `RemoteReply`, y no un `RemoteGrade` con la nota a `null`.

La alternativa era generalizar `publishGrade` a un `publishOutcome` que decidiera según el `kind`.
Se descarta porque mete una decisión de dominio —qué significa publicar en cada tipo de actividad—
dentro del conector, que es el sitio donde peor se prueba y donde nadie la va a buscar. Dos verbos
distintos para dos cosas distintas, y la decisión de cuál se usa vive en `publishToLms()`, en la API,
que es donde ya viven las demás.

Compartir tipo, además, invita a compartir camino. Es exactamente el error que acabamos de quitar.

### 2. Cada conector rechaza el cruce, y el mock también

`publishGrade()` sobre un foro lanza; `publishForumReply()` sobre una entrega lanza. En `moodle3`
**y en el mock**, que es donde se prueba el circuito completo sin Moodle delante: si el mock lo
dejara pasar, el error volvería a descubrirse en producción.

El corte está antes de parsear el identificador y no dentro, porque el identificador no distingue
nada — ese es justamente el problema.

### 3. Las funciones de escritura se verifican por catálogo, no llamándolas

`mod_assign_save_grade` y `mod_forum_add_discussion_post` **no se pueden ensayar**: la primera
calificaría a un alumno de verdad y la segunda publicaría un mensaje en un foro con gente dentro. Un
botón «Probar conexión» con efectos visibles para el alumnado no es una comprobación, es un
incidente.

Se leen en su lugar del catálogo de funciones que `core_webservice_get_site_info` devuelve para el
token. Ahí está exactamente el fallo habitual: **Moodle no añade ninguna función al crear un
servicio externo**, hay que listarlas a mano y lo normal es que falten varias.

**Lo que esto comprueba y lo que no, dicho donde se lee.** Que la función esté en el servicio no
garantiza que el usuario tenga la capacidad (`mod/assign:grade`, `mod/forum:replypost`): eso sólo se
sabe publicando. El detalle de la comprobación lo dice con esas palabras en lugar de enseñar un
visto verde que promete más de lo que sabe.

Cuando el sitio no devuelve el catálogo, la comprobación sale como **omitida**, no como fallida. Dar
por ausente lo que no se ha podido leer mandaría a habilitar funciones que probablemente ya estén
puestas.

### 4. En un foro se publica una sola vez

No hay nota que separar del fichero, así que no hacen falta dos marcas: se reutiliza
`grade_published_at` como «esto ya salió hacia el LMS» y el reintento sigue siendo idempotente. Que
un alumno vea dos respuestas a la misma duda —quizá distintas— es peor que no ver ninguna.

## Lo que sigue sin resolverse, y hay que decirlo

**El formato del mensaje.** El cuerpo de la respuesta es hoy `teacherLatex ?? aiLatex`, el documento
de corrección, que nació en LaTeX/markdown porque nació para una entrega de matemáticas. **Un
mensaje de foro es prosa.** Publicarlo tal cual puede enseñarle al alumno la sintaxis en crudo.

Quien lo tiene que arreglar es el motor de IA: el [ADR 0011](0011-cuatro-operaciones-y-verificacion-mecanica.md)
le da una operación propia para responder dudas, y esa operación debe devolver prosa, no un
documento. **El transporte ya está; la decisión de formato es de H3** y está anotada en el código
donde se toma (`toRemoteReply()`), no escondida en un documento.

Sigue igualmente sin verificar contra un Moodle real —como todo `moodle3`—:

- si conviene `options[discussionsubscribe]=0`, para que el profesor no acabe suscrito a todos los
  debates que Vega conteste;
- qué hace el sitio con `maxeditingtime` respecto a cuándo se notifica el mensaje;
- `publishFeedbackFile` en `assignfeedback_file`, que sigue siendo el spike conocido de HU-17 y sigue
  lanzando a propósito.

## Consecuencias

**A favor**

- Deja de existir un camino que escribía notas reales en el sitio equivocado sin dar error. Es la
  razón por la que este ADR existe, y hay cuatro pruebas que fallan si vuelve.
- H3 se encuentra el transporte hecho: cuando el motor sepa redactar la respuesta, publicarla es una
  llamada que ya está probada.
- El profesor se entera en Ajustes de que le falta una función de escritura, y no de madrugada.

**En contra**

- **Ocho operaciones.** Cada una es una barrera más para quien quiera mandar un conector de su
  propio LMS, que era justo lo que el ADR 0006 quería evitar. Se acepta porque la alternativa
  —conectores que se las apañan solos con el `kind`— reparte la misma complejidad en más sitios y
  peor probados.
- Un visto verde en Ajustes sobre una función de escritura significa menos de lo que parece. Se
  compensa con el texto del detalle, que es lo único que se puede hacer sin publicar de verdad.
- El conector de ficheros escribe la respuesta en `respuesta.txt`, que hay que tratar como fichero de
  servicio: si no, la siguiente ingesta la leería como una intervención más del alumno y Vega
  acabaría respondiéndose a sí misma.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Generalizar `publishGrade` a `publishOutcome` según el `kind` | Mete una decisión de dominio en el conector, donde peor se prueba y donde nadie la busca |
| `RemoteGrade` con `score: null` para los foros | Compartir tipo invita a compartir camino, que es el fallo que se está quitando |
| No publicar y que el profesor copie y pegue | Convierte HU-20 en un generador de borradores y deja el circuito sin cerrar |
| Llamar de verdad a las funciones de escritura para verificarlas | «Probar conexión» calificaría a un alumno o publicaría en un foro |
| Marcar como fallida la escritura cuando el sitio no devuelve el catálogo | Manda a habilitar funciones que probablemente ya estén puestas |
| Colgar la respuesta del debate en vez del mensaje | La dejaría suelta al final del hilo en vez de bajo la duda que contesta |
