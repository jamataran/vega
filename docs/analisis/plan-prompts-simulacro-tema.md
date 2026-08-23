# Plan para afinar la corrección de simulacros de tema

**Fecha:** 22 de agosto de 2026 · **Entorno:** `https://vega.opo-mates.es` (producción, recién
desplegada, `v1.0.0` sobre `sha-59dae25`)

## Qué es este documento y qué se pide de quien lo lea

Vega acaba de entrar en producción en una academia de oposiciones de matemáticas. El primer uso real
son **simulacros de tema**: el alumno elige uno de entre varios temas propuestos y lo desarrolla de
memoria y en tiempo tasado. Hay nueve actividades de este tipo importadas desde Moodle, y ninguna ha
procesado todavía ninguna entrega.

Este documento reúne (1) cómo funciona el motor por dentro, (2) el estado verificado de producción,
(3) cómo corrige el profesor, (4) los problemas detectados con su evidencia, y (5) el plan propuesto.

**Lo que se pide al revisor:** buscar los fallos del plan. En concreto, si la solución propuesta al
problema de la selección de tema (§6.1) es la correcta, si el reparto entre capas es el adecuado, y
si hay algún efecto de segundo orden que no se haya visto — sobre todo en la interacción entre el
prompt del motor, el verificador y el coste por corrección.

Todo lo marcado como **verificado** procede de leer el código o de consultar la API de producción, y
lleva su fuente. Lo demás es juicio de quien escribe y está marcado como tal.

---

## 1. Arquitectura: cuatro capas, y sólo una es «el prompt»

Un fallo de corrección puede tener su causa en cuatro sitios distintos, con plazos y alcances muy
diferentes. Distinguirlos es la decisión más importante de todo este trabajo.

| Capa | Qué es | Alcance | Cómo se cambia |
|---|---|---|---|
| **Prompt** | Instrucciones de operación del motor. 8 claves activas | **Toda la instalación**, todas las asignaturas y profesores | API, efecto inmediato |
| **Contexto** | Criterio docente, en Markdown, en 5 niveles | El nivel que se elija | Interfaz, efecto inmediato |
| **Configuración de actividad** | Plantilla, solución, ficheros, reparto de puntos, nota máxima | Una actividad | Interfaz, efecto inmediato |
| **Código** | El motor: qué se envía, qué se hace con la respuesta | Todo | CI → test → promoción manual |

**La regla que ordena el resto:** un prompt sólo se toca si el fallo se repetiría con cualquier
asignatura y cualquier profesor. Si el criterio es propio de esta academia, de esta materia o de este
tribunal, va en el contexto. Vega es AGPL y la instalan terceros: meter «no uses comillas» en
`grading.topic.system` se lo impone también a una academia de lengua.

### Prompts activos (verificado)

Las únicas ocho claves que el motor pide, según `packages/core/src/ai/anthropic.ts` y
`packages/core/src/ai/provider.ts`:

`global.system` · `transcription.system` · `triage.system` · `verify.system` ·
`grading.problem.system` · `grading.topic.system` · `forum.answer.simple.system` ·
`forum.answer.expert.system`

La pantalla de administración lista además `pd.regulation.system` (13 KB), que **no lo reclama ningún
camino de ejecución**: sólo existe en `apps/api/src/prompts/seeds.ts`. Editarlo no cambia nada.

### Niveles de contexto

`global` → `activity_kind` → `template` → `course` → `activity`. Los más específicos **añaden y
matizan**, nunca borran. Definidos en producción:

| Nivel | Clave | Tamaño |
|---|---|---|
| `global` | `global` | 26.415 car. — define las «§1–§10 globales» que citan los prompts |
| `activity_kind` | `assignment` / `forum` | 3.407 / 3.359 |
| `template` | `simulacro-problema` | 3.407 |
| `template` | `simulacro-tema` | 4.666 — define las reglas **T1–T11** |

