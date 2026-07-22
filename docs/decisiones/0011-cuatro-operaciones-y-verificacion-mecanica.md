# ADR 0011 — La interfaz `AiProvider` crece a cuatro operaciones, y la verificación mecánica no es una de ellas

**Estado**: Aceptado

**Sustituye a**: [ADR 0005](0005-proveedor-ia-intercambiable.md) en lo relativo al número de
operaciones. Todo lo demás del 0005 —mock por defecto, mock con datos incómodos, determinismo,
`UsageMetrics` siempre, proveedor visible en `/api/health`, modelo real guardado— sigue vigente y
se refuerza aquí.

## Contexto

El ADR 0005 fijó que la interfaz cubre **exactamente dos operaciones**, `transcribe` y `grade`, y
lo dejó por escrito como una apuesta consciente: «si un proveedor futuro exige un flujo distinto,
la interfaz se queda corta. Se asume; ampliar después es más barato que abstraer de más ahora».

Ha llegado ese momento, por dos exigencias del cliente que el diseño del motor
([`docs/motor-ia.md`](../motor-ia.md)) traduce en etapas nuevas:

1. **«Que no alucine.»** La defensa que hace comprobable esa exigencia es una **segunda opinión con
   contexto disjunto**: un modelo que recibe la transcripción y la corrección propuesta, pero *no*
   el contexto con el que se corrigió, y comprueba coherencia y afirmaciones señaladas. Si esa
   llamada se hiciera desde dentro de `grade()`, compartiría contexto y dejaría de ser
   independiente: el valor entero de la capa desaparece.

2. **Optimizar el coste de las dudas.** Una errata tipográfica no debe costar ni un token de
   corrección. Eso exige clasificar **antes** y con un prompt mínimo **ciego al contexto del
   curso**. Fundir la clasificación en la llamada estándar —que sí lleva el contexto completo—
   destruiría exactamente el ahorro que la justifica: una errata pasaría de coste cero a pagar el
   prefijo entero.

Ninguna de las dos cabe en `transcribe` ni en `grade` sin romper la propiedad que las hace útiles.

Existía una alternativa seria, defendida durante el diseño: **no tocar la interfaz** y resolver el
triaje dentro de la llamada estándar con una salida estructurada `{tipo, escalar, respuesta}`. Es
más barata en gobernanza y ahorra un modelo, pero anula el ahorro de tokens (arriba) y mezcla dos
tareas con presupuestos de contexto opuestos. Se descarta por eso, no por gusto arquitectónico.

## Decisión

### 1. La interfaz pasa a cuatro operaciones

```
transcribe(páginas, contexto)                      -> Transcription + UsageMetrics
grade(transcripción|texto, contextoSegmentado, …)  -> Correction    + UsageMetrics
triage(mensaje, hiloPrevio)                        -> Triage        + UsageMetrics   [NUEVA]
verify(transcripción|texto, correcciónPropuesta)   -> Verification  + UsageMetrics   [NUEVA]
```

Reglas que impiden que las dos nuevas se conviertan en cajones de sastre:

- **`triage` es ciega por contrato.** Su firma **no admite** el contexto resuelto. La ceguera es la
  característica, no una limitación: es lo que la hace costar céntimos. Si algún día necesita el
  contexto, deja de ser triaje y hay que rediscutir este ADR.
- **`verify` recibe contexto disjunto por contrato.** Su firma **no admite** el contexto de
  corrección ni la solución de referencia. Un verificador que ve el contexto del corrector hereda
  su cadena de razonamiento y deja de ser una segunda opinión.
- Las cuatro devuelven `UsageMetrics` y validan su salida con el mismo esquema Zod en las dos
  implementaciones, igual que exigía el 0005.
- El **mock implementa las cuatro** de forma determinista, y las nuevas también devuelven datos
  incómodos: al menos un caso de `escalar: true`, uno de confianza de triaje por debajo del umbral
  y uno de verificación con veredicto grave.

### 2. `GradeInput.context` deja de ser un único string

Hoy es un solo bloque de texto (`packages/core/src/ai/provider.ts:97`), cacheado entero. El diseño
de caché con dos `cache_control` —uno tras el nivel de plantilla, otro tras el de actividad—
requiere que el contexto viaje **segmentado** hasta el proveedor. Es un cambio de interfaz, no de
prompt: sin él, la estrategia de caché no es implementable.

### 3. La verificación mecánica **no** es una operación de la interfaz

Esta es la mitad importante del ADR y la que evita que la interfaz siga creciendo.

Comprobar que una cita existe literalmente en la transcripción, que la suma de apartados cuadra,
que se respetan los topes y los cuartos de punto **no requiere ningún modelo**. Es código puro y
vive en `packages/core` junto a `alignItems` y `detectReviewFlags`.

