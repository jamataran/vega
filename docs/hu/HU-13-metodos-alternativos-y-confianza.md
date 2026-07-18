# HU-13 — Métodos alternativos y confianza

| | |
|---|---|
| **Id** | HU-13 |
| **Épica** | Corrección |
| **Estado** | borrador |
| **Prioridad** | Should |
| **Estimación** | 5 |
| **Depende de** | HU-12 |
| **Bloquea a** | ninguna |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** profesor
**quiero** que Vega me diga dónde no está seguro y dónde el alumno ha resuelto por un camino
distinto al mío
**para** gastar mi atención en las diez entregas que la necesitan y no en las noventa que no.

Es la HU que hace viable el
[ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md). Si el profesor tiene que revisar
cien correcciones con el mismo cuidado, la validación humana obligatoria es una carga insoportable
y acabará degenerando en pulsar el botón sin mirar — «lo peor de los dos mundos: la responsabilidad
formal sin la revisión real», dice el propio ADR.

Dos señales, dos problemas distintos. **`alternativeMethod`** dice «esto es correcto pero no como
tú lo harías»: el riesgo es que la IA lo haya dado por bueno sin poder verificarlo.
**`confidence` baja** dice «no me fío de mí misma»: el riesgo es una nota mal puesta. Las dos
merecen los ojos del profesor, por motivos opuestos.

## Criterios de aceptación

### Escenario 1: se detecta un método alternativo

```gherkin
Dado que la solución de referencia resuelve una integral por partes
Y el alumno la resuelve con un cambio de variable, correctamente
Cuando se corrige la entrega
Entonces ese CorrectionItem tiene alternativeMethod = true
Y aiPoints es la puntuación completa del apartado
Y aiFeedback reconoce el camino alternativo sin penalizarlo
```

### Escenario 2: un método alternativo no verificable baja la confianza

```gherkin
Dado que el alumno resuelve por un camino que la IA no puede validar por completo
Cuando se corrige
Entonces alternativeMethod es true
Y la confidence de ese item es menor que 0,60
Y aiFeedback indica qué paso concreto no se ha podido verificar
```

### Escenario 3: la cola cuenta los apartados dudosos

```gherkin
Dado que una corrección tiene 5 items y 2 con confidence menor que 0,75
Cuando consulto GET /api/submissions
Entonces el QueueItem de esa entrega tiene lowConfidenceItems = 2
Y confidence refleja la confianza global de la corrección
```

### Escenario 4: la cola destaca lo que necesita atención

```gherkin
Dado que hay entregas con confianza alta y sin marcas, y otras con confianza baja o con marcas
Cuando abro la cola de revisión
Entonces las que tienen lowConfidenceItems mayor que 0, flagCount mayor que 0
        o algún método alternativo aparecen visualmente destacadas
Y puedo ordenar la cola por confianza ascendente
```

### Escenario 5: el apartado se señala en la revisión

```gherkin
Dado que abro una entrega con un apartado de confidence 0,45
Cuando llego a la pantalla de corrección
Entonces ese apartado aparece marcado como de baja confianza
Y el motivo, cuando la IA lo ha declarado en el feedback, es visible sin desplegar nada
```

### Escenario 6: el método alternativo se distingue de la baja confianza

```gherkin
Dado que un apartado tiene alternativeMethod = true y confidence 0,92
Cuando lo veo en la pantalla de revisión
Entonces se señala como método alternativo
Y NO se señala como de baja confianza
Y las dos señales son visualmente distinguibles
```

### Escenario 7: las marcas de transcripción arrastran la confianza

```gherkin
Dado que la transcripción de una entrega tiene 3 marcas ILEGIBLE en el apartado 2
Cuando se corrige
Entonces la confidence de ese item es menor que 0,50
Y la confianza global de la corrección es menor que 0,50
Y aiFeedback dice qué parte no se ha podido leer, sin puntuarla como errónea
```

### Escenario 8: la confianza global no es la media

