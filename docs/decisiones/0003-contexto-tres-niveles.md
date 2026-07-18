# ADR 0003 — Contexto de corrección en tres niveles

**Estado**: Aceptado

## Contexto

Lo que la IA necesita saber para corregir un examen se compone de cosas con **frecuencias de
cambio muy distintas**:

- Que el feedback se escriba en segunda persona, que la coma sea el separador decimal, que un error
  de arrastre se penalice una sola vez: eso es política de departamento. Cambia una vez al año, y
  cuando cambia debe aplicarse a todo.
- Que en un simulacro de tema se valore la cobertura del temario y en un simulacro de problema el
  rigor del cálculo: eso es política de formato. Cambia poco y afecta a docenas de buzones.
- Que en `tema04` no se acepte la regla de la cadena sin explicitar la función interna, o que en
  `problema12` haya que exigir la comprobación del signo del área: eso es específico de un examen
  concreto. Se escribe una vez, para un examen, y se toca mientras dura la corrección.

Meter las tres cosas en un único campo por buzón obliga a copiar y pegar las políticas generales en
cada buzón nuevo. Al tercer buzón hay tres versiones divergentes de la misma norma y nadie sabe
cuál es la buena. Y en cuanto se afina una instrucción global —después de ver que la IA es
sistemáticamente dura con la falta de justificación—, hay que propagarla a mano a todos.

Meterlas en un único campo global tampoco vale: no hay dónde poner la exigencia concreta de un
examen concreto.

## Decisión

**Tres niveles de contexto, de más general a más específico, concatenados en ese orden.**

Modelado como `ContextLevel = 'global' | 'task_type' | 'mailbox'` y como filas de
`grading_contexts` con `UNIQUE (level, key)`:

| Nivel | `key` | Fichero por defecto | Contenido |
|---|---|---|---|
| `global` | `global` | `contexts/global.md` | Política de departamento: tono, arrastre, justificación, decimales |
| `task_type` | el `TaskType` | `contexts/task-types/<taskType>.md` | Qué se valora en cada formato |
| `mailbox` | el `slug` del buzón | `contexts/mailboxes/<slug>.md` | Indicaciones del examen concreto |

Además, el nivel de buzón se completa con datos **estructurados** que no son Markdown y por eso
viven en columnas de `mailboxes`: `referenceSolution`, `pointsAllocation`, `maxScore`,
`gradingNotes`.

La resolución se expone tal cual en `GET /api/contexts/resolved/{mailboxId}`
(`ResolvedContextResponse`), que devuelve los tres niveles por separado **y** el `merged` — que es,
literalmente, lo que se envía al modelo. Sin caja negra: el profesor puede leer el prompt.

Regla de combinación: **concatenación, no sustitución**. Lo específico añade y matiza; no borra lo
general. Cuando lo específico contradice a lo general, el criterio explícito en `global.md` es que
**gana lo más específico**, y así se le dice al modelo en el propio texto.

## Consecuencias

**A favor**

- Una política nueva se escribe una vez, en el nivel que le corresponde, y llega a todos los
  buzones que hereden de él.
- Los tres niveles son Markdown editable por el profesor. Ajustar el criterio de corrección no
  requiere desplegar.
- **El prefijo del prompt es estable dentro de un buzón**, que es la condición para que el prompt
  caching sirva de algo. Por eso el lote nocturno se ordena por buzón (ver `arquitectura.md`).
- Da un lugar evidente donde poner cada cosa, lo que evita la deriva por copia y pega.

**En contra**

- Tres sitios donde mirar cuando una corrección sale rara. Se mitiga con el endpoint de contexto
  resuelto, que enseña el resultado final.
- La contradicción entre niveles es posible y **no se detecta automáticamente**: si `global.md`
  dice de penalizar la falta de justificación y `tema04.md` dice de no hacerlo, la resolución
  depende de cómo lo interprete el modelo. La regla «gana lo específico» está escrita en el texto,
  pero no es una garantía del sistema.
- El prompt crece. Tres niveles más la solución de referencia más el reparto de puntos pueden ser
  varios miles de tokens por llamada. Es precisamente lo que hace rentable el caching, pero pone
  un techo práctico a lo largos que pueden ser los contextos.
- **Doble almacén**: los ficheros de `contexts/` en git y las filas de `grading_contexts` en la
  base de datos. Cuál gana cuando divergen es una pregunta abierta (ver `HU-06` y
  `contexts/README.md`). La regla provisional es: el fichero siembra, la base de datos manda a
  partir de la primera edición.
