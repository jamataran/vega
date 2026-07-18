# HU-10 — Transcripción del manuscrito a LaTeX

| | |
|---|---|
| **Id** | HU-10 |
| **Épica** | Transcripción |
| **Estado** | borrador |
| **Prioridad** | Must |
| **Estimación** | 13 |
| **Depende de** | HU-08 |
| **Bloquea a** | HU-11, HU-12 |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** sistema
**quiero** convertir el desarrollo manuscrito de cada página en LaTeX, señalando lo que no leo bien
**para** poder corregir sobre texto y para que el profesor sepa dónde no fiarse de la lectura.

Es el paso con más incertidumbre de Vega. Un examen de matemáticas escrito a mano tiene fracciones
apiladas, integrales, subíndices, flechas, tachones y márgenes con cuentas sueltas. Un OCR que
inventa lo que no lee es peor que uno que falla: produce una corrección segura de sí misma sobre un
texto que el alumno no escribió.

De ahí la decisión central: **el sistema declara su incertidumbre en lugar de esconderla.**
`[ILEGIBLE]` y `[DUDA]` no son casos de error; son salida normal y esperada, y la corrección sabe
qué hacer con ellas (`contexts/global.md` §8).

## Criterios de aceptación

### Escenario 1: transcripción correcta

```gherkin
Dado que existe una entrega en status "pending" con 4 páginas
Cuando se ejecuta la transcripción
Entonces la entrega pasa por "transcribing" y termina en "transcribed"
Y se crea una Transcription con 4 TranscriptionPage
Y cada página tiene page (1-indexada), latex e imageUrl
Y confidence está entre 0 y 1
Y model registra el modelo usado
```

### Escenario 2: marca de fragmento ilegible

```gherkin
Dado que una página tiene un fragmento que no se puede leer
Cuando se ejecuta la transcripción
Entonces el latex de esa página contiene la marca [ILEGIBLE] en su posición
Y flags incluye una entrada con kind "ILEGIBLE", la página y el excerpt afectado
Y la confianza global de la transcripción baja
```

### Escenario 3: marca de duda

```gherkin
Dado que una página tiene un símbolo que admite dos lecturas plausibles
Cuando se ejecuta la transcripción
Entonces se transcribe la interpretación más probable
Y flags incluye una entrada con kind "DUDA", la página, el excerpt y una note
        explicando la lectura alternativa
```

### Escenario 4: el orden de las páginas se conserva

```gherkin
Dado que una entrega tiene 6 páginas
Cuando se transcribe
Entonces pages tiene page de 1 a 6 sin huecos ni repeticiones
Y cada imageUrl corresponde al escaneo de esa misma página
```

### Escenario 5: página en blanco

```gherkin
Dado que la página 3 de una entrega está en blanco
Cuando se transcribe
Entonces la página 3 existe en pages con latex vacío o indicando página sin contenido
Y no se genera ninguna marca ILEGIBLE por ello
Y la confianza global no baja por una página en blanco
```

### Escenario 6: confianza baja se señala

```gherkin
Dado que una transcripción termina con confidence 0.62
Cuando la entrega aparece en la cola de revisión
Entonces QueueItem.flagCount refleja el número de marcas
Y la UI destaca la entrega como de lectura dudosa
Y en la pantalla de revisión el aviso aparece antes de la corrección
```

### Escenario 7: fallo de transcripción

```gherkin
Dado que el proveedor de IA devuelve un error irrecuperable
Cuando se ejecuta la transcripción de una entrega
Entonces la entrega queda en status "error"
Y errorMessage explica en español qué ha fallado
Y no se crea ninguna Transcription parcial
```

### Escenario 8: transcripción y escaneo, lado a lado

```gherkin
Dado que existe una transcripción de una entrega
Cuando abro la pantalla de revisión
Entonces puedo ver la imagen original de cada página y su LaTeX renderizado
Y las marcas ILEGIBLE y DUDA aparecen resaltadas en el texto
Y puedo saltar de una marca a la página del escaneo donde está
```

### Escenario 9: no se envía el nombre del alumno

```gherkin
Dado que una entrega tiene studentAlias "María G."
Cuando se llama al proveedor de IA para transcribir
Entonces el contenido enviado no incluye studentAlias ni ningún nombre real
Y sólo se identifica la entrega por studentRef
```

### Escenario 10: reprocesar sustituye

```gherkin
Dado que una entrega ya tiene una Transcription
Cuando se reprocesa desde el OCR
Entonces la transcripción anterior se sustituye, no se acumula
Y transcriptions.submission_id sigue siendo único
```

## Reglas de negocio

**RN-1.** La transcripción produce **una entrada por página**, 1-indexada, en orden, con el LaTeX y
la URL del escaneo correspondiente.

