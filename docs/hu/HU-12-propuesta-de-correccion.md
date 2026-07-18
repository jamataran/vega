# HU-12 — Propuesta de corrección por apartados

| | |
|---|---|
| **Id** | HU-12 |
| **Épica** | Corrección |
| **Estado** | borrador |
| **Prioridad** | Must |
| **Estimación** | 13 |
| **Depende de** | HU-05, HU-07, HU-10 |
| **Bloquea a** | HU-13, HU-14 |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** sistema
**quiero** puntuar cada apartado del examen contra la solución de referencia y el criterio del
profesor, con su feedback y su confianza
**para** que el profesor sólo tenga que revisar y ajustar, en lugar de corregir desde cero.

Es el corazón del producto. Todo lo demás —buzones, contextos, ingesta, transcripción— existe para
alimentar esta llamada, y la cola de revisión existe para auditar su resultado.

Dos decisiones ya tomadas condicionan la especificación. La primera: **`aiPoints` y `teacherPoints`
son columnas distintas** ([ADR 0008](../decisiones/0008-separar-puntos-ia-y-profesor.md)); esta HU
sólo escribe la primera, y nunca toca la segunda. La segunda: la corrección **propone**, no decide
([ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md)); termina en `graded`, que
significa «esperando al profesor».

## Criterios de aceptación

### Escenario 1: corrección completa

```gherkin
Dado que existe una entrega en status "transcribed"
Y su buzón tiene referenceSolution, pointsAllocation de 4 apartados y maxScore 10
Cuando se ejecuta la corrección
Entonces la entrega pasa por "grading" y termina en "graded"
Y se crea una Correction con maxScore 10 copiado del buzón
Y se crean 4 CorrectionItem, uno por apartado del reparto
Y cada item tiene label, statement, maxPoints, aiPoints, aiFeedback, confidence y position
Y la correction tiene aiSummary, confidence, model y usage
```

### Escenario 2: los puntos del profesor nacen vacíos

```gherkin
Dado que se acaba de crear una corrección
Cuando consulto sus items
Entonces teacherPoints es null en todos
Y teacherFeedback es null en todos
Y teacherSummary de la corrección es null
Y effectivePoints devuelve aiPoints para todos
```

### Escenario 3: los apartados salen del reparto de puntos

```gherkin
Dado que el buzón tiene pointsAllocation con labels "1", "2", "3", "4"
Cuando se corrige una entrega de ese buzón
Entonces los CorrectionItem tienen esos mismos labels
Y sus maxPoints coinciden con los del reparto
Y position refleja el orden del reparto, empezando en 0
```

### Escenario 4: apartado no entregado

```gherkin
Dado que el reparto tiene 4 apartados
Y el alumno sólo ha resuelto 3
Cuando se corrige
Entonces existen 4 CorrectionItem
Y el del apartado no resuelto tiene aiPoints 0
Y su aiFeedback indica que el apartado no aparece en la entrega
```

### Escenario 5: nunca se supera el máximo del apartado

```gherkin
Dado que un apartado tiene maxPoints 2.5
Cuando se corrige
Entonces aiPoints está entre 0 y 2.5
Y una respuesta del modelo con aiPoints mayor que maxPoints se rechaza
        y la corrección se reintenta o falla, pero no se guarda
```

### Escenario 6: la nota total es la suma efectiva

```gherkin
Dado que una corrección tiene items con aiPoints 2.5, 1.75, 0 y 2.25
Cuando consulto la entrega en la cola
Entonces QueueItem.score es 6.5
Y ese valor es el que devuelve totalScore sobre los items
```

### Escenario 7: buzón sin reparto de puntos

```gherkin
Dado que el buzón no tiene pointsAllocation
Cuando se corrige una entrega
Entonces la IA genera el desglose que estime a partir de la entrega y la solución
Y la suma de maxPoints de los items es coherente con maxScore
Y la UI señala que el desglose no viene del profesor
```

### Escenario 8: se aplica el contexto de los tres niveles

```gherkin
Dado que el contexto global penaliza la falta de justificación con 0,25 puntos
Y el contexto del buzón exige comprobar las hipótesis del teorema
Cuando se corrige una entrega donde el alumno no comprueba las hipótesis
Entonces el aiFeedback del apartado menciona esa falta
Y el descuento aplicado es coherente con lo escrito en el contexto
```

### Escenario 9: se registra el consumo

```gherkin
Dado que se corrige una entrega con el proveedor real
Cuando termina la corrección
Entonces correction.usage tiene inputTokens, outputTokens, cachedInputTokens y costCents
Y a partir de la segunda entrega del mismo buzón en el mismo lote, cachedInputTokens es mayor que cero
```

### Escenario 10: fallo de corrección

```gherkin
Dado que el modelo devuelve una respuesta que no valida contra el esquema Correction
Cuando se ejecuta la corrección
Entonces se reintenta el número de veces configurado
Y si sigue fallando, la entrega queda en status "error" con errorMessage legible
Y no se guarda ninguna corrección parcial
```

