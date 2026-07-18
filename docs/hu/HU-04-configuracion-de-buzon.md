# HU-04 — Configuración de un buzón

| | |
|---|---|
| **Id** | HU-04 |
| **Épica** | Buzones y contexto de corrección |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 5 |
| **Depende de** | HU-01 |
| **Bloquea a** | HU-05, HU-06, HU-08 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** ver la lista de buzones y configurar el nombre, el tipo de tarea y la nota máxima de
cada uno
**para** que Vega sepa qué clase de examen está corrigiendo antes de gastar un token.

El buzón es la unidad de trabajo de Vega: agrupa las entregas de un mismo examen y guarda todo lo
necesario para corregirlas. `taskType` no es una etiqueta descriptiva: **determina qué contexto de
nivel `task_type` se carga** y, con él, el criterio con el que se corrige
([ADR 0003](../decisiones/0003-contexto-tres-niveles.md)). Un simulacro de tema corregido con el
contexto de problema sale mal, y sale mal en silencio.

Esta HU cubre la configuración básica. La solución de referencia y el reparto de puntos, que son lo
caro de preparar, van en HU-05.

## Criterios de aceptación

### Escenario 1: listado de buzones

```gherkin
Dado que he iniciado sesión como "teacher"
Y existen tres buzones: "tema04" activo, "problema12" activo y "tema01" inactivo
Cuando envío GET /api/mailboxes
Entonces recibo 200 con MailboxListResponse
Y "items" contiene los tres buzones
Y cada uno trae slug, name, taskType, maxScore, connector, lmsRef y active
```

### Escenario 2: la lista distingue los buzones inactivos

```gherkin
Dado que existe un buzón "tema01" con active = false
Cuando abro la pantalla de buzones
Entonces "tema01" aparece visualmente diferenciado como inactivo
Y aparece después de los activos
```

### Escenario 3: cambiar el nombre y la nota máxima

```gherkin
Dado que existe el buzón "tema04" con maxScore 10
Cuando envío PATCH /api/mailboxes/{id} con name "Tema 04 — Derivadas (marzo)" y maxScore 20
Entonces recibo 200 con el Mailbox actualizado
Y las correcciones ya existentes conservan su propio maxScore, que no cambia
```

### Escenario 4: cambiar el tipo de tarea cambia el contexto que se aplica

```gherkin
Dado que existe el buzón "tema04" con taskType "simulacro_tema"
Y existe contexto de nivel task_type para "simulacro_tema" y para "simulacro_problema"
Cuando envío PATCH /api/mailboxes/{id} con taskType "simulacro_problema"
Entonces recibo 200
Y GET /api/contexts/resolved/{id} devuelve en "taskType" el contexto de "simulacro_problema"
Y la UI advierte de que el criterio de corrección de las próximas entregas cambia
```

### Escenario 5: no se puede cambiar el tipo con entregas publicadas

```gherkin
Dado que el buzón "tema04" tiene al menos una entrega en estado "published"
Cuando envío PATCH /api/mailboxes/{id} con un taskType distinto
Entonces recibo 409 con error.code = "CONFLICT"
Y error.message explica que ya hay correcciones publicadas con el criterio anterior
```

### Escenario 6: nota máxima inválida

```gherkin
Dado que he iniciado sesión como "teacher"
Cuando envío PATCH /api/mailboxes/{id} con maxScore 0
Entonces recibo 400 con error.code = "BAD_REQUEST"
Y error.fields.maxScore indica que debe ser mayor que cero
```

### Escenario 7: desactivar un buzón

```gherkin
Dado que existe el buzón "tema04" con active = true
Cuando envío PATCH /api/mailboxes/{id} con active = false
Entonces recibo 200
Y el siguiente lote nocturno no descarga entregas nuevas de ese buzón
Y las entregas ya existentes de ese buzón siguen siendo revisables y publicables
```

### Escenario 8: campos no modificables

```gherkin
Dado que existe el buzón "tema04" con slug "tema04" y connector "moodle3"
Cuando envío PATCH /api/mailboxes/{id} incluyendo slug o connector en el cuerpo
Entonces esos campos se ignoran, porque no forman parte de UpdateMailboxRequest
Y el buzón conserva su slug y su connector
```