**RN-2.** Los fragmentos que no se pueden leer se marcan `[ILEGIBLE]` **en el propio LaTeX** y se
registran en `flags`. Los ambiguos, `[DUDA]`, con la lectura elegida en el texto y la alternativa
en `note`.

**RN-3.** **Nunca se inventa contenido.** Ante un fragmento ilegible se marca; no se rellena con lo
más probable. Es la regla que sostiene la utilidad de toda la transcripción.

**RN-4.** `confidence` es la confianza global del OCR, de 0 a 1. **Por debajo de 0,75 la UI lo
señala** (umbral fijado en `domain.ts`).

**RN-5.** Cada `TranscriptionFlag` lleva `kind`, `page` (1-indexada), `excerpt` (el LaTeX afectado,
para resaltarlo) y `note`.

**RN-6.** Una entrega tiene **como mucho una transcripción**
(`transcriptions.submission_id UNIQUE`). Reprocesar sustituye; no hay historial.

**RN-7.** El estado recorre `pending → transcribing → transcribed`, o `→ error` si falla. Un fallo
**no deja transcripción parcial**.

**RN-8.** `model` guarda el identificador real del modelo usado, no la variable de entorno. Una
transcripción antigua sigue diciendo con qué se hizo.

**RN-9.** **No se envía a la API de IA ningún dato personal del alumno**: ni `studentAlias`, ni el
nombre real. Sólo `studentRef` como identificador opaco.

**RN-10.** La transcripción es un paso **separado** de la corrección, con su propia llamada. Permite
reintentar sólo lo que falló, y sobre todo permite enseñarle al profesor la lectura antes que la
nota.

**RN-11.** La transcripción **no juzga**: no dice si lo escrito está bien. Sólo transcribe.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Escaneo torcido, oscuro o con sombra | Se transcribe lo que se pueda, se marca el resto y baja la confianza. No se preprocesa la imagen |
| Página fotografiada del revés | Se intenta igual. Si sale ilegible, se marca. Ver pregunta abierta 3 |
| Dos ejercicios en la misma página | Se transcribe la página entera como una unidad. Repartir por apartados es trabajo de la corrección (HU-12) |
| Cuentas sueltas al margen | Se transcriben como parte de la página. Que sean o no parte del desarrollo lo decide la corrección |
| Tachones y texto sobrescrito | Se transcribe lo que parezca la versión final y se marca `[DUDA]` cuando no esté claro |
| Entrega de 60 páginas | Se transcribe. Puede exigir trocear en varias llamadas. El coste sube linealmente. Ver pregunta abierta 4 |
| El alumno escribe en dos columnas | Se intenta seguir el orden de lectura. Si es ambiguo, `[DUDA]` con nota |
| Diagramas y gráficas dibujadas a mano | No hay LaTeX razonable para una gráfica de bocetos. Se describe en texto y se marca `[DUDA]`. Ver pregunta abierta 2 |
| Una sola página de las seis es ilegible | La transcripción se completa. Las marcas se concentran en esa página y la confianza baja |

## Fuera de alcance

- **Editar la transcripción.** Es HU-11, y hoy no hay endpoint.
- **Preprocesado de imagen** (enderezar, recortar, ajustar contraste). Ver pregunta abierta 3.
- **Detectar el nombre del alumno en la hoja** para asociar la entrega. Viene del conector (HU-08).
- **Reconocer gráficas y diagramas** como objetos estructurados.
- **Transcribir el enunciado.** Sólo se transcribe el desarrollo del alumno; el enunciado vive en
  el reparto de puntos y en la solución de referencia (HU-05).
- **Historial de transcripciones.** RN-6.
- **OCR local sin IA.** No hay respaldo: si el proveedor falla, la entrega queda en `error`.

## Notas de implementación

**Entidades** (`@vega/shared`): `Transcription` (`pages`, `flags`, `confidence`, `model`),
`TranscriptionPage` (`page`, `latex`, `imageUrl`), `TranscriptionFlag` (`kind`, `page`, `excerpt`,
`note`), `TranscriptionFlagKind` (`ILEGIBLE` | `DUDA`).

**Estados** (`SubmissionStatus`): `pending → transcribing → transcribed`, o `→ error`.

**Contrato**: `SubmissionDetail.transcription` es `Transcription | null` — `null` antes de
`transcribed`. `QueueItem.flagCount` cuenta las marcas.

**Esquema**: `transcriptions` con `submission_id UNIQUE` (RN-6), `pages jsonb`, `flags jsonb`,
`confidence numeric(4,3) CHECK BETWEEN 0 AND 1`, `model text`.

