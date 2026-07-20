# HU-05 — Solución de referencia y reparto de puntos

| | |
|---|---|
| **Id** | HU-05 |
| **Épica** | Actividades y contexto de corrección |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 5 |
| **Depende de** | HU-04 |
| **Bloquea a** | HU-12 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** pegar la solución de la actividad y definir cuánto vale cada apartado
**para** que la IA corrija contra mi criterio y no contra el suyo, y para que la nota salga
desglosada como yo la desgloso.

Es lo más caro de preparar de todo el sistema y lo que más determina la calidad de la corrección.
Una actividad puntuable sin reparto produce correcciones que el profesor no puede revisar por
apartados; sin solución de referencia produce correcciones donde la IA decide sola qué es correcto.

**Esto es una HU de actividades puntuables.** El reparto de puntos sólo tiene sentido cuando
`graded` es `true`: en una actividad no puntuable no hay puntos que repartir ni nota máxima sobre
la que repartirlos, y la corrección sale como texto redactado sin apartados (HU-04, RN-6). La
solución de referencia, en cambio, **sirve igual en los dos casos**: en un foro no reparte puntos,
pero le dice a Vega cuál es la respuesta buena.

Vega no es una herramienta de matemáticas: sirve a cualquier materia. `referenceSolution` es texto
—LaTeX si la materia lo pide, prosa si no— y el reparto son apartados con nombre y puntos, sin
presuponer ninguna estructura interna. Cómo se reparte por dentro un apartado es asunto del
contexto del tipo de actividad (`contexts/activity-kinds/`), que el profesorado edita, no de esta
HU.

Dos matices decididos en otro sitio y que no se discuten aquí: la solución de referencia **no es la
única solución válida** —los métodos alternativos se puntúan completo, ver HU-13— y la suma del
reparto **no tiene por qué dar la nota máxima**, porque hay enunciados con apartados opcionales
(`domain.ts` lo dice explícitamente).

## Criterios de aceptación

### Escenario 1: guardar la solución de referencia

```gherkin
Dado que existe la actividad "problema12" con referenceSolution a null
Cuando envío PATCH /api/activities/{id} con referenceSolution conteniendo texto y LaTeX
Entonces recibo 200 con ActivityResponse
Y GET /api/activities/{id} devuelve el mismo texto exacto, sin transformar ni reescapar
```

### Escenario 2: la solución se renderiza

```gherkin
Dado que la actividad tiene referenceSolution con "El área vale $$\int_0^1 x^2\,dx = \frac{1}{3}$$"
Cuando abro la pantalla de la actividad
Entonces veo la prosa como texto y la expresión renderizada con KaTeX
Y puedo alternar entre la vista renderizada y el texto fuente
```

### Escenario 3: LaTeX inválido no rompe la pantalla

```gherkin
Dado que la actividad tiene referenceSolution con "$$\frac{1}{$$"
Cuando abro la pantalla de la actividad
Entonces la expresión mal formada se muestra señalada como no renderizable
Y el resto de la solución sí se renderiza
Y el guardado no se bloquea: el texto se conserva tal cual
```

### Escenario 4: definir el reparto de puntos

```gherkin
Dado que existe la actividad "comentario-texto" con graded true y maxScore 10
Cuando envío PATCH /api/activities/{id} con pointsAllocation:
  | label | statement                             | maxPoints |
  | 1     | Localización y tipo de texto          | 2         |
  | 2     | Tema y estructura                     | 3         |
  | 3     | Análisis de los recursos              | 3         |
  | 4     | Valoración crítica                    | 2         |
Entonces recibo 200
Y la Activity devuelve los cuatro apartados en el mismo orden en que los envié
```

### Escenario 5: la suma no cuadra con la nota máxima

```gherkin
Dado que la actividad tiene graded true y maxScore 10
Cuando envío un pointsAllocation cuya suma de maxPoints es 8
Entonces recibo 200: la operación NO se rechaza
Y la pantalla de la actividad muestra un aviso visible con la suma y la nota máxima
```

