# HU-15 — Pantalla de revisión en el móvil

| | |
|---|---|
| **Id** | HU-15 |
| **Épica** | Revisión y validación |
| **Estado** | refinada |
| **Prioridad** | Must |
| **Estimación** | 13 |
| **Depende de** | HU-14 |
| **Bloquea a** | HU-16 |
| **Entrega mockeada** | Sí |

## Narrativa

**Como** profesor
**quiero** ver el original, la transcripción y la corrección de una entrega en el móvil, deslizando
entre las tres
**para** poder verificar una corrección de pie, entre clases, sin abrir el portátil.

Esta pantalla es Vega. Todo lo demás es infraestructura para llegar hasta aquí, y el
[ADR 0004](../decisiones/0004-validacion-humana-obligatoria.md) sólo se sostiene si revisar cuesta
segundos: la validación humana obligatoria es la contrapartida de esta pantalla, y viceversa.

El diseño se hace **primero para 375 px** y luego se ensancha. No es una pantalla de escritorio que
se adapta: es una pantalla de móvil que también funciona en escritorio. La operativa completa
—verificar, ajustar, validar— tiene que ser alcanzable con el pulgar de una mano.

Esta HU cubre **ver**. Editar y validar es HU-16.

## Criterios de aceptación

### Escenario 1: todo en una sola llamada

```gherkin
Dado que abro una entrega en status "graded"
Cuando la aplicación llama a GET /api/submissions/{id}
Entonces recibo 200 con SubmissionDetail
Y trae submission, mailbox completo, transcription, correction y scanUrls
Y no hacen falta más llamadas para pintar la pantalla
```

### Escenario 2: tres pestañas deslizables

```gherkin
Dado que estoy en la pantalla de revisión de una entrega
Cuando deslizo horizontalmente
Entonces alterno entre "Original", "Transcripción" y "Corrección"
Y la pestaña activa se indica visualmente
Y el gesto funciona con el pulgar en un dispositivo de 375 px de ancho
```

### Escenario 3: el escaneo original

```gherkin
Dado que la entrega tiene 4 páginas
Cuando abro la pestaña "Original"
Entonces veo las 4 páginas en orden a partir de scanUrls
Y puedo ampliar y desplazarme dentro de una página
Y sé en qué página estoy
```

### Escenario 4: la transcripción con sus marcas

```gherkin
Dado que la transcripción tiene marcas ILEGIBLE y DUDA
Cuando abro la pestaña "Transcripción"
Entonces veo el LaTeX renderizado con KaTeX, página a página
Y las marcas aparecen resaltadas y distinguibles entre sí
Y puedo saltar de una marca a la página correspondiente del original
```

### Escenario 5: la corrección por apartados

```gherkin
Dado que la corrección tiene 4 items
Cuando abro la pestaña "Corrección"
Entonces veo una tarjeta por apartado, en orden de position
Y cada una muestra label, statement, puntos efectivos sobre maxPoints y el feedback
Y los apartados con baja confianza o método alternativo están señalados (HU-13)
```

### Escenario 6: la nota total siempre visible

```gherkin
Dado que estoy en cualquiera de las tres pestañas
Cuando miro la pantalla
Entonces veo la nota total efectiva sobre maxScore en una barra fija
Y esa nota es la que devuelve totalScore sobre los items
Y la barra no tapa el contenido ni exige desplazamiento horizontal
```

### Escenario 7: sin desplazamiento horizontal

```gherkin
Dado que abro la pantalla en un dispositivo de 375 px de ancho
Cuando recorro las tres pestañas con contenido real, incluido LaTeX largo
Entonces en ningún momento hay desplazamiento horizontal de la página
Y las expresiones que no caben se desplazan dentro de su propio contenedor
```

### Escenario 8: entrega sin transcripción ni corrección

```gherkin
Dado que abro una entrega en status "pending"
Cuando se pinta la pantalla
Entonces la pestaña "Original" muestra el escaneo
Y las de "Transcripción" y "Corrección" indican que aún no hay contenido
Y no se muestra ningún error
```

### Escenario 9: entrega en error

```gherkin
Dado que abro una entrega en status "error"
Cuando se pinta la pantalla
Entonces veo errorMessage de forma destacada y legible
Y tengo disponible la acción de reprocesar (HU-11)
```

### Escenario 10: navegar entre entregas

