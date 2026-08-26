# Incidencias del lote de producción del 23-08-2026 — análisis, diseño y plan de implementación

**Contexto.** El 23-08 a las 17:22 el planificador de producción lanzó el proceso de entregas con
`ingest.maxAgeDays = 0` (sin límite de antigüedad). Ingirió 131 entregas históricas, corrigió 14 y
falló 3 (`batch_runs.8e1395f1`, 3 h 40 min, 33,98 €). Un proceso manual del 24-08 a las 15:15
(`788c7e19`) ingirió una entrega más y falló con ella. De ahí salen los tres síntomas de este
documento. Se analizan con el registro de llamadas de IA de producción (`scripts/vega-admin.sh`),
no con suposiciones.

**Decisiones tomadas el 24-08 (José):**

1. **Poppler entra en la imagen del API.** Poppler es la biblioteca libre de PDF que usan Evince,
   Okular y LibreOffice; `poppler-utils` son sus herramientas de terminal, y `pdftoppm` es la que
   convierte cada página de un PDF en una imagen. Es un paquete del sistema (Alpine lo trae), no un
   módulo de Node: no hay compilación nativa ni cambia el `package.json`.
2. **La aplicación debe ser robusta frente a entregas grandes**, aunque el volumen habitual sea
   pequeño. Por tanto los puntos que en el primer borrador eran opcionales (tope de páginas, tope de
   tamaño, redescarga desde el reproceso, presupuesto por petición) **entran en el alcance**.

| # | Síntoma en la cola | Causa raíz | Arreglo | PR |
|---|---|---|---|---|
| 1 | `413 request_too_large` | El PDF entero (94 MB de fotos de móvil) viaja en **una** petición; el tope de la API son 32 MB por petición | Normalizar el original para el motor (rasterizar a 150 ppp) + presupuesto de bytes por petición + original opcional en `grade()` | 3 |
| 2 | «Moodle no ha respondido en 30000 ms al descargar la entrega» | Un único timeout de 30 s cubre la descarga completa; un escaneo de 94 MB no cabe | Timeout por inactividad + tope absoluto + tope de tamaño; reintento; redescarga desde el reproceso; copy que diga la verdad | 2 |
| 3 | «no ha transcrito las páginas 2…13» | El prompt exige `pages[].notes` y `pages[].confidence` pero el esquema JSON no los admite; la decodificación restringida descarrila al modelo tras la página 1 | Alinear esquema con prompt (test de contrato) + reintento dirigido de las páginas que faltan + consolidación asimétrica | 1 |

---

## 1. `request_too_large`

### 1.1 Evidencia

Entrega `0bcfd564` (*Mes 2 – Prueba 1: Desarrollo de tema*, 14 páginas, «SIMULACRO BLOQUE 2
TEORÍA.pdf»). Las dos lecturas (`reading_a` `89aa1249`, `reading_b` `03396055`) fallan con
`413 {"error":{"type":"request_too_large"}}`. El ledger guarda el tamaño de cada bloque enviado:

| Bloque (páginas) | Bytes |
|---|---|
| 1–4 | 30 015 608 |
| 5–8 | 29 923 749 |
| 9–12 | 25 386 054 |
| 13–14 | 13 214 625 |
| **Total en una petición** | **93,98 MB** (≈ 125 MB en base64) |

Misma causa en `87ea5f52` (17 páginas, «simulacro septiembre. Tema 3.pdf»). Son escaneos de móvil:
**~7 MB por página**. Para comparar, `bd6b7660` (13 páginas, escáner) ocupa 6,57 MB en total.

### 1.2 Causa

Dos cosas combinadas:

1. **`ai.pagesPerChunk` no acota la petición.** `splitPdfIntoPageSources()` parte el PDF en bloques
   (`batch.ts:1227`), pero `AnthropicProvider.transcribe()` mete **todos** los bloques en un solo
   mensaje (`anthropic.ts:295-343`). El troceado sólo sirve para que el modelo numere bien las
   páginas (commit `f43c2aa`); el tamaño total de la petición es el del PDF completo. Lo mismo ocurre
   en `grade()`: `originals` son todos los bloques otra vez (`anthropic.ts:380`). Con el límite
   documentado de **32 MB por petición, contando todo el payload**, cualquier original que pase de
   ~23 MB en bruto falla en lectura A, lectura B y corrección.
2. **Los bytes de más no compran nada.** La API rasteriza cada página a imagen en su lado (y en Opus
   4.8 la reduce a ≤ 2 576 px de lado largo). Una foto de 12 Mpx a 7 MB y un JPEG de 1 754 px a
   300 KB cuestan los mismos tokens. La documentación de PDF lo dice explícitamente: «downsampling
   embedded images can also help» y avisa de que la Files API **no** evita el fallo con PDF grandes
   (queda descartada como solución; además no reduce coste ni el límite de 600 páginas).

No es un fallo global del proveedor (bien: `isFatalProviderError` no lo trata como tal y el lote
sigue), pero el mensaje que ve el profesor es el JSON crudo de la API.

### 1.3 Diseño

Tres capas, de la que resuelve el caso real a la que sólo protege:

**Capa A — Normalizar el original para el motor (arreglo real).**

