# HU-17 — Publicar nota y PDF de feedback en el LMS

| | |
|---|---|
| **Id** | HU-17 |
| **Épica** | Publicación |
| **Estado** | borrador |
| **Prioridad** | Must |
| **Estimación** | 13 |
| **Depende de** | HU-16 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | No |

## Narrativa

**Como** profesor
**quiero** que la nota validada y un PDF con la corrección lleguen al LMS
**para** que el alumno reciba su feedback donde ya mira, sin que yo tenga que copiar nada a mano.

Es el último paso del circuito y el primero que toca a un tercero. Se separa de la validación a
propósito: validar es una decisión humana que no debe depender de que el Moodle esté en pie;
publicar es una operación de red que falla, se reintenta y no debería volver a molestar al profesor.

Arrastra el **riesgo técnico conocido** del proyecto: subir un fichero al área
`assignfeedback_file` de Moodle 3 por web services no es una operación limpia y puede no ser viable
según la configuración. El [ADR 0006](../decisiones/0006-conectores-lms-interfaz-minima.md)
encapsula ese riesgo en un método de una implementación, y `publishGrade` y `publishFeedbackFile`
son operaciones separadas precisamente para que la nota pueda llegar aunque el fichero no.

## Criterios de aceptación

### Escenario 1: publicación correcta

```gherkin
Dado que una entrega está en status "validated"
Cuando envío POST /api/submissions/{id}/publish
Entonces se genera el PDF de feedback
Y se llama a publishGrade del conector del buzón con la nota efectiva
Y se llama a publishFeedbackFile con el PDF
Y recibo 200 con CorrectionResponse
Y correction.publishedAt queda relleno
Y submission.status es "published"
```

### Escenario 2: no se publica sin validar

```gherkin
Dado que una entrega está en status "graded"
Cuando envío POST /api/submissions/{id}/publish
Entonces recibo 409 con error.code = "CONFLICT"
Y no se llama al conector
Y nada llega al alumno
```

### Escenario 3: la nota publicada es la efectiva

```gherkin
Dado que una corrección tiene items con aiPoints 2, 2, 2, 2
Y el profesor puso teacherPoints 1 en el primero
Cuando se publica
Entonces la nota enviada al LMS es 7, calculada con totalScore
Y no es 8
```

### Escenario 4: el LMS no responde

```gherkin
Dado que una entrega está en "validated"
Y el servidor del LMS no responde
Cuando envío POST /api/submissions/{id}/publish
Entonces recibo 500 con error.code = "INTERNAL"
Y submission.status pasa a "error" con errorMessage legible en español
Y publishedAt sigue siendo null
Y la entrega se puede reintentar
```

### Escenario 5: reintento tras un fallo

```gherkin
Dado que una entrega quedó en "error" al fallar la publicación
Y el LMS vuelve a estar disponible
Cuando reintento la publicación
Entonces la entrega vuelve a "validated" y se publica
Y no se duplica la nota en el LMS
```

### Escenario 6: la nota se publica y el fichero falla

```gherkin
Dado que publishGrade termina correctamente
Y publishFeedbackFile falla
Cuando se ejecuta la publicación
Entonces la entrega NO queda en "published"
Y errorMessage indica que la nota se publicó pero el fichero no
Y el reintento no vuelve a publicar la nota si ya está puesta
```

### Escenario 7: contenido del PDF

```gherkin
Dado que se genera el PDF de feedback de una corrección
Cuando lo abro
Entonces contiene la nota total sobre la máxima, con coma decimal
Y un bloque por apartado con sus puntos efectivos y su feedback efectivo
Y el resumen efectivo de la corrección
Y el LaTeX aparece renderizado, no como código fuente
Y lleva la marca de la academia
```

### Escenario 8: el PDF muestra lo efectivo, no lo de la IA

```gherkin
Dado que un apartado tiene aiFeedback y teacherFeedback distintos
Cuando se genera el PDF
Entonces aparece el teacherFeedback
Y el aiFeedback NO aparece en ninguna parte del documento
```

### Escenario 9: no se republica

```gherkin
Dado que una entrega está en status "published"
Cuando envío POST /api/submissions/{id}/publish
Entonces recibo 409 con error.code = "CONFLICT"
```

### Escenario 10: conector sin soporte de ficheros

```gherkin
Dado que el conector del buzón no implementa publishFeedbackFile
Cuando se publica una entrega de ese buzón
Entonces la nota se publica igualmente
Y la entrega queda en "published"
Y se indica que el feedback no se ha adjuntado por limitación del conector
```

