# Diseño del motor de IA — análisis del hito

> **Estado: SUSTITUIDO por [`motor-ia.md`](motor-ia.md) (2026-07-22).** La arquitectura del motor
> quedó cerrada allí tras consolidar este análisis, los de `docs/analisis/` y el input humano de
> `docs/analisis/comentarios-sesion.md`. De este documento, la §5 (API key y prueba de conexión)
> **ya está implementada** (`apps/api/src/ai/factory.ts`, `routes/settings.ts`); la §4 queda
> superada por las decisiones de `motor-ia.md`. Se conserva como registro del análisis.
>
> Convención de este documento: convierto las fechas relativas a absolutas y cito el código real
> (`fichero:símbolo`) en vez de describirlo de memoria. Si algo aquí no cuadra con el código, el
> error está en este documento.

## 0. Encuadre en una frase

Los hitos H1 (login, maquetación, CI/CD) y H2 (configuración de actividades) están cerrados. Este
hito **enciende la capa de IA**: que la aplicación **guarde y funcione todo salvo los procesos
—lote y planificador— y el panel económico**, que se pueda **introducir la API key de Anthropic y
probar la conexión de verdad**, y que quede documentado cómo corregirá y responderá dudas el motor.
El modelo es **fijo** en esta iteración; el enrutado por complejidad se valora más adelante (§6).

---

## 1. El objetivo, otra vez

Vega hace **dos trabajos con un mismo motor**, y la única bifurcación real es `hasStudentFile(kind)`
de `@vega/shared`:

| | Entrega (`assignment`) | Foro (`forum`) |
|---|---|---|
| Entra | Fichero del alumno → transcripción (OCR) | Texto escrito → sin OCR |
| Sale | Apartados puntuados + `aiLatex` | Sólo `aiLatex` (respuesta) |
| ¿Nota? | Normalmente sí | **Nunca** |

Todo lo que el motor sabe de la materia vive en **contextos** que el profesorado edita, resueltos en
tres niveles por `resolveContext()` (`packages/core/src/context/resolve.ts`):

```
global  (toda la academia)           ── lo que MENOS cambia → prefijo cacheable
  → activity_kind  (entrega / foro)
    → activity  (esta tarea + solución de referencia + material adjunto)  ── lo que MÁS cambia
```

El orden no es estético: es **especificidad creciente** y, a la vez, el orden que **aprovecha la
caché de prompts** (lo estable primero). Ver §4.

---

## 2. Alcance de este hito — "todo menos los procesos"

Inventario completo de capacidades, su estado hoy y qué hace este hito. **Diferido** = queda para un
hito posterior; no se toca aquí.

| Capacidad | Hoy | Este hito | Nota |
|---|---|---|---|
| Login, usuarios, alcance por curso | Funciona y persiste | — | H1/H2, cerrado |
| Cursos y actividades desde Moodle (discover/import) | Funciona y persiste | — | H2, cableado real |
| Contextos 3 niveles + edición desde UI | Funciona y persiste (`grading_contexts`) | — | H2 |
| Ficheros de contexto (texto en `activity_files.content`) | Funciona y persiste | — | H2 |
| Cola de revisión, detalle, editar/validar/publicar(marcado en BD) | Funciona y persiste | — | Se apoya en datos sembrados |
| Ajustes de instalación (`app_settings`) | Funciona y persiste | — | Incluye la clave secreta |
| **API key de Anthropic: guardar y USAR** | Se guarda, **no se usa** (§5) | **Cerrar el hueco** | El proveedor se construye del `.env`, ignora la BD |
| **Proveedor/modelos desde ajustes (no sólo `.env`)** | Se guardan, **no mandan** | **`ai/factory.ts`** | Simetría con `lms/factory.ts` |
| **Prueba de conexión con Anthropic** | No existe | **Nueva ruta + UI** | Espejo de la prueba de token de Moodle |
| **Salud incluye estado real de IA** | `aiProvider` es config, no comprobación | **Comprobación real** | `GET /api/health` |
| Documentar prompts, formato de respuesta, ahorro de tokens | Disperso en código | **§4 de este doc** | Para revisión antes de implementar |
| **Lote de corrección (`runBatch`/`processOne`)** | Funciona con `mock` | **Diferido (proceso)** | El motor real se ejerce, pero no aquí |
| **Planificador (`batch/scheduler.ts`)** | Existe | **Diferido (proceso)** | |
| Ingesta desde el LMS (`listSubmissions`/`download`) | Sin cablear | **Diferido** | Es un proceso de entrada; H3/H5 |
| Publicación real en el LMS (`publishGrade`…) | Sin cablear | **Diferido** | H5 |
| **Panel económico / desglose de coste** | Parcial | **Diferido** | Petición explícita: va más adelante |
| Almacén de binarios (PDF/imágenes) | `storage_path` siempre `NULL` | **Diferido** | Ligado a ingesta |
| Compilación real de LaTeX | Simulada | **Diferido** | |