- Nuevo módulo `apps/api/src/ingest/normalize.ts`: `normalizeForEngine(bytes, mediaType) →
  { bytes, pages }`. Rasteriza cada página con `pdftoppm -r 150 -jpeg -jpegopt quality=80`
  (`poppler-utils`, `apk add --no-cache poppler-utils` en la etapa `runtime` de
  `apps/api/Dockerfile`, ~30 MB de imagen) y recompone un PDF con `pdf-lib` (`embedJpg`, una página
  por imagen, tamaño A4). A4 a 150 ppp = 1 240 × 1 754 px, por debajo de los 2 576 px que usa el
  modelo; un manuscrito queda en 150–400 KB/página. Los 17 folios de `87ea5f52` pasarían de ~100 MB a
  ~5 MB: **una sola petición** y, de paso, minutos menos de subida (la lectura A tardó 97 s sólo
  en fallar).
- Una **imagen suelta** (`image/jpeg`, `image/png`, que tiene su propio tope de 5 MB por imagen) se
  envuelve primero en un PDF A4 con `pdf-lib` y sigue el mismo camino.
- **Cuándo**: perezosamente en `pagesOf()` (`batch.ts:1200`), sólo si `sizeBytes / pageCount >
  ENGINE_MAX_BYTES_PER_PAGE` (1,5 MB) o `sizeBytes > ENGINE_MAX_ORIGINAL_BYTES` (20 MB). El resultado
  se guarda una vez en `submissions/<id>/engine.pdf` (`FileStore.saveDerived`) y se reutiliza en
  reprocesos. Hacerlo aquí y no en la ingesta evita migración, cubre las entregas ya ingeridas (las
  dos que están hoy en `error`) y no alarga la descarga.
- **El original no se toca.** `storage_path`, `/api/submissions/:id/original` y `imageUrl` siguen
  apuntando al fichero que entregó el alumno: es la prueba de lo que entregó y lo que el profesor
  abre para revisar.
- **Si `pdftoppm` no está** (imagen antigua, desarrollo local sin poppler): `pagesOf()` sigue con
  el original y las capas B y C hacen su trabajo; `/api/health` añade `tools.pdftoppm: ok|missing`
  y el arranque escribe un `warn`. Nunca se rechaza una entrega por esto.
- Por qué `pdftoppm` y no otra cosa: `sharp` es un módulo nativo de Node y sólo reescala imágenes,
  no páginas; `jpeg-js` es JS puro pero sólo cubre páginas que sean exactamente un JPEG (falla con
  JPX de escáneres iOS, Flate, PDF vectoriales mixtos). Poppler rasteriza cualquier PDF y el ADR 0001
  ya contemplaba «invocar un binario (`pdftoppm`)» para esto.

**Capa B — Presupuesto de bytes por petición (red de seguridad, TS puro).**

- `splitPdfIntoPageSources(bytes, { pagesPerChunk, maxChunkBytes })`: además del tope de páginas,
  corta el bloque cuando `páginas × (bytes/pageCount)` superaría `maxChunkBytes` (mínimo, una
  página por bloque). La estimación por página media basta: los tamaños observados son homogéneos.
- El motor agrupa bloques en peticiones: `planTranscriptionRequests(pages, REQUEST_RAW_BUDGET)` en
  `engine.ts`, con `REQUEST_RAW_BUDGET = 20 MiB` en bruto (≈ 26,7 MiB en base64 + prompts, margen
  frente a 32 MB). `gradeSubmission()` llama a `provider.transcribe()` **una vez por grupo y
  lectura**, con `input.manifest = { totalPages, pageNumbers }` para que el prompt diga «páginas 5–8
  de un examen de 14» y no «transcribe el examen completo». La lectura es la unión de los grupos;
  `assessPageAssembly` (PR 1) no cambia. Concurrencia acotada a 4 peticiones simultáneas por entrega
  (helper de 10 líneas, sin dependencia) para no disparar `429`.
- Ledger: una fila por petición HTTP (el envoltorio `withAiLedger` ya lo hace si la llamada es del
  motor y no interna del proveedor); `requestParams.manifest` deja rastro de qué grupo era.
- Con la capa A activa, en la práctica siempre hay un solo grupo. La capa B existe para el día en
  que no haya poppler o llegue un PDF de 300 páginas.

**Capa C — El original es opcional en `grade()` cuando no cabe.**

- Si ni normalizado cabe en el presupuesto, `grade()` recibe `document: []` y
  `documentOmitted: { bytes, pages }`. El prompt de usuario lo declara («No se adjunta el original:
  corrige sólo sobre la transcripción y sus marcas») y el motor añade un aviso de verificación
  `original_omitido` (ver PR 3, paso 5: va en `verification.issues`, que es lo que la ficha enseña y
  lo que deja la corrección como no coherente) con el texto: «El corrector no ha visto el original
  (94 MB, 14 páginas): la corrección se apoya sólo en la transcripción. Revísala con el escaneo
  delante.» Es una degradación explícita del ADR 0015 («el original manda»), no silenciosa.

**Guardias de entrega desproporcionada (decisión 2).**

- En la ingesta, tras `countPages()`: `pageCount > INGEST_MAX_PAGES` (100) → la entrega queda en
  `error` con «El PDF entregado tiene 240 páginas y Vega corrige hasta 100. Comprueba que el alumno
  ha subido el fichero correcto o corrígela a mano.» Se guarda el fichero igualmente (prueba de lo
  entregado). 100 cubre con holgura un simulacro de teoría (13–17 folios) y evita pagar la lectura
  de un PDF equivocado.
- El tope de tamaño de fichero (200 MB) se aplica **antes** de descargar (§2.2).

**Además**

