# HU-09 — Lote nocturno de procesamiento

| | |
|---|---|
| **Id** | HU-09 |
| **Épica** | Ingesta |
| **Estado** | borrador |
| **Prioridad** | Should |
| **Estimación** | 8 |
| **Depende de** | HU-08 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** profesor
**quiero** que cada noche Vega descargue, transcriba y corrija todo lo que haya llegado, y que por
la mañana me lo encuentre en la cola
**para** no tener que lanzar nada ni esperar delante de una barra de progreso.

Ejecutar por lotes no es sólo comodidad: es lo que hace el sistema **barato**. Procesar todas las
entregas de un buzón seguidas mantiene estable el prefijo del prompt —contexto de tres niveles más
solución de referencia— y eso es exactamente lo que abarata el prompt caching. Ordenar por fecha en
lugar de por buzón invalidaría la caché en cada salto y multiplicaría el coste.

El lote es también el sitio donde se mide: `BatchRun` acumula entregas procesadas, fallidas, tokens
y coste.

## Criterios de aceptación

### Escenario 1: ejecución programada

```gherkin
Dado que la hora configurada del lote son las 03:00
Y hay entregas pendientes en dos buzones activos
Cuando llega esa hora
Entonces se crea un BatchRun con status "running" y startedAt
Y se ingieren, transcriben y corrigen las entregas pendientes
Y al terminar el BatchRun pasa a "done" con finishedAt
Y submissionsProcessed y submissionsFailed reflejan lo ocurrido
Y usage acumula inputTokens, outputTokens, cachedInputTokens y costCents
```

### Escenario 2: orden por buzón

```gherkin
Dado que hay entregas pendientes de los buzones "tema04" y "problema12" intercaladas por fecha
Cuando se ejecuta el lote
Entonces se procesan todas las de un buzón antes de pasar al siguiente
Y a partir de la segunda entrega de cada buzón, cachedInputTokens es mayor que cero
```

### Escenario 3: disparo manual

```gherkin
Dado que he iniciado sesión como "admin"
Y hay cinco entregas pendientes
Cuando envío POST /api/batch/run
Entonces recibo 202 con TriggerBatchResponse
Y "run" es el BatchRun recién creado en estado "running"
Y "queued" es 5
Y la respuesta llega sin esperar a que el lote termine
```