**Lectura de la tabla:** casi todo lo que no es *proceso* ya guarda y funciona desde H1/H2. Lo que
este hito **cierra de verdad** es la capa de IA que hoy está desconectada: la clave se guarda pero no
se usa, no hay forma de comprobar que la conexión funciona, y el proveedor no respeta los ajustes.
Eso es lo que se implementa (§5). La **corrección real** de entregas y foros ocurre **dentro del
lote**, que es un *proceso* y por tanto queda fuera de este hito: aquí se prueba que la tubería a
Anthropic existe y responde, no se lanza producción de correcciones.

---

## 3. Dónde vive cada dato: memoria, base de datos, sistema de archivos

Principio rector: **la base de datos manda; el `.env` es sólo el arranque; `app_settings` lo
sobrescribe; la memoria del proceso es caché de una operación, nunca fuente de verdad.** Si el
proceso muere, no se pierde estado.

### 3.1 Base de datos (PostgreSQL) — la fuente de verdad

Todo el estado persistente. Ya modelado en `apps/api/migrations/` y `packages/shared/src/domain.ts`:

| Dato | Tabla | Por qué en BD |
|---|---|---|
| Usuarios, roles, token Moodle, alcance | `users`, `course_teachers` | Estado transaccional; decide permisos |
| Cursos y actividades | `courses`, `activities` | Catálogo idempotente; sobrevive a reinicios |
| Contextos de corrección | `grading_contexts` | Editables desde el móvil a las 23:00 (además del git, §3.3) |
| Ficheros de texto del contexto | `activity_files.content` | Van enteros al prompt; deben estar donde lee el lote |
| Entregas, transcripciones, correcciones, apartados | `submissions`, `transcriptions`, `corrections`, `correction_items` | El trabajo del alumno y su corrección |
| Consumo de un lote | `batch_runs` | Trazabilidad de coste (con la salvedad de §7) |
| **Ajustes de instalación, incl. API key** | `app_settings` (`is_secret`) | **Editable desde la UI sin redesplegar**; la clave nunca sale por la API |

**La API key de Anthropic vive en `app_settings['anthropic.apiKey']`** con `is_secret = true`
(`apps/api/src/settings/service.ts:SECRET_KEYS`). La API **la escribe pero nunca la devuelve**: sólo
informa de `apiKeyConfigured`. Limitación conocida, heredada del token de Moodle: **se guarda en
claro**, sin cifrado en reposo. Se documenta como deuda (§7) y no se resuelve en este hito.

### 3.2 Sistema de archivos / almacén de objetos

| Dato | Dónde | Estado |
|---|---|---|
| Binarios del alumno (PDF/imágenes escaneadas) | Almacén de objetos | **No implementado**: `storage_path` siempre `NULL`. Diferido (ligado a ingesta) |
| Páginas escaneadas de la UI | Generadas al vuelo | SVG en `routes/scans.ts`, no bytes guardados |
| Contextos por defecto (Markdown) | Repositorio git (`contexts/`) | Ver §3.3 |

En este hito **no se introduce almacén de binarios**: el texto sigue en BD y los binarios siguen
siendo referencia. Es coherente con "todo menos los procesos": el almacén sólo cobra sentido cuando
la ingesta descargue ficheros de Moodle, que es un proceso.

### 3.3 Git (`contexts/`) — historial, no tiempo de ejecución