- `anthropic.ts`: capturar `Anthropic.APIError` con `status === 413` y convertirlo en
  `AiResponseError('request_too_large', …)` con mensaje en español: «La petición a Anthropic supera
  los 32 MB que admite la API (original de 94 MB en 14 páginas). Vega normaliza los escaneos
  pesados; si ves esto, comprueba que `pdftoppm` está disponible en el servidor.» Hoy la cola enseña
  el JSON crudo.
- `docs/configuracion.md`: aclarar que «Páginas por bloque» es la unidad de numeración y agrupación,
  no un límite de tamaño de petición.

---

## 2. Descarga de Moodle: «no ha respondido en 30000 ms»

### 2.1 Evidencia

`MoodleClient.downloadFile()` (`connectors/moodle3/src/api.ts:545-566`) envuelve `fetch` **y**
`response.arrayBuffer()` en `#withTimeout` con el mismo `DEFAULT_REQUEST_TIMEOUT_MS = 30_000` que
las llamadas al web service. Es decir: 30 s para **terminar** de bajar el fichero. Un escaneo de
94 MB a 2–3 MB/s tarda 30–50 s; el mismo fichero que luego dio el 413 es el que no cabía en el
timeout. La entrega aparcada `6ac07476` (0 páginas, sin fichero) tiene el mismo mensaje.

Lo que pasa después ya está bien pensado: la entrega queda en `error` sin `storage_path`, y
`needsFile()` (`ingest/run.ts:297`) la vuelve a descargar en la **siguiente** ingesta — por eso
`0bcfd564` sí tenía fichero en el proceso manual de las 15:15 (`submissionsIngested: 1`). El
problema es que «la siguiente ingesta» es el lote de mañana (cada 1 440 min) o un proceso lanzado
a mano, y el mensaje dice «vuelve a intentarlo en unos minutos» cuando el profesor no tiene ningún
botón para hacerlo: `reprocess` con `scope=full` no descarga (falla en `pagesOf` con «no tiene un
fichero real almacenado»).

### 2.2 Diseño

**`MoodleClient.downloadFile()` con cuatro límites distintos**, en vez de uno:

| Límite | Valor | Significa | Mensaje |
|---|---|---|---|
| Cabeceras | 30 s (el actual) | Moodle no empieza a responder | «Moodle no ha empezado a enviar el fichero en 30 s. Vega lo reintentará en el próximo proceso.» |
| Inactividad | 30 s sin recibir bytes | La transferencia se ha parado | «La descarga se ha interrumpido: 41 MB de 94 MB recibidos y 30 s sin datos. Vega lo reintentará en el próximo proceso.» |
| Absoluto | 10 min | Cinturón de seguridad del lote | «La descarga de 94 MB no ha terminado en 10 min.» |
| Tamaño | `INGEST_MAX_FILE_BYTES = 200 MB` | Protege memoria y disco | «El fichero pesa 260 MB y supera el máximo de 200 MB. Pide al alumno que lo reenvíe comprimido.» |

- Implementación: leer `response.body` como stream (`for await (const chunk of response.body)`),
  reiniciar el temporizador de inactividad en cada trozo, acumular en `Buffer.concat`. Comprobar
  `content-length` antes de leer, y el acumulado durante la lectura (Moodle no siempre manda
  `content-length` con `pluginfile.php`). `#withTimeout` se queda para las llamadas al web service.
- `sizeBytes` viene en el listado de Moodle (`filesize`, `connector.ts:833`) y ya se guarda en la
  fila: la ingesta rechaza **antes de descargar** lo que supere el máximo, con el mismo mensaje.
- `downloadInto()` (`ingest/run.ts:436`): un reintento inmediato tras 5 s cuando el error es
  `LmsUnavailableError` (corte puntual). Si vuelve a fallar, `error` como hoy.
- `LmsUnavailableError` gana `details: { receivedBytes, totalBytes, elapsedMs }` para que el
  mensaje lleve cifras reales y el log también.
- Copy: todos los mensajes acaban con lo que va a pasar de verdad («Vega lo reintentará en el
  próximo proceso»), nunca con una acción que el profesor no puede hacer.
- **Redescarga desde el reproceso (decisión 2).** `reprocess` con `scope=full` sobre una entrega
  sin fichero llama a `ensureFile(ctx, submission, activity)` (`ingest/run.ts`): construye el
  conector del profesor que importó la actividad, lista la actividad en Moodle (el conector sólo
  conoce la URL de descarga tras `listSubmissions()`), localiza la entrega por `remote_id` y ejecuta
  el mismo `downloadInto()` de la ingesta. Cierra el hueco «lo veo en error y no puedo hacer nada
  hasta mañana». Si la descarga vuelve a fallar, la respuesta del endpoint lo dice con el mensaje de
  arriba y la entrega sigue en `error`.

Sin ajustes nuevos en la web: el timeout por inactividad hace innecesario afinar un número, y los
topes (200 MB, 100 páginas) son límites de seguridad de la instalación, no preferencias. Quedan como
constantes con nombre y aparecen en `docs/configuracion.md` para que se sepa que existen.

---

## 3. Lectura incompleta: «no ha transcrito las páginas 2…13»

### 3.1 Evidencia

Dos entregas de 13 páginas de *Mes 1 – Prueba 1: Desarrollo de tema*, escaneadas (4–7 MB en total,
sin ningún problema de tamaño):