```gherkin
Dado que he llegado desde la cola con un filtro aplicado
Cuando termino con una entrega
Entonces puedo pasar a la siguiente sin volver a la cola
Y el orden es el mismo que tenía la cola
```

### Escenario 11: entrega inexistente

```gherkin
Dado que he iniciado sesión
Cuando abro GET /api/submissions/{id inexistente}
Entonces recibo 404 con error.code = "NOT_FOUND"
Y la aplicación muestra un mensaje claro con vuelta a la cola
```

### Escenario 12: acceso a los escaneos

```gherkin
Dado que tengo una URL de scanUrls de una entrega
Cuando intento abrirla sin sesión válida
Entonces no obtengo el fichero
```

## Reglas de negocio

**RN-1.** Toda la pantalla se pinta con **una sola llamada** a `GET /api/submissions/{id}`
(`SubmissionDetail`). Es lo que hace la apertura instantánea.

**RN-2.** Tres vistas: **Original**, **Transcripción**, **Corrección**, en ese orden, alcanzables
por deslizamiento y por pulsación en la pestaña.

**RN-3.** La **nota total efectiva** está visible en todo momento, en una barra fija, en cualquiera
de las tres vistas.

**RN-4.** La nota se calcula con `totalScore` sobre los items, siempre. **Nunca sumando
`aiPoints`.**

**RN-5.** `transcription` y `correction` son nullable en el contrato: la pantalla debe funcionar con
cualquiera de las dos a `null`.

**RN-6.** Diseño **mobile-first a 375 px**. Toda la operativa alcanzable con el pulgar y **sin
desplazamiento horizontal de la página** (el contenido ancho —LaTeX largo, tablas— se desplaza
dentro de su contenedor).

**RN-7.** El LaTeX se renderiza con KaTeX, con posibilidad de ver el fuente.

**RN-8.** Los apartados se muestran ordenados por `position`.

**RN-9.** Los escaneos (`scanUrls`, `TranscriptionPage.imageUrl`) **no son públicos**: son entregas
de alumnos. La política de acceso concreta está sin decidir (ver preguntas abiertas), pero el
requisito es firme.

**RN-10.** Se puede navegar a la entrega siguiente sin volver a la cola, respetando el filtro y el
orden de origen.

**RN-11.** Esta HU es de **lectura**. Editar y validar es HU-16, aunque compartan pantalla.

## Casos límite

| Caso | Qué se hace |
|---|---|
| Entrega de 40 páginas | La vista de original carga las páginas de forma perezosa. Se indica el total |
| LaTeX inválido en la transcripción | El fragmento se muestra señalado como no renderizable, con el fuente. El resto de la página sí renderiza |
| Un `scanUrl` no carga | Se muestra el hueco de esa página con opción de reintentar. Las demás se ven |
| Feedback muy largo | La tarjeta del apartado se pliega, con las primeras líneas visibles y opción de desplegar |
| Corrección con un solo apartado | Válido (simulacro de tema puntuado en bloque). Una sola tarjeta |
| Corrección sin items | No debería ocurrir. Se muestra como incidencia, no como pantalla vacía |
| Conexión intermitente | La pantalla ya cargada sigue siendo navegable. Lo que falla es guardar, y eso es HU-16 |
| Pantalla ancha (escritorio, tableta) | Las tres vistas pueden mostrarse en paralelo. Es una mejora, no el diseño de partida |
| La entrega cambia de estado mientras está abierta | No se refresca sola. Al intentar guardar o validar puede haber 409 (HU-16) |

## Fuera de alcance

- **Editar puntuaciones, feedback y validar.** Es HU-16.
- **Editar la transcripción.** Es HU-11.
- **Anotar sobre el escaneo.** No hay dónde guardar anotaciones.
- **Comparar con la solución de referencia lado a lado.** Está en `mailbox.referenceSolution` y es
  accesible, pero no hay vista de comparación.
- **Modo sin conexión.** La PWA es instalable, pero no hay caché de entregas ni cola de cambios
  diferidos.
- **Ver la corrección de otra entrega del mismo alumno.**

## Notas de implementación

**Contrato**: `SubmissionDetail` (`submission`, `mailbox`, `transcription`, `correction`,
`scanUrls`). El `mailbox` viene **completo**, con `referenceSolution` y `pointsAllocation`: el
profesor puede consultar su propia solución sin otra llamada.