### Escenario 11: no se envía el nombre del alumno

```gherkin
Dado que la entrega tiene studentAlias "María G."
Cuando se llama al proveedor de IA para corregir
Entonces el contenido enviado no incluye studentAlias ni ningún nombre real
```

## Reglas de negocio

**RN-1.** La corrección genera **un `CorrectionItem` por apartado del `pointsAllocation`** del
buzón, en su mismo orden (`position` desde 0) y con `label`, `statement` y `maxPoints` copiados.

**RN-2.** **Los apartados se copian en el momento de corregir.** Cambiar el reparto después no
altera las correcciones hechas (HU-05, RN-5).

**RN-3.** Un apartado que el alumno no ha resuelto **existe igualmente** con `aiPoints = 0` y
feedback que lo explica. No se omite: omitirlo lo haría invisible en la revisión.

**RN-4.** `0 <= aiPoints <= maxPoints` para cada apartado. Una respuesta del modelo que lo incumpla
**no se persiste**: se reintenta.

**RN-5.** La IA **nunca escribe `teacherPoints`, `teacherFeedback` ni `teacherSummary`**. Nacen
`null` y sólo los toca una petición autenticada
([ADR 0008](../decisiones/0008-separar-puntos-ia-y-profesor.md)).

**RN-6.** `Correction.maxScore` se copia de `Mailbox.maxScore` al corregir, por el mismo motivo que
RN-2.

**RN-7.** La nota total es `totalScore(items)` = suma de `effectivePoints` redondeada a dos
decimales. **No se persiste**: se calcula siempre con la función de `@vega/shared`.

**RN-8.** Cada item lleva su `confidence` (0–1) y la corrección la suya. La global **no es la media**
de las de los apartados: es la respuesta a «¿puede el profesor firmar esto sin abrir el escaneo?»
(`contexts/global.md` §9.5).

**RN-9.** Al modelo se le envía: el contexto resuelto de los tres niveles (HU-07), la solución de
referencia, el reparto de puntos, `maxScore` y la transcripción. **Nunca datos personales del
alumno** (README, privacidad).

**RN-10.** La salida del proveedor se valida contra el esquema Zod de `Correction` **antes de
persistirse**. Una respuesta inválida no se guarda ni a medias.

**RN-11.** Una entrega tiene **como mucho una corrección** (`corrections.submission_id UNIQUE`).
Reprocesar sustituye (HU-11).

**RN-12.** La corrección termina en `graded`. **Nunca en `validated` ni en `published`**: no hay
camino automático hacia el alumno.

**RN-13.** `usage` se registra siempre, también con el proveedor `mock` (a cero). Alimenta HU-18.

**RN-14.** `model` guarda el identificador real del modelo, no la variable de entorno.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Entrega en blanco | Corrección con todos los apartados a 0 y feedback explicándolo. No es un error |
| El alumno resuelve un apartado que no está en el reparto | Se transcribe pero no genera item: no hay dónde puntuarlo. Se menciona en `aiSummary`. Coherente con `contexts/task-types/simulacro_tema.md` T10 |
| La suma de `maxPoints` no cuadra con `maxScore` | Se corrige igual. La nota sale sobre la suma real. Se avisa (HU-05, RN-3) |
| La transcripción tiene marcas `[ILEGIBLE]` en el paso decisivo | La corrección aplica `contexts/global.md` §8.2: no penaliza el fragmento, baja la confianza y lo dice. Ver HU-13 |
| El modelo devuelve más items de los esperados | La respuesta se rechaza por RN-1 y se reintenta |
| Entrega larguísima | Puede exigir trocear la llamada. Sube el coste; no cambia la especificación |
| Buzón sin solución de referencia | Se corrige igual: la IA resuelve por su cuenta. Menor calidad, avisada en la UI (HU-05, RN-8) |
| Dos entregas del mismo alumno en el buzón | Se corrigen las dos, de forma independiente. Cuál vale lo decide el profesor (HU-08, pregunta 1) |
| El contexto cambia entre la transcripción y la corrección | Se usa el vigente al corregir. Sin foto del contexto (HU-07, pregunta 2) |

## Fuera de alcance

- **Editar la corrección.** Es HU-16.
- **Método alternativo y umbrales de confianza en la UI.** Es HU-13.
- **Validar y publicar.** Son HU-16 y HU-17.
- **Comparar dos correcciones de la misma entrega.** No hay historial (RN-11).
- **Corregir sin transcripción**, directamente sobre la imagen. Ver HU-10, pregunta 2.
- **Explicar cómo llegó la IA a una puntuación** más allá de `aiFeedback`.
- **Generar el PDF de feedback.** Es HU-17.

## Notas de implementación

