# HU-11 — Revisar la transcripción y reprocesar

| | |
|---|---|
| **Id** | HU-11 |
| **Épica** | Transcripción |
| **Estado** | borrador |
| **Prioridad** | Should |
| **Estimación** | 8 |
| **Depende de** | HU-10 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | No |

## Narrativa

**Como** profesor
**quiero** corregir lo que el OCR ha leído mal y volver a corregir con mi lectura
**para** que un alumno no pierda puntos porque el escáner salió oscuro.

Cuando una transcripción trae `[ILEGIBLE]` en el paso decisivo, hoy el profesor tiene dos salidas:
puntuar a ojo mirando el escaneo, o dar por bueno lo que la IA dedujo de un texto incompleto. Las
dos son malas. La buena —«pone esto, vuelve a corregir»— **no existe en el contrato**: no hay
endpoint para guardar una transcripción editada.

Esta es la HU más honesta del backlog: **necesita ampliar el contrato antes de poder
implementarse**, y por eso está fuera de la entrega mockeada. Lo que sí existe es
`POST /api/submissions/{id}/reprocess`, que cubre la mitad del problema: recorregir tras cambiar el
contexto, la solución de referencia o el reparto de puntos.

## Criterios de aceptación

> Los escenarios 1 a 4 dependen de un endpoint que hoy no existe. Están escritos para poder
> discutirlos, y son la especificación de la ampliación que hay que decidir (pregunta abierta 1).

### Escenario 1: corregir un fragmento ilegible

```gherkin
Dado que estoy revisando una entrega cuya transcripción tiene [ILEGIBLE] en la página 2
Y en el escaneo se lee "\int_0^1 x^2 dx"
Cuando sustituyo la marca por ese LaTeX y guardo la transcripción
Entonces la transcripción queda actualizada
Y la marca ILEGIBLE correspondiente desaparece de flags
Y la corrección existente queda señalada como desactualizada respecto a la transcripción
```

### Escenario 2: recorregir con la transcripción arreglada

```gherkin
Dado que he corregido la transcripción de una entrega en status "graded"
Cuando lanzo el reproceso de la corrección
Entonces la entrega pasa a "grading"
Y al terminar vuelve a "graded" con una corrección nueva
Y la corrección anterior se sustituye, porque corrections.submission_id es único
```

### Escenario 3: no se puede editar una transcripción publicada

```gherkin
Dado que una entrega está en status "published"
Cuando intento editar su transcripción
Entonces recibo 409 con error.code = "CONFLICT"
```

### Escenario 4: se conserva lo que el profesor ya había puntuado

```gherkin
Dado que una entrega en "graded" tiene teacherPoints en dos apartados
Cuando reproceso la corrección
Entonces se me advierte de que mis ediciones se perderán
Y debo confirmar explícitamente antes de que el reproceso se ejecute
```

### Escenario 5: reprocesar una entrega en error

```gherkin
Dado que una entrega está en status "error" por un fallo de transcripción
Cuando envío POST /api/submissions/{id}/reprocess
Entonces recibo 200 con CorrectionResponse
Y errorMessage se limpia
Y la entrega vuelve a un estado de proceso y se reintenta
```

### Escenario 6: recorregir tras cambiar el contexto

```gherkin
Dado que he editado el contexto de nivel mailbox de "tema04"
Y hay entregas de ese buzón en status "graded"
Cuando reproceso una de ellas
Entonces la nueva corrección se genera con el contexto actualizado
Y la transcripción NO se vuelve a ejecutar, porque no ha cambiado
Y no se gasta de nuevo el coste del OCR
```

### Escenario 7: no se reprocesa lo publicado

```gherkin
Dado que una entrega está en status "published"
Cuando envío POST /api/submissions/{id}/reprocess
Entonces recibo 409 con error.code = "CONFLICT"
```

### Escenario 8: reproceso ya en curso

```gherkin
Dado que una entrega está en status "grading"
Cuando envío POST /api/submissions/{id}/reprocess
Entonces recibo 409 con error.code = "CONFLICT"
```

## Reglas de negocio

**RN-1.** La transcripción es **editable por el profesor** mientras la entrega no esté en
`published`. Requiere endpoint nuevo (ver notas y preguntas abiertas).

