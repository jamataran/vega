# HU-18 — Panel de coste y desviación

| | |
|---|---|
| **Id** | HU-18 |
| **Épica** | Observabilidad y coste |
| **Estado** | borrador |
| **Prioridad** | Could |
| **Estimación** | 5 |
| **Depende de** | HU-12, HU-16 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** administrador de la academia
**quiero** ver qué me cuesta Vega y cuánto tengo que corregir a la IA
**para** saber si el sistema sale a cuenta y si está mejorando o empeorando.

Dos preguntas, ninguna retórica. La del **coste** decide si el producto es viable: si corregir un
examen cuesta más que el tiempo que ahorra, no hay negocio. La de la **desviación** decide si el
producto funciona: si el profesor cambia sistemáticamente medio punto por entrega, la propuesta de
la IA no le está ahorrando revisión, sólo se la está reformulando.

La desviación se puede medir gracias al
[ADR 0008](../decisiones/0008-separar-puntos-ia-y-profesor.md): `aiPoints` y `teacherPoints` son
columnas distintas, así que la señal está en los datos desde el primer día sin instrumentación
adicional. Este panel sólo la enseña.

## Criterios de aceptación

### Escenario 1: resumen general

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/stats/overview
Entonces recibo 200 con OverviewResponse
Y counts trae el recuento por estado
Y gradedLast30Days trae las corregidas en 30 días
Y usageThisMonth trae inputTokens, outputTokens, cachedInputTokens y costCents
Y avgCostCentsPerCorrection trae el coste medio por corrección
Y avgTeacherDeviation trae la desviación media en puntos
Y lastBatchRun trae el último lote o null
```

### Escenario 2: la desviación tiene signo

```gherkin
Dado que hay correcciones validadas donde el profesor subió la nota
Cuando consulto el panel
Entonces avgTeacherDeviation es positiva
Y la UI explica que positiva significa que el profesor sube la nota respecto a la IA
```

### Escenario 3: sin datos suficientes

```gherkin
Dado que no hay ninguna corrección validada
Cuando consulto el panel
Entonces avgTeacherDeviation es 0
Y la UI indica que no hay datos suficientes en lugar de presentar el 0 como un resultado
```

### Escenario 4: la desviación se calcula sobre lo validado

```gherkin
Dado que hay correcciones en "graded" sin validar y otras en "validated"
Cuando se calcula avgTeacherDeviation
Entonces sólo se tienen en cuenta las validadas
Y las que están esperando al profesor no cuentan
```

### Escenario 5: coste con proveedor mock

```gherkin
Dado que el despliegue tiene AI_PROVIDER=mock
Cuando consulto el panel
Entonces costCents es 0 y los tokens son 0
Y la UI indica que el sistema está en modo simulado
Y no se presentan esos ceros como una medida real de coste
```

### Escenario 6: ahorro de caché

```gherkin
Dado que se han ejecutado lotes ordenados por buzón
Cuando consulto el panel
Entonces veo la proporción de cachedInputTokens sobre inputTokens
Y esa proporción es mayor que cero
```

### Escenario 7: historial de lotes

```gherkin
Dado que se han ejecutado varios lotes
Cuando consulto GET /api/batch/runs
Entonces veo cada BatchRun con su duración, entregas procesadas, fallidas y coste
Y el panel muestra el último de forma destacada
```

### Escenario 8: cuello de botella visible

```gherkin
Dado que hay 40 entregas en "graded" y 2 en "validated"
Cuando abro el panel
Entonces counts lo refleja
Y el panel deja claro que el trabajo se acumula en la revisión, no en el proceso
```

## Reglas de negocio

**RN-1.** `avgTeacherDeviation` es la media, **sobre correcciones validadas**, de
`SUM(effectivePoints) - SUM(aiPoints)`. **Positiva = el profesor sube la nota** (lo dice el propio
comentario de `OverviewResponse`).

**RN-2.** `usageThisMonth` agrega el consumo del **mes natural en curso**, a partir de las cuatro
columnas de `corrections`.

**RN-3.** `avgCostCentsPerCorrection` es `costCents` total dividido por número de correcciones, en
**céntimos** (`UsageMetrics.costCents`). El dinero no viaja como flotante de euros.

**RN-4.** `counts` es el mismo `QueueCounts` de la cola: recuento por estado de todas las entregas.

**RN-5.** Con el proveedor `mock`, `usage` es cero. La UI **debe indicarlo** para que nadie
interprete un coste de cero como una medida (HU-03, RN-3).

**RN-6.** El panel es de **sólo lectura**. No permite lanzar el lote (eso es HU-09, y es de `admin`)
ni ninguna otra acción.

**RN-7.** Accesible para cualquier usuario autenticado. Ver pregunta abierta 5.

**RN-8.** Las cifras se calculan en el momento de la petición. No hay agregados precalculados ni
tabla de métricas.

**RN-9.** Con menos de un mínimo de correcciones validadas, la desviación **no se presenta como
resultado**: se indica que no hay datos suficientes.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Ninguna corrección todavía | Todo a cero y mensaje de «sin datos», no un panel de ceros |
| Una sola corrección validada | La desviación se calcula pero se marca como no significativa (RN-9) |
| Desviación exactamente 0 | Puede significar acuerdo perfecto **o** que nadie ha tocado nada. Se distingue mostrando el porcentaje de entregas validadas sin edición |
| Correcciones de meses anteriores | `usageThisMonth` sólo cuenta el mes en curso; `avgCostCentsPerCorrection` no está acotado a mes (ver pregunta abierta 2) |
| Un lote fallido | Sale en `lastBatchRun` con `status: 'failed'`. El panel lo destaca |
| El coste se dispara un mes | El panel lo muestra. **No hay alerta**: nadie se entera si no mira. Ver HU-09, pregunta 3 |
| Muchas correcciones | La agregación es un `SUM` sobre `corrections` y `correction_items`. Con volumen de academia no hay problema; con años de historia conviene índice |

## Fuera de alcance

- **Desviación por buzón, por apartado o por periodo.** `OverviewResponse` sólo trae la media
  global. Ver pregunta abierta 1.
- **Exportación CSV.** Estaba en el backlog original (T09); no está en el contrato.
- **Gráficas de evolución temporal.** No hay endpoint de series.
- **Alertas de coste.** RN de casos límite.
- **Coste por alumno o por buzón.** No hay endpoint.
- **Métricas de calidad del OCR.** Ver HU-10, pregunta 6 y HU-11, pregunta 5.
- **Calibración de la confianza.** Ver HU-13, pregunta 4.
- **Tiempo de revisión por entrega.** No se mide.

## Notas de implementación

**Entidades** (`@vega/shared`): `UsageMetrics`, `BatchRun`, `QueueCounts`, y las funciones
`effectivePoints` y `totalScore`.

**Contrato**: `OverviewResponse` (`counts`, `gradedLast30Days`, `usageThisMonth`,
`avgCostCentsPerCorrection`, `avgTeacherDeviation`, `lastBatchRun`), `BatchRunListResponse`.

**Endpoints** (`routes`): `overview` → `GET /api/stats/overview`; `batchRuns` →
`GET /api/batch/runs`.

**Esquema**: `corrections` con `input_tokens`, `output_tokens`, `cached_input_tokens` y
`cost_cents numeric(10,4)`; `correction_items` con `ai_points` y `teacher_points`; `batch_runs` con
las mismas cuatro columnas de consumo.

**Cálculo de la desviación (RN-1)**: sobre `correction_items` de correcciones con `validated_at IS
NOT NULL`, `SUM(COALESCE(teacher_points, ai_points)) - SUM(ai_points)` por corrección, y media de
ese valor. Es exactamente la resta que el ADR 0008 hace posible.

Ojo con el signo: `effectivePoints - aiPoints` y no al revés. Invertirlo produce un panel que dice
lo contrario de la realidad, y nadie lo notará durante meses.

**Métrica que falta en el contrato**: el **porcentaje de entregas validadas sin ninguna edición**
—la medida real del ahorro de tiempo, según el propio ADR 0008— **no está en `OverviewResponse`**.
Es una consulta trivial —correcciones validadas en las que todos los `teacher_points` y el
`teacher_summary` siguen a `NULL`— y probablemente la cifra más importante del panel. Ver pregunta
abierta 3.

**UI**: pestaña «Métricas» de la navegación inferior. Tres bloques: **carga de trabajo** (recuentos
por estado, cuello de botella), **coste** (mes en curso, media por corrección, proporción de caché)
y **calidad** (desviación media, con su signo explicado en texto, no sólo con un número). Aviso
visible cuando el proveedor es `mock` (RN-5).

**Mock**: parcial. El endpoint es real y las consultas también; lo que no hay son datos con
significado, porque el proveedor `mock` deja `usage` a cero. La parte de desviación sí es
demostrable en la entrega mockeada: basta con editar puntuaciones y validar.

## Preguntas abiertas

1. **¿Hace falta desagregar la desviación?** La media global dice si el sistema va bien o mal, pero
   **no dice qué arreglar**. La cifra accionable es por buzón —«en `tema07` subo sistemáticamente
   medio punto, el contexto es demasiado duro»— o por apartado. Los datos están; falta endpoint y
   falta decidir hasta dónde llegar. Sin desagregar, el panel informa pero no sirve para actuar.

2. **¿Sobre qué ventana se calcula `avgCostCentsPerCorrection`?** El contrato no lo dice.
   ¿Histórico completo, que mezcla modelos y precios de hace meses? ¿Mes en curso, coherente con
   `usageThisMonth` pero ruidoso al principio de mes? ¿Últimos 30 días? Cada opción da un número
   distinto y el panel no aclara cuál es. **`[bloqueante]` para que la cifra signifique algo.**

3. **¿Se añade el porcentaje de validadas sin edición?** Es, según el ADR 0008, «la medida real del
   ahorro de tiempo», y es la cifra que responde a «¿me está sirviendo esto?». No está en
   `OverviewResponse`. Añadirla es un campo más en el contrato y una consulta sencilla. La única
   pega: con la respuesta (b) a la pregunta 3 de HU-16 —aceptar apartado guardando `teacherPoints =
   aiPoints`— esta métrica se contaminaría. Las dos decisiones están acopladas.

4. **¿Cómo se calcula `costCents` con el proveedor real?** El coste depende del modelo, de los
   precios vigentes y del descuento por caché, y esos precios cambian. Opciones: (a) tabla de
   precios por modelo en configuración, que hay que mantener a mano y quedará obsoleta; (b) tomar el
   coste del proveedor si lo devuelve; (c) sólo contar tokens y no calcular euros, lo que quita al
   panel su respuesta más útil. Sin resolverlo, `cost_cents` es un número inventado con aspecto de
   dato.

5. **¿Debe un profesor ver la desviación?** Es una métrica sobre **su propio trabajo** frente al de
   la IA, y en manos de un jefe de estudios puede leerse como evaluación de desempeño. RN-7 lo deja
   visible para todos. Opciones: (a) visible para todos, que es lo que hay; (b) sólo `admin`; (c)
   cada profesor ve la suya y el `admin` ve la agregada. La (c) es la más sana pero exige desagregar
   por usuario, que hoy es posible (`validated_by`) pero no está en el contrato.

6. **¿Merece la pena un histórico de coste por mes?** `usageThisMonth` sólo da el mes en curso. Ver
   la tendencia —si el coste por corrección baja al mejorar la caché, o sube al cambiar de modelo—
   exige series temporales y un endpoint nuevo. ¿O basta con mirar `GET /api/batch/runs`, que ya
   trae el coste de cada lote y permite hacerse una idea?