---

## 2. Cómo se monta una llamada de corrección (verificado)

De `packages/core/src/ai/anthropic.ts:400-460`. El orden está elegido para el caché de prompt:
**instrucciones fijas → contexto de la actividad → material adjunto → reparto → transcripción**.

```
system: [
  global.system + grading.topic.system        (según gradePromptKey)
  contexto global (26 KB)
  contexto activity_kind
  contexto template            ← cache_control aquí
  contexto course / activity
  material adjunto             ← solución de referencia + TODOS los ficheros
  bloque de reparto de puntos  ← cache_control aquí
]
messages: [ user: [páginas originales del PDF, datos del alumno, transcripción] ]
```

Cuatro consecuencias que importan para el plan:

1. **El material adjunto viaja entero en cada corrección**, dentro del prefijo cacheado.
   `renderActivityMaterial` (`packages/core/src/grading/engine.ts:383`) concatena la solución de
   referencia y **todos** los ficheros de la actividad que tengan contenido, cada uno precedido de
   `## Material adjunto · <nombre-del-fichero>`. **El nombre del fichero llega al modelo**, lo cual es
   el gancho para la selección de tema.
2. **No hay selección de ficheros.** El motor no puede mandar sólo el tema que el alumno eligió: o
   van todos, o no va ninguno.
3. **El verificador no ve nada de esto.** La etapa de verificación corre con contexto disjunto, a
   propósito: un verificador que hereda el razonamiento del corrector no es una segunda opinión. El
   material grande sólo se paga en la llamada de corrección.
4. **La corrección usa `effort: xhigh`** con `max_tokens ≥ 64k` (`clampEffort`, sólo se concede a
   `opus-4-8` y `fable`; cualquier otro modelo se degrada a `high` en silencio). Los modelos
   configurados son `claude-opus-4-8` para lectura y corrección.

### Sin reparto de puntos: el motor ya lo contempla (verificado)

Corrige una conclusión errónea de un análisis anterior. Cuando `pointsAllocation` está vacío:

- `anthropic.ts:402` envía literalmente: *«No hay reparto de puntos configurado. Propón un máximo para
  cada apartado y haz que la suma de todos los `maxPoints` sea exactamente 10.»*
- `alignItems` (`engine.ts`) acepta los apartados propuestos por el modelo y **los normaliza a la nota
  máxima de la actividad**, para no producir el engañoso «2,5 / 10» repetido.

Es decir: **la decisión del profesor de no cargar reparto de puntos está soportada por el código.** El
problema está en el prompt, que dice lo contrario (§6.1).

---

## 3. Estado verificado de producción

Consultado por API el 22/08/2026.

| Comprobación | Resultado |
|---|---|
| `/api/health` | `ok` · base `up` · almacén `up` · proveedor `anthropic` · conector `moodle3` |
| Actividades | 9, todas `assignment`, «Mes N - Prueba 1: Desarrollo de tema» |
| `templateKey` | **`null` en las nueve** |
| `pointsAllocation` | Vacío en las nueve (intencionado) |
| `referenceSolution` | **`null` en las nueve** |
| Ficheros de contexto | **0 en las nueve** |
| `maxScore` | 10 |
| `autonomy` | `review_all` (nada se publica sin profesor) |
| Prompts | Los 9, todos en v1, sin editar desde la siembra |
| Cola de entregas | Vacía |
| Planificador | Entregas cada 1440 min, foros cada 480; corrió a las 17:22 UTC sin traer nada |

---

## 4. Cómo corrige el profesor

Recogido de su propia descripción, literal donde importa.

**Formato del buzón.** Un buzón por mes; el alumno elige **uno** de entre varios temas propuestos y
lo desarrolla. Los materiales son `tXX.tex` (solución del tema XX) y `rubricaXX.tex` (rúbrica del
tema XX, con puntos por apartado o con lo que debe contener). **No habrá reparto de puntos** en estas
actividades: lo pondera la rúbrica de cada tema.

