# HU-14 — Cola de revisión

| | |
|---|---|
| **Id** | HU-14 |
| **Épica** | Revisión y validación |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 5 |
| **Depende de** | HU-01, HU-12 |
| **Bloquea a** | HU-15 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** una lista de lo que me espera, con lo que necesita atención destacado
**para** decidir en cinco segundos por dónde empezar y saber cuánto me queda.

Es la pantalla de inicio del producto: lo primero que el profesor ve al abrir Vega por la mañana.
Su trabajo es responder a dos preguntas —**¿cuánto queda?** y **¿por dónde empiezo?**— y no
estorbar en nada más.

El contrato está diseñado para eso: `QueueItem` trae la nota propuesta, la confianza, el número de
marcas y los apartados dudosos **sin cargar la corrección entera**. Una fila de la cola es barata;
abrirla es lo caro.

## Criterios de aceptación

### Escenario 1: la cola por defecto muestra lo revisable

```gherkin
Dado que hay entregas en todos los estados de SubmissionStatus
Cuando envío GET /api/submissions sin parámetro status
Entonces recibo 200 con QueueResponse
Y items contiene las entregas en "graded", "validated" y "error"
Y no contiene las que están en "pending", "transcribing", "transcribed" ni "grading"
```

### Escenario 2: cada fila trae lo necesario para decidir

```gherkin
Dado que existe una entrega en "graded" con corrección
Cuando la veo en la cola
Entonces su QueueItem trae submission, mailbox reducido, score, maxScore,
        confidence, flagCount y lowConfidenceItems
Y score es la nota efectiva calculada con totalScore
Y no se ha cargado la corrección completa para pintarla
```

### Escenario 3: recuentos por estado

```gherkin
Dado que hay 14 entregas en "graded", 3 en "validated" y 1 en "error"
Cuando envío GET /api/submissions/counts
Entonces recibo 200 con QueueCounts
Y counts.graded es 14, counts.validated 3 y counts.error 1
Y las pestañas de la cola muestran esos números
```

### Escenario 4: filtrar por estado

```gherkin
Dado que hay entregas en varios estados
Cuando envío GET /api/submissions?status=error
Entonces items contiene sólo las que están en "error"
Y meta.total refleja ese subconjunto
```

### Escenario 5: filtrar por buzón

```gherkin
Dado que hay entregas de tres buzones
Cuando envío GET /api/submissions?mailboxId={id de tema04}
Entonces items contiene sólo entregas de ese buzón
```

### Escenario 6: buscar por alumno

```gherkin
Dado que existe una entrega con studentAlias "María G." y otra con studentRef "A-0417"
Cuando envío GET /api/submissions?q=0417
Entonces items contiene la entrega cuyo studentRef coincide
Y la búsqueda actúa sobre studentAlias y studentRef
```

### Escenario 7: ordenar por confianza

```gherkin
Dado que hay entregas con confianzas 0,45, 0,80 y 0,95
Cuando envío GET /api/submissions?sort=confidence&order=asc
Entonces la de 0,45 aparece primero
```

### Escenario 8: paginación

```gherkin
Dado que hay 45 entregas revisables
Cuando envío GET /api/submissions?page=2&pageSize=20
Entonces items contiene 20 elementos
Y meta es page 2, pageSize 20, total 45, totalPages 3
```

### Escenario 9: pageSize por encima del máximo

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/submissions?pageSize=500
Entonces recibo 400 con error.code = "BAD_REQUEST"
Y error.fields.pageSize indica el máximo permitido
```

### Escenario 10: entregas destacadas

```gherkin
Dado que hay entregas con flagCount 0 y lowConfidenceItems 0,
        y otras con flagCount 3 o lowConfidenceItems 2