| Entrega | Lectura | `stop_reason` | Tokens salida | Páginas devueltas |
|---|---|---|---|---|
| `bd6b7660` | A | `end_turn` | 331 | sólo la 1 (el índice del tema) |
| `bd6b7660` | B | `end_turn` | 364 | la 1, **y otra vez la 1 con `latex` vacío** |
| `5da6d424` | A | `end_turn` | 673 | sólo la 1 |
| `5da6d424` | B | `end_turn` | 10 554 | **las 13, con 6 marcas: lectura perfecta** |

No es un corte por `max_tokens` (el suelo es 32k y el modelo paró solo), no es un `refusal` y no
es el problema de numeración de `f43c2aa` (los números que devuelve son correctos). La pista está en
el final del `latex` de la lectura A de `5da6d424`:

```
…8. Bibliografía.','notes_placeholder'.\n\n8. Bibliografía .',''
```

El modelo intenta escribir un campo `notes` que **no puede** escribir.

### 3.2 Causa

**El prompt y el esquema de salida no dicen lo mismo.** `transcription.system` v1 (la semilla, sin
editar en producción) exige en §6.1–6.2 `pages[].confidence` y `pages[].notes`, y en §2.7, §4.4,
§4.6, §4.7 y §7.1 manda al modelo escribir cosas concretas en `notes`. Pero `TranscriptionAnswer`
(`packages/core/src/ai/anthropic.ts:136`) sólo admite `{ page, latex }`. `zodOutputFormat` genera el
JSON Schema con `additionalProperties: false` y la salida estructurada **restringe la decodificación**:
tras `latex` la gramática sólo permite cerrar el objeto. El modelo, que «quiere» escribir `notes`,
descarrila: unas veces cierra el array y termina (sólo página 1), otras vuelca las notas dentro de la
cadena `latex`. Que la primera página sea un índice corto (lo primero sobre lo que querría anotar
«página de índice») lo hace más probable, y que sea no determinista explica que la misma entrega
tenga una lectura perfecta y otra rota.

Debilidades secundarias que el mismo caso deja ver:

- `validatePageAssembly` se ejecuta **por lectura** y lanza: una lectura rota tira la otra, ya
  pagada y completa (`5da6d424`: 10 554 tokens de salida a la basura).
- No hay reintento para una lectura incompleta, aunque el reintento sería barato (20k tokens de
  entrada) y dirigido.
- El esquema admite `flags[].kind = 'DISCREPANCIA'`, que es una marca que pone el código, no el
  modelo; el prompt dice «exactamente `ILEGIBLE` o `DUDA`».

### 3.3 Diseño

**A. Alinear esquema y prompt, y blindarlo con un test de contrato.**

- `TranscriptionAnswer.pages[]` pasa a `{ page, latex, confidence, notes }`; `flags[].kind` se
  reduce a `ILEGIBLE | DUDA` en el esquema del modelo (el motor sigue añadiendo `DISCREPANCIA`).
  **No hace falta tocar el prompt de producción**: ya describe exactamente estos campos.
- `TranscriptionPage` (`packages/shared`) gana `confidence?: number` y `notes?: string`,
  opcionales: `transcriptions.pages` es `jsonb`, sin migración; las filas antiguas no los tienen.
  `consolidateTranscriptions` conserva `min(confianzaA, confianzaB)` y concatena las notas cuando
  difieren. La pantalla de transcripción puede enseñarlos en una iteración posterior; ahora lo
  importante es que existan.