**RN-2.** Editar la transcripción **no dispara** la corrección automáticamente. Son dos acciones:
el profesor puede arreglar varias páginas antes de recorregir una sola vez.

**RN-3.** Una transcripción editada **deja la corrección existente desactualizada**. La UI lo indica
con claridad: la nota que se ve se calculó sobre un texto que ya no es el actual.

**RN-4.** El reproceso **sustituye**, no acumula: `transcriptions.submission_id` y
`corrections.submission_id` son únicos. No hay historial.

**RN-5.** Reprocesar **destruye las ediciones del profesor** (`teacherPoints`, `teacherFeedback`,
`teacherSummary`) de la corrección anterior. Exige confirmación explícita cuando existan.

**RN-6.** El reproceso tiene dos alcances distintos: **desde el OCR** (vuelve a `transcribing`,
gasta la llamada de visión) o **sólo la corrección** (vuelve a `grading`, reutiliza la
transcripción). El segundo es el habitual y el barato.

**RN-7.** No se reprocesa una entrega en `published` ni una con proceso en curso (`transcribing`,
`grading`): 409.

**RN-8.** Reprocesar desde `error` limpia `errorMessage`.

**RN-9.** La edición de la transcripción **no cambia el estado** de la entrega: una entrega en
`graded` sigue en `graded` con la transcripción editada y la corrección marcada como
desactualizada.

**RN-10.** Cuando el profesor corrige un fragmento marcado, la marca correspondiente **se elimina**
de `flags`, y `confidence` de la transcripción **no se recalcula**: es la confianza que declaró el
modelo, no una métrica del sistema.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Se edita la transcripción de una entrega sin corrección todavía | Permitido. La corrección posterior usará el texto editado |
| El profesor introduce LaTeX inválido | Se guarda igual. La vista previa señala lo que no renderiza; el guardado no se bloquea |
| Se edita la transcripción de una entrega ya validada | La corrección queda desactualizada y la validación con ella. Ver pregunta abierta 4 |
| Reproceso durante un lote nocturno | La entrega se marca en proceso y el lote no la toma. Sin colisión |
| El reproceso vuelve a fallar | La entrega vuelve a `error` con el mensaje nuevo. Sin límite de reintentos manuales |
| El profesor edita y no recorrige | La corrección se queda desactualizada indefinidamente. Se puede validar igual, pero la UI advierte de que el texto cambió |
| Se elimina texto y con él una marca `[DUDA]` | La marca correspondiente desaparece de `flags` (RN-10) |
| Reproceso de una entrega cuyo buzón ha cambiado de `taskType` | Se corrige con el criterio nuevo. Es justamente el caso de uso de HU-04, RN-3 |

## Fuera de alcance

- **Historial de transcripciones y correcciones.** RN-4: el esquema tiene claves únicas por entrega.
- **Reproceso en bloque de un buzón o un lote.** No hay endpoint, y sin `batch_run_id` en
  `submissions` (HU-09, pregunta 1) ni siquiera se sabe qué entregas tocó un lote.
- **Preservar las ediciones del profesor entre correcciones.** RN-5. Ver pregunta abierta 3.
- **Reprocesar sólo un apartado.** El reproceso es de la entrega entera.
- **Sugerencias del modelo para resolver una marca `[DUDA]`.** La alternativa ya está en `note`.
- **Medir cuántas transcripciones corrige el profesor.** Sería la métrica de calidad del OCR (HU-10,
  pregunta 6), pero exige que esta HU exista primero.

## Notas de implementación

**Entidades** (`@vega/shared`): `Transcription`, `TranscriptionPage`, `TranscriptionFlag`.

**Estados** (`SubmissionStatus`): el reproceso lleva a `transcribing` o `grading` según alcance
(RN-6), y desde `error` puede volver a `pending`.

**Endpoints** (`routes`): `reprocess(id)` → `POST /api/submissions/{id}/reprocess`.