**Método.** Cada sección del tema se compara con lo escrito en la solución aportada. Lo que está mal
explicado o falta se indica. **No se comenta nada que esté bien.**

**Cabecera de la corrección**, literal:

```
Hola _____.

Te devuelvo el simulacro corregido y te dejo por aquí los comentarios:
```

**Avisos recurrentes**, literales:

| # | Cuándo | Texto |
|---|---|---|
| b | Usa abreviaturas | «No uses abreviaturas sobre todo dentro de frases. Pueden penalizarte como falta de ortografía.» |
| c | Usa comillas | «No uses comillas.» |
| d | Se pega al borde | «Debes respetar los márgenes.» |
| e | Puntos de millar | «Los puntos de miles son una falta de ortografía, se puede poner un espacio como separación, pero no un punto.» |
| f | Puntos entre siglas | «Los puntos entre siglas son una falta de ortografía, no se pone nada entre las letras.» |
| g | Falta rigor | «El tema está redactado a un nivel más de Bachillerato que de oposición. Debes marcar la diferencia demostrando rigor matemático a lo largo del tema (redacción rigurosa, lenguaje específico matemático, estructura de proposición/teorema, demostración). Ten en cuenta que a nivel de Bachillerato es como lo contará la gente que no se haya estudiado el tema e improvise, y a ese nivel no se aprueba el tema.» |
| h | No indica «Índice» | «Indica que esto es el índice.» |
| i | Currículo escueto | «La relación con el currículo es muy breve, debes desarrollarla con un poco más de detalle.» |

**Bibliografía (j).** Debe llevar Boyer, dos o tres referencias matemáticas —que existan y guarden
cierta relación— y la normativa curricular estatal y autonómica de ESO y/o Bachillerato según con qué
etapa se haya relacionado el tema. La estatal, literal:

> Real Decreto 217/2022, de 29 de marzo, por el que se establece la ordenación y las enseñanzas
> mínimas de la Educación Secundaria Obligatoria
> Real Decreto 243/2022, de 5 de abril, por el que se establecen la ordenación y las enseñanzas
> mínimas del Bachillerato

Admite la forma abreviada: «Real Decreto 217/2022, de 29 de marzo y Real Decreto 243/2022, de 5 de
abril, por el que se establecen la ordenación y las enseñanzas mínimas de la ESO y del Bachillerato,
respectivamente».

**Márgenes (d):** el profesor decide **aplazarlo**. Ver §6.6 para por qué probablemente no sea
posible.

---

## 5. Lo que ya está bien y no hay que tocar

Conviene decirlo antes de la lista de problemas, porque condiciona el plan: **la infraestructura está
bien construida**. `grading.topic.system` (14 KB) es un prompt serio, con estados de cobertura
tipados, cita literal obligatoria y verificable por código, escala de rigor para demostraciones,
tarifa de descuentos de estructura, tratamiento de `[ILEGIBLE]`, reglas anti-alucinación y
comprobación final. El contexto `template: simulacro-tema` ya define T1–T11 con criterio.

**El problema no es que esté mal escrito: es que no está conectado a nada.**

---

## 6. Problemas detectados

### 6.1 · Ninguna actividad tiene plantilla → se usaría el prompt equivocado

**Evidencia:** `templateKey: null` en las nueve (API). `gradePromptKey`
(`packages/core/src/ai/provider.ts:169`) decide así:

```ts
return (input.templateKey ?? '').includes('tema')
  ? 'grading.topic.system'
  : 'grading.problem.system';
```

**Consecuencia:** hoy los nueve simulacros de tema se corregirían con el prompt de **problemas**, y el
contexto aplicado sería `activity_kind: assignment` («Simulacro de problema»). El contexto
`template: simulacro-tema`, con sus T1–T11, no lo vería nadie.