### Escenario 9: buzón inexistente

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/mailboxes/{id de un buzón que no existe}
Entonces recibo 404 con error.code = "NOT_FOUND"
```

## Reglas de negocio

**RN-1.** El `slug` identifica al buzón como lo nombra la academia (`tema04`, `problema12`), es
único (`mailboxes.slug UNIQUE`) y **es inmutable**: sirve de `key` del contexto de nivel `mailbox`
(`GradingContext.key`) y de nombre del fichero en `contexts/mailboxes/`. Cambiarlo desconectaría al
buzón de sus instrucciones. Por eso no está en `UpdateMailboxRequest`.

**RN-2.** `taskType` sólo admite los valores de `TaskType`: `simulacro_problema` o
`simulacro_tema`. Determina qué contexto de nivel `task_type` se resuelve para este buzón.

**RN-3.** Cambiar `taskType` **cambia el criterio de corrección** de las siguientes entregas. Se
permite mientras no haya entregas en `published` (RN-4), y siempre con advertencia explícita en la
UI.

**RN-4.** Con al menos una entrega en `published`, cambiar `taskType` se rechaza con 409. Ya hay
alumnos con notas puestas bajo un criterio; cambiarlo dejaría el buzón incoherente consigo mismo.

**RN-5.** `maxScore > 0`. Es la nota máxima del examen completo.

**RN-6.** Cambiar `maxScore` **no altera las correcciones ya hechas**: `corrections.max_score` es
una columna propia de la corrección, copiada del buzón en el momento de corregir. Una corrección
antigua sigue valiendo sobre la escala con la que se hizo.

**RN-7.** `active = false` **impide la ingesta** de entregas nuevas (HU-08), pero no bloquea nada
de lo ya existente: las entregas del buzón siguen siendo revisables, validables y publicables.

**RN-8.** `connector` y `lmsRef` no se editan desde este endpoint: no están en
`UpdateMailboxRequest`. Se fijan al crear el buzón.

**RN-9.** La lista no se pagina: `MailboxListResponse` es `{ items: Mailbox[] }`. Una academia
maneja decenas de buzones.

**RN-10.** Cualquier usuario autenticado (`teacher` o `admin`) puede ver y editar buzones. El
README lo dice: el contexto de corrección es del profesor.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Buzón sin contexto de nivel `mailbox` | Permitido. `ResolvedContextResponse.mailbox` devuelve cadena vacía; se corrige sólo con global y tipo de tarea. La UI lo señala |
| Buzón sin `pointsAllocation` | Permitido por el esquema (`DEFAULT '[]'`), pero la corrección no puede desglosarse. Ver HU-05 |
| Buzón sin `lmsRef` con `connector = 'moodle3'` | La ingesta de ese buzón falla con error de configuración, no de red. Se avisa en la pantalla del buzón |
| Reducir `maxScore` por debajo de la suma del reparto de puntos | Permitido con aviso. El esquema no lo impide a propósito (hay apartados opcionales). Ver HU-05 |
| Desactivar un buzón con entregas en `graded` | Permitido. Las entregas siguen en la cola: lo contrario dejaría trabajo del profesor colgado |
| Dos profesores editan el mismo buzón a la vez | Último en escribir gana. Sin bloqueo optimista |
| `taskType` cambiado con entregas en `graded` sin publicar | Permitido (RN-4 sólo mira `published`), pero esas correcciones se hicieron con el criterio anterior. La UI advierte y sugiere reprocesarlas (HU-11) |

## Fuera de alcance

- **Crear buzones desde la UI.** No hay `POST /api/mailboxes` en el contrato. Ver pregunta abierta 1.
- **Borrar buzones.** No hay ruta, y `ON DELETE CASCADE` se llevaría por delante todas las
  entregas, transcripciones y correcciones. Se desactivan.
- **Solución de referencia y reparto de puntos.** Es HU-05, aunque viajen en el mismo
  `UpdateMailboxRequest`.
- **Contextos de corrección en Markdown.** Es HU-06.
- **Asignar buzones a profesores.** Ver HU-02, pregunta abierta 3.
- **Duplicar un buzón** para el examen del año siguiente. Ver pregunta abierta 4.

## Notas de implementación

**Entidades** (`@vega/shared`): `Mailbox` (`slug`, `name`, `taskType`, `maxScore`,
`referenceSolution`, `gradingNotes`, `pointsAllocation`, `connector`, `lmsRef`, `active`),
`TaskType`, `TASK_TYPE_LABEL` («Simulacro de problema» / «Simulacro de tema»).

**Contrato**: `MailboxListResponse`, `UpdateMailboxRequest` (todos los campos opcionales:
`name`, `taskType`, `maxScore`, `referenceSolution`, `gradingNotes`, `pointsAllocation`, `active`).

**Endpoints** (`routes`): `mailboxes` → `GET /api/mailboxes`; `mailbox(id)` → `GET`/`PATCH
/api/mailboxes/{id}`.

**Esquema**: tabla `mailboxes` con `slug UNIQUE`, `CHECK (task_type IN (...))`,
`CHECK (max_score > 0)`, `points_allocation jsonb DEFAULT '[]'`, `connector DEFAULT 'mock'`.

**Relación con los contextos**: `mailboxes.slug` es la `key` del `GradingContext` de nivel
`mailbox`. No hay FK entre `grading_contexts` y `mailboxes` (ver `modelo-de-datos.md`), así que la
coherencia la mantiene el API.

**UI**: pestaña «Buzones» de la navegación inferior. Lista con slug, nombre, tipo, nota máxima y
número de entregas pendientes. Detalle con formulario de esta HU más las secciones de HU-05 (reparto
de puntos, solución) y enlace al editor de contexto (HU-06). El cambio de `taskType` va detrás de
una confirmación que explique la consecuencia (RN-3).

**Mock**: completa. El conector `mock` siembra tres buzones —`tema04`, `problema12`, `tema07`—
coherentes con los contextos de ejemplo de `contexts/mailboxes/`.

## Preguntas abiertas

1. **¿Cómo nace un buzón?** No hay `POST /api/mailboxes` en el contrato. Opciones: (a) los crea el
   conector al descubrir tareas en el LMS, lo que exige ampliar la interfaz de conector con
   `listAssignments` ([ADR 0006](../decisiones/0006-conectores-lms-interfaz-minima.md) dice
   explícitamente que hoy no existe); (b) se añade `POST /api/mailboxes` y se crean a mano,
   escribiendo el `lmsRef` del LMS; (c) se crean por semilla o por CLI. Consecuencia: sin
   resolverlo, en producción no hay forma de crear un buzón desde la aplicación.
   **`[bloqueante]`: es un agujero en el circuito.**

2. **¿Qué pasa con `taskType` cuando hay correcciones en `graded` sin publicar?** RN-4 sólo bloquea
   si hay `published`. Pero cambiar el tipo deja esas correcciones hechas con otro criterio, y el
   profesor las validará sin saberlo. Opciones: (a) bloquear también con `graded`; (b) permitirlo y
   marcar esas entregas como «corregidas con criterio anterior», lo que exige guardar el `taskType`
   en la corrección — columna nueva; (c) permitirlo, avisar y confiar. **`[bloqueante]`: afecta a
   la fiabilidad de notas que el profesor va a firmar.**

3. **¿Debe validarse que `SUM(pointsAllocation.maxPoints) == maxScore`?** `domain.ts` dice
   explícitamente que no se fuerza «porque hay enunciados con apartados opcionales». Pero un buzón
   donde la suma da 8 y `maxScore` es 10 producirá notas sobre 8 sin que nadie se entere. ¿Aviso
   visual, aviso bloqueante al validar la primera entrega, o nada?

4. **¿Hace falta duplicar un buzón?** El caso real: el examen del tema 04 del curso siguiente
   reutiliza reparto de puntos, contexto y a menudo la solución, pero es un buzón distinto con
   entregas distintas. Copiar todo a mano es tedioso y propenso a errores. ¿Se añade una acción de
   duplicar (con `slug` nuevo), o se asume el copiar y pegar?

5. **¿Cómo se relacionan `gradingNotes` (columna del buzón) y el contexto de nivel `mailbox`
   (fichero Markdown)?** Ambos son Markdown, ambos son indicaciones del buzón, y hoy conviven sin
   una frontera clara. ¿`gradingNotes` es el editable rápido desde el móvil y el contexto el
   editable serio? ¿O sobra uno de los dos? Ver también HU-06.

6. **¿Debe la pantalla del buzón mostrar cuántas entregas hay en cada estado?** Es la información
   más útil para decidir dónde ponerse, pero exige o bien un contador en la respuesta de
   `/api/mailboxes` —ampliando el contrato— o bien una llamada extra por buzón a
   `/api/submissions/counts` filtrando por `mailboxId`, que hoy no acepta ese filtro.