## Reglas de negocio

**RN-1.** Sólo se publica desde `validated`. **No existe camino de `graded` a `published`**
([ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md)). La comprobación está en el API.

**RN-2.** La nota publicada es `totalScore` sobre los puntos **efectivos**
(`teacherPoints ?? aiPoints`), no la propuesta de la IA.

**RN-3.** El PDF muestra el contenido **efectivo**: `teacherFeedback ?? aiFeedback` por apartado y
`teacherSummary ?? aiSummary` como resumen. **Lo que el profesor sustituyó no aparece.**

**RN-4.** La publicación son dos operaciones separadas del conector: `publishGrade` y
`publishFeedbackFile`. Un conector puede implementar sólo la primera.

**RN-5.** `published` sólo se alcanza si **todas** las operaciones soportadas por el conector han
terminado bien. Un éxito parcial deja la entrega en `error` con mensaje explicativo.

**RN-6.** La publicación es **idempotente en la medida de lo posible**: reintentar tras un fallo
parcial no debe duplicar la nota ni el fichero.

**RN-7.** Un fallo de publicación lleva a `error` con `errorMessage` legible en español, y se puede
reintentar sin volver a validar.

**RN-8.** `publishedAt` se rellena sólo al completar la publicación. Estado terminal.

**RN-9.** El PDF lleva la marca de la academia (`BRAND_NAME` y el logo montado), y **el LaTeX va
renderizado**: un alumno no debe recibir `\frac{1}{2}` en crudo.

**RN-10.** Se usa el conector **actual** del buzón (`Mailbox.connector`), no el que tenía cuando se
ingirió la entrega.

**RN-11.** Cualquier usuario autenticado puede publicar. Publicar es ejecutar una decisión ya
tomada al validar.

## Casos límite

| Caso | Qué se hace |
|---|---|
| El buzón ha cambiado de conector desde la ingesta | Se publica con el actual (RN-10). Puede fallar si `lmsRef` no corresponde: error de configuración, no de red |
| El alumno ya no existe en el LMS | Fallo de publicación con mensaje que lo nombra. No se reintenta solo |
| La tarea del LMS está cerrada a calificación | Fallo de configuración. Requiere intervención en el LMS |
| Nota efectiva por encima de `maxScore` | Se publica tal cual (HU-16, RN-9). Si el LMS la rechaza, es fallo de publicación con mensaje explícito |
| Conector `filesystem` | Escribe nota y PDF en el directorio de salida. Es el camino de las academias sin LMS |
| Conector `mock` | Simula la publicación sin efectos externos. La entrega llega a `published` |
| PDF enorme (entrega de 40 páginas) | Se genera igual. Sólo lleva la corrección, no los escaneos, así que el tamaño es acotado |
| Publicación de muchas entregas seguidas | Cada una es una llamada. No hay publicación en bloque |
| Reintento tras publicar la nota pero no el fichero | RN-6: se comprueba si la nota ya está puesta antes de reenviarla |

## Fuera de alcance

- **Publicación en bloque.** No hay endpoint.
- **Publicación automática tras validar.** Son dos acciones a propósito, aunque la UI pueda
  encadenarlas.
- **Despublicar o retirar una nota.** No hay ruta. Ver pregunta abierta 3.
- **Notificar al alumno.** Lo hace el LMS con sus propios avisos.
- **Adjuntar los escaneos originales al PDF.**
- **Personalizar la plantilla del PDF** más allá de la marca. Ver pregunta abierta 4.
- **Publicar en otro sitio** (correo directo al alumno, descarga desde Vega).

## Notas de implementación

**Entidades** (`@vega/shared`): `Correction.publishedAt`, `Correction.validatedAt`,
`effectivePoints`, `totalScore`.

**Estados** (`SubmissionStatus`): `validated → published`, o `→ error` si falla.

**Endpoints** (`routes`): `publish(id)` → `POST /api/submissions/{id}/publish`. Sin cuerpo. Devuelve
`CorrectionResponse`.

**Interfaz de conector** (ADR 0006): `publishGrade(ref, nota)` y `publishFeedbackFile(ref, pdf)`.

**Esquema**: `corrections.published_at timestamptz`, nullable. No hay más columnas: **no se guarda
el PDF generado** ni el resultado detallado de la publicación.