**Capa:** configuración. **Arreglo:** asignar la plantilla `simulacro-tema` a las nueve. Coste cero.

**Observación de diseño para el revisor:** decidir el prompt por `templateKey.includes('tema')` es
frágil. Una plantilla llamada `sistemas-de-ecuaciones` contiene «tema» como subcadena y activaría el
prompt de temas. No es urgente, pero es una trampa esperando.

### 6.2 · No hay ningún material cargado

**Evidencia:** `referenceSolution: null` y 0 ficheros en las nueve (API).

Sin material, el prompt hace lo correcto: §1.3 devuelve `cobertura` vacío, puntúa sólo por rigor y
estructura, lo declara en `avisos` y baja la confianza por debajo de 0,50. **Afinar redacción antes de
resolver esto sería trabajar a ciegas.**

**Aviso:** Vega no almacena bytes de binarios. Un PDF subido como contexto se registra con
`hasContent: false` y **su contenido nunca llega al modelo**. El `.tex` sí viaja literal, que es la
mejor fidelidad posible para notación matemática.

### 6.3 · El alumno elige un tema; el prompt asume una sola rúbrica

**El problema más grave del conjunto.** `grading.topic.system` §2.1:

> Recorre la matriz **entera, en su orden, sin saltarte filas**. `cobertura` lleva una entrada por
> fila de la matriz: ni una más ni una menos.

Si la actividad lleva las rúbricas de todos los temas propuestos, el modelo recorrería también las
filas de los temas que el alumno **no** eligió y las marcaría `ausente`. Resultado: una corrección con
la inmensa mayoría de contenidos ausentes y una nota cercana a cero, para un tema perfectamente
desarrollado.

**Capa:** prompt (la regla es del motor, no de esta academia) + contexto (la convención de nombres sí
es de la academia).

**Propuesta:** añadir a `grading.topic.system` una sección previa a §2 —selección de matriz— que diga,
en esencia: cuando el material adjunto contenga varias rúbricas identificables por su nombre de
fichero, primero determina qué tema desarrolla la transcripción, declara cuál has elegido y con qué
evidencia, y aplica **sólo** esa rúbrica; el resto del material no genera filas de cobertura. Si no
puedes determinarlo con seguridad, no elijas: declara la ambigüedad, deja `cobertura` vacío y baja la
confianza, que es exactamente lo que §1.3 ya hace cuando falta matriz.

Y en el contexto `simulacro-tema`, la convención: `tXX.tex` es la solución del tema XX y
`rubricaXX.tex` su rúbrica; el número del nombre del fichero es la identidad del tema.

**Por qué en el prompt y no sólo en el contexto:** porque §2.1 es una orden del prompt, y una regla
del contexto que la contradiga deja al modelo entre dos instrucciones incompatibles. El caso «varias
matrices, elige una» es genérico de cualquier examen con temas a elegir, no propio de esta academia.

### 6.4 · El prompt contradice al motor sobre el reparto de puntos

**Evidencia:** el motor, sin reparto, envía «Propón un máximo para cada apartado…»
(`anthropic.ts:402`) y `alignItems` acepta los apartados propuestos. Pero el prompt dice:

- §6.1: «`items` devuelve **exactamente** sus apartados» (los del reparto).
- §4.3: «Si el reparto de puntos **no declara un apartado de estructura**, no apliques estos
  descuentos a la nota».
- §1.5 cubre «sin pesos», pero no «sin reparto en absoluto».

**Consecuencia doble:** el modelo recibe dos instrucciones contrarias sobre de dónde salen los
apartados; y, por §4.3, **la presentación dejaría de puntuar**, que es justo lo contrario de lo que
dice T7 («la presentación sí puntúa aquí»).

**Capa:** prompt. **Arreglo:** una rama explícita para «sin reparto»: los apartados y sus máximos
salen de la rúbrica del tema elegido, suman `maxScore`, y entre ellos hay uno de estructura si la
rúbrica lo contempla o si T7 lo exige.