- `mock.ts` produce los campos nuevos.
- **Test de contrato** en `apps/api/src/prompts/seeds.test.ts` (el API es quien tiene las
  semillas y depende de `core`, así que va ahí y no al revés): extrae los bloques ```` ```json ````
  de cada semilla y los valida con el esquema que exporta `@vega/core`; los esquemas van
  `.strict()` a todos los niveles, así que un campo de más también falla. Antes de este PR, el de
  transcripción fallaba; a partir de aquí, quien cambie el prompt o el esquema por separado rompe
  la CI.
  **Hallazgo al implementarlo (24-08)**: los ejemplos de `grading.problem.system` (`citas[]` en vez
  de `aiQuote`/`aiQuotePage`, sin `maxPoints`/`escalate`/`noEsDuda`), `triage.system`
  (`tipo`/`confianza`/`motivo`) y `verify.system` (`veredicto`/`problemas`) **tampoco cuadran** con
  sus esquemas. No es la causa de ningún fallo observado —la gramática obliga al modelo a rellenar
  los campos del esquema y esas llamadas funcionan—, pero es la misma clase de desajuste. Como
  arreglarlos exige reescribir prompts de producción (`grading.topic` va por v2 editada a mano) y
  medir, quedan en `skip` en la prueba, con el motivo a la vista, sin bloquear la CI (§4.5).

**B. Validar cada lectura al llegar y reintentar sólo lo que falta** (`engine.ts`).

- Tras cada `transcribe()`, `validatePageAssembly` deja de lanzar y devuelve
  `{ missing, duplicates, unexpected }`. Antes de comparar, se limpian duplicados vacíos (el
  `{page:1, latex:""}` de arriba); un duplicado no vacío cuenta como página que hay que releer.
- Si la lectura está incompleta: **un** reintento con los bloques que contienen las páginas que
  faltan (`chunksCovering(missing)`), misma lectura (`a`/`b`), y `manifest` que diga «páginas 2–13
  de 13». Se fusiona y se revalida. En el ledger, `requestParams.retryOf = <páginas>` para que se
  vea que fue un reintento.
- Coste: como mucho una petición extra por lectura rota, con el mismo prefijo cacheado.

**C. Consolidación asimétrica: una lectura completa no muere por la otra**
(`verification.ts`, ADR 0017).

- Si tras el reintento una lectura está completa y la otra no, se consolida con lo que hay: para
  cada página ausente en una lectura se toma la otra **tal cual** (sin meter el marcador
  `[PÁGINA AUSENTE…]` en el `latex`, que hoy ensucia el texto y resta 0,15 por página), se añade un
  `flag` `DISCREPANCIA` con nota «Sólo una de las dos lecturas ha transcrito esta página», se aplica
  **una** penalización global de 0,15 (no una por página) y se emite el `ReviewFlag`
  `lectura_parcial` → la entrega termina en revisión, no en `graded` sin más.
- Sólo si una página falta **en las dos lecturas después de reintentar**, la entrega falla con el
  mensaje actual, añadiendo «tras reintentar la lectura». Esa es la única situación en la que de
  verdad se estaría corrigiendo a ciegas.
- Esto enmienda la frase del ADR 0015 «una página ausente, duplicada o inesperada hace fallar la
  entrega» → **ADR 0017: lectura incompleta — reintento dirigido y consolidación asimétrica**
  (el 0015 no se edita; se marca la enmienda).

---

## 3 bis. Incidencia aparecida al desplegar el PR 1 (25-08): entrega aparcada como «no es una duda»

Con `v1.0.3` en producción, `bd6b7660` se transcribió entera a la primera (13 + 13 páginas, sin
relectura: el PR 1 funciona) y se corrigió (16 apartados, 5,8 min), pero acabó **aparcada** con
«La respuesta con contexto confirma que no es una duda». `GradingAnswer` exigía `escalate` y
`noEsDuda` —decisiones de foro— en **todas** las correcciones; ningún prompt de corrección los
menciona; a un simulacro de tema el modelo contestó `noEsDuda: true` (literalmente cierto), y
`processOne` (`batch.ts:977`) aparcaba sin mirar el tipo de actividad, descartando la corrección.
Otra entrega del mismo día (`493b9400`) recibió `false` y se corrigió: no determinista.

Es la misma familia que §3.2 (un campo en el esquema que el prompt no gobierna), en la otra
dirección. **Hotfix (PR 1b, rama `fix/no-es-duda-solo-foros`)**: `ForumGradingAnswer` extiende
`GradingAnswer` sólo para foros (a una entrega con fichero el esquema ya no le ofrece esos campos);
el motor fuerza `escalate`/`noEsDuda` a `false` fuera de un foro; y el lote sólo aparca por ese
motivo si `activity.kind === 'forum'`. Pruebas en `engine.test.ts` y `anthropic.test.ts`.

## 4. Plan de implementación

Tres PR independientes contra `main`, en este orden (del más barato al que toca la imagen). Cada
PR se fusiona, se despliega solo en **test**, se comprueba con las entregas de la tabla de §4.4 y
después se promociona a producción con «Promote to prod». Comandos reales del repositorio:
`pnpm typecheck`, `pnpm test` (`node --test` vía `tsx`), `pnpm build`.

Convenciones que ya sigue el código y hay que mantener: mensajes de error en español dirigidos al
profesor; comentarios que explican el *porqué*; constantes con nombre en lugar de números sueltos;
nada de dependencias nuevas de npm en ninguno de los tres PR.

### 4.1 PR 1 — `fix(motor): lectura incompleta` (§3)

**Estado: implementado el 24-08-2026 en la rama `fix/lectura-incompleta`**; pendiente de PR, de
la aceptación en test y del reproceso de §4.4. Sólo `packages/core`, `packages/shared` y una prueba
en `apps/api`. Sin migración, sin cambio de prompt en producción, sin dependencias.

| Paso | Fichero | Qué |
|---|---|---|
| 1 | `packages/shared/src/domain.ts` | `TranscriptionPage` gana `confidence: z.number().min(0).max(1).optional()` y `notes: z.string().optional()`. |
| 2 | `packages/core/src/ai/anthropic.ts` | `TranscriptionAnswer.pages[]` → `{ page, latex, confidence, notes }`; `flags[].kind` → `z.enum(['ILEGIBLE','DUDA'])`. `transcribe()` copia `confidence`/`notes` a `TranscriptionPage`. `TranscribeInput` gana `manifest?: { totalPages: number; retryOf?: number[] }` (`provider.ts`) y el texto del mensaje de usuario lo usa: «páginas 2, 3 … de un examen de 13» / «relectura de las páginas …». |
| 3 | `packages/core/src/ai/mock.ts` | Produce `confidence` y `notes` por página; respeta `manifest` (devuelve sólo las páginas pedidas). |
| 4 | `packages/core/src/grading/engine.ts` | `validatePageAssembly` → `assessPageAssembly(reading, sources): { missing, duplicates, unexpected, cleaned }` (limpia duplicados con `latex` vacío, no lanza). Nueva `readWithRetry(provider, input, reading, sources)`: llama, evalúa, si falta algo relanza **una vez** con `chunksCovering(missing ∪ duplicates)` y `manifest.retryOf`, fusiona (las páginas nuevas sustituyen a las dudosas) y devuelve `{ result, assessment }`. `gradeSubmission()` usa `readWithRetry` para A y B en paralelo. |
| 5 | `packages/core/src/grading/verification.ts` | `consolidateTranscriptions(a, b)`: página presente sólo en un lado → `latex` de ese lado tal cual, flag `DISCREPANCIA` «Sólo una de las dos lecturas ha transcrito esta página», sin marcador en el texto; penalización global única `PARTIAL_READING_PENALTY = 0.15` si hubo páginas asimétricas; `confidence` por página = `min(a, b)`; `notes` concatenadas si difieren. Devuelve además `partialPages: number[]`. |
| 6 | `packages/core/src/grading/engine.ts` | `ReviewReason` gana `'lectura_parcial'`; si `partialPages.length > 0` se añade al `review` mecánico (`mechanical.review`) un `ReviewFlag` con `label: null` y detalle «Las dos lecturas no coinciden en las páginas 2, 5: sólo una las ha transcrito. Revísalas con el original delante.». **Importante**: el API no persiste `result.review`; lo único que llega a la ficha son los `verification.issues` (`corrections.verification`, jsonb, `kind` de texto libre → sin migración), que `CorrectionView` ya pinta como «Verificación: N avisos» y que ponen `coherent: false`. Por eso el aviso tiene que entrar por `mechanical.review`, que es lo que `engine.ts:270-283` vuelca en `verification.issues` con `source: 'mechanical'`. Si una página falta en **ambas** lecturas tras reintentar → `throw` con el mensaje actual + «tras reintentar la lectura». |
| 7 | `apps/frontend/src/components/submission/CorrectionView.tsx` | Nada de layout: comprobar que un aviso con `itemLabel: null` se lista bien (hoy los mecánicos llevan apartado). |
| 8 | `docs/decisiones/0017-lectura-incompleta.md` + `README.md` del índice | ADR 0017 (enmienda 0015). |
| 9 | `docs/motor-ia.md` | Un párrafo en el bloque de «lecciones del piloto» (junto al de `f43c2aa`) contando el desajuste prompt↔esquema y el reintento dirigido. |

**Pruebas**

- `apps/api/src/prompts/seeds.test.ts` — *contrato prompt↔esquema*: cada bloque ```` ```json ````
  de la semilla `transcription.system` pasa `TranscriptionAnswer` (estricto a todos los niveles).
  Los de corrección, triaje y verificación quedan en `skip` con su motivo (ver §3.3 A y §4.5).
