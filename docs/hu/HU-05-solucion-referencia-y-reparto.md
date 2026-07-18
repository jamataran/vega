# HU-05 — Solución de referencia y reparto de puntos

| | |
|---|---|
| **Id** | HU-05 |
| **Épica** | Buzones y contexto de corrección |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 5 |
| **Depende de** | HU-04 |
| **Bloquea a** | HU-12 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** pegar la solución del examen y definir cuánto vale cada apartado
**para** que la IA corrija contra mi criterio y no contra el suyo, y para que la nota salga
desglosada como yo la desgloso.

Es lo más caro de preparar de todo el sistema y lo que más determina la calidad de la corrección.
Un buzón sin reparto de puntos produce correcciones que el profesor no puede revisar por apartados;
un buzón sin solución de referencia produce correcciones donde la IA decide sola qué es correcto.

Dos matices que están decididos y no se discuten aquí: la solución de referencia **no es la única
solución válida** —los métodos alternativos se puntúan completo, ver HU-13— y la suma del reparto
de puntos **no tiene por qué dar la nota máxima**, porque hay enunciados con apartados opcionales
(`domain.ts` lo dice explícitamente).

## Criterios de aceptación

### Escenario 1: guardar la solución de referencia

```gherkin
Dado que existe el buzón "problema12" sin solución de referencia
Cuando envío PATCH /api/mailboxes/{id} con referenceSolution conteniendo LaTeX
Entonces recibo 200 con el Mailbox actualizado
Y GET /api/mailboxes/{id} devuelve el mismo texto exacto, sin reescapar
```

### Escenario 2: la solución se renderiza

```gherkin
Dado que el buzón tiene referenceSolution con "$$\int_0^1 x^2\,dx = \frac{1}{3}$$"
Cuando abro la pantalla del buzón
Entonces veo la expresión renderizada con KaTeX
Y puedo alternar entre la vista renderizada y el texto fuente
```

### Escenario 3: LaTeX inválido no rompe la pantalla

```gherkin
Dado que el buzón tiene referenceSolution con "$$\frac{1}{$$"
Cuando abro la pantalla del buzón
Entonces la expresión mal formada se muestra señalada como no renderizable
Y el resto de la solución sí se renderiza
Y el guardado no se bloquea: el texto se conserva tal cual
```

### Escenario 4: definir el reparto de puntos

```gherkin
Dado que existe el buzón "problema12" con maxScore 10
Cuando envío PATCH /api/mailboxes/{id} con pointsAllocation:
  | label | statement                          | maxPoints |
  | 1     | Integral con cambio de variable    | 2.5       |
  | 2     | Área entre curvas                  | 2.5       |
  | 3     | Volumen de revolución              | 2.5       |
  | 4     | Teorema fundamental del cálculo    | 2.5       |
Entonces recibo 200
Y el buzón devuelve los cuatro apartados en el mismo orden
```

### Escenario 5: la suma no cuadra con la nota máxima

```gherkin
Dado que el buzón tiene maxScore 10
Cuando envío un pointsAllocation cuya suma de maxPoints es 8
Entonces recibo 200: la operación NO se rechaza
Y la pantalla del buzón muestra un aviso visible: "El reparto suma 8 de 10 puntos"
```

### Escenario 6: apartado sin etiqueta

```gherkin
Dado que he iniciado sesión
Cuando envío un pointsAllocation con un apartado cuyo label es ""
Entonces recibo 400 con error.code = "BAD_REQUEST"
Y error.fields señala el apartado afectado
```

### Escenario 7: puntos negativos

```gherkin
Dado que he iniciado sesión
Cuando envío un apartado con maxPoints = -1
Entonces recibo 400 con error.code = "BAD_REQUEST"
```

### Escenario 8: cambiar el reparto no altera las correcciones hechas

```gherkin
Dado que el buzón "problema12" tiene entregas ya corregidas con cuatro apartados
Cuando cambio el pointsAllocation a cinco apartados
Entonces las correcciones existentes conservan sus cuatro correction_items
Y sus max_points no cambian
Y las próximas entregas que se corrijan usarán los cinco apartados
```

### Escenario 9: la solución llega al modelo

```gherkin
Dado que el buzón tiene referenceSolution y pointsAllocation definidos
Cuando se corrige una entrega de ese buzón
Entonces la solución de referencia y el reparto de puntos forman parte
        de lo que se envía al modelo
Y GET /api/contexts/resolved/{id} permite comprobarlo antes de corregir
```