### 6.5 · «Comparar contra la solución» choca con la anti-alucinación

El profesor quiere comparar cada sección con la solución aportada. El prompt lo restringe:

- §1.1: la solución de referencia «sirve **sólo para verificar** rigor y demostraciones, nunca para
  definir cobertura ni para citarla como texto del alumno».
- §8.2: «Las citas salen sólo de la transcripción: nunca de la matriz, de la solución de referencia ni
  de tu conocimiento del temario.»

Esa restricción existe por una razón excelente: impide que el modelo dé por escrito lo que está en la
solución y no en el examen, que es el modo de fallo más caro de todos. **La petición no es
incompatible si se formula bien:**

> La rúbrica define **qué** se espera. La solución define el **estándar** contra el que se juzga lo
> que el alumno escribió. Las citas salen **siempre** del alumno. Un contenido que aparece en la
> solución y no en la transcripción es `ausente`, nunca `presente`.

**Capa:** contexto (es método docente), con una posible precisión en §1.1 del prompt para que
«comparar contra» y «sólo para verificar» no se lean como contradictorias.

### 6.6 · Reglas del profesor que hay que colocar, y dos que no se pueden cumplir

Los avisos b, c, e, f, g, h, i, j son **política de esta academia**: van al contexto
`template: simulacro-tema`, junto a T1–T11, con los textos literales de §4. Propuesta de reparto:

| Regla | Destino |
|---|---|
| b, c, e, f | **T12 nueva**: ortografía y convenciones de escritura, con las cuatro frases literales |
| g | Refuerza T2/T3 con el párrafo literal sobre nivel de Bachillerato |
| h | T7 ya descuenta la falta de índice; añadir el comentario literal |
| i | T8 ya menciona la relación con el currículo; añadir la frase literal |
| j | T9, concretando: Boyer, 2-3 referencias matemáticas, normativa estatal y autonómica |

**Dos cosas no se pueden hacer como se piden:**

- **Márgenes (d).** Es un defecto de la página manuscrita, no del texto. La transcripción produce
  LaTeX; salvo que conserve geometría —y no parece—, el modelo no tiene con qué detectarlo. Sería
  cambio de código, si es que es posible. **Aplazado por decisión del profesor.**
- **«Comprobar que las referencias existen» (j).** Sin búsqueda web, el modelo no verifica existencia:
  sólo plausibilidad. Lo honesto es que **marque las dudosas para que las revise el profesor**, nunca
  que afirme que existen. Afirmarlo sería exactamente el tipo de invención que el resto del motor
  está diseñado para impedir.

### 6.7 · La cabecera del feedback no la puede escribir la IA

Dos obstáculos, ambos verificados:

1. §11 del prompt: `aiLatex` es «un fragmento LaTeX sin preámbulo, `\section*{}` por apartado».
2. **El motor no manda el nombre del alumno.** `GradeInput` lleva `studentRef`
   (`provider.ts:54`), un identificador interno. Es una decisión de privacidad deliberada. El hueco de
   «Hola _____» no se puede rellenar con lo que el modelo recibe.

**Propuesta:** la cabecera la pone la plantilla de publicación, no la IA. Si se quisiera dentro del
`aiLatex`, sería cambio de código y una revisión de la postura de privacidad.

### 6.8 · Defecto real en el prompt: un hueco en §5.1

`grading.topic.system` §5.1 dice, literalmente:

> Evalúa **cómo se ha repartido** el tiempo declarado en **,** no cuánto se ha escrito […] Si  llega
> vacío, **no evalúes el ajuste al tiempo**

Falta el nombre del campo, dos veces. Comprobado en bytes: el hueco está vacío en
`apps/api/src/prompts/seeds.ts:694`, así que viene de origen y afecta a toda instalación nueva.
Hay que rellenarlo con el campo real o retirar la sección si ese dato no existe.

