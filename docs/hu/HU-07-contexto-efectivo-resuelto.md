# HU-07 — Ver el contexto efectivo de un buzón

| | |
|---|---|
| **Id** | HU-07 |
| **Épica** | Buzones y contexto de corrección |
| **Estado** | refinada |
| **Prioridad** | Should |
| **Estimación** | 2 |
| **Depende de** | HU-06 |
| **Bloquea a** | HU-12 |
| **Entrega mockeada** | Parcial |

## Narrativa

**Como** profesor
**quiero** ver exactamente lo que la IA va a leer antes de corregir un buzón
**para** entender por qué una corrección ha salido como ha salido, y poder arreglarla mirando el
sitio correcto.

Con tres niveles de contexto más la solución de referencia y el reparto de puntos, cuando una
corrección sale rara hay cinco sitios donde puede estar el problema. Sin esta pantalla, depurar un
criterio de corrección es adivinar.

Es una HU pequeña con un efecto desproporcionado: convierte «la IA ha corregido mal» en «la
instrucción del nivel global contradice la del buzón, y está en la línea 12». Es la herramienta de
depuración del producto, y es barata porque el endpoint ya está en el contrato.

## Criterios de aceptación

### Escenario 1: los tres niveles resueltos

```gherkin
Dado que existe el buzón "tema04" con taskType "simulacro_tema"
Y existe contexto global, contexto de task_type "simulacro_tema" y contexto de mailbox "tema04"
Cuando envío GET /api/contexts/resolved/{id del buzón}
Entonces recibo 200 con ResolvedContextResponse
Y "global" contiene el contenido del nivel global
Y "taskType" contiene el del contexto "simulacro_tema"
Y "mailbox" contiene el del contexto "tema04"
Y "merged" contiene los tres en ese orden
```

### Escenario 2: un nivel sin contenido

```gherkin
Dado que el buzón "problema12" no tiene contexto de nivel mailbox
Cuando envío GET /api/contexts/resolved/{id}
Entonces recibo 200
Y "mailbox" es una cadena vacía
Y "merged" contiene sólo los niveles global y task_type
Y la respuesta NO es un error
```

### Escenario 3: el tipo de tarea determina qué se resuelve

```gherkin
Dado que el buzón "tema04" tiene taskType "simulacro_tema"
Cuando cambio su taskType a "simulacro_problema"
Y vuelvo a pedir GET /api/contexts/resolved/{id}
Entonces "taskType" contiene ahora el contexto de "simulacro_problema"
Y "mailbox" no ha cambiado
```

### Escenario 4: el merged refleja lo que se envía

```gherkin
Dado que he consultado el contexto resuelto de un buzón
Cuando se corrige una entrega de ese buzón
Entonces las instrucciones enviadas al modelo se corresponden con el "merged" consultado
Y cualquier diferencia entre ambos es un defecto
```

### Escenario 5: buzón inexistente

```gherkin
Dado que he iniciado sesión
Cuando envío GET /api/contexts/resolved/{id inexistente}
Entonces recibo 404 con error.code = "NOT_FOUND"
```

### Escenario 6: navegar de la corrección al contexto

```gherkin
Dado que estoy revisando una entrega cuya corrección no me convence
Cuando abro el contexto efectivo desde esa pantalla
Entonces veo el contexto resuelto del buzón de esa entrega
Y puedo saltar a editar el nivel que corresponda (HU-06)
```

### Escenario 7: tamaño del contexto

```gherkin
Dado que consulto el contexto efectivo de un buzón
Cuando se muestra el resultado
Entonces veo el tamaño aproximado en tokens de lo que se envía
Y el desglose por nivel
```

## Reglas de negocio

**RN-1.** La resolución es por **buzón**, no por entrega: el `taskType` y el `slug` del buzón
determinan qué contextos se cargan.

**RN-2.** El orden de concatenación en `merged` es **global → task_type → mailbox**, de más general
a más específico. No es configurable.

**RN-3.** Un nivel sin fila o con contenido vacío se resuelve como **cadena vacía**, nunca como
error. Un buzón puede corregirse sólo con el nivel global.

**RN-4.** `merged` debe ser **exactamente** el bloque de instrucciones que se envía al modelo. Si
el motor añade algo más (la solución de referencia, el reparto de puntos, la transcripción), ese
añadido tiene que ser visible en esta pantalla o quedar documentado como parte estructurada
separada. **Una discrepancia entre `merged` y lo enviado es un defecto**, porque destruye la razón
de ser de esta HU.

**RN-5.** Es una vista de **sólo lectura**. Editar se hace en HU-06, sobre el nivel concreto.

**RN-6.** Se resuelve en el momento de la petición. No se cachea: un cambio de contexto se ve al
instante.