```gherkin
Dado que una corrección tiene 6 items: cinco con confidence 0,95 y uno con 0,40
Cuando se guarda la corrección
Entonces la confianza global es sensiblemente menor que la media aritmética
Y refleja que hay un apartado que el profesor debe mirar
```

## Reglas de negocio

**RN-1.** `alternativeMethod` marca que la resolución es válida **y distinta** de la solución de
referencia. **No es una penalización**: un método alternativo correcto puntúa completo
(`contexts/global.md` §5.1).

**RN-2.** Un método alternativo que la IA **no puede verificar** se puntúa con lo que sí se pueda
justificar y se declara `confidence < 0,60`, diciendo qué paso no se ha validado
(`contexts/global.md` §5.4).

**RN-3.** El **umbral de baja confianza es 0,75** (comentario de `Transcription.confidence` en
`domain.ts`). Por debajo, la UI lo señala.

**RN-4.** `QueueItem.lowConfidenceItems` cuenta los apartados por debajo del umbral;
`QueueItem.flagCount` cuenta las marcas de transcripción. Las dos cifras están en el contrato para
poder destacar filas **sin traerse la corrección entera**.

**RN-5.** La confianza global **no es la media** de las de los apartados (`contexts/global.md`
§9.5). Un solo apartado a 0,40 debe arrastrarla hacia abajo.

**RN-6.** Baja confianza y método alternativo son **señales distintas** y se muestran distintas. Un
apartado puede tener una, otra, las dos o ninguna.

**RN-7.** Las marcas `[ILEGIBLE]` y `[DUDA]` de la transcripción **arrastran la confianza de la
corrección** hacia abajo, con los umbrales de `contexts/global.md` §8.2 a §8.4.

**RN-8.** Las señales **no bloquean nada**: el profesor puede validar una entrega con confianza
0,30 igual que una con 0,98. Son ayudas a la atención, no controles. Ver preguntas abiertas.

**RN-9.** La confianza **no se recalcula** en Vega: es lo que declaró el modelo. Vega la muestra y
la usa para ordenar, no la corrige.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Todos los apartados con confianza baja | La entrega se destaca entera. Suele indicar un problema de configuración del buzón, no del alumno: se sugiere revisar contexto y solución de referencia |
| Confianza alta y nota muy baja | No se destaca. Un cero bien fundamentado es máxima confianza (`contexts/global.md` §9.4) |
| Método alternativo en todos los apartados | Suele indicar que la solución de referencia no coincide con lo que se pidió al alumno. Se destaca el buzón, no sólo la entrega |
| La IA infla sistemáticamente la confianza | Vega no lo detecta hoy. Se vería indirectamente en la desviación IA↔profesor (HU-18) |
| Confianza exactamente 0,75 | **No** es baja: el umbral es estrictamente menor |
| Método alternativo mal marcado (era el de referencia) | Sin consecuencia sobre la nota. El profesor lo desmarca mentalmente; no hay campo editable |
| Corrección sin ningún item | No debería ocurrir (HU-12, RN-1). Si ocurre, la entrega se trata como `error` |

## Fuera de alcance

- **Que el profesor edite `alternativeMethod` o `confidence`.** Son declaraciones del modelo; no hay
  campo del profesor para ellas en el contrato.
- **Bloquear la validación por baja confianza.** RN-8; ver pregunta abierta 2.
- **Umbral configurable desde la UI.** Es constante. Ver HU-03, pregunta 1.
- **Calibrar la confianza del modelo** contra la desviación real observada.
- **Validación en bloque de las entregas de alta confianza.** Es HU-16, y contradice parcialmente
  el ADR 0004.
- **Explicar por qué la confianza es la que es**, más allá de lo que diga el feedback.

## Notas de implementación

**Entidades** (`@vega/shared`): `CorrectionItem.confidence`, `CorrectionItem.alternativeMethod`,
`Correction.confidence`, `Transcription.confidence`, `TranscriptionFlag`.