## Reglas de negocio

**RN-1.** `referenceSolution` es texto libre (LaTeX o texto plano) y es nullable. Se guarda **tal
cual se escribe**, sin transformar ni reescapar.

**RN-2.** `pointsAllocation` es una lista ordenada de `PointsAllocation`: `label` (no vacío),
`statement` (por defecto cadena vacía) y `maxPoints >= 0`. **El orden del array es el orden de los
apartados** y se conserva.

**RN-3.** **La suma de `maxPoints` no se fuerza a coincidir con `maxScore`.** Es una decisión
explícita del modelo de dominio: hay enunciados con apartados opcionales o con puntos de
presentación fuera del reparto. La UI avisa de la discrepancia; el API no la rechaza.

**RN-4.** Los `label` deben ser **únicos dentro del buzón**. Dos apartados «1a» hacen imposible que
el profesor sepa cuál está puntuando.

**RN-5.** Cambiar `pointsAllocation` **no reescribe correcciones ya hechas**. Los
`correction_items` guardan su propio `label`, `statement` y `max_points`, copiados en el momento de
corregir. Sólo afecta a las correcciones futuras.

**RN-6.** El reparto de puntos y la solución de referencia forman parte de lo que se envía al
modelo, junto con los tres niveles de contexto (`contexts/README.md`). No son documentación
interna: son entrada del sistema.

**RN-7.** Un buzón **sin `pointsAllocation`** puede corregirse, pero la IA decide sola el desglose,
y ese desglose será distinto entre entregas del mismo examen. La UI lo advierte como configuración
incompleta.

**RN-8.** Un buzón **sin `referenceSolution`** puede corregirse: la IA resuelve el examen por su
cuenta. La calidad baja y la UI lo advierte, pero es un caso soportado — hay exámenes para los que
el profesor no tiene la solución escrita.

**RN-9.** `gradingNotes` es Markdown libre con indicaciones del buzón, editable desde aquí. Su
relación exacta con el contexto de nivel `mailbox` está por decidir (ver preguntas abiertas).

## Casos límite

| Caso | Qué se hace |
|---|---|
| Solución de referencia muy larga (un PDF entero pegado) | Se guarda. Encarece cada llamada al modelo, pero el prompt caching lo amortigua dentro del mismo buzón. La UI muestra el tamaño aproximado |
| Reparto con un solo apartado de valor `maxScore` | Válido. Es el caso de un simulacro de tema que se puntúa en bloque. La corrección tendrá un solo `CorrectionItem` |
| Reparto vacío en un buzón con entregas ya corregidas | Permitido. Las correcciones hechas no cambian; las futuras las desglosa la IA sola |
| `maxPoints = 0` en un apartado | Válido (`CHECK (max_points >= 0)`). Es un apartado que se comenta pero no puntúa |
| La suma del reparto supera `maxScore` | Se guarda con aviso. Una entrega perfecta podría dar más nota que el máximo del examen: se avisa también en la revisión |
| Solución de referencia en un formato distinto (PDF escaneado) | Fuera de alcance: el campo es texto. Ver pregunta abierta 2 |
| Se reordenan los apartados sin cambiar los `label` | Las correcciones futuras salen en el orden nuevo. Las hechas conservan su `position` |
| Dos apartados con el mismo `label` | 400 por RN-4 |

## Fuera de alcance

- **Adjuntar la solución como PDF.** `referenceSolution` es texto. Ver pregunta abierta 2.
- **Editor visual de fórmulas.** El profesor escribe LaTeX. Se le da vista previa, no un editor
  WYSIWYG.
- **Rúbrica estructurada por apartado** (qué vale el planteamiento, qué el desarrollo). Eso vive en
  Markdown, en el contexto del buzón: ver `contexts/task-types/` y HU-06.
- **Reescribir correcciones existentes al cambiar el reparto.** RN-5. Si se quiere, se reprocesa
  (HU-11).
- **Importar el reparto de puntos desde el LMS.** La interfaz de conector no lo contempla.
- **Historial de versiones de la solución.** No hay columna ni tabla.

## Notas de implementación

**Entidades** (`@vega/shared`): `Mailbox.referenceSolution`, `Mailbox.pointsAllocation`,
`Mailbox.gradingNotes`, `PointsAllocation` (`label`, `statement`, `maxPoints`).

**Contrato**: `UpdateMailboxRequest` con `referenceSolution`, `gradingNotes` y `pointsAllocation`.
Es el mismo endpoint de HU-04.