- `anthropic.test.ts` — el mensaje de usuario con `manifest` dice «páginas X de N» y, con
  `retryOf`, «relectura».
- `engine.test.ts` — A completa + B sólo página 1 → segundo `transcribe` de B con las páginas 2..N y
  `manifest.retryOf`; reintento OK → sin flags de parcialidad; reintento KO → consolidación
  asimétrica con `lectura_parcial`; ambas incompletas tras reintento → error «tras reintentar»;
  duplicado vacío se ignora; duplicado con texto fuerza relectura.
- `verification.test.ts` — página sólo en A → `latex` de A sin marcador, un flag, una única
  penalización; `confidence` por página = mínimo.

**Aceptación en test** (proveedor real, ~1 € por entrega): las entregas afectadas están en
producción, así que en test se usa la actividad de pruebas con un PDF de teoría de ≥ 10 páginas
cuya primera página sea un índice (es el patrón que disparó el fallo). Criterio: las dos lecturas
devuelven todas las páginas **sin** reintento (se ve en `calls`: dos filas `reading_a`/`reading_b`,
ninguna con `retryOf`). Si aparece reintento, funciona igual, pero hay que anotar la frecuencia
para saber si el desajuste era la única causa. Las entregas de producción se reprocesan después
según §4.4.

### 4.2 PR 2 — `fix(ingesta): descarga de Moodle robusta` (§2)

Rama `fix/descarga-moodle`. `connectors/moodle3`, `connectors/lms`, `apps/api/src/ingest`,
`apps/api/src/routes/submissions.ts`.

| Paso | Fichero | Qué |
|---|---|---|
| 1 | `connectors/lms/src/types.ts` (o donde viva `LmsUnavailableError`) | `LmsUnavailableError` admite `details?: { receivedBytes?: number; totalBytes?: number | null; elapsedMs?: number }`. |
| 2 | `connectors/moodle3/src/api.ts` | `MoodleClientOptions` gana `download?: { headersTimeoutMs; idleTimeoutMs; maxTotalMs; maxBytes }` con constantes `DEFAULT_DOWNLOAD_*` (30 s, 30 s, 10 min, 200 MB). `#downloadFile` pasa a stream: `fetch` bajo el timeout de cabeceras; `content-length` > `maxBytes` → error de tamaño sin leer el cuerpo; bucle `for await` sobre `response.body` con temporizador de inactividad que se reinicia por trozo, contador de bytes (aborta al superar `maxBytes`) y tope absoluto; `Buffer.concat` al final. Cada fallo lanza `LmsUnavailableError` (o `LmsError` de tamaño, no reintentable) con el mensaje de la tabla de §2.2 y `details`. |
| 3 | `connectors/moodle3/src/connector.ts` | Pasa las opciones de descarga al cliente; `download()` no cambia de firma. |
| 4 | `apps/api/src/ingest/run.ts` | Antes de descargar: `item.sizeBytes > INGEST_MAX_FILE_BYTES` → `markError` con el mensaje de tamaño (sin tocar la red). `downloadInto()`: un reintento tras `DOWNLOAD_RETRY_DELAY_MS = 5_000` si el error es `LmsUnavailableError`; log con bytes y ms. Tras `countPages()`: `pages > INGEST_MAX_PAGES` (100) → se guarda el fichero y la entrega queda en `error` con el mensaje de §1.3. Nueva `ensureFile(ctx, submission, activity, log)`: `connectorForUser(activity.importedBy)` → `listSubmissions(activityRef)` → busca `remoteId` → `downloadInto()`; devuelve `{ ok, message }`. |
| 5 | `apps/api/src/routes/submissions.ts` (`reprocess`) | Con `scope === 'full'` y `storagePath === null` en una actividad con fichero: llama a `ensureFile` **antes** de cambiar el estado; si falla, responde `409` con el mensaje y deja la entrega en `error`; si va bien, sigue el flujo actual (`pending` + `runBatch`). |
| 6 | `apps/frontend` (`SubmissionPage.tsx`) | Sólo copy: el aviso de error ya se pinta; comprobar que el `409` del reproceso se muestra con `notify.error` y su mensaje (sin cambios de layout). |
| 7 | `docs/configuracion.md` | Apartado «Límites de la instalación»: 200 MB por fichero, 100 páginas, timeouts de descarga, y que un fallo de descarga se reintenta solo en la siguiente ingesta o desde «Reprocesar → completo». |