**Motor**: `packages/core`, función `transcribe(escaneo, contexto)`, sin dependencias de HTTP ni de
LMS. Ejecutable por CLI para ajustar el prompt sin levantar la aplicación
([ADR 0001](../decisiones/0001-monorepo-typescript.md)).

**Proveedor**: interfaz `AiProvider`
([ADR 0005](../decisiones/0005-proveedor-ia-intercambiable.md)). La salida del proveedor real se
valida contra el esquema Zod de `Transcription` **antes** de devolverse, igual que la del mock: es
lo que impide que las dos implementaciones diverjan.

**Instrucciones al modelo**: el criterio sobre `[ILEGIBLE]` y `[DUDA]` está escrito en
`contexts/global.md` §8, del lado de la corrección. El prompt de transcripción necesita su propio
juego de instrucciones, que **hoy no está en `contexts/`** — ver pregunta abierta 1.

**UI**: pestaña «Transcripción» de la pantalla de revisión (HU-15), con el escaneo al lado. Marcas
resaltadas y navegables. LaTeX renderizado con KaTeX, conmutable a fuente.

**Mock**: parcial. El proveedor `mock` devuelve transcripciones deterministas por `submissionId`,
con LaTeX realista de matemáticas y **al menos una marca de cada tipo**, para que la UI se diseñe
contra el caso incómodo y no contra el ideal.

## Preguntas abiertas

1. **¿Dónde viven las instrucciones de transcripción?** Los tres niveles de `contexts/` están
   escritos para corregir, no para transcribir. Pero el OCR también necesita criterio: qué hacer con
   los tachones, cómo tratar las cuentas al margen, cuándo marcar `[DUDA]` en lugar de elegir. Hoy
   ese criterio estaría enterrado en el código de `core`. Opciones: (a) un cuarto fichero de
   contexto, fuera de los tres niveles, sin representación en `ContextLevel`; (b) un nivel más en el
   enum, que rompe la simetría de
   [ADR 0003](../decisiones/0003-contexto-tres-niveles.md); (c) dejarlo en el código y aceptar que
   ajustar el OCR exige desplegar. **`[bloqueante]`: sin decidirlo, el criterio de transcripción
   queda fuera del alcance del profesor.**

2. **¿Qué se hace con gráficas y dibujos?** Una representación gráfica de una función, un diagrama
   de una región de integración o un esquema geométrico no tienen transcripción a LaTeX razonable.
   Y en `problema12` la región dibujada puede ser parte del planteamiento. Opciones: (a) describir
   en texto y marcar `[DUDA]`, que es lo que dicen los casos límite; (b) marcar la zona y enviar
   **también la imagen** al modelo de corrección, lo que cambia el flujo —la corrección dejaría de
   trabajar sólo sobre texto—; (c) ignorar los dibujos. La (b) es la correcta desde el punto de
   vista de la calidad y la más cara.

3. **¿Hace falta preprocesar la imagen?** Escaneos torcidos, con sombra o fotografiados con el móvil
   son la norma, no la excepción. Enderezar y normalizar contraste mejoraría mucho el OCR, pero
   `packages/core` está en Node, donde el tratamiento de imagen es más pobre que en Python
   (consecuencia reconocida en [ADR 0001](../decisiones/0001-monorepo-typescript.md)). Opciones: (a)
   invocar un binario (`pdftoppm`, ImageMagick) desde el contenedor; (b) confiar en el modelo de
   visión, que suele tolerarlo bien; (c) pedir a la academia que escanee decentemente, que es
   gratis y probablemente lo más efectivo.

4. **¿Cómo se trocean las entregas largas?** Un simulacro de tema puede ocupar 20 páginas. ¿Una
   llamada por entrega, una por página, o bloques? Una llamada por página multiplica el coste fijo y
   pierde el contexto entre páginas —un desarrollo que continúa de una a otra—; una sola llamada
   corre el riesgo de respuesta truncada. Afecta al coste, a la calidad y al tiempo del lote.

5. **¿Qué se considera «confianza global» de la transcripción?** ¿La media por página? ¿La peor
   página? ¿Una función del número de marcas? `contexts/global.md` §9.5 fija el criterio para la
   corrección —«¿puede el profesor firmar esto sin abrir el escaneo?»— pero para la transcripción no
   hay criterio escrito. Sin uno, el número es incomparable entre entregas y la cola ordena por
   ruido.

6. **¿Debe el sistema medir su propia tasa de acierto en OCR?** La desviación IA↔profesor (HU-18)
   mide la corrección, no la lectura. Si el OCR lee mal, la corrección será mala aunque el criterio
   sea perfecto, y hoy no hay forma de distinguir las dos causas. Medirlo exigiría que el profesor
   corrigiera transcripciones (HU-11) y contar esas correcciones.