**Contrato**: `QueueItem.confidence`, `QueueItem.flagCount`, `QueueItem.lowConfidenceItems` — las
tres existen precisamente para que la cola destaque sin cargar correcciones enteras.

**Esquema**: `correction_items.confidence numeric(4,3) CHECK BETWEEN 0 AND 1`,
`correction_items.alternative_method boolean NOT NULL DEFAULT false`, y las confianzas equivalentes
en `corrections` y `transcriptions`.

**Umbral**: 0,75, documentado en `domain.ts`. Debe existir como **una sola constante exportada
desde `@vega/shared`** y usarse tanto en el cálculo de `lowConfidenceItems` en el API como en el
resaltado del front. Dos definiciones del umbral divergirán.

**Instrucciones al modelo**: la escala de confianza está escrita en `contexts/global.md` §9, con
una tabla de referencia por situación, y el criterio de método alternativo en §5. **Esta HU no
implementa lógica de confianza: implementa que lo que el modelo declara se propague y se vea.**

**UI**: en la cola, indicador por fila con las tres señales (confianza, marcas, alternativo) sin
saturar; orden por confianza ascendente disponible. En la revisión, distintivo por apartado, con
método alternativo y baja confianza visualmente distintos (RN-6) — distintos en forma, no sólo en
color, por accesibilidad.

**Mock**: parcial. El proveedor `mock` produce deliberadamente la variedad necesaria: apartados con
confianza alta, uno por debajo de 0,60, uno con `alternativeMethod`, y una entrega con marcas de
transcripción que arrastran la confianza global. Es lo que permite diseñar la UI contra el caso
incómodo (ADR 0005, regla 1).

## Preguntas abiertas

1. **¿Es 0,75 el umbral correcto?** Es un número escrito en un comentario, sin datos detrás. Si
   resulta bajo, el profesor revisa a fondo todo y la señal no sirve; si resulta alto, se le colarán
   correcciones malas. Sólo se puede calibrar con datos reales, cruzando confianza declarada con
   desviación observada (HU-18). ¿Se deja fijo hasta tener esos datos y se revisa después?

2. **¿Debería la baja confianza frenar la validación?** RN-8 dice que no. Pero el
   [ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) reconoce que validar puede
   degenerar en pulsar el botón sin mirar, y una entrega con un apartado a 0,30 validada en dos
   segundos es exactamente eso. Opciones: (a) nada, confiar en el profesor; (b) exigir confirmación
   adicional cuando haya apartados por debajo de un umbral crítico; (c) exigir que el profesor abra
   el apartado dudoso antes de poder validar, lo que requiere registrar qué ha mirado —dato que hoy
   no existe. La (b) es un freno barato en el sitio correcto.

3. **¿Qué es exactamente un «método alternativo»?** El límite es difuso: resolver una integral por
   partes en lugar de por cambio de variable lo es claramente; usar $u$ en lugar de $t$ no. Si el
   modelo lo marca con demasiada alegría, la señal se satura y deja de servir. ¿Hace falta afinar el
   criterio en `contexts/global.md` §5, o medir con qué frecuencia se marca y ajustarlo después?

4. **¿Debería medirse si la confianza está calibrada?** Es la pregunta más interesante que permiten
   los datos de Vega: cruzar `confidence` con `|teacherPoints - aiPoints|` diría si el modelo sabe
   cuándo no sabe. Si resultara que no correlacionan, toda esta HU sería decoración. Es una consulta
   sobre datos que ya se guardan, y encajaría en HU-18. ¿Entra en el panel?

5. **¿Debe verse el motivo de la baja confianza como campo aparte?** Hoy va mezclado en
   `aiFeedback`, que también verá el alumno. Pero «no he podido verificar el paso 3» es información
   **para el profesor**, no para el alumno, y publicarla tal cual es raro. ¿Se separa en un campo
   propio —lo que amplía `CorrectionItem` y el esquema— o se acepta que el profesor lo reescriba
   antes de publicar?