**Pruebas**

- `connectors/moodle3/src/api.test.ts` — `fetchImpl` que emite trozos cada 5 s durante 90 s → éxito
  (antes fallaba a los 30 s); un trozo y silencio → falla al vencer la inactividad con cifras en el
  mensaje; `content-length` > máximo → falla sin leer el cuerpo; cuerpo sin `content-length` que
  supera el máximo → aborta durante la lectura; cabeceras que nunca llegan → mensaje de cabeceras.
  Usar temporizadores simulados (`mock.timers` de `node:test`) para no esperar de verdad.
- `apps/api/src/ingest/run.test.ts` — `sizeBytes` por encima del máximo → `error` sin llamar a
  `download()`; `LmsUnavailableError` seguido de éxito → la entrega acaba con fichero;
  `pageCount > 100` → fichero guardado y `error` con el mensaje; `ensureFile` descarga la entrega
  correcta cuando la actividad tiene varias.
- `apps/api/src/routes/lifecycle.test.ts` (o el que cubra `reprocess`) — `full` sin fichero llama a
  `ensureFile`; fallo → `409`; éxito → `pending`.

**Aceptación en test**: subir a Moodle (aula de pruebas) un PDF de ≥ 80 MB, lanzar el proceso y
comprobar en el log del API «Descarga terminada» con bytes y ms > 30 000. Después, borrar el fichero
del volumen de esa entrega, ponerla en `error` y usar «Reprocesar → completo»: debe redescargar.

### 4.3 PR 3 — `feat(motor): originales pesados` (§1)

Rama `feat/originales-pesados`. `apps/api/Dockerfile`, `apps/api/src/ingest`, `apps/api/src/storage`,
`apps/api/src/routes/batch.ts`, `apps/api/src/routes/health.ts`, `packages/core`.

| Paso | Fichero | Qué |
|---|---|---|
| 1 | `apps/api/Dockerfile` (etapa `runtime`) | `apk add --no-cache tini poppler-utils`. Comentario: para qué es y que su ausencia degrada, no rompe. |
| 2 | `apps/api/src/ingest/normalize.ts` | `pdftoppmAvailable(): Promise<boolean>` (`execFile('pdftoppm', ['-v'])`, cacheado). `normalizeForEngine(bytes, mediaType): Promise<{ bytes: Uint8Array; pages: number } | null>`: escribe el original en un directorio temporal del almacén (`derived/tmp-<uuid>/`), ejecuta `pdftoppm -r 150 -jpeg -jpegopt quality=80 in.pdf page` con `execFile` (timeout `NORMALIZE_TIMEOUT_MS = 5 min`, `maxBuffer` irrelevante porque escribe a disco), lee `page-*.jpg` en orden numérico, los embebe con `pdf-lib` en páginas A4 (`embedJpg`, escala a caber conservando proporción), limpia el temporal y devuelve el PDF. Una imagen suelta se envuelve antes en un PDF de una página A4. Devuelve `null` (y log `warn`) si `pdftoppm` no está o falla: el llamante sigue con el original. |
| 3 | `apps/api/src/storage/files.ts` | `saveDerived(submissionId, name, bytes)` → `submissions/<id>/derived/<name>`; `readDerived`/`hasDerived`; `removeSubmissionFiles` ya borra el directorio entero. |
| 4 | `apps/api/src/routes/batch.ts` (`pagesOf`) | Si `sizeBytes > ENGINE_MAX_ORIGINAL_BYTES` (20 MB) **o** `sizeBytes / pageCount > ENGINE_MAX_BYTES_PER_PAGE` (1,5 MB): usa `engine.pdf` derivado si existe; si no, lo genera con `normalizeForEngine` y lo guarda. `splitPdfIntoPageSources(bytes, { pagesPerChunk, maxChunkBytes: REQUEST_RAW_BUDGET })` corta también por bytes estimados. |
| 5 | `packages/core/src/grading/engine.ts` | `planTranscriptionRequests(pages, REQUEST_RAW_BUDGET = 20 MiB)` agrupa bloques consecutivos bajo presupuesto (`byteLength` de `bytes` o `stat` de `path`). `readWithRetry` (PR 1) itera por grupos con `manifest.totalPages`, concurrencia máxima 4 (`runLimited(tasks, 4)`), y une resultados. Para `grade()`: si la suma de bloques supera el presupuesto, `document: []` y `documentOmitted: { bytes, pages }`; `ReviewReason` gana `'original_omitido'` y el aviso entra por `mechanical.review` (mismo motivo que en el PR 1: es lo que se persiste en `verification.issues` y se enseña en la ficha). |
| 6 | `packages/core/src/ai/provider.ts` / `anthropic.ts` / `mock.ts` | `GradeInput` gana `documentOmitted?: { bytes: number; pages: number } | null`; el mensaje de usuario de `grade()` lo declara. En `anthropic.ts`, `withStopRetry`/los `catch` traducen `Anthropic.APIError` con `status === 413` a `AiResponseError('request_too_large', …)` (mensaje de §1.3). `AiResponseError` admite el código nuevo. |
| 7 | `apps/api/src/routes/health.ts` | `tools: { pdftoppm: 'ok' \| 'missing' }`; `status` no baja a `degraded` por esto (es degradación funcional, no caída). `index.ts`: `warn` al arrancar si falta. |
| 8 | `docs/configuracion.md`, `docs/arquitectura.md` | «Páginas por bloque» es unidad de numeración/agrupación; nuevo apartado sobre la normalización del original (qué se guarda, dónde, cuándo) y sobre `pdftoppm` en la imagen. `docs/motor-ia.md`: cerrar el `TODO(vega)` de `anthropic.ts:314` sobre límites de tamaño. |