Los contextos por defecto son Markdown versionado (`contexts/global.md`, etc.). **El API no los lee
en caliente**: `pnpm db:demo` los vuelca en `grading_contexts` y a partir de ahí manda la BD
(`readContextLevel()`). El git da diff y revisión por pares sobre unas instrucciones que **deciden
notas**; la BD da edición inmediata. La reconciliación entre ambos es una pregunta abierta de HU-06.

### 3.4 Memoria del proceso — caché efímera de una operación

Nada crítico vive sólo en memoria. Lo que hay es caché de una operación:

- **El proveedor de IA se instancia una sola vez por lote** (`routes/batch.ts:137`) para que la caché
  de prompts de Anthropic sirva de una entrega a la siguiente.
- **El contexto resuelto se memoriza por actividad dentro del lote** (`contextCache`, `batch.ts:133`).
- La configuración cargada al arrancar (`config.ts`), sobrescrita por `app_settings` en cada lectura.

Si el proceso cae a mitad de un lote, las entregas ya persistidas están a salvo y el resto vuelve a
`pending`; no se pierde ninguna fuente de verdad.

---

## 4. Cómo funciona el sistema de IA  ·  ⚠️ SECCIÓN ABIERTA A REVISIÓN (ahorro de tokens)

> Esta es la sección que otra IA debe revisar antes de implementar. Describo el diseño **actual** del
> código (`packages/core/src/ai/anthropic.ts`) y sus números, y luego abro las palancas de
> optimización con sus alternativas y compensaciones. Nada de §4.3 se da por decidido.

### 4.1 Dos llamadas, no una

- **Transcribir** (visión): manuscrito → LaTeX con marcas `[ILEGIBLE]`/`[DUDA]`. Sólo en entregas.
- **Corregir** (razonamiento): sobre la transcripción (entrega) o sobre `textContent` (foro).

Separarlas permite **reintentar sólo lo que falló**, **cachear el contexto de corrección** entre
entregas de la misma actividad, y **enseñar la transcripción al profesor** para que juzgue si la
corrección parte de una lectura correcta. En un foro sólo existe la segunda llamada.

### 4.2 Los prompts del sistema: quién fija el formato

Hay **dos capas de prompt, y no son lo mismo**:

1. **System prompt fijo de Vega** (`TRANSCRIPTION_SYSTEM`, `GRADING_SYSTEM` en `anthropic.ts`). Lo
   escribe Vega, **no el profesor**. Define el **rol** y —lo importante— el **formato de salida**: un
   objeto JSON con una forma exacta, que se valida con Zod al recibirlo (`TranscriptionAnswer`,
   `GradingAnswer`). El profesor nunca toca esto.
2. **Contexto de corrección** = los tres niveles + solución de referencia + material, montados por
   `resolveContext()`. **Esto es lo que escribe el profesor.** Son los **criterios**, no el formato.

El montaje del mensaje respeta el orden que abarata la caché:

```
system: [ instrucciones fijas de Vega ]              ← estable
        [ contexto de la actividad ] · cache_control  ← estable dentro de una actividad
user:   [ transcripción / texto del alumno ]          ← cambia en cada entrega
```

**Formato de respuesta.** Hoy el modelo devuelve JSON incrustado en texto y Vega lo parsea con
`JSON.parse` + Zod. Funciona, pero es frágil (si el modelo antepone prosa, revienta). Anthropic
ofrece **structured outputs** (`output_config.format` con `json_schema`) en Opus 4.8, que **garantiza
JSON válido contra el esquema**. Es a la vez una mejora de fiabilidad y de tokens (menos reintentos).
→ **Candidato de §4.3.**

### 4.3 Optimización de tokens — palancas y decisiones abiertas

Lo que **ya hace** el diseño actual:

1. **Prefijo cacheable.** El bloque de contexto lleva `cache_control: { type: 'ephemeral' }`
   (`anthropic.ts:228`). Se sirve a ~0,1× a partir de la 2.ª entrega de la misma actividad.
2. **Lote ordenado por actividad** (`ORDER BY activity_id`, `batch.ts:111`): mantiene el prefijo
   estable entre entregas seguidas.
3. **Un proveedor por lote** y **contexto memorizado por actividad** (§3.4).

Palancas y **preguntas abiertas** (esto es lo que hay que valorar):