**RN-7.** Accesible para cualquier usuario autenticado.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Ningún nivel tiene contenido | `merged` es cadena vacía. La UI avisa de que el buzón se corregiría sin instrucciones ninguna |
| Contradicción entre niveles | No se detecta automáticamente. La pantalla muestra los tres por separado para que el profesor la vea. La regla «gana lo específico» está escrita en `contexts/global.md`, pero no la garantiza el sistema |
| `merged` enorme | Se muestra con el tamaño estimado y aviso por encima del umbral. No se trunca nunca: truncar aquí mentiría sobre lo que se envía |
| Contexto modificado entre la consulta y la corrección | Se corrige con el vigente en el momento de corregir. La consulta no reserva nada |
| Buzón con `taskType` cuyo contexto no existe | `taskType` es cadena vacía. Es un caso de configuración incompleta y la UI lo destaca |

## Fuera de alcance

- **Editar desde esta pantalla.** RN-5.
- **Ver el prompt completo** con el mensaje de sistema, la transcripción y el formato de respuesta
  exigido. Esto muestra las instrucciones de corrección, no el prompt entero. Ver pregunta abierta 1.
- **Comparar el contexto de dos buzones.**
- **Ver con qué contexto se corrigió una entrega concreta en el pasado.** No se guarda. Ver
  pregunta abierta 2.
- **Detectar contradicciones entre niveles.**
- **Estimar el coste de corregir con este contexto.** Relacionado con HU-18.

## Notas de implementación

**Contrato**: `ResolvedContextResponse` (`global`, `taskType`, `mailbox`, `merged`).

**Endpoints** (`routes`): `resolvedContext(mailboxId)` → `GET /api/contexts/resolved/{mailboxId}`.

**Resolución**: leer el `Mailbox` por id; buscar `('global','global')`,
`('task_type', mailbox.taskType)` y `('mailbox', mailbox.slug)` en `grading_contexts`; concatenar
en ese orden con un separador estable.

**Punto crítico de RN-4**: la función que construye `merged` **debe ser la misma** que usa
`packages/core` para armar el prompt. Si son dos implementaciones, divergirán, y esta HU dejará de
servir sin que nadie se entere. Vive en `core` y el API la reutiliza. Un test comprueba que el
prompt enviado por el motor contiene literalmente el `merged` del endpoint.

**UI**: accesible desde el detalle del buzón (HU-04) y desde la pantalla de revisión (HU-15), donde
es más útil: es cuando el profesor tiene delante una corrección que no le cuadra. Se muestra con
los tres niveles plegables, cada uno etiquetado con `CONTEXT_LEVEL_LABEL`, y el `merged` completo
al final. Estimación de tokens con una aproximación por caracteres, no con un tokenizador real.

**Mock**: parcial. El endpoint es real y devuelve la concatenación real de los contextos sembrados;
lo que no existe en la entrega mockeada es la garantía de RN-4, porque el proveedor `mock` no
construye un prompt de verdad. El test que comprueba la correspondencia entra con el proveedor real.

## Preguntas abiertas

1. **¿Debe verse el prompt completo o sólo las instrucciones?** `merged` cubre los tres niveles de
   contexto, pero al modelo también le llegan la solución de referencia, el reparto de puntos, la
   transcripción y el formato de respuesta exigido. Un profesor que depura una corrección rara
   querrá ver **todo**. Opciones: (a) ampliar la respuesta con el prompt final completo, lo que
   cambia el contrato y expone detalles de implementación que envejecen; (b) mostrar el `merged`
   más las partes estructuradas por separado, que es lo que hace hoy la UI; (c) un modo de
   depuración sólo para `admin` que enseñe el prompt literal. La (c) es tentadora pero convierte el
   prompt en superficie pública del producto.

2. **¿Debe guardarse con qué contexto se corrigió cada entrega?** Hoy no se guarda, así que una
   corrección de hace un mes no se puede explicar: el contexto ha cambiado. Para depurar
   desviaciones y para defender una nota ante una reclamación, sería valioso. Opciones: (a) guardar
   un hash del `merged` en `corrections` —barato, permite saber si cambió, no qué cambió—; (b)
   guardar el `merged` entero, que multiplica el tamaño de la tabla por un factor grande; (c) nada,
   y confiar en el historial de contextos si se decide tenerlo (HU-06, pregunta 2). La (a) parece
   el equilibrio, pero exige una columna nueva y una migración.

3. **¿Hace falta estimar tokens de verdad?** El escenario 7 pide un tamaño aproximado. Una
   estimación por caracteres se equivoca sistemáticamente con el LaTeX, que tokeniza mal. Usar el
   contador real del proveedor cuesta una llamada de red por consulta. ¿Basta con la aproximación
   advirtiendo de que lo es?

4. **¿Debería esta pantalla avisar de contradicciones evidentes entre niveles?** Detectar
   contradicciones en lenguaje natural es un problema abierto, pero hay casos triviales: la misma
   cifra de penalización con valores distintos en dos niveles, o instrucciones opuestas sobre el
   mismo concepto. ¿Merece la pena intentarlo, o es la clase de funcionalidad que falla en silencio
   y da falsa seguridad?
