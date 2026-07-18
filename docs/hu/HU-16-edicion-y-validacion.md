# HU-16 — Editar puntuaciones y validar

| | |
|---|---|
| **Id** | HU-16 |
| **Épica** | Revisión y validación |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 8 |
| **Depende de** | HU-15 |
| **Bloquea a** | HU-17, HU-18 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** ajustar la puntuación y el feedback de los apartados que no me convencen, y validar
cuando la corrección ya es mía
**para** firmar una nota que asumo como propia y que puede publicarse.

Es la frontera del sistema. Antes de la validación, todo es una propuesta; después, es la nota de
un alumno. El [ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) hace cumplir esa
frontera de forma estructural: no existe camino de `graded` a `published`.

El contrato está diseñado para que validar sea **una sola acción atómica**: `ValidateRequest` es
idéntico a `SaveCorrectionRequest`, de modo que el botón «Validar» envía los cambios pendientes y
valida en la misma petición. No hay ventana en la que el profesor pulse validar y se firme una
versión anterior a sus últimas ediciones.

## Criterios de aceptación

### Escenario 1: ajustar la puntuación de un apartado

```gherkin
Dado que estoy revisando una entrega en "graded" con un apartado de aiPoints 1.5 y maxPoints 2.5
Cuando envío PATCH /api/submissions/{id}/correction con teacherPoints 2 para ese item
Entonces recibo 200 con CorrectionResponse
Y ese item tiene teacherPoints 2 y conserva aiPoints 1.5
Y effectivePoints de ese item devuelve 2
Y la nota total se recalcula con totalScore
Y submission.status sigue siendo "graded"
```

### Escenario 2: volver a la propuesta de la IA

```gherkin
Dado que un apartado tiene teacherPoints 2 y aiPoints 1.5
Cuando envío PATCH con teacherPoints null para ese item
Entonces recibo 200
Y teacherPoints vuelve a ser null
Y effectivePoints devuelve 1.5
Y effectiveSource devuelve "ai"
```

### Escenario 3: editar el feedback

```gherkin
Dado que un apartado tiene aiFeedback escrito por la IA
Cuando envío PATCH con teacherFeedback "Revisa la regla de la cadena en el tercer paso."
Entonces recibo 200
Y aiFeedback se conserva sin cambios
Y el feedback efectivo que verá el alumno es el del profesor
```

### Escenario 4: guardado parcial

```gherkin
Dado que una corrección tiene 4 items
Cuando envío PATCH con sólo 2 de ellos en el array items
Entonces recibo 200
Y los otros 2 items quedan exactamente como estaban
```

### Escenario 5: editar el resumen global

```gherkin
Dado que la corrección tiene aiSummary
Cuando envío PATCH con teacherSummary "Buen dominio del cálculo; cuida la justificación."
Entonces recibo 200
Y aiSummary se conserva
Y teacherSummary queda guardado
```

### Escenario 6: validar

```gherkin
Dado que estoy revisando una entrega en "graded"
Y he ajustado dos apartados sin guardar todavía
Cuando envío POST /api/submissions/{id}/validate con esos cambios en el cuerpo
Entonces recibo 200 con CorrectionResponse
Y los cambios enviados quedan guardados
Y correction.validatedBy es mi id de usuario
Y correction.validatedAt es la fecha actual
Y submission.status es "validated"
```

### Escenario 7: validar sin cambios pendientes

```gherkin
Dado que estoy conforme con toda la propuesta de la IA
Cuando envío POST /api/submissions/{id}/validate con items vacío y teacherSummary null
Entonces recibo 200
Y la entrega queda en "validated"
Y todos los teacherPoints siguen siendo null
Y la nota efectiva es la suma de aiPoints
```

### Escenario 8: no se valida dos veces

```gherkin
Dado que una entrega ya está en status "validated"
Cuando envío POST /api/submissions/{id}/validate
Entonces recibo 409 con error.code = "CONFLICT"
```

### Escenario 9: no se edita lo publicado

```gherkin
Dado que una entrega está en status "published"
Cuando envío PATCH /api/submissions/{id}/correction
Entonces recibo 409 con error.code = "CONFLICT"
```

### Escenario 10: apartado ajeno a la corrección

```gherkin
Dado que envío un items[].id que pertenece a la corrección de otra entrega
Cuando la petición llega al API
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y no se modifica ningún apartado
```

### Escenario 11: puntuación negativa

```gherkin
Dado que estoy editando un apartado
Cuando envío teacherPoints -1
Entonces recibo 400 con error.code = "BAD_REQUEST"
```

### Escenario 12: puntuación por encima del máximo del apartado

```gherkin
Dado que un apartado tiene maxPoints 2.5
Cuando envío teacherPoints 4
Entonces la UI avisa antes de enviar de que se supera el máximo del apartado
Y si se envía igualmente, el API lo acepta y la nota total lo refleja
```

### Escenario 13: edición con el pulgar