**Endpoints** (`routes`): `mailbox(id)` → `PATCH /api/mailboxes/{id}`.

**Esquema**: `mailboxes.reference_solution text`, `mailboxes.grading_notes text`,
`mailboxes.points_allocation jsonb NOT NULL DEFAULT '[]'`.

**Relación con la corrección**: `CorrectionItem` copia `label`, `statement` y `maxPoints` del
reparto en el momento de corregir. Esa copia es lo que hace que RN-5 se cumpla sin esfuerzo.

**RN-4 no está en el esquema**: la unicidad de `label` dentro del `jsonb` no la puede expresar un
`CHECK` razonable. Se valida en el API con un refinamiento Zod sobre `UpdateMailboxRequest`.

**UI**: dentro del detalle del buzón. La solución de referencia con área de texto y vista previa
KaTeX conmutable (mismo componente que el editor de contextos de HU-06). El reparto de puntos como
lista editable: añadir, reordenar por arrastre, eliminar, con la suma acumulada visible en todo
momento junto a `maxScore`. En móvil, la suma va fija en la parte inferior.

**Mock**: completa. El conector `mock` siembra los tres buzones con reparto y solución realistas,
coherentes con `contexts/mailboxes/`. Al menos uno de ellos siembra deliberadamente una suma que
**no** cuadra con `maxScore`, para que el aviso de RN-3 se vea desde el primer día.

## Preguntas abiertas

1. **¿Qué se hace cuando la IA no encuentra en el examen un apartado del reparto?** Un alumno deja
   el apartado 3 en blanco. Opciones: (a) `CorrectionItem` con `aiPoints = 0` y feedback explicando
   que no aparece —lo que hace `contexts/global.md` §1.2—; (b) no generar el item, dejando la
   corrección con menos apartados de los esperados. La (a) es coherente con el contexto global, pero
   conviene que quede escrito como regla del sistema y no sólo como instrucción al modelo.
   **`[bloqueante]` para HU-12.**

2. **¿Debe poder adjuntarse la solución como PDF?** El README menciona «solución de referencia en
   PDF o LaTeX», pero `Mailbox.referenceSolution` es `string`. Muchos profesores tienen la solución
   escrita a mano o en un PDF, no en LaTeX. Opciones: (a) sólo texto, y que el profesor transcriba
   —es trabajo real, una tarde por examen—; (b) subir el PDF y **transcribirlo con el mismo motor
   de OCR** que las entregas, guardando el LaTeX resultante en `referenceSolution`; (c) subir el
   PDF y enviarlo como imagen al modelo en cada corrección, lo que exige almacenamiento y cambia el
   contrato. La (b) es elegante y reutiliza HU-10. **`[bloqueante]`: hay una discrepancia entre el
   README y el contrato.**

3. **¿Debe avisarse cuando la suma del reparto no cuadra, o bloquearse?** RN-3 dice avisar. Pero un
   buzón mal configurado produce notas mal escaladas para todos sus alumnos, y el aviso se ignora.
   ¿Debería bloquearse la **validación** de la primera entrega del buzón hasta que el profesor
   confirme que la discrepancia es intencionada? Sería un freno en el sitio donde importa.

4. **¿Cómo se reparten los puntos dentro de un apartado?** `contexts/task-types/simulacro_problema.md`
   propone 30/50/20 para planteamiento, desarrollo y resultado. Hoy eso vive en Markdown, no en
   datos. ¿Basta? ¿O hace falta que el profesor pueda fijar ese reparto por apartado, lo que
   significaría estructurar la rúbrica y ampliar `PointsAllocation`?

5. **¿Qué relación hay entre `gradingNotes` y el contexto de nivel `mailbox`?** Los dos son Markdown
   con indicaciones del mismo buzón, y hoy no hay frontera. Opciones: (a) `gradingNotes` es el
   apunte rápido desde el móvil y el contexto es el documento serio versionado; (b) se elimina
   `gradingNotes` y todo va al contexto; (c) `gradingNotes` desaparece de la UI y queda como campo
   heredado. Mantener los dos sin criterio garantiza que la información acabe partida por la mitad.
   Ver también HU-04 y HU-06.

6. **¿Debe poder reutilizarse un reparto de puntos entre buzones?** Los cuatro apartados de
   `problema12` se repiten en `problema13` y `problema14`. Copiar y pegar funciona pero se
   desincroniza. ¿Merece la pena una plantilla de reparto, o es complejidad prematura?