### Escenario 6: apartado sin etiqueta

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío un pointsAllocation con un apartado cuyo label es ""
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.fields señala la posición del apartado afectado
Y el reparto anterior no cambia
```

### Escenario 7: puntos negativos

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío un apartado con maxPoints = -1
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.fields señala el apartado afectado
```

### Escenario 8: dos apartados con la misma etiqueta

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío un pointsAllocation con dos apartados cuyo label es "1a"
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.message explica que las etiquetas de los apartados no pueden repetirse
```

### Escenario 9: en una actividad no puntuable no hay reparto

```gherkin
Dado que existe la actividad "foro-dudas" con graded false y maxScore null
Cuando abro la pantalla de la actividad
Entonces no veo la sección de reparto de puntos ni el campo de nota máxima
Y sí veo la sección de solución de referencia
```

### Escenario 10: la solución de referencia sigue valiendo sin puntuación

```gherkin
Dado que existe la actividad "foro-dudas" con graded false
Cuando envío PATCH /api/activities/{id} con referenceSolution "El tema del que preguntan es…"
Entonces recibo 200 y la Activity conserva graded false y maxScore null
Y GET /api/contexts/resolved/{id} lo incluye bajo el título "Material asociado",
  no bajo "Solución de referencia"
Y la respuesta publicada no lleva nota ni desglose por apartados
```

### Escenario 11: quitar la puntuación vacía el reparto en uso

```gherkin
Dado que la actividad "practica-lectura" tiene graded true, maxScore 10 y cuatro apartados
Cuando guardo la actividad con graded false
Entonces recibo 200 con graded false y maxScore null
Y las correcciones que se hagan a partir de ahora no llevan apartados: Correction.items va vacío
  y Correction.maxScore va a null
Y las correcciones ya hechas conservan sus apartados y su maxScore
```

### Escenario 12: cambiar el reparto no altera las correcciones hechas

```gherkin
Dado que la actividad "problema12" tiene entregas ya corregidas con cuatro apartados
Cuando cambio el pointsAllocation a cinco apartados
Entonces las correcciones existentes conservan sus cuatro CorrectionItem
Y sus maxPoints no cambian
Y las próximas entregas que se corrijan usarán los cinco apartados
```

### Escenario 13: la solución y los ficheros aparecen en el contexto efectivo

```gherkin
Dado que la actividad tiene referenceSolution y un fichero de contexto ".tex" subido entero
Cuando consulto GET /api/contexts/resolved/{activityId}
Entonces merged incluye los tres niveles de Markdown
Y después una sección con la solución de referencia
Y después una sección "Material adjunto · <nombre>" con el contenido del .tex
Y un fichero binario adjunto NO aporta ninguna sección
Y un fichero cuya subida no se ha cerrado tampoco aparece
```

### Escenario 13 bis: el reparto llega al modelo, la solución todavía no

```gherkin
Dado que la actividad tiene referenceSolution y pointsAllocation definidos
Cuando se corrige una entrega de esa actividad en el lote
Entonces el reparto de puntos sí llega al motor y manda sobre lo que devuelva la IA
Pero la solución de referencia y el contenido de los ficheros NO se envían:
  el lote monta el contexto con sólo los tres niveles de Markdown