| Comprobación | Dónde | Coste | Fiabilidad |
|---|---|---|---|
| ¿Existe cada cita en la transcripción o en los adjuntos? | Código | 0 | Exacta |
| ¿Suma de apartados, topes, cuartos de punto? | Código (ya existe) | 0 | Exacta |
| ¿Apartado a máxima puntuación con descuentos en su feedback? | Código | 0 | Exacta |
| ¿El feedback dice lo que la nota refleja? | `verify()` | ~0,02 € | Probabilística |
| ¿Este paso matemático señalado se sostiene? | `verify()` | incluido | Probabilística |

**Regla general: todo lo que pueda comprobarse por código se comprueba por código.** La llamada al
modelo se reserva para lo semántico y **de forma dirigida** — descuentos de mayor peso, apartados
con método alternativo o confianza baja—, nunca como re-corrección exhaustiva.

Consecuencia operativa deliberada: la capa mecánica **no es desconectable**. `AI_VERIFY=false`
apaga la llamada al modelo; nunca las comprobaciones de código.

### 4. La comparación de citas es sobre texto canónico

Sin esto la decisión anterior es contraproducente. `\frac` frente a `\dfrac`, el espaciado o la
coma decimal frente al punto harían fallar un `includes` ingenuo, produciendo falsos positivos
sistemáticos. Un verificador que canta alarmas falsas enseña al profesor a ignorarlas, y entonces
es **peor que no tener verificador**.

Se normaliza antes de comparar: colapsar espacios, unificar comandos LaTeX equivalentes, unificar
el separador decimal. El esquema de salida exige la cita como **copia carácter a carácter con su
página**, no como paráfrasis.

### 5. La verificación tiene consecuencia sobre la autonomía, no sobre la cola

- Informativa hacia el profesor: **no bloquea** la cola. El verificador también puede equivocarse,
  y quien decide es la persona ([ADR 0004](0004-validacion-humana-obligatoria.md)).
- **Bloqueante hacia la autonomía**, como invariante en código y no en documentación:

```
verificación ausente o fallida        ⇒ no auto-publicación
cita inexistente detectada por código ⇒ confianza global < 0,5 + veto de autonomía
AI_VERIFY=false con autonomy≠review_all ⇒ el arranque lo rechaza
actividad de foro con triaje          ⇒ no admite modo autonomous
```

## Consecuencias

**A favor**

- La alucinación pasa de fallo silencioso a **evento observable**: una cita fabricada es un fallo
  de búsqueda con detección del 100 % sobre la fabricación, y lo detecta código, no un modelo.
- El coste de una errata baja a cero, y el de una duda sencilla a una fracción del de una difícil.
- La parte determinista del sistema —aritmética, topes, emparejamiento de apartados, forma de la
  salida— tiene probabilidad de alucinación **exactamente cero**, no «baja».
- La ceguera y la disjunción quedan en la **firma**, no en un comentario: son difíciles de romper
  por accidente.

**En contra**

- **Cuatro operaciones son el doble de superficie que dos**, y el mock tiene que sostener las
  cuatro o los tests dejan de compilar. Es el coste directo de esta decisión.
- **Un tercer rol de modelo** (triaje) añade configuración y una caché más que no se comparte con
  las otras: cada rol tiene la suya, así que una duda escalada paga prefijo frío en el modelo
  experto.
- **`verify()` es un modelo estándar opinando sobre la salida de uno experto** — verificar «hacia
  abajo». Por eso se restringe a pasos señalados y a coherencia, nunca a re-corregir la matemática:
  la defensa del método alternativo sigue siendo la regla de `global.md` §5.4 y la métrica
  `avgTeacherDeviation`, no el verificador.
- **La comprobación mecánica verifica la letra, no el soporte.** Que una cita exista no prueba que
  sostenga lo que se afirma con ella. Hay que documentar ese alcance con precisión y no venderlo
  como más de lo que es.
- Segmentar `GradeInput.context` obliga a tocar el motor, el proveedor real, el mock y la CLI en el
  mismo cambio.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Mantener dos operaciones y meter el triaje en la llamada estándar | Anula el ahorro: una errata pasaría de coste cero a pagar el prefijo completo |
| `verify()` dentro de `grade()` | Compartiría contexto y dejaría de ser una segunda opinión independiente: se pierde la propiedad que la justifica |
| Verificación sólo por modelo, sin capa mecánica | Duplica el coste por entrega para comprobar cosas que son código exacto, y sustituye una comprobación exacta por una probabilística |
| Verificación sólo mecánica, sin modelo | No detecta incoherencia semántica entre nota y feedback, que `global.md` §10.2 llama «el peor error posible» |
| Usar la función `citations` nativa de la API | Es incompatible con la salida estructurada (devuelve 400) y no comprobaría lo que importa: que la cita exista en el texto **del alumno** |