### Escenario 4: un profesor no puede lanzar el lote

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío POST /api/batch/run
Entonces recibo 403 con error.code = "FORBIDDEN"
```

### Escenario 5: ya hay un lote corriendo

```gherkin
Dado que existe un BatchRun con status "running"
Cuando envío POST /api/batch/run
Entonces recibo 409 con error.code = "CONFLICT"
Y no se crea un segundo BatchRun
```

### Escenario 6: una entrega falla y el lote sigue

```gherkin
Dado que hay diez entregas pendientes
Y la transcripción de una de ellas falla de forma irrecuperable
Cuando se ejecuta el lote
Entonces esa entrega queda en status "error" con errorMessage legible
Y las otras nueve se procesan con normalidad
Y el BatchRun termina en "done" con submissionsProcessed 9 y submissionsFailed 1
```

### Escenario 7: el lote se cae entero

```gherkin
Dado que un lote está en ejecución
Y el proceso del API se reinicia
Cuando el API vuelve a arrancar
Entonces el BatchRun que quedó en "running" se cierra como "failed"
Y las entregas que quedaron en "transcribing" o "grading" se recuperan a un estado consistente
Y el siguiente lote las vuelve a tomar
```

### Escenario 8: historial de lotes

```gherkin
Dado que se han ejecutado varios lotes
Cuando envío GET /api/batch/runs
Entonces recibo 200 con BatchRunListResponse
Y los lotes vienen ordenados del más reciente al más antiguo
Y cada uno trae su duración, entregas procesadas, fallidas y consumo
```

### Escenario 9: resumen por correo

```gherkin
Dado que hay configuración SMTP
Y acaba de terminar un lote con 12 entregas procesadas, 2 con avisos y 0,84 € de coste
Cuando el lote pasa a "done"
Entonces se envía un correo de resumen con esas cifras
Y si no hay configuración SMTP, el lote termina igual sin enviar nada y sin fallar
```

### Escenario 10: no hay nada que procesar

```gherkin
Dado que no hay ninguna entrega pendiente ni ninguna entrega nueva en el LMS
Cuando se ejecuta el lote
Entonces se crea un BatchRun que termina en "done" con submissionsProcessed 0
Y no se envía correo de resumen
```

## Reglas de negocio

**RN-1.** El lote ejecuta la secuencia completa: ingesta (HU-08) → transcripción (HU-10) →
corrección (HU-12), dejando las entregas en `graded`.

**RN-2.** **Las entregas se procesan agrupadas por buzón.** Es un requisito de coste, no una
preferencia de orden.

**RN-3.** Sólo puede haber **un `BatchRun` en `running`** a la vez. El disparo manual con uno en
curso devuelve 409.

**RN-4.** El fallo de una entrega no aborta el lote (RN-5 de HU-08 para los buzones, esta para las
entregas). Se cuenta en `submissionsFailed` y se sigue.

**RN-5.** El `BatchRun` acumula `UsageMetrics` de todas las llamadas al modelo: `inputTokens`,
`outputTokens`, `cachedInputTokens` y `costCents`. Es la fuente de HU-18.

**RN-6.** Al arrancar, el API cierra como `failed` cualquier `BatchRun` que quedara en `running`, y
devuelve a un estado consistente las entregas atrapadas en `transcribing` o `grading`. Sin esto, un
reinicio deja entregas bloqueadas para siempre.

**RN-7.** Lanzar el lote a mano es de rol `admin`; consultar el historial, de cualquier usuario
autenticado.

**RN-8.** El disparo manual es **asíncrono**: responde 202 en cuanto encola, con el número de
entregas encoladas.

**RN-9.** El correo de resumen es opcional. Sin SMTP configurado, el lote funciona igual.

**RN-10.** La hora del lote es configuración de despliegue (variable de entorno), no editable desde
la UI (HU-03, RN-7).

**RN-11.** El lote **nunca valida ni publica nada**. Deja las entregas en `graded`, esperando al
profesor ([ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md)).

## Casos límite

| Caso | Qué se hace |
|---|---|
| El lote dura más que el intervalo hasta el siguiente | El siguiente no arranca: RN-3 lo impide. Se salta esa noche |
| El saldo de la API de IA se agota a mitad | Las entregas restantes fallan con mensaje explícito. El lote termina en `done` con muchas fallidas. Ver pregunta abierta 3 |
| Un buzón con cientos de entregas | Se procesan todas. No hay límite por buzón ni por lote. Ver pregunta abierta 4 |
| Entregas en `error` de lotes anteriores | **No se reintentan automáticamente.** Requieren reproceso explícito (HU-11). El lote sólo toma `pending` |
| El contexto cambia a mitad de lote | Las ya enviadas usan el anterior; las siguientes, el nuevo. Un lote puede quedar corregido con dos criterios (HU-06) |
| Dos instancias del API con el planificador activo | Ambas intentarían lanzar el lote. Se protege con un bloqueo a nivel de base de datos. Hoy Vega corre con una réplica, pero la protección se implementa igual |
| Reinicio justo al terminar un lote | RN-6 lo cerraría como `failed` aunque hubiera terminado bien. Se marca `finishedAt` antes de cambiar el estado para minimizar la ventana |

## Fuera de alcance

- **Editar la hora del lote desde la UI.** RN-10; ver HU-03, pregunta 1.
- **Progreso en tiempo real.** `GET /api/batch/runs` se consulta cuando se quiera; no hay
  WebSocket ni SSE en el contrato.
- **Cancelar un lote en curso.** No hay endpoint.
- **Prioridad entre buzones.** Se procesan en un orden estable pero no configurable.
- **Reintento automático de entregas en `error`.**
- **Lanzar el lote de un solo buzón.** Ver HU-08, pregunta abierta 4.
- **Presupuesto máximo por lote.** Ver pregunta abierta 3.

## Notas de implementación

**Entidades** (`@vega/shared`): `BatchRun` (`startedAt`, `finishedAt`, `status`
`running`|`done`|`failed`, `submissionsProcessed`, `submissionsFailed`, `usage`), `UsageMetrics`.

**Contrato**: `BatchRunListResponse`, `TriggerBatchResponse` (`{ run, queued }`).

**Endpoints** (`routes`): `batchRuns` → `GET /api/batch/runs`; `triggerBatch` →
`POST /api/batch/run` (admin, 202).

**Esquema**: tabla `batch_runs` con las cuatro columnas de consumo desglosadas e índice
`batch_runs_started_at_idx`.

**Dónde vive**: dentro del proceso de `apps/api`, sin cola de mensajes externa (ver
`arquitectura.md`). La protección de instancia única se hace con un advisory lock de Postgres, el
mismo mecanismo que las migraciones ([ADR 0002](../decisiones/0002-migraciones-sql-planas.md)).

**Optimización de coste**: la implementación `anthropic` del proveedor usa la Batches API con
respaldo en Messages, y marca como cacheable el prefijo estable del prompt. Que RN-2 funcione se
verifica con un test que comprueba `cachedInputTokens > 0` a partir de la segunda entrega del mismo
buzón.

**Trazabilidad**: `batch_runs` **no tiene relación con `submissions`** en el esquema. Qué entregas
procesó un lote sólo se deduce por ventana temporal. Ver pregunta abierta 1.

**Mock**: parcial. El planificador y el `BatchRun` son reales; el trabajo lo hace el proveedor
`mock`, que devuelve transcripciones y correcciones deterministas con `UsageMetrics` a cero. Sirve
para ver el circuito completo y la pantalla de historial, no para medir coste.

## Preguntas abiertas

1. **¿Hace falta saber qué entregas procesó cada lote?** Hoy no se puede: no hay `batch_run_id` en
   `submissions`. Cuando un lote sale mal, no se puede listar lo que tocó ni reprocesarlo en bloque.
   Añadir la columna es una migración pequeña con valor grande. ¿Se hace ahora o se espera a
   necesitarlo? **`[bloqueante]` si se quiere reproceso por lote.**

2. **¿Debe el lote reintentar las entregas en `error`?** Hoy no (RN de casos límite): una entrega
   que falló por un timeout se queda ahí hasta que alguien la reprocese a mano. Distinguir el fallo
   transitorio del permanente permitiría reintentar los primeros. Exige guardar la clase de error,
   no sólo el mensaje: columna nueva o convención en `errorMessage`.

3. **¿Hay tope de gasto por lote?** Una noche con 300 entregas de 20 páginas puede costar bastante
   más de lo previsto, y nadie se entera hasta la factura. Opciones: (a) tope de coste por lote que
   lo detenga al alcanzarlo, dejando entregas sin procesar; (b) tope de entregas por lote; (c) sólo
   avisar por correo al superar un umbral; (d) nada. La (a) es la única que protege de verdad, y es
   también la que puede dejar a un profesor sin corregir la mitad de la clase.

4. **¿Cuál es el tamaño máximo razonable de un lote?** Con la Batches API el tiempo de vuelta puede
   ser de horas. Si el lote de las 03:00 no ha terminado a las 08:00, el profesor se encuentra la
   cola a medias. ¿Se parte en varios lotes? ¿Se prioriza por buzón según cuándo se necesitan las
   notas?

5. **¿Quién recibe el correo de resumen?** No hay campo de destinatario en ningún sitio: ni en
   `users`, ni en configuración de aplicación. ¿Va a todos los `admin`? ¿A una dirección fija por
   variable de entorno? ¿A los profesores del buzón, lo que exigiría la asignación buzón-profesor
   de HU-02?

6. **¿Qué debe hacer el lote con las entregas que ya están en `transcribed` de un lote anterior
   interrumpido?** RN-6 habla de «estado consistente» sin concretar. ¿Se devuelven a `pending` y se
   vuelve a transcribir, gastando tokens otra vez? ¿O se retoman desde `transcribed`, saltándose el
   OCR ya pagado? La segunda es mejor pero exige que el lote sepa continuar a mitad de camino.