```gherkin
Dado que estoy en un dispositivo de 375 px
Cuando ajusto la puntuación de un apartado
Entonces puedo hacerlo con un control alcanzable con el pulgar
Y la nota total de la barra fija se actualiza al instante, antes de guardar
Y el teclado, al editar feedback, no tapa el campo que estoy escribiendo
```

### Escenario 14: fallo de red al guardar

```gherkin
Dado que he editado tres apartados
Y pierdo la conexión al pulsar guardar
Entonces la aplicación conserva mis cambios y me lo indica
Y puedo reintentar sin volver a escribirlos
```

## Reglas de negocio

**RN-1.** El profesor edita `teacherPoints`, `teacherFeedback` y `teacherSummary`. **Nunca**
`aiPoints`, `aiFeedback` ni `aiSummary`: no están en `CorrectionItemPatch`
([ADR 0008](../decisiones/0008-separar-puntos-ia-y-profesor.md)).

**RN-2.** **`teacherPoints: null` es una acción con significado**: devuelve el apartado a la
puntuación de la IA. No equivale a «no cambiar»; para eso se omite el item del array.

**RN-3.** El guardado es **parcial**: sólo se aplican los items enviados.

**RN-4.** Guardar **no valida**. La entrega sigue en `graded` y `validatedBy`/`validatedAt` no se
tocan.

**RN-5.** **Validar guarda y valida en una sola operación atómica.** `ValidateRequest =
SaveCorrectionRequest`. O se aplica todo, o no se aplica nada.

**RN-6.** Validar exige estado `graded`. Desde cualquier otro: 409.

**RN-7.** Al validar se registra `validatedBy` (el usuario autenticado) y `validatedAt`. Es la
firma, y es lo que da sentido al ADR 0004.

**RN-8.** Una entrega en `published` **no se edita ni se valida**: 409.

**RN-9.** `teacherPoints >= 0` (contrato y `CHECK` del esquema). **No hay tope superior**: el API
acepta un valor por encima de `maxPoints`. La UI avisa antes de enviar, pero no lo impide — el
profesor manda.

**RN-10.** La nota total se calcula siempre con `totalScore` sobre `effectivePoints`, en el
navegador para la vista previa y en el servidor para persistir, **con la misma implementación**.

**RN-11.** Cualquier usuario autenticado puede editar y validar cualquier entrega. No hay
restricción por buzón (ver HU-02, pregunta 3).

**RN-12.** Las ediciones **no tienen historial**: la última pisa a la anterior. Lo que se conserva
es la propuesta original de la IA, que es lo que importa para medir la desviación.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Dos profesores validan la misma entrega a la vez | El primero gana; el segundo recibe 409 por RN-6. La UI lo explica y recarga |
| El profesor pone `teacherPoints` igual a `aiPoints` | Se guarda como edición del profesor: `effectiveSource` pasa a `teacher`. **No** se normaliza a `null`. Es información: el profesor se ha pronunciado |
| Suma de puntos efectivos por encima de `maxScore` | Se permite y se avisa. Puede ocurrir por RN-9 o porque el reparto ya sumaba de más (HU-05) |
| Validar una entrega con confianza muy baja | Permitido. Las señales no bloquean (HU-13, RN-8) |
| Feedback vacío en un apartado | `teacherFeedback` a cadena vacía es distinto de `null`: la cadena vacía **sustituye** al feedback de la IA por nada. Se avisa antes de publicar |
| Editar mientras un reproceso está en curso | La corrección será sustituida. La UI avisa (HU-11, RN-5) |
| Token caducado al guardar | 401. El cliente conserva los cambios, pide login y reintenta (HU-01, casos límite) |
| Validar y publicar de una vez desde la UI | Son dos llamadas: `validate` y luego `publish` (HU-17). El botón puede encadenarlas, pero el API mantiene la separación |
| Reabrir una entrega ya validada | **No hay endpoint.** Ver pregunta abierta 2 |

## Fuera de alcance

- **Publicar en el LMS.** Es HU-17.
- **Reabrir una entrega validada.** No hay ruta. Ver pregunta abierta 2.
- **Historial de ediciones.** RN-12.
- **Editar `aiPoints` o `aiFeedback`.** RN-1: son inmutables por diseño.
- **Editar la transcripción.** Es HU-11.
- **Validación en bloque.** No está en el contrato. Ver pregunta abierta 1.
- **Comentarios internos del profesor** que no vea el alumno.
- **Modo sin conexión con cola de cambios.** El escenario 14 sólo exige no perder lo escrito en
  memoria.

## Notas de implementación

**Entidades** (`@vega/shared`): `Correction`, `CorrectionItem`, `effectivePoints`,
`effectiveSource`, `totalScore`.

**Contrato**: `CorrectionItemPatch` (`id`, `teacherPoints` nullable, `teacherFeedback` nullable),
`SaveCorrectionRequest` (`items`, `teacherSummary`), `ValidateRequest = SaveCorrectionRequest`,
`CorrectionResponse` (`{ correction, submission }`).

**Endpoints** (`routes`): `saveCorrection(id)` → `PATCH /api/submissions/{id}/correction`;
`validate(id)` → `POST /api/submissions/{id}/validate`.