Y esto es una carencia declarada, no el comportamiento deseado (RN-8)
```

### Escenario 14: sin sesión

```gherkin
Dado que no envío cabecera Authorization
Cuando envío PATCH /api/activities/{id} con referenceSolution o pointsAllocation
Entonces recibo 401 con error.code = "UNAUTHORIZED"
Y nada se guarda
```

## Reglas de negocio

**RN-1.** `referenceSolution` es **texto libre y nullable**: prosa, LaTeX o una mezcla de las dos.
Se guarda **tal cual se escribe**, sin transformar ni reescapar. No se presupone materia: el LaTeX
es una posibilidad, no un requisito.

**RN-2.** `pointsAllocation` es una lista ordenada de `PointsAllocation`: `label` (no vacío),
`statement` (por defecto cadena vacía) y `maxPoints >= 0`. **El orden del array es el orden de los
apartados** y se conserva.

**RN-3.** Los `label` deben ser **únicos dentro de la actividad**. Dos apartados «1a» hacen
imposible que el profesor sepa cuál está puntuando.

**RN-4.** **El reparto de puntos sólo aplica a actividades puntuables.** Con `graded = false` no se
muestra, no se envía al modelo y no genera `CorrectionItem`. Lo que ocurre con un reparto ya
guardado cuando la actividad deja de puntuarse está en la pregunta abierta 1.

**RN-5.** **La solución de referencia aplica siempre**, se puntúe o no. En una actividad no
puntuable es la guía de la respuesta correcta: orienta lo que Vega redacta, pero no reparte puntos
ni produce nota.

**RN-5 bis.** **El mismo campo se rotula distinto según `graded`.** En una actividad puntuable la
sección se titula **«Solución de referencia»**; en una no puntuable, **«Material asociado»**. No es
cosmética: en un foro de dudas lo que el profesor pega no es la respuesta correcta a una pregunta,
sino el material del que preguntan los alumnos, y llamarlo «solución» invita al modelo a tratarlo
como plantilla de respuesta. Lo aplica `resolveContext()` en `packages/core`, y la UI usa el mismo
rótulo para que el profesor vea en pantalla lo que el modelo va a leer.

**RN-6.** **La suma de `maxPoints` no se fuerza a coincidir con `maxScore`.** Es una decisión
explícita del modelo de dominio: hay enunciados con apartados opcionales o con puntos de
presentación fuera del reparto. La UI avisa de la discrepancia; el API no la rechaza.

**RN-7.** Cambiar `pointsAllocation` **no reescribe correcciones ya hechas**. Los `CorrectionItem`
guardan su propio `label`, `statement` y `maxPoints`, copiados en el momento de corregir. Sólo
afecta a las correcciones futuras.

**RN-8.** El reparto de puntos y la solución de referencia **son entrada del sistema**, no
documentación interna: forman parte del contexto que se envía al modelo, junto con los tres niveles
de Markdown (`contexts/README.md`). `resolveContext()` los monta en su propia sección, al final:
son lo más concreto y lo que más cambia entre actividades, así que ponerlos antes acortaría el
prefijo cacheable sin ganar nada.

> **Ojo, y esto sigue roto.** `resolveContext()` sabe montar la sección y
> `GET /api/contexts/resolved/{activityId}` la enseña, pero **el lote no se la pasa**:
> `apps/api/src/routes/batch.ts` construye el `ResolveContextInput` con sólo los tres niveles de
> Markdown. Hoy la solución de referencia y el contenido de los ficheros adjuntos se ven en la
> pantalla de contexto efectivo y **no pesan en la corrección**. Hasta que el lote los pase, la
> pantalla promete algo que no ocurre.

**RN-8 bis.** **Los ficheros de contexto de texto sí guardan su contenido.** `.tex`, `.md`,
`.markdown` y `.txt` (`isTextFile()`) se almacenan en `activity_files.content` y entran en el
contexto resuelto en su propia sección, «Material adjunto · *nombre*». Un fichero **binario** se
registra como referencia del profesor, sin contenido: `ActivityFile.hasContent` va a `false` y la UI
lo dice, en vez de ofrecer una subida que no sirve para nada.

**RN-9.** Una actividad puntuable **sin `pointsAllocation`** se corrige igual, pero la IA decide
sola el desglose, y ese desglose será distinto entre entregas de la misma actividad. La UI lo
advierte como configuración incompleta.

**RN-10.** Una actividad **sin `referenceSolution`** se corrige igual: la IA resuelve la actividad
por su cuenta. La calidad baja y la UI lo advierte, pero es un caso soportado — hay actividades
para las que el profesor no tiene la solución escrita.

**RN-11.** El reparto **no presupone estructura interna del apartado**. Un apartado es un nombre y
unos puntos. Cómo se valora por dentro —qué pesa el planteamiento, el desarrollo o el resultado, si
es que la materia distingue esas cosas— se escribe en Markdown en `contexts/activity-kinds/`, que
el profesorado edita sin tocar el producto.

**RN-12.** Las indicaciones de corrección de la actividad **no viven en una columna propia**: van
en el `GradingContext` de nivel `activity`, cuya `key` es el `slug`. La columna `grading_notes`
desapareció en la migración `0002_activities.sql`.

**RN-13.** Cualquier usuario autenticado (`teacher` o `admin`) puede editar la solución y el
reparto, con el mismo `PATCH /api/activities/{id}` de HU-04.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Solución de referencia muy larga (un documento entero pegado) | Se guarda. Encarece cada llamada al modelo, pero el prompt caching lo amortigua dentro de la misma actividad. La UI muestra el tamaño aproximado |
| Reparto con un solo apartado de valor `maxScore` | Válido. Es la actividad que se puntúa en bloque. La corrección tendrá un solo `CorrectionItem` |
| Reparto vacío en una actividad con entregas ya corregidas | Permitido. Las correcciones hechas no cambian; las futuras las desglosa la IA sola (RN-9) |
| `maxPoints = 0` en un apartado | Válido. Es un apartado que se comenta pero no puntúa |
| La suma del reparto supera `maxScore` | Se guarda con aviso. Una entrega perfecta podría dar más nota que el máximo: se avisa también en la revisión |
| Se envía `pointsAllocation` no vacío a una actividad con `graded = false` | Ver pregunta abierta 1: hoy el API lo acepta y lo guarda, y la pantalla envía `[]`. La regla que falta decidir es si se rechaza con 422 o se conserva latente |
| Se reordenan los apartados sin cambiar los `label` | Las correcciones futuras salen en el orden nuevo. Las hechas conservan su `position` |
| Solución de referencia escrita en LaTeX en un fichero aparte | Se sube como fichero de contexto: un `.tex` guarda su contenido y entra en el contexto resuelto. Ver pregunta abierta 2 |
| Solución de referencia en un formato distinto (PDF escaneado, foto de la pizarra) | **No se almacena su contenido.** El fichero se registra como referencia del profesor, con `hasContent: false`, y la UI advierte de que no llega al modelo. Hay que transcribirla o pegarla como texto. Ver pregunta abierta 2 |
| Un fichero de texto muy grande | Tope de 4 MiB por fichero (`MAX_FILE_CONTENT_BYTES`). Al superarlo la subida se borra y se devuelve 422: nadie va a reanudar una subida que no cabe |
| La subida se corta a medias | La fila queda con `upload_complete = false`: **no se lista ni entra en el contexto**, y se barre a la hora. Una subida cortada no acaba nunca en un prompt |
| Actividad no puntuable con solución de referencia y sin contexto propio | Válido y útil: es el caso normal de un foro de dudas bien preparado. La sección se titula «Material asociado» (RN-5 bis) |

## Fuera de alcance

- **Configurar `graded`, `maxScore`, `enabled` y `autonomy`.** Es HU-04, aunque se guarden con el
  mismo `PATCH`.
- **Adjuntar la solución como fichero binario y que el modelo la lea.** Un `.tex`, `.md` o
  `.txt` sí guarda su contenido y entra en el contexto resuelto; un PDF, una imagen o un `.docx` se
  registran como referencia y no llegan al modelo. **No hay OCR de ficheros de contexto**: el motor
  de HU-10 transcribe entregas de alumnos, no material del profesor. Ver pregunta abierta 2 y HU-06.
- **Que el lote pase la solución de referencia y los ficheros al modelo.** El contexto resuelto los
  incluye y la pantalla los enseña, pero `batch.ts` todavía no se los pasa al motor (RN-8). Es una
  carencia declarada, no una decisión.
- **Editor visual de fórmulas.** El profesor escribe LaTeX si su materia lo pide. Se le da vista
  previa, no un editor WYSIWYG.
- **Rúbrica estructurada dentro de un apartado.** RN-11: eso vive en Markdown, en
  `contexts/activity-kinds/`, y se edita desde HU-06.
- **Reescribir correcciones existentes al cambiar el reparto.** RN-7. Si se quiere, se reprocesa
  (HU-11).
- **Importar el reparto de puntos desde Moodle.** La interfaz `LmsConnector` no lo contempla y no
  se plantea ampliarla por esto.
- **Historial de versiones de la solución.** No hay columna ni tabla.
- **Plantillas de reparto reutilizables entre actividades.** Ver pregunta abierta 4.

## Notas de implementación

**Entidades** (`@vega/shared`): `Activity.referenceSolution`, `Activity.pointsAllocation`,
`PointsAllocation` (`label`, `statement`, `maxPoints`), `Correction.items`, `Correction.maxScore`,
`CorrectionItem`.

**Contrato** (`packages/shared/src/api.ts`): `UpdateActivityRequest` con `referenceSolution`
(`z.string().nullable().optional()`) y `pointsAllocation` (`z.array(PointsAllocation).optional()`).
Es el mismo endpoint de HU-04.

**Endpoints** (`routes`): `activity(id)` → `PATCH /api/activities/{id}`.

**Códigos de error**: las validaciones de cuerpo salen por `parseOrThrow`, que devuelve **422
`UNPROCESSABLE`** con `error.fields`, no 400.

**Esquema** (`0002_activities.sql` sobre `0001_init.sql`): `activities.reference_solution text`,
`activities.points_allocation jsonb NOT NULL DEFAULT '[]'`. La columna `activities.grading_notes`
**ya no existe** (RN-12). Desde `0003_courses.sql`: `activity_files.content text` guarda el texto de
los ficheros legibles y `activity_files.upload_complete boolean NOT NULL DEFAULT true` marca las
subidas cerradas.

**Contexto resuelto** (`packages/core/src/context/resolve.ts`): `resolveContext()` recibe
`referenceSolution`, `graded` y `fileContents`, y añade después de los tres niveles una sección
«Solución de referencia» o «Material asociado» según `graded` (RN-5 bis), más una sección «Material
adjunto · *nombre*» por cada fichero de texto. Lo llama `GET /api/contexts/resolved/{activityId}`
—que es lo que el profesor ve— y lo llama `gradeSubmission()` —que es lo que el modelo lee—, pero el
lote sólo le pasa los tres niveles: ver el aviso de RN-8.

**Relación con la corrección**: `CorrectionItem` copia `label`, `statement` y `maxPoints` del
reparto en el momento de corregir. Esa copia es lo que hace que RN-7 se cumpla sin esfuerzo.
`corrections.max_score` es nullable desde la 0002, que es lo que permite RN-4 y el escenario 11.

**UI**: dentro de `apps/frontend/src/pages/ActivityDetailPage.tsx`. La solución de referencia usa
`PreviewEditor` en modo `latex`, con vista previa conmutable. El reparto usa
`PointsAllocationEditor`, que recibe `maxScore` para poder mostrar la suma acumulada. Ambas
secciones se pintan condicionadas a `form.graded`, salvo la solución de referencia, que se muestra
siempre (RN-5). Al guardar con `graded = false`, el formulario envía `pointsAllocation: []`.

**Lo que hoy NO está implementado y esta HU exige**:

- **RN-3 (etiquetas únicas, escenario 8)**: no hay refinamiento en `PointsAllocation` ni en
  `UpdateActivityRequest`, y la unicidad dentro de un `jsonb` no la expresa un `CHECK` razonable.
  Hay que añadir un `.superRefine()` en el contrato.
- **RN-4 en el API (caso límite del reparto en actividad no puntuable)**: el `PATCH` guarda
  `pointsAllocation` sin mirar `graded`. Sólo la UI lo evita. Ver pregunta abierta 1.

**Mock**: completa. Los datos sembrados incluyen actividades con reparto y solución realistas y al
menos una **no puntuable con solución de referencia**, para que el caso del foro se vea desde el
primer día, y al menos una cuya suma **no** cuadra con `maxScore`, para que el aviso de RN-6 sea
visible sin fabricarlo.

## Preguntas abiertas

1. **¿Qué se hace con un `pointsAllocation` que llega a una actividad no puntuable?** Hoy el API lo
   guarda y sólo la UI lo evita enviando `[]`, así que el estado de la base de datos depende de por
   dónde entren los datos. Opciones: (a) rechazar con 422 si `graded` es `false` y el reparto no
   está vacío, coherente con RN-4 pero incómodo al alternar el conmutador; (b) aceptarlo y
   conservarlo latente, de modo que volver a puntuar recupere el reparto —es lo que describe el
   caso límite de HU-04—; (c) aceptarlo y vaciarlo en el servidor, como se hace con `maxScore`
   (HU-04, RN-5), lo que es consistente pero destruye trabajo del profesor sin avisar. Consecuencia:
   sin decidirlo, dos clientes distintos dejan la misma actividad en estados distintos.
   **`[bloqueante]`: es una invariante del dominio a medio escribir.**

2. ~~**¿Puede la solución de referencia entrar como fichero?**~~ **Resuelta: sólo texto, sin OCR.**
   Es la opción (a) con una vuelta de tuerca: no se pide al profesor que transcriba a mano en el
   formulario, sino que **suba el fichero si ya es texto**. `.tex`, `.md`, `.markdown` y `.txt`
   guardan su contenido en `activity_files.content` y entran en el contexto resuelto; el LaTeX de un
   enunciado ya es texto, entra literal en el prompt, se cachea con el resto del contexto y no cuesta
   ni una llamada de visión.

   Se descartó (b) —transcribir con el motor de OCR de HU-10— porque ese motor está afinado para
   manuscrito de alumno y no para material tipografiado, y porque una transcripción errónea del
   enunciado envenena todas las correcciones de la actividad sin que nadie lo note. Y (c) —enviar el
   fichero como imagen en cada corrección— porque exige almacenamiento real de binarios y encarece
   cada llamada de forma permanente.

   **Consecuencia asumida, y visible en la UI**: un PDF escaneado o una foto de la pizarra **se
   pueden adjuntar pero no llegan al modelo**. `ActivityFile.hasContent` lo expresa en el contrato y
   la pantalla lo dice; ya no se ofrece una subida que no sirve para nada, pero el profesor con la
   solución en papel sigue teniendo que escribirla.

   Queda un cabo suelto que no es de esta pregunta: el lote todavía no pasa el contenido de los
   ficheros al motor (RN-8).

3. **¿Debe avisarse cuando la suma del reparto no cuadra, o bloquearse?** RN-6 dice avisar. Pero una
   actividad mal configurada produce notas mal escaladas para todos sus alumnos, y el aviso se
   ignora. Opciones: (a) avisar y ya; (b) bloquear la **validación** de la primera entrega hasta que
   el profesor confirme que la discrepancia es intencionada, que es un freno en el sitio donde
   importa; (c) exigir que cuadre, incompatible con los apartados opcionales que motivaron RN-6.

4. **¿Debe poder reutilizarse un reparto entre actividades?** Los apartados de un comentario de
   texto se repiten en todos los comentarios de texto del curso. Copiar y pegar funciona pero se
   desincroniza. Opciones: (a) plantillas de reparto como entidad nueva; (b) copiar el reparto de
   otra actividad al configurarla, sin vínculo posterior; (c) nada, y que el reparto viva en el
   contexto del tipo de actividad como texto. Consecuencia: (a) es una tabla y una pantalla más para
   un problema que quizá resuelva (b).

5. **¿Qué hace la IA cuando no encuentra en la entrega un apartado del reparto?** El alumno deja el
   apartado 3 en blanco. Opciones: (a) generar el `CorrectionItem` con `aiPoints = 0` y feedback
   explicando que no aparece, que es lo que hoy instruye `contexts/global.md`; (b) no generar el
   ítem, dejando la corrección con menos apartados de los esperados y una nota que no se puede
   comparar entre alumnos. La (a) es coherente con el contexto global, pero conviene que quede
   escrito como regla del sistema y no sólo como instrucción al modelo. **`[bloqueante]` para
   HU-12.**