**Endpoints** (`routes`): `submission(id)` → `GET /api/submissions/{id}`.

**Funciones del dominio**: `effectivePoints` y `totalScore` de `@vega/shared`, ejecutadas **en el
navegador** para pintar la nota. Es la misma implementación que usa el servidor: por eso no hay dos
redondeos distintos ([ADR 0001](../decisiones/0001-monorepo-typescript.md)).

**Etiquetas**: `SUBMISSION_STATUS_LABEL`, `TASK_TYPE_LABEL`.

**UI**: pestañas deslizables con gesto horizontal y pulsación. Barra inferior fija con la nota total
y, en HU-16, el botón de validar. Tarjeta por apartado con el análisis plegable. KaTeX en toda la
aplicación. Navegación a la siguiente entrega en la propia barra.

**Riesgo de diseño**: la barra fija inferior compite por el espacio con el teclado del móvil cuando
HU-16 entra a editar feedback. Hay que resolverlo desde el principio, no como parche: es el punto
donde esta pantalla se rompe en un dispositivo real.

**Rendimiento**: `SubmissionDetail` con 40 páginas de LaTeX es una respuesta grande. Las imágenes
se cargan de forma perezosa; el LaTeX se renderiza por página visible, no todo de golpe.

**Mock**: completa. Es **la pantalla que justifica la entrega mockeada**: con datos simulados debe
poder recorrerse el circuito entero y decidir si el producto es el que se quiere. Los datos del mock
incluyen una entrega con marcas de OCR, una con método alternativo, una con confianza baja y una en
`error`.

## Preguntas abiertas

1. **¿Cómo se protegen los escaneos?** `scanUrls` e `imageUrl` son `string` en el contrato, sin
   política de acceso definida, y son **exámenes de alumnos**. Opciones: (a) rutas servidas por el
   API que exigen el JWT, lo que impide usarlas directamente en `<img>` sin un interceptor o un
   `fetch` a blob; (b) URLs firmadas con caducidad, que funcionan en `<img>` pero exigen firmar y
   renovar; (c) URLs largas e impredecibles sin autenticación, que es seguridad por oscuridad y no
   es aceptable para datos personales. La (b) es la habitual, y arrastra la decisión de
   almacenamiento de HU-08. **`[bloqueante]`: hoy hay datos personales sin política de acceso.**

2. **¿Cuál debe ser la vista de aterrizaje?** Abrir en «Corrección» es lo más rápido para el
   profesor que confía; abrir en «Original» es lo más honesto, porque le pone delante lo que el
   alumno escribió antes que lo que la IA opina. La primera acelera; la segunda protege contra
   validar sin mirar, que es el riesgo que el ADR 0004 reconoce. ¿Depende de la confianza —abrir en
   «Original» si es baja—? Eso sería un buen equilibrio y es fácil de implementar.

3. **¿Hace falta modo sin conexión?** Corregir en el metro es un caso de uso real y la PWA es
   instalable. Pero implica cachear entregas, encolar cambios y resolver conflictos al volver — un
   salto grande de complejidad, con riesgo de publicar notas basadas en datos viejos. ¿Se descarta
   explícitamente, o entra en la hoja de ruta?

4. **¿Cómo se ve el escaneo y la transcripción a la vez en un móvil?** Verificar que la
   transcripción dice lo que pone el papel exige compararlos, y en 375 px no caben dos columnas.
   Opciones: (a) alternar con un gesto rápido y confiar en la memoria visual; (b) vista partida
   vertical, con la mitad de altura para cada uno; (c) superponer la transcripción sobre la imagen
   con opacidad. Ninguna es evidente, y es la interacción más importante de la pantalla.

5. **¿Debe registrarse qué ha mirado el profesor?** Saber si abrió la pestaña «Original» antes de
   validar permitiría distinguir la revisión real del clic automático, que es la preocupación
   central del ADR 0004. Pero es telemetría sobre el comportamiento de un trabajador, con lo que eso
   implica. ¿Se mide? ¿Se le enseña sólo a él, como ayuda, y nunca a un superior?

6. **¿La navegación a la siguiente entrega debe saltarse las ya validadas?** Si el profesor recorre
   la cola de veinte en veinte, volver a pasar por las que ya validó es ruido. Pero saltárselas
   impide revisar una decisión reciente. ¿Se salta con opción de retroceder?
