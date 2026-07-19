# HU-18 — Panel de coste y desviación

| | |
|---|---|
| **Id** | HU-18 |
| **Épica** | Observabilidad y coste |
| **Estado** | borrador |
| **Prioridad** | Should |
| **Estimación** | 8 |
| **Depende de** | HU-12, HU-16 |
| **Bloquea a** | HU-21 |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** administrador de la academia
**quiero** ver qué me cuesta Vega, en qué se me va y cuánto tengo que corregir a la IA
**para** saber si el sistema sale a cuenta, dónde recortar y si está mejorando o empeorando.

Tres preguntas, ninguna retórica. La del **coste total** decide si el producto es viable: si
corregir una entrega cuesta más que el tiempo que ahorra, no hay negocio. La del **reparto** decide
qué hacer al respecto: un total no es accionable, pero «los foros de Lengua II se han comido la
mitad del mes» sí lo es. Y la de la **desviación** decide si el producto funciona: si el profesor
cambia sistemáticamente medio punto por entrega, la propuesta de la IA no le está ahorrando
revisión, sólo se la está reformulando.

La desviación se puede medir gracias al
[ADR 0008](../decisiones/0008-separar-puntos-ia-y-profesor.md): `aiPoints` y `teacherPoints` son
columnas distintas, así que la señal está en los datos desde el primer día sin instrumentación
adicional. Este panel sólo la enseña.

**Cambio respecto a la versión anterior de esta HU:** el panel era una foto plana del mes en curso.
Ahora la ventana se elige y el gasto se desglosa por tres ejes —tipo de actividad, curso y
actividad— para poder bajar del agregado a lo que lo ha provocado sin cambiar de pantalla.

## Criterios de aceptación

### Escenario 1: resumen general

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/stats/overview
Entonces recibo 200 con OverviewResponse
Y counts trae el recuento por estado
Y gradedLast30Days trae las corregidas en 30 días
Y avgTeacherDeviation trae la desviación media en puntos
Y untouchedRatio trae la proporción de validadas sin editar
Y lastBatchRun trae el último lote o null
```

### Escenario 2: desglose del gasto por defecto

```gherkin
Dado que hay correcciones de este mes
Cuando envío GET /api/stats/cost sin parámetros
Entonces recibo 200 con CostBreakdownResponse
Y period es "this_month" y dimension es "activity_kind"
Y from y to delimitan la ventana en fechas ISO
Y usage, corrections y avgCostCents son los totales de esa ventana
Y groups trae una fila por ActivityKind con gasto en la ventana
```

### Escenario 3: cambiar la ventana no cambia el eje

```gherkin
Dado que estoy viendo el desglose por tipo del mes en curso
Cuando elijo el periodo "Últimos 30 días"
Entonces se consulta GET /api/stats/cost?period=last_30_days&dimension=activity_kind
Y los totales y las filas corresponden a la ventana nueva
Y el eje elegido se conserva
```

### Escenario 4: bajar del tipo a la actividad

```gherkin
Dado que estoy viendo el desglose por tipo
Cuando cambio el eje a "Actividad"
Entonces se consulta GET /api/stats/cost?period=<el mismo>&dimension=activity
Y cada fila trae activityId, y su etiqueta es el nombre de la actividad
Y las filas vienen ordenadas de más caro a menos caro
Y desde cada fila puedo abrir la ficha de esa actividad
```

### Escenario 5: sólo aparece lo que ha gastado

```gherkin
Dado que existen actividades dadas de alta sin ninguna corrección en la ventana
Cuando consulto el desglose por actividad
Entonces esas actividades no aparecen en groups
Y el panel no las presenta como si hubieran costado 0
```

### Escenario 6: periodo sin gasto

```gherkin
Dado que no hay ninguna corrección en la ventana elegida
Cuando consulto el desglose
Entonces groups viene vacío
Y los totales son 0
Y la UI muestra un estado vacío que lo explica, en lugar de una lista de ceros
```

### Escenario 7: parámetros inválidos

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/stats/cost?period=ayer
Entonces recibo 422 con error.code = "UNPROCESSABLE"
Y error.fields.period indica los valores admitidos
```

### Escenario 8: el desglose distingue lo no puntuable

```gherkin
Dado que hay gasto en actividades de tipo forum
Cuando consulto el desglose por tipo o por actividad
Entonces las filas de foro vienen marcadas como no puntuables
Y su coste se suma al total igual que el de las entregas
```