**Generación del PDF**: Markdown más LaTeX a PDF con la plantilla de la academia. En Node esto no es
trivial —renderizar KaTeX a un PDF exige un motor de composición o un navegador sin interfaz—, y es
una de las consecuencias reconocidas de [ADR 0001](../decisiones/0001-monorepo-typescript.md).

**Riesgo del conector `moodle3`**: subir a `assignfeedback_file` vía web services más
`mod_assign_save_grade` puede no ser viable limpiamente. El plan B —nota más feedback como
comentario HTML, PDF por otro canal— se implementa **dentro de la implementación `moodle3`**, sin
que el resto del sistema se entere. Conviene hacer ese spike antes de estimar el resto de la HU.

**Mock**: fuera de la entrega mockeada. El conector `mock` simula la publicación para que el
circuito llegue hasta `published` en la demo, pero ni se genera PDF real ni se toca ningún LMS. La
publicación real en Moodle 3 es la pieza con más riesgo del proyecto y no debe mezclarse con la
entrega que sirve para cerrar el diseño del producto.

## Preguntas abiertas

1. **¿Es viable `assignfeedback_file` en Moodle 3?** Es el riesgo técnico número uno del proyecto y
   sigue sin resolverse. Necesita un spike contra un Moodle 3 real antes de comprometer la HU. Si no
   es viable: (a) plan B con feedback HTML como comentario y sin PDF; (b) PDF por correo desde
   Vega, lo que exige SMTP obligatorio; (c) PDF descargable desde Vega con un enlace en el
   comentario del LMS, lo que exige acceso público autenticado a un recurso de Vega.
   **`[bloqueante]`: condiciona el alcance entero de la HU.**

2. **¿Qué se hace cuando la nota se publica y el fichero falla?** RN-5 deja la entrega en `error`,
   pero **la nota ya está en el LMS y el alumno la ve**. El estado de Vega y el del mundo no
   coinciden. Opciones: (a) lo que dice RN-5, con `errorMessage` explícito y reintento que sólo
   reenvía lo que falta —exige saber qué se llegó a publicar, y hoy no hay dónde guardarlo—; (b)
   marcar `published` con aviso, mintiendo un poco; (c) publicar primero el fichero y luego la nota,
   invirtiendo el orden para que el fallo deje al alumno sin nota en lugar de sin explicación. La
   (c) es una decisión de producto interesante: ¿qué es peor para el alumno? **`[bloqueante]`.**

3. **¿Se puede corregir una nota ya publicada?** Ocurrirá: un alumno reclama y tiene razón. Hoy
   `published` es terminal y no hay endpoint de despublicación ni de reapertura (HU-16, pregunta 2).
   Opciones: (a) reabrir a `graded`, reeditar y volver a publicar, lo que exige decidir si el LMS
   admite sobrescribir la nota y qué pasa con el PDF anterior; (b) no soportarlo y que el profesor
   lo corrija a mano en el LMS, dejando Vega desactualizado; (c) permitir una republicación
   explícita. **`[bloqueante]`: el caso es seguro, no hipotético.**

4. **¿Qué aspecto tiene el PDF de feedback?** No hay plantilla definida. Y hay decisiones de fondo,
   no de estilo: ¿aparece el desglose por apartados o sólo la nota y el resumen? ¿Se dice al alumno
   que la corrección la ha propuesto una IA y validado un profesor? Lo segundo tiene lecturas de
   transparencia y de RGPD, y afecta a cómo el alumno recibe la nota.

5. **¿Debe guardarse el PDF publicado?** Hoy no se guarda: se genera al vuelo. Si un alumno reclama
   dos meses después, no se puede reproducir exactamente lo que recibió —el feedback pudo cambiar,
   o la plantilla. Guardarlo exige almacenamiento y política de retención, la misma pregunta de
   HU-08.

6. **¿Hace falta publicación en bloque?** Publicar 80 entregas validadas una a una es tedioso y
   además es puro trabajo mecánico: la decisión ya está tomada al validar. Es un caso mucho más
   claro que el de la validación en bloque (HU-16, pregunta 1), porque no compromete el ADR 0004. Un
   `POST /api/batch/publish` no está en el contrato.

7. **¿Debe reintentarse automáticamente la publicación fallida?** Un timeout del LMS a las 8:00
   podría reintentarse solo a las 8:05 sin molestar a nadie. Exige distinguir fallo transitorio de
   fallo de configuración —lo que el ADR 0006 pide a todo conector— y guardar la clase de error, que
   hoy no tiene columna.