Cuando abro la cola
Entonces las segundas aparecen visualmente destacadas
Y el motivo del destacado es identificable sin abrir la entrega
```

### Escenario 11: entregas en error

```gherkin
Dado que hay una entrega en "error" con errorMessage
Cuando la veo en la cola
Entonces se distingue claramente de las corregidas
Y su score es null
Y puedo abrirla para ver el mensaje y reprocesarla
```

### Escenario 12: cola vacía

```gherkin
Dado que no hay entregas en estados revisables
Cuando abro la cola
Entonces veo un estado vacío que indica que no queda nada por revisar
Y NO veo una lista vacía sin explicación
```

## Reglas de negocio

**RN-1.** Sin filtro de estado, la cola muestra `REVIEWABLE_STATUSES = ['graded', 'validated',
'error']`, la constante de `@vega/shared`. Los estados de máquina (`pending`, `transcribing`,
`transcribed`, `grading`) se ven filtrando explícitamente.

**RN-2.** `QueueItem` trae sólo lo necesario para pintar la fila. **La corrección completa se carga
al abrir la entrega** (HU-15), no antes.

**RN-3.** `QueueItem.score` es la nota **efectiva** (`totalScore` sobre `effectivePoints`), no la
suma de `aiPoints`: si el profesor ya ajustó puntuaciones, la cola muestra su nota
([ADR 0008](../decisiones/0008-separar-puntos-ia-y-profesor.md)).

**RN-4.** `score` y `confidence` son `null` cuando no hay corrección (entregas en `error`, por
ejemplo).

**RN-5.** Orden por defecto: `submittedAt` descendente. Alternativas: `confidence` y `score`, ambas
en cualquier sentido.

**RN-6.** Paginación uniforme (`PageMeta`), `pageSize` por defecto 20 y **máximo 100**.

**RN-7.** La búsqueda `q` actúa sobre `studentAlias` y `studentRef`. **No busca en el contenido de
la corrección ni de la transcripción.**

**RN-8.** Se destacan las entregas con `flagCount > 0`, `lowConfidenceItems > 0` o `confidence` por
debajo del umbral (HU-13).

**RN-9.** Los recuentos de `GET /api/submissions/counts` son **de todos los estados**, no sólo de
los revisables: la cola muestra también cuántas están en proceso.

**RN-10.** Accesible para cualquier usuario autenticado. Hoy **todos los profesores ven todas las
entregas** (ver HU-02, pregunta 3).

## Casos límite

| Caso | Qué se hace |
|---|---|
| Entrega en `graded` sin corrección | No debería existir (invariante 1 del modelo de datos). Si aparece, se muestra con `score` null y se trata como incidencia |
| Muchas entregas del mismo alumno | Aparecen todas, sin agrupar. La UI señala la repetición de `studentRef` en el mismo buzón (HU-08) |
| Ordenar por confianza con entregas sin corrección | Los `null` van al final en orden ascendente, para que lo dudoso —no lo desconocido— quede arriba |
| Filtro por buzón inexistente | Lista vacía, no 404: es un filtro, no un recurso |
| Un lote termina mientras la cola está abierta | La lista no se actualiza sola. Hay que recargar. No hay tiempo real en el contrato |
| Cientos de entregas revisables | Paginación. Ver pregunta abierta 2 sobre agrupar por buzón |
| Entrega ya publicada | No aparece por defecto (no está en `REVIEWABLE_STATUSES`). Se ve filtrando por `published` |
| `q` con caracteres especiales | Se trata como texto literal, sin interpretar comodines |

## Fuera de alcance

- **Abrir y revisar la entrega.** Es HU-15.
- **Validar desde la cola, sin abrir.** Ver HU-16, pregunta sobre validación en bloque.
- **Actualización en tiempo real.** No hay WebSocket ni SSE en el contrato.
- **Agrupar visualmente por buzón.** Ver pregunta abierta 2.
- **Filtrar por rango de fechas o de nota.** `QueueQuery` no lo contempla.
- **Guardar filtros como vistas.**
- **Exportar la cola.**
- **Asignar entregas a profesores.** Ver HU-02, pregunta 3.

## Notas de implementación

**Entidades** (`@vega/shared`): `Submission`, `SubmissionStatus`, `REVIEWABLE_STATUSES`,
`SUBMISSION_STATUS_LABEL` (etiquetas en español: `graded` → «Por revisar», `validated` →
«Validada»…).

**Contrato**: `QueueQuery` (`status`, `mailboxId`, `q`, `page`, `pageSize`, `sort`, `order`),
`QueueItem`, `QueueResponse = paginated(QueueItem)`, `QueueCounts`, `PageMeta`.

**Endpoints** (`routes`): `queue` → `GET /api/submissions`; `queueCounts` →
`GET /api/submissions/counts`.

**Esquema**: índices `submissions_status_idx`, `submissions_mailbox_idx` y
`submissions_submitted_at_idx` (este último `DESC`, alineado con el orden por defecto de RN-5).

**Rendimiento**: `QueueItem` necesita `score`, `confidence`, `flagCount` y `lowConfidenceItems`,
que viven en `corrections`, `correction_items` y `transcriptions`. Pintar 20 filas **no puede
suponer 60 consultas**: se resuelve con una consulta con agregados sobre las tres tablas. Es el
único punto de esta HU con riesgo de rendimiento real.

Ojo con RN-3: `score` es la suma de `COALESCE(teacher_points, ai_points)`, no de `ai_points`. Es el
error fácil de esta consulta y el que produce notas mal en la pantalla más visible del producto.

**Etiquetas**: las de `SUBMISSION_STATUS_LABEL`, sin reescribirlas en el front.

**UI**: pestaña «Bandeja», primera de la navegación inferior y pantalla de aterrizaje tras el login.
Pestañas por estado con los recuentos de `counts`. Cada fila: buzón, alias o referencia del alumno,
nota propuesta sobre máxima, y los distintivos de HU-13. Filtro por buzón y búsqueda accesibles con
el pulgar. Estado vacío explícito (escenario 12).

**Mock**: completa. El conjunto simulado incluye entregas en `graded`, `validated` y `error`,
repartidas entre los tres buzones, con variedad de confianzas y marcas — suficiente para que la
cola se vea como se verá en producción.

## Preguntas abiertas

1. **¿Cuál es el orden por defecto que más ayuda?** Hoy es `submittedAt` descendente, que es lo
   predecible. Pero si el objetivo es gastar la atención donde importa, ordenar por confianza
   ascendente pondría arriba lo que hay que mirar. Contra eso: corregir en orden de llegada es lo
   que espera un profesor, y romper esa expectativa desorienta. Opciones: (a) dejarlo por fecha; (b)
   por confianza ascendente; (c) por fecha, pero con una sección «necesitan atención» arriba, lo que
   exige dos consultas o un criterio de partición.

2. **¿Debe agruparse por buzón?** Revisar diez entregas del mismo examen seguidas es mucho más
   rápido que saltar entre exámenes: el profesor ya tiene el criterio en la cabeza. Pero el contrato
   pagina sobre una lista plana, y agrupar con paginación es incómodo. Opciones: (a) filtro por
   buzón, que ya existe, y confiar en que el profesor lo use; (b) agrupación visual dentro de la
   página, que puede partir grupos entre páginas; (c) ordenar por buzón y luego por fecha, que
   agrupa de facto. La (c) es gratis y probablemente suficiente.

3. **¿Hace falta actualización automática?** El caso real: el profesor abre la cola a las 8:00
   mientras el lote de las 3:00 aún está corriendo (HU-09, pregunta 4). Ve doce entregas, corrige
   tres, y no se entera de que han entrado ocho más. Opciones: (a) recarga manual, que es lo que hay;
   (b) sondeo cada N segundos, barato pero con coste de batería en móvil; (c) SSE, que exige
   endpoint nuevo.

4. **¿Debe la cola mostrar las entregas `validated` pendientes de publicar?** Hoy sí:
   `REVIEWABLE_STATUSES` las incluye. Pero mezclarlas con las que esperan revisión confunde dos
   trabajos distintos —revisar y publicar— en la misma lista. ¿Pestaña separada? ¿O es justo lo que
   se quiere, que no se olviden sin publicar?

5. **¿Qué se ve del alumno en la cola?** `studentAlias` puede ser `null` (HU-08, pregunta 6), en
   cuyo caso sólo queda `studentRef`, que es un identificador opaco. Una cola de veinte filas que
   dicen `A-0417`, `A-0418`, `A-0419` es funcional pero deshumanizada, y dificulta que el profesor
   detecte «esta es la entrega de quien va fatal, mírala bien». ¿Se rellena el alias? ¿Con qué? Es
   la misma pregunta de RGPD de HU-08.