### Escenario 9: la desviación tiene signo

```gherkin
Dado que hay correcciones validadas donde el profesor subió la nota
Cuando consulto el panel
Entonces avgTeacherDeviation es positiva
Y la UI explica que positiva significa que el profesor sube la nota respecto a la IA
```

### Escenario 10: sin datos suficientes

```gherkin
Dado que no hay ninguna corrección validada
Cuando consulto el panel
Entonces avgTeacherDeviation es 0
Y la UI indica que no hay datos suficientes en lugar de presentar el 0 como un resultado
```

### Escenario 11: la desviación se calcula sobre lo validado y puntuable

```gherkin
Dado que hay correcciones en "graded" sin validar, otras en "validated" de entregas
Y correcciones validadas de actividades con graded = false
Cuando se calcula avgTeacherDeviation
Entonces sólo se tienen en cuenta las validadas de actividades puntuables
Y las de foro no entran, porque no tienen puntos que restar
```

### Escenario 12: coste con proveedor mock

```gherkin
Dado que el despliegue tiene AI_PROVIDER=mock
Cuando consulto el panel
Entonces costCents es 0 y los tokens son 0
Y la UI indica que el sistema está en modo simulado
Y no se presentan esos ceros como una medida real de coste
```

### Escenario 13: ahorro de caché

```gherkin
Dado que se han ejecutado lotes ordenados por actividad
Cuando consulto el desglose
Entonces veo la proporción de cachedInputTokens sobre inputTokens
Y esa proporción es mayor que cero
```

### Escenario 14: cuello de botella visible

```gherkin
Dado que hay 40 entregas en "graded" y 2 en "validated"
Cuando abro el panel
Entonces counts lo refleja
Y el panel deja claro que el trabajo se acumula en la revisión, no en el proceso
```

## Reglas de negocio

**RN-1.** `avgTeacherDeviation` es la media, por corrección validada, de
`SUM(COALESCE(teacherPoints, aiPoints) - aiPoints)`. Positiva significa que el profesor sube la
nota respecto a la IA.

**RN-2.** La desviación **sólo considera correcciones validadas de actividades puntuables**. En una
actividad con `graded = false` no hay `pointsAllocation` ni `teacherPoints`: incluirla sería sumar
ceros y diluir la señal.

**RN-3.** `untouchedRatio` es la proporción de correcciones validadas en las que el profesor no
cambió nada: ni puntos, ni feedback de apartado, ni resumen, ni el texto redactado. Es la métrica
que justifica subir el modo de autonomía de una actividad (ver HU-21).

**RN-4.** Con cero correcciones validadas, `avgTeacherDeviation` y `untouchedRatio` valen `0` y la
UI **debe** distinguir ese `0` de un resultado medido.

**RN-5.** `CostPeriod` admite `this_month`, `last_30_days`, `this_quarter` y `all_time`. `all_time`
se ancla en la fecha de la primera corrección, no en `-infinity`: el contrato devuelve fechas ISO y
la ventana tiene que poder rotularse.

**RN-6.** `CostDimension` admite `activity_kind`, `course` y `activity`. Periodo y eje son
independientes: cambiar uno no reinicia el otro.

**RN-7.** `groups` viene **ordenado por `costCents` descendente**. La primera fila es la que hay que
mirar.

**RN-8.** En `groups` sólo entran filas con gasto en la ventana. Una actividad sin correcciones no
aparece: el panel informa de lo gastado, no inventaria el catálogo.

**RN-9.** `activityId` sólo viene relleno con `dimension = activity`; es lo que permite navegar a la
ficha. Con `course` y `activity_kind` es `null`.

**RN-10.** Al agrupar por curso, `courseName` vacío se etiqueta «Sin curso». Es texto libre y admite
la cadena vacía por defecto de esquema.

**RN-11.** Los costes viajan en **céntimos** en todo el contrato (`numeric(10,4)` en base de datos)
y se formatean en el front. `avgCostCents` se redondea a cuatro decimales.