---

## 7. Decisión sobre cómo cargar los materiales (pregunta 1 del profesor)

La pregunta era qué es más óptimo y barato. Nada está cargado todavía, así que se decide en limpio.

### Lo que fija el coste

El material adjunto viaja **entero, en cada corrección**, dentro del prefijo cacheado. La aritmética
por corrección, con `claude-opus-4-8` a 5 $/MTok de entrada:

- **Acierto de caché:** ~0,1× → 0,50 $ por millón de tokens de material.
- **Fallo de caché:** 1,25× la primera vez (escritura) → 6,25 $ por millón.

El caché es efímero, con vida de **cinco minutos** (el código no fija `ttl`). Y aquí está el detalle
que decide: con **8-10 entregas semanales repartidas entre nueve actividades**, dos entregas de la
misma actividad rara vez se corregirán con cinco minutos de diferencia. **Hay que presupuestar
fallo de caché casi siempre.**

Regla práctica: **cada 10 KB de LaTeX adjunto ≈ 3.000 tokens ≈ 0,019 $ por corrección** con fallo de
caché. Un `tXX.tex` de 40 KB y su rúbrica de 5 KB salen a unos 0,085 $ por corrección **por cada tema
ofertado**, se use o no.

### Recomendación

**Ahora, sin tocar código: subir a cada actividad únicamente los `tXX.tex` y `rubricaXX.tex` de los
temas que esa actividad oferta.** No el temario entero, no los de otros meses. Con dos a cuatro temas
por buzón el sobrecoste es de céntimos por corrección y no compensa ninguna ingeniería.

Mantener los nombres `tXX.tex` y `rubricaXX.tex` tal como ya están: **el nombre del fichero llega al
modelo** en la cabecera `## Material adjunto · rubrica34.tex`, y es lo que hace posible la selección
de §6.3 sin cambiar el motor.

**Umbral para cambiar de estrategia:** si un buzón llegara a ofertar más de seis u ocho temas, o si el
total adjunto superara los ~40.000 tokens, deja de compensar y conviene la optimización de abajo.

### Optimización con código (no para ahora)

El motor transcribe **antes** de corregir, así que en el momento de montar la llamada de corrección
ya se sabe qué escribió el alumno. Un cambio acotado en `renderActivityMaterial`
(`engine.ts:383`) podría filtrar los ficheros por el tema identificado y mandar sólo `tXX.tex` y
`rubricaXX.tex` del tema elegido.

Ventajas: coste dividido por el número de temas ofertados, y **desaparece por completo el riesgo de
§6.3** — el modelo ya no puede confundir rúbricas porque sólo recibe una. Inconveniente: hay que
decidir qué pasa cuando la identificación falla, y probablemente sea «mandarlo todo y que el prompt
decida», que es el comportamiento de ahora.

**Juicio:** merece la pena en cuanto el volumen crezca o el número de temas por buzón suba. Hoy no
bloquea nada, y hacerlo ahora retrasaría la primera corrección real detrás de un ciclo de despliegue.

---

## 8. Plan por fases

### Fase A — Configuración (hoy, coste cero, sin despliegue)

1. Asignar la plantilla `simulacro-tema` a las nueve actividades.
2. Subir a cada actividad los `tXX.tex` y `rubricaXX.tex` **de los temas que oferta**, como texto.
3. Dejar el reparto de puntos vacío, como estaba previsto. `maxScore` es 10 y el motor lo respeta.

Al terminar, `GET /api/contexts/resolved/{activityId}` debe mostrar el segmento `template`
`simulacro-tema`, y la actividad debe listar sus ficheros con contenido.

### Fase B — Contexto (sin despliegue)

4. Ampliar `template: simulacro-tema`: T12 de ortografía, refuerzo de T2/T3/T7/T8/T9 con los textos
   literales, la convención de nombres `tXX`/`rubricaXX`, la regla de comparación de §6.5 y la
   política de «no se comenta lo que está bien».