**Pruebas**

- `apps/api/src/ingest/normalize.test.ts` — fixture `fixtures/scan-3p.pdf` (3 páginas con un JPEG
  de ~1 MB cada una, generado una vez con `pdf-lib` y commiteado; ~3 MB) → 3 páginas, tamaño
  < 25 % del original; imagen suelta → PDF de 1 página. `test.skip` con motivo si `pdftoppm` no está
  en PATH (la CI de GitHub Actions lo instala con `apt-get install poppler-utils`; añadirlo al
  workflow de test).
- `apps/api/src/routes/batch.pdf.test.ts` — `maxChunkBytes` corta a una página por bloque cuando el
  PDF pesa; el manifiesto sigue cubriendo 1..N exactamente; PDF ligero → bloques de `pagesPerChunk`.
- `packages/core/src/grading/engine.test.ts` — `planTranscriptionRequests` respeta el presupuesto y
  nunca deja un grupo vacío; con dos grupos, cada lectura hace dos llamadas con `manifest.totalPages`
  y la unión pasa la evaluación; original por encima del presupuesto → `grade()` recibe
  `document: []` y `review` incluye `original_omitido`.
- `packages/core/src/ai/anthropic.test.ts` — un 413 del SDK se traduce a
  `AiResponseError('request_too_large')` sin reintento y sin marcar el lote como fallo global.
- `apps/api/src/routes/health.ts` — respuesta incluye `tools.pdftoppm`.

**Aceptación en test**: subir a la actividad de pruebas un PDF de 14 fotos de móvil (≥ 80 MB) y
procesarlo con proveedor real (una entrega, ~1 €). Criterio: `calls` muestra **una** fila por
lectura y una de `grade`, `requestParams.pages[].byteLength` suma < 10 MB, y
`submissions/<id>/derived/engine.pdf` existe en el volumen. Repetir con la imagen sin poppler
(variable de entorno `PATH` sin `pdftoppm` en un contenedor local) para ver la degradación: varias
filas por lectura y `original_omitido` en revisión.

### 4.4 Después de cada promoción a producción

`scripts/vega-admin.sh reprocess <id> full` (`full` es obligatorio: no hay transcripción
persistida). Son entregas de agosto de alumnos reales, así que sólo tras validar cada PR en test.

| Entrega | Actividad | Tras PR |
|---|---|---|
| `bd6b7660-e73f-480b-ad3e-c8a535afa157` | Mes 1 – Prueba 1 (13 p.) | 1 |
| `5da6d424-7c17-4237-ad18-2818a04e273b` | Mes 1 – Prueba 1 (13 p.) | 1 |
| `0bcfd564-e4c3-4129-a972-e299b3ffd756` | Mes 2 – Prueba 1 (14 p., 94 MB) | 3 |
| `87ea5f52-bd46-4270-afb4-893c38acd127` | Mes 1 – Prueba 1 (17 p.) | 3 |

Las dos últimas ya tienen el fichero en el volumen: la normalización perezosa de `pagesOf()` las
cubre sin reingesta.

### 4.5 Fuera de alcance (anotado, no olvidado)

- **Alinear los prompts de corrección, triaje y verificación con sus esquemas** (hallazgo del
  PR 1). Es trabajo de prompt, no de código: reescribir la sección de salida de cada uno para que
  describa exactamente `GradingAnswer`, `TriageAnswer` y `VerificationAnswer`, subirlos con
  `vega-admin push` y medir un par de entregas. Al hacerlo, quitar el `skip` correspondiente en
  `apps/api/src/prompts/seeds.test.ts`.

- Enseñar `notes` y `confidence` por página en la pantalla de transcripción: los datos quedan
  persistidos desde el PR 1; la vista se toca cuando se toque esa pantalla.
- El lote sin límite de días que originó todo. `ingest.maxAgeDays = 0` es el valor por defecto
  documentado («una instalación nueva no debe descartar en silencio»); con 119 entregas aparcadas a
  mano después, quizá convenga que el proceso avise antes de ingerir más de N entregas históricas de
  golpe. Es otra conversación.