**RN-12.** El desglose es de **sólo lectura y por sesión**: no se persiste el periodo ni el eje
elegidos.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Una sola fila en el desglose | Ocupa la barra entera; no es un error, es que sólo hay una fuente de gasto |
| Fila con coste 0 y correcciones > 0 | Aparece con barra al mínimo visible; es señal de proveedor mock o de tarifa mal configurada |
| Actividad borrada con correcciones históricas | El `JOIN` la excluye; su gasto desaparece del desglose por actividad pero sigue en los totales. **Discrepancia conocida**: ver preguntas abiertas |
| Curso renombrado en Moodle a mitad de periodo | Aparecen dos filas, una por cada nombre. `courseName` es texto libre y no hay identidad estable |
| `all_time` sin ninguna corrección | `from` y `to` valen ambos «ahora»; la ventana es vacía y `groups` también |
| Cambio de eje con la petición anterior en vuelo | Se muestra el resultado anterior atenuado hasta que llega el nuevo; no se vacía la lista |

## Fuera de alcance

- **Exportar el desglose** a CSV o PDF.
- **Comparar dos periodos** entre sí (mes contra mes anterior).
- **Presupuesto y alertas**: fijar un techo de gasto mensual y avisar al acercarse. Es la
  continuación natural de esta HU y no está decidida.
- **Coste por profesor**: el gasto se atribuye a la actividad, no a quien revisa.
- **Cuarto nivel de zoom** (las correcciones individuales de una actividad). Desde la fila se abre la
  ficha de la actividad; el detalle por entrega vive en la cola de revisión (HU-14).

## Notas de implementación

**Entidades** (`@vega/shared`): `OverviewResponse`, `CostBreakdownResponse`, `CostGroup`,
`CostPeriod`, `CostDimension`, `UsageMetrics`, `BatchRun`.

**Endpoints** (`routes`): `overview` → `GET /api/stats/overview`; `costBreakdown` →
`GET /api/stats/cost?period=&dimension=`. Ambos exigen sesión.

**Esquema**: `corrections.cost_cents` (`numeric(10,4)`), `input_tokens`, `output_tokens`,
`cached_input_tokens`, `created_at`. El desglose une `corrections → submissions → activities` y
agrupa por `a.kind`, `a.course_name` o `a.id`.

**UI**: `apps/frontend/src/pages/OverviewPage.tsx` y
`apps/frontend/src/components/overview/CostBreakdown.tsx`. Selector de periodo con `Select`, eje con
`Tabs`. Las barras de proporción se escalan sobre la fila más cara, no sobre el total, para que el
reparto no se vea plano cuando hay una fila dominante. No se añade librería de gráficas: para
métricas sueltas el panel sigue usando cifras tipografiadas.

## Preguntas abiertas

1. **¿Qué hace `costCents` cuando el proveedor es real?** Hoy el valor lo escribe el motor a partir
   de una tarifa fija. Si la tarifa cambia y no se versiona, el histórico queda mal calculado y
   `cost_cents` es un número inventado con aspecto de dato. Opciones: (a) guardar la tarifa aplicada
   junto a cada corrección; (b) recalcular el histórico al cambiar la tarifa; (c) asumir la deriva y
   documentarla. `[bloqueante]`
2. **¿Cómo sabe el panel que está en modo simulado?** El escenario 12 lo exige y **no hay ningún
   campo en el contrato que lo diga**. Opciones: (a) añadir `simulated: boolean` a las dos
   respuestas de estadísticas; (b) derivarlo de `GET /api/settings`, que sólo ve el administrador;
   (c) marcar las correcciones simuladas en base de datos. La (c) es la única que sobrevive a
   cambiar de proveedor a mitad de mes. `[bloqueante]`
3. **¿Qué pasa con el gasto de una actividad borrada?** El `JOIN` la excluye del desglose pero su
   coste sigue contando en los totales, así que la suma de `groups` puede ser menor que
   `usage.costCents`. Opciones: (a) fila «Actividades eliminadas» que cuadre la suma; (b) impedir el
   borrado y desactivar en su lugar; (c) documentar la discrepancia. Hoy no hay endpoint de borrado
   de actividad, así que no es urgente — pero el `JOIN` ya está escrito como si lo hubiera.
4. **¿Debe el desglose respetar la actividad desactivada?** Una actividad con `enabled = false`
   sigue teniendo gasto histórico. Hoy aparece. Parece correcto, pero conviene confirmarlo.
5. **¿Merece la pena `avgCostCentsPerCorrection` en `OverviewResponse`** ahora que
   `CostBreakdownResponse` da la misma cifra con ventana elegible? Son dos fuentes para el mismo
   número y pueden discrepar si las ventanas no coinciden. Candidato a eliminarse del contrato.