- **⚠️ El mínimo de caché en Opus 4.8 es 4096 tokens, no ~1024.** El comentario del código
  (`anthropic.ts:227`) dice "~1024"; para Opus 4.8 el prefijo **no se cachea por debajo de 4096
  tokens** (silenciosamente: `cache_creation_input_tokens = 0`). **Implicación fuerte:** si el
  contexto de una actividad es corto, la caché **no se activa** y no hay ahorro. Decidir: ¿se exige un
  contexto mínimo? ¿se cachea también el `GRADING_SYSTEM` fijo junto al contexto para superar el
  umbral? Hoy `GRADING_SYSTEM` **no** lleva `cache_control` y el contexto va en un bloque aparte.
- **TTL de la caché.** `ephemeral` es 5 min. Un lote lento puede pasarse entre actividades y perder la
  caché. Valorar TTL de 1 h (`ttl: "1h"`, escritura a 2× pero sobrevive a huecos).
- **`cache_creation_input_tokens` no se contabiliza.** `toUsage()` (`anthropic.ts:321`) sólo guarda
  `cache_read`. La escritura de caché (1,25×) no se factura → **el coste real se infravalora**. Añadir
  columna o contabilizarlo (§7).
- **Structured outputs vs JSON-en-texto** (§4.2): más fiabilidad, menos reintentos.
- **Batch API de Anthropic (−50%).** El lote nocturno es asíncrono por naturaleza: encaja con
  `messages.batches` (mitad de precio, resultados en <24 h). Es la palanca de coste **más grande** y
  **encaja justo con lo diferido** (los procesos). Anotarlo para cuando se implemente el lote.
- **Longitud de salida.** `aiLatex` es un documento entero y la salida se factura a 25 $/M (5× la
  entrada). El coste de una corrección lo domina el *output*, no el *input*. Valorar acotar el
  documento y `max_tokens` (hoy 16k, `anthropic.ts:40`).
- **Compresión del contexto.** Quitar del Markdown lo que no afecta a la nota antes de enviarlo.

**Presupuesto orientativo por corrección** (tarifa Opus 4.8, `cost/pricing.ts`: 5 $/25 $/0,5 $ por M
de entrada/salida/entrada-cacheada; `USD_TO_EUR = 0,92`): una entrega con ~3k tokens de contexto
cacheado + ~2k de transcripción + ~1,5k de salida ≈ **céntimos por corrección**, dominado por la
salida. Los números finos salen al medir con clave real (§5).

### 4.4 Qué se espera de los prompts del profesor

El profesor escribe **contextos** (criterios), nunca formato. El estándar de oro está ya en el
repositorio: `contexts/global.md` es específico, numerado, define descuentos, escala de confianza y
tono; `contexts/activity-kinds/forum.md` concreta que **un foro no se puntúa nunca** y qué es una
buena respuesta. Guía para un buen prompt de profesor:

- **Sé prescriptivo:** reparto de puntos, qué penaliza y cuánto, cuándo bajar la confianza.
- **No repitas el formato:** de eso se encarga el system prompt de Vega. Repetirlo gasta tokens.
- **Cuida el nivel `global`:** cambiarlo invalida la caché de **todas** las actividades y es un cambio
  de criterio de evaluación. Merece revisión por pares (por eso vive también en git, §3.3).
- **Solución de referencia ≠ respuesta correcta en foro:** `resolveContext()` rotula la sección
  «Solución de referencia» si se puntúa y «Material asociado» si no, para que el modelo no trate el
  material de un foro de dudas como plantilla de respuesta.

---

## 5. API key de Anthropic y prueba de conexión  (se implementa en este hito)

### 5.1 El hueco que hay que cerrar

Hoy la clave tiene **dos fuentes desconectadas**:

- `app_settings['anthropic.apiKey']` — secreto editable desde la UI, **se guarda pero nunca se lee**
  para usarla (sólo se expone `apiKeyConfigured`).
- `ctx.config.ANTHROPIC_API_KEY` — el `.env`, que es **lo único** que usa `batch.ts:139` para
  construir el proveedor.

Consecuencia: **si el admin mete la clave por la UI, no se usa.** Y no hay ninguna forma de
comprobar si la conexión funciona. Además, a diferencia de `lms/factory.ts`, **no existe
`ai/factory.ts`**: el proveedor no respeta `app_settings`, rompiendo el principio "la BD manda sobre
el `.env`" que el resto del sistema sí cumple.