> **Dos huecos del contrato, y son el motivo de que esta HU esté en borrador:**
>
> 1. **No existe endpoint para guardar una transcripción editada.** Habría que añadir algo como
>    `PATCH /api/submissions/{id}/transcription` con su esquema de petición y respuesta. Sin eso,
>    los escenarios 1 a 4 no se pueden implementar.
> 2. **`reprocess` no tiene esquema de petición**, así que **no se puede indicar el alcance** de
>    RN-6: hoy no hay forma de pedir «sólo la corrección» frente a «desde el OCR». La diferencia es
>    el coste de una llamada de visión por entrega, que no es despreciable.

**Esquema**: `transcriptions` con `submission_id UNIQUE`, `pages jsonb`, `flags jsonb`. Editar es
un `UPDATE` del `jsonb`, sin migración.

**UI**: en la pestaña «Transcripción» de la pantalla de revisión (HU-15). Edición por página, con
el escaneo al lado. Las marcas son puntos de entrada evidentes: pulsar una `[ILEGIBLE]` lleva a
editar ese fragmento con la imagen ampliada al lado. En móvil, escribir LaTeX es incómodo: barra de
símbolos frecuentes mínima. El botón de recorregir es explícito y avisa de RN-5.

**Mock**: fuera de la entrega mockeada. El reproceso con el proveedor `mock` no aporta nada —
devuelve lo mismo, por ser determinista— y la edición exige contrato nuevo.

## Preguntas abiertas

1. **¿Se añade el endpoint de edición de transcripción?** Es la decisión que desbloquea la HU
   entera. Opciones: (a) `PATCH /api/submissions/{id}/transcription` con las páginas editadas, lo
   que exige definir esquema de petición y decidir si se envían todas las páginas o sólo las
   tocadas; (b) no hacerlo, y que el profesor ajuste la nota a mano mirando el escaneo —lo que
   convierte cada `[ILEGIBLE]` en trabajo manual—; (c) no hacerlo, pero permitir al profesor
   escribir una nota de contexto que se envíe al recorregir, más barato pero indirecto.
   **`[bloqueante]`.**

2. **¿Debe `reprocess` aceptar el alcance?** Sin cuerpo de petición, el sistema tiene que adivinar
   si volver a transcribir o no. Adivinar mal por defecto es caro: reprocesar desde el OCR toda una
   noche de entregas por un cambio de contexto duplica el gasto de visión sin motivo. Opciones: (a)
   añadir cuerpo con `scope: 'transcription' | 'grading'`; (b) deducirlo del estado —desde `error`
   en transcripción, reprocesa OCR; desde `graded`, sólo corrección—; (c) dos endpoints separados.
   La (b) no requiere tocar el contrato y cubre el 90 % de los casos. **`[bloqueante]`: hoy el
   comportamiento de un endpoint del contrato no está definido.**

3. **¿Se pueden preservar las ediciones del profesor al recorregir?** RN-5 las destruye, y es
   doloroso: un profesor que ha ajustado seis apartados y luego arregla una `[ILEGIBLE]` pierde el
   trabajo. Opciones: (a) conservar `teacherPoints` y `teacherFeedback` de los apartados cuyo
   `label` coincida entre la corrección vieja y la nueva; (b) mostrar la corrección anterior al lado
   de la nueva para copiar a mano; (c) destruir y avisar, que es lo que dice RN-5 hoy. La (a) es
   claramente mejor pero se apoya en que los `label` sean estables, lo que no está garantizado si la
   IA los genera sola (HU-05, pregunta 1).

4. **¿Qué pasa si se edita la transcripción de una entrega ya `validated`?** La validación fue sobre
   un texto que ya no existe. Opciones: (a) impedirlo, y exigir reabrir a `graded` primero; (b)
   permitirlo, invalidando automáticamente —lo que borraría `validated_by` y `validated_at`, y por
   tanto la firma de alguien—; (c) permitirlo y avisar. La (a) es la más coherente con el
   [ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md), pero exige que exista la
   reapertura, que hoy tampoco tiene endpoint (ver HU-16).

5. **¿Debe medirse cuánto edita el profesor la transcripción?** Sería la métrica de calidad del OCR,
   complementaria a la desviación de nota. Barato de contar si esta HU existe: número de páginas
   editadas sobre total. ¿Merece un sitio en el panel de HU-18?