**Entidades** (`@vega/shared`): `Correction` (`items`, `maxScore`, `aiSummary`, `teacherSummary`,
`confidence`, `model`, `usage`, `validatedBy`, `validatedAt`, `publishedAt`), `CorrectionItem`
(`label`, `statement`, `maxPoints`, `aiPoints`, `aiFeedback`, `teacherPoints`, `teacherFeedback`,
`confidence`, `alternativeMethod`, `position`), `UsageMetrics`.

**Funciones del dominio**: `effectivePoints`, `effectiveSource`, `totalScore`. **Son la única forma
admitida de calcular la nota.** Nadie suma `aiPoints` a mano.

**Estados** (`SubmissionStatus`): `transcribed → grading → graded`, o `→ error`.

**Esquema**: `corrections` con `submission_id UNIQUE`, las cuatro columnas de consumo desglosadas
(se agrupan en `usage` al serializar) y `validated_by`, `validated_at`, `published_at` nullables;
`correction_items` con `CHECK (ai_points >= 0)` e índice `(correction_id, position)`.

> El esquema **no impone `ai_points <= max_points`** (RN-4): sólo hay `CHECK (ai_points >= 0)`. La
> restricción se valida en el API, con un refinamiento Zod sobre la respuesta del proveedor.

**Motor**: `packages/core`, función `grade(transcripción, contextoResuelto, buzón)`, pura y sin
dependencias de HTTP ni de LMS. Ejecutable por CLI: `pnpm --filter core cli grade --buzon tema04
--pdf examen.pdf`.

**Coste**: el prefijo estable del prompt —contexto de tres niveles, solución de referencia, reparto
de puntos— se marca como cacheable. Es lo que hace rentable ordenar el lote por buzón (HU-09, RN-2).

**Mock**: parcial. El proveedor `mock` devuelve correcciones deterministas por `submissionId`, con
puntuaciones variadas, **al menos un apartado de confianza baja**, al menos uno con
`alternativeMethod`, y feedback en español con LaTeX real. `usage` a cero. Es lo que permite
construir y enseñar HU-14, HU-15 y HU-16 completas sin gastar nada.

## Preguntas abiertas

1. **¿Cuántos reintentos y con qué criterio?** RN-10 rechaza la respuesta inválida, pero no dice
   cuántas veces se reintenta ni si el reintento cambia el prompt. Cada reintento cuesta tokens.
   ¿Dos intentos y a `error`? ¿Se distingue «no valida el esquema» —donde reintentar tiene sentido—
   de «el modelo dice que no puede corregir esto» —donde no lo tiene—?

2. **¿Qué pasa si el modelo se niega a puntuar un apartado?** Puede ocurrir con desarrollos
   ilegibles o con contenido que no reconoce como matemáticas. Opciones: (a) `aiPoints = 0` con
   confianza muy baja, lo que castiga al alumno por defecto; (b) `aiPoints = maxPoints` con
   confianza muy baja, que le beneficia por defecto; (c) un tercer estado «sin puntuar» que hoy no
   cabe en el modelo, porque `ai_points` es `NOT NULL`. La opción por defecto **decide notas** en el
   caso en que el profesor no revise a fondo. **`[bloqueante]`.**

3. **¿La corrección puede proponer puntos fuera del reparto?** `contexts/global.md` §1.2 dice que no
   se reparten puntos que el enunciado no ha asignado, pero varios contextos hablan de descuentos
   —0,25 por notación, 0,25 por no interpretar el resultado— que podrían no caber en el apartado. Si
   un apartado vale 1 punto y acumula tres descuentos de 0,25, ¿el suelo es 0? ¿Puede un descuento
   global aplicarse a la nota total en lugar de a un apartado? Hoy no hay dónde guardar eso.

4. **¿Qué granularidad debe tener `aiFeedback`?** `contexts/global.md` §2.7 pide entre una y cuatro
   frases por apartado. Pero el feedback tiene dos destinatarios con necesidades opuestas: el
   alumno, que quiere saber qué arreglar, y el profesor, que quiere verificar rápido por qué la IA
   ha puntuado así. ¿Un solo texto para los dos? ¿Dos campos, lo que exige ampliar `CorrectionItem`
   y el esquema?

5. **¿Se debe guardar con qué versión del contexto se corrigió?** Ver HU-07, pregunta 2. Sin eso, la
   desviación IA↔profesor de HU-18 mezcla periodos con criterios distintos y es difícil de
   interpretar.

6. **¿Cómo se comporta la corrección cuando el buzón no tiene reparto de puntos?** El escenario 7
   dice que la IA genera el desglose, pero entonces **dos entregas del mismo examen pueden salir con
   apartados distintos**, y compararlas o revisarlas en serie se vuelve incómodo. Opciones: (a)
   generar el desglose en la primera entrega del buzón y **fijarlo** como `pointsAllocation` para
   las siguientes, lo que escribe en el buzón desde el motor; (b) permitir desgloses distintos y
   asumir la incomodidad; (c) exigir reparto de puntos y rechazar corregir sin él.
   **`[bloqueante]` si se admiten buzones sin reparto.**