### 5.2 Diseño

1. **`apps/api/src/ai/factory.ts`** — espejo de `lms/factory.ts`. Lee proveedor, modelos y clave de
   `app_settings` con *fallback* al `.env` (usando `readSecret()` para la clave, que nunca cruza HTTP)
   y construye el `AiProvider`. `batch.ts` pasa a usarlo → la clave de la UI **se usa de verdad**.
2. **`verifyConnection()` en el `AiProvider`** (`packages/core`): el `mock` responde OK sin red; el
   `anthropic` hace **una llamada mínima real** (un mensaje de `max_tokens` pequeño) para validar
   clave + modelo, y devuelve modelo y consumo.
3. **Ruta `POST /api/settings/anthropic/test`** (sólo admin), espejo exacto de
   `testMyMoodleConnection`: **no** es 200/500 —una clave inválida es una respuesta legítima—, sino
   200 con `{ ok, message, model, ... }`. Nuevo contrato `AnthropicConnectionResponse` en
   `@vega/shared`.
4. **Frontend:** botón «Probar conexión» en la sección Anthropic de Ajustes, espejo de
   `MoodleConnectionCard`.
5. **`GET /api/health` no hace la prueba real a propósito.** El proxy inverso lo sondea cada pocos
   segundos; una llamada a Anthropic por sondeo sería coste y límites de peticiones tirados. La
   prueba real y de pago es el botón «Probar conexión», que dispara el administrador cuando quiere.
   La salud sigue reportando el proveedor efectivo y si la clave está configurada, no su alcance.

**Seguridad:** la clave se escribe y no se lee por la API; nunca se registra en logs; se guarda en
claro (deuda conocida, §7).

### 5.3 Cómo se prueba

El usuario pega su clave en Ajustes → Guardar → «Probar conexión». Como es una llamada real, gasta
unos pocos tokens (intencionado: es *probar la conexión*). Con la clave puesta, el mismo mecanismo
permite después medir el coste real de una corrección (§4.3).

---

## 6. Modelo fijo ahora, enrutado por complejidad después

**Ahora:** modelo **fijo**, configurable en Ajustes, por defecto `claude-opus-4-8` para transcripción
y corrección (`anthropic.ts:36-37`). Los ids salen de configuración, nunca escritos a mano.

**Después (a valorar):** un **enrutador** que elija modelo por complejidad. Opciones:

- **Heurística (recomendada para empezar):** foro/pregunta corta → Haiku; manuscrito o entrega
  puntuable compleja → Opus; intermedio → Sonnet. Coste cero, decisión grosera.
- **Clasificador previo:** una llamada barata que puntúa la complejidad. Añade latencia y tokens.
- **Compensación con la caché:** **cambiar de modelo invalida la caché de prompts** (es por modelo).
  Como el lote agrupa por actividad y el modelo sería por actividad, el enrutado convive bien con la
  caché **si se decide por actividad**, no por entrega.

Qué hace falta para construirlo bien más adelante: tarifas por modelo (ya en `cost/pricing.ts`),
telemetría de calidad por modelo (`corrections.model` ya se persiste → permite medir
`avgTeacherDeviation` por modelo), y una función de decisión. **Recomendación:** heurística primero,
medida por la desviación del profesor, y sólo entonces algo más listo. Si conviene tomar esta
decisión antes, se puede trabajar en un hito propio.

---

## 7. Revisión crítica del modelo de datos

**Lo que está bien y hay que conservar:**

- Nota **opcional** como dos campos atados por `CHECK` (`graded` + `max_score`), no un flag de config.
- Bifurcación por `hasStudentFile(kind)` en un solo sitio; el resto del pipeline es común.
- Contexto en tres niveles **sin FK** a propósito (un contexto puede existir antes que su actividad).
- Coste en **céntimos** (`numeric`), nunca flotantes para dinero.
- Alcance por curso en un único punto (`auth/scope.ts`); import idempotente con `moodle_ref` prefijado.
- Autonomía **por actividad**, con la conjunción de `review_low_confidence` bien pensada.

**Lo que mejoraría (por prioridad):**

