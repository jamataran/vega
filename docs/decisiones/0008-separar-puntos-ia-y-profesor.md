# ADR 0008 — Separar `aiPoints` de `teacherPoints`

**Estado**: Aceptado

## Contexto

Cuando el profesor cambia la puntuación de un apartado, lo más simple es sobrescribir el número:
una columna `points`, la IA la escribe, el profesor la pisa. Un campo, cero ambigüedad al leer la
nota.

El problema es que esa simplicidad **destruye la única señal que dice si Vega funciona**. Sin
saber qué propuso la IA no se puede responder a nada de esto:

- ¿La IA es sistemáticamente dura o blanda? ¿En qué apartados?
- ¿Ha mejorado la corrección tras retocar `contexts/global.md`? ¿Y tras cambiar de modelo?
- ¿Qué buzones necesitan mejor solución de referencia?
- ¿Cuántas entregas se validan **sin tocar nada**? Ese porcentaje es la medida real del ahorro de
  tiempo, y es la métrica que justifica el producto.

Hay un problema añadido, más sutil: con un solo campo **no se distingue «el profesor está de
acuerdo» de «el profesor no lo ha mirado»**. Ambos casos dejan el mismo número. Y esa distinción es
justo la que necesita la pantalla de revisión para señalar qué queda por atender.

## Decisión

**Dos columnas por apartado, y `teacherPoints` nullable, donde `null` significa «el profesor no se
ha pronunciado».**

```
ai_points        numeric NOT NULL   CHECK (ai_points >= 0)
ai_feedback      text    NOT NULL
teacher_points   numeric NULL       CHECK (teacher_points >= 0)
teacher_feedback text    NULL
```

Y lo mismo a nivel de corrección: `ai_summary NOT NULL` frente a `teacher_summary NULL`.

Las reglas de lectura son funciones puras en `@vega/shared`, no consultas repetidas por ahí:

```ts
effectivePoints(item) = item.teacherPoints ?? item.aiPoints
effectiveSource(item) = item.teacherPoints === null ? 'ai' : 'teacher'
totalScore(items)     = redondeo a 2 decimales de la suma de effectivePoints
```

Invariantes:

1. **La IA nunca escribe en `teacherPoints` ni en `teacherFeedback`.** Sólo los toca una petición
   HTTP autenticada.
2. **El profesor nunca escribe en `aiPoints` ni en `aiFeedback`.** `UpdateMailboxRequest` y
   `CorrectionItemPatch` no exponen esos campos: son inmutables desde la API.
3. **Enviar `teacherPoints: null` es una acción con significado**: devuelve el apartado a la
   propuesta de la IA. Está documentado en el propio contrato («`null` devuelve el apartado a la
   puntuación propuesta por la IA»). No es «no cambiar nada» — para eso se omite el item.
4. La nota que se publica en el LMS es siempre `totalScore` sobre los puntos efectivos.

Esto es lo que alimenta `OverviewResponse.avgTeacherDeviation`: media, sobre correcciones
validadas, de `SUM(effectivePoints) - SUM(aiPoints)`. Positiva significa que el profesor sube la
nota respecto a la IA.

## Consecuencias

**A favor**

- **La desviación IA↔profesor es medible sin instrumentación adicional**: sale de una consulta
  sobre datos que ya están ahí, para cualquier ventana temporal, buzón o apartado, y
  retroactivamente sobre todo el histórico.
- Se puede medir el porcentaje de entregas validadas sin edición, que es la métrica de ahorro real.
- El profesor puede **deshacer** un cambio de forma exacta: volver a `null` recupera la propuesta
  original. No hace falta historial de ediciones para eso.
- La UI distingue tres estados por apartado —sin revisar, aceptado tal cual, modificado— y puede
  señalar visualmente lo que falta por mirar.
- El feedback conserva las dos versiones: se puede comparar cómo escribe la IA y cómo escribe el
  profesor, y usarlo para afinar el tono en `contexts/global.md`.

**En contra**

- **Ningún consumidor debe leer los puntos directamente.** Quien haga `SUM(ai_points)` para pintar
  una nota se equivocará en silencio. Mitigación: `effectivePoints` y `totalScore` viven en
  `shared` y son la única forma admitida de calcular la nota; ninguna vista de base de datos
  expone los puntos crudos como si fueran la nota.
- **Aceptar explícitamente no se distingue de no mirar.** Si el profesor lee un apartado, está de
  acuerdo y no lo toca, queda `null`: idéntico a no haberlo abierto. La métrica de desviación no
  sufre, pero «¿revisó de verdad esta entrega?» no tiene respuesta a nivel de apartado — sólo a
  nivel de entrega, vía `validated_at`. Registrar la aceptación explícita exigiría un tercer estado
  y ensuciaría el modelo; se descarta por ahora. **Pregunta abierta en `HU-16`.**
- **Sólo se guarda una versión de la edición del profesor.** `corrections.submission_id` es único:
  no hay historial. Un cambio posterior pisa al anterior. Se acepta: el valor está en la diferencia
  IA↔profesor, no en la trayectoria de las ediciones.
- Duplica columnas y obliga a acordarse de la nulabilidad en cada consulta. Coste real, asumido a
  cambio de la señal.