### Fase C — Prompt (sin despliegue: se sube por API)

5. `grading.topic.system`: selección de matriz (§6.3), rama «sin reparto de puntos» (§6.4), matiz de
   §1.1 sobre comparar contra la solución (§6.5), y el hueco de §5.1 (§6.8).

Cada cambio se presenta en diff, con las entregas de control con las que se verifica, antes de
subirlo. El rollback es volver a publicar el fichero que guardó el `pull` previo — `restore` vuelve a
la semilla del código, no a la versión anterior.

### Fase D — Verificación con una entrega real

6. Una entrega, `reprocess` con `scope=grade_only`, leer la traza completa del registro de IA
   (`sent` y `received`), comparar apartado por apartado. Ajustar. Coste medido en el entorno de test:
   0,35-1,00 € por entrega.

### Aparte, cuando toque

7. El hueco de §5.1 y el prompt huérfano `pd.regulation.system` son cambios de código
   (`seeds.ts`) además del arreglo por API: la semilla afecta a instalaciones nuevas.
8. La fragilidad de `templateKey.includes('tema')` (§6.1).
9. Filtrado de material por tema identificado (§7).
10. Márgenes (§6.6), aplazado.

---

## 9. Preguntas abiertas para el revisor

1. **§6.3 es la decisión de fondo.** ¿Es correcto resolver la selección de tema con una instrucción de
   prompt sobre nombres de fichero, o el riesgo de que el modelo elija mal justifica hacer ya el
   cambio de código que manda un solo tema? ¿Qué debería ocurrir si dos temas del temario comparten
   contenidos y la identificación queda ambigua?
2. **§6.4.** Con el reparto de puntos ausente, los apartados los propone el modelo a partir de la
   rúbrica. Eso significa que **dos entregas del mismo buzón con temas distintos tendrán apartados
   distintos**, y que la comparabilidad entre alumnos depende de la coherencia de las rúbricas. ¿Es
   aceptable, o conviene forzar una estructura de apartados común?
3. **§6.5.** ¿La reformulación propuesta —rúbrica define qué, solución define el estándar, citas
   siempre del alumno— preserva de verdad la garantía anti-alucinación, o abre una puerta a que el
   modelo dé por cubierto lo que ha leído en la solución?
4. **«No se comenta nada que esté bien»** interactúa con el verificador, que comprueba que el feedback
   concuerda con la puntuación. Un apartado perfecto con feedback vacío, ¿lo interpretará el
   verificador como incoherencia? Conviene revisar `verify.system` antes de escribirlo.
5. **Coste.** El cálculo de §7 supone fallo de caché casi siempre por la vida de cinco minutos y el
   volumen semanal. ¿Merece la pena subir el `ttl` del bloque cacheado a una hora, dado que el lote
   agrupa por actividad?

---

## Apéndice · Cómo reproducir las comprobaciones

Todo lo verificado de producción sale de `scripts/vega-admin.sh` (ver `docs/depuracion-prompts.md`):

```bash
scripts/vega-admin.sh health
scripts/vega-admin.sh prompts
scripts/vega-admin.sh pull                                  # los 9 prompts a var/prompts/<host>/
scripts/vega-admin.sh raw GET /api/activities
scripts/vega-admin.sh raw GET /api/activities/<id>
scripts/vega-admin.sh raw GET /api/activities/<id>/files
scripts/vega-admin.sh raw GET /api/contexts
scripts/vega-admin.sh resolved <id-actividad>
```

Ficheros de código citados: `packages/core/src/ai/anthropic.ts` (montaje de la llamada, líneas
400-460), `packages/core/src/ai/provider.ts:169` (`gradePromptKey`),
`packages/core/src/grading/engine.ts:383` (`renderActivityMaterial`) y `alignItems`,
`apps/api/src/prompts/seeds.ts` (semillas de los prompts).