1. **[Este hito] Clave y proveedor desconectados del uso.** Resuelto por `ai/factory.ts` (§5).
2. **Secretos en claro** (`users.moodle_token`, `anthropic.apiKey`). Cifrado en reposo pendiente.
   Riesgo real: un volcado de BD expone credenciales de Moodle y de Anthropic.
3. **`submissions` sin `batch_run_id`.** No se puede saber qué lote corrigió qué entrega; el panel de
   coste lo deduce por **ventana temporal**, que es frágil. Recomendación: columna `batch_run_id` +
   migración. (Pregunta abierta de HU-09.)
4. **`cache_creation_input_tokens` no se persiste** → el coste se **infravalora** (la escritura de
   caché es 1,25×). Añadir columna o contabilizarlo en `toUsage()`.
5. **Estados fantasma `transcribed`/`grading`.** Figuran en el `CHECK` y en las etiquetas pero el lote
   real salta de `transcribing` a `graded`. `transcribed` sólo lo siembra el demo. Limpiar.
6. **Hueco de deduplicación en foros.** `original_filename` es `NULL` en foros y en PostgreSQL dos
   `NULL` no colisionan → reingerir el mismo foro **duplica**. Necesita migración (`NULLS NOT
   DISTINCT` o clave por `remoteId`). Bloqueante cuando aterrice la ingesta.
7. **`GET /api/contexts/resolved/{id}` no filtra por `upload_complete`** al leer el `content` de los
   ficheros (único hueco de esa invariante). Corregir.
8. **Sin señal de "modo simulado" en el contrato.** El panel no sabe distinguir ceros reales de
   `AI_PROVIDER=mock` (pregunta abierta de HU-18). Un campo lo resolvería.
9. **`course_teachers` no caduca.** Aceptable y documentado; anotado para no olvidarlo.
10. **Reproducibilidad de la nota.** Una nota la produce una versión concreta de contexto/prompt. Como
    las notas son de alto impacto, valorar un campo que ate cada corrección a la versión de contexto
    que la generó. Hoy no se puede reconstruir con qué criterio se puntuó.

**Veredicto:** el modelo es sólido y está bien pensado para lo que ya hace. Los puntos 1 (este hito),
2, 3 y 4 son los que de verdad importan para la capa de IA; el resto son afinados que caben cuando se
toque el archivo correspondiente.

---

## 8. Qué implementa este hito, en concreto

**Se implementa ahora** (§5, seguro y explícitamente pedido, no toca la arquitectura de §4.3):

- `apps/api/src/ai/factory.ts`: proveedor desde `app_settings` con *fallback* al `.env`.
- `packages/core`: `verifyConnection()` en la interfaz `AiProvider` (mock + anthropic).
- **`anthropic.maxTokens` toma efecto de verdad.** Era otra config guardada por la UI que el
  proveedor ignoraba (`MAX_TOKENS` fijo): ahora la factoría se la pasa y `AnthropicAiProvider` la usa.
- `@vega/shared`: contrato `AnthropicConnectionResponse` + ruta `testAnthropicConnection`.
- `apps/api`: ruta de prueba de conexión (admin) + `batch.ts` usando la factoría.
- Frontend: botón «Probar conexión» y resultado en la sección Anthropic de Ajustes.

> **Toda la configuración es del administrador y por la web.** El principio del sistema es
> «`app_settings` manda sobre el `.env`». Este hito lo hace cierto también para la IA: proveedor,
> modelos, `maxTokens` y clave se editan en Ajustes y **se usan**. Lo único que queda en el `.env`
> es infraestructura de arranque (`DATABASE_URL`, `JWT_SECRET`, puertos, `WEB_ORIGIN`, admin inicial),
> que no es «configuración» que el administrador gestione en caliente, sino lo imprescindible para
> levantar el contenedor antes de que exista la base de datos.

**Queda para revisión antes de implementar** (§4.3): la arquitectura de prompts y ahorro de tokens
—structured outputs, umbral de caché de 4096, TTL, Batch API, contabilidad de `cache_creation`,
longitud de salida—. Otra IA debe validar si hay una forma más óptima antes de tocar
`packages/core/src/ai/anthropic.ts`.

**Diferido a hitos posteriores** (son *procesos* o el panel económico): lote y planificador, ingesta
y publicación reales contra Moodle, almacén de binarios, compilación de LaTeX, panel de coste.