**Estados**: `graded → graded` al guardar; `graded → validated` al validar.

**Esquema**: `correction_items.teacher_points numeric CHECK (teacher_points >= 0)` — nullable, sin
tope superior (RN-9); `corrections.validated_by uuid REFERENCES users(id) ON DELETE SET NULL` y
`validated_at timestamptz`.

**Atomicidad (RN-5)**: validar es una transacción que aplica los patches, comprueba que el estado
sigue siendo `graded`, y escribe `validated_by`/`validated_at` y el estado. Con `SELECT ... FOR
UPDATE` sobre la entrega para que dos validaciones simultáneas den 409 y no dos escrituras.

**Validación de pertenencia (escenario 10)**: cada `items[].id` debe pertenecer a la corrección de
**esta** entrega. Sin esa comprobación, un id de otra corrección modificaría la nota de otro alumno.
Es la comprobación de seguridad más importante de esta HU.

**UI**: tarjeta por apartado con control de puntuación tipo *stepper* —pasos de 0,25, que es la
unidad de descuento de `contexts/global.md`— y campo de feedback editable. La barra fija inferior
muestra la nota total recalculada al instante y el botón «Validar». Indicador por apartado de si
está sin tocar, aceptado o modificado (posible gracias a `effectiveSource`). Botón de deshacer que
envía `teacherPoints: null` (RN-2).

**Coma decimal**: los puntos se muestran y se introducen con coma (`1,75`), como exige
`contexts/global.md` §7.1. La conversión a `number` es del front.

**Mock**: completa. Es, con HU-15, lo que hace que la entrega mockeada valga para decidir si el
producto es el que se quiere.

## Preguntas abiertas

1. **¿Debe existir la validación en bloque?** Es la petición más previsible del cliente en cuanto
   corrija su primera noche de 80 entregas, y hoy exige 80 llamadas. El
   [ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) lo contempla pero pone
   condiciones: seguiría necesitando `validated_by` por entrega y seguiría teniendo que ser un acto
   explícito sobre un conjunto que el profesor ha visto. Opciones: (a) no hacerlo; (b) endpoint de
   validación en bloque restringido a entregas por encima de un umbral de confianza y sin marcas;
   (c) permitirlo sin restricciones, que es vaciar el ADR 0004 de contenido. La (b) es defendible;
   la (c) no. **`[bloqueante]` para el diseño de la cola: si entra, HU-14 necesita selección
   múltiple.**

2. **¿Cómo se reabre una entrega validada?** El diagrama de estados de `modelo-de-datos.md` incluye
   `validated → graded`, pero **no hay endpoint que lo haga**. El caso es real: el profesor valida,
   se da cuenta de un error y todavía no ha publicado. Opciones: (a) endpoint de reapertura que
   limpia `validated_by` y `validated_at` —lo que borra una firma, y hay que decidir si eso deja
   rastro—; (b) permitir `PATCH correction` en estado `validated`, que devolvería la entrega a
   `graded` implícitamente; (c) obligar a reprocesar, que destruye todo el trabajo del profesor.
   **`[bloqueante]`: hay una transición documentada sin forma de ejecutarla.**

3. **¿Debe distinguirse «revisado y conforme» de «no mirado»?** Hoy no se puede: los dos casos dejan
   `teacherPoints` a `null` (es la contrapartida reconocida del ADR 0008). Un profesor que revisa a
   fondo y está de acuerdo con todo deja el mismo rastro que uno que valida sin abrir. Opciones: (a)
   nada, y confiar; (b) un gesto de «aceptar apartado» que guarde `teacherPoints = aiPoints`, lo que
   funciona con el modelo actual pero **contamina la métrica de desviación** —esos apartados pasarían
   a contar como decisión del profesor—; (c) una tercera columna de aceptación explícita, que
   ensucia el modelo. La (b) es tentadora y tiene una consecuencia seria que hay que ver antes de
   elegirla.

4. **¿Debería avisarse al validar si el feedback de un apartado contiene texto dirigido al
   profesor?** La IA escribe cosas como «no he podido verificar el paso 3» (HU-13, pregunta 5), y si
   el profesor valida sin reescribirlo, el alumno lo leerá. ¿Se detecta? ¿Se separa el feedback en
   dos campos? ¿Se confía en que el profesor lo lea?

5. **¿Qué pasos debe tener el control de puntuación?** 0,25 es la unidad de descuento de
   `contexts/global.md`, pero un apartado de 0,5 puntos necesitaría 0,1, y uno de 3 puntos
   agradecería 0,5. ¿Paso fijo de 0,25? ¿Proporcional a `maxPoints`? ¿Entrada libre además del
   stepper, aceptando que teclear en el móvil es lento?

6. **¿Debe el profesor poder dejar una entrega «marcada para después»?** El caso: abre una, ve que
   necesita mirar el escaneo con calma en el ordenador, y quiere apartarla sin validarla. Hoy sólo
   puede dejarla en `graded`, indistinguible de las que no ha abierto. ¿Hace falta una marca? No hay
   columna para ella.
