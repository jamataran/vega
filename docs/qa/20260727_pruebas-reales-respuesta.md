# Respuesta a la segunda batería de pruebas

Contesta a `20260727_pruebas-reales.md`. Lo que se ha implementado va marcado como **hecho**; lo que
es análisis, como **análisis**; lo que necesita una decisión tuya, como **pendiente**.

---

## 1. La explicación del nivel, dentro del prompt · hecho

El texto que veías no era ayuda de la pantalla: era **el contenido del contexto global**, y viajaba
al modelo en cada llamada. La instalación se sembraba con `contexts/installation.md`, que empezaba
explicando qué era el nivel `installation` y por qué era cacheable. Se pagaba por contarle a la IA
cómo está montada Vega.

- La explicación de los cinco niveles, la precedencia y qué escribir en cada uno está ahora en un
  diálogo de ayuda en `/contexto`.
- `contexts/installation.md` empieza directamente por el estándar de rigor.
- **Los contextos que nadie haya editado se vuelven a sembrar en cada arranque.** Antes la siembra
  era `ON CONFLICT DO NOTHING`, así que un arreglo del fichero sólo llegaba a instalaciones nuevas y
  el entorno de test se quedaba con el texto defectuoso para siempre. La condición es que la versión
  activa venga de la siembra (`source = 'seed'`); en cuanto guardas desde la aplicación, la base de
  datos manda y no se toca. Lo mismo para los prompts, con `updated_by IS NULL`.

## 2. Repaso de congruencia de los contextos · hecho a medias

Sobre los ficheros del repositorio he corregido tres incongruencias reales:

- **`buzón` seguía usándose como sinónimo de actividad** en `global.md` (§1.2, §4.1, §4.5) y en las
  plantillas. El profesor no ve esa palabra en ninguna pantalla, así que el modelo estaba recibiendo
  instrucciones sobre un objeto que no existe en la interfaz.
- **Referencias a nombres de fichero** (`global.md §6 y §7`) dentro del texto que se envía al
  modelo. Los ficheros no viajan: viaja un único bloque de texto. Ahora dicen «las instrucciones
  globales, §6 y §7», que sí es resoluble dentro del propio prompt.
- La meta-documentación del punto 1.

**Lo que no he podido revisar son los contextos que has editado tú en test**, que viven en la base de
datos y no en el repositorio. Para eso: `/contexto` → «Contexto efectivo» → elige una actividad; ahí
sale literalmente lo que se envía al modelo, con los cinco niveles resueltos. Pégamelo y lo reviso.

### 2.1 Apartados con el mismo peso · hecho

Añadido en tres sitios, porque la regla tiene que aplicar aunque falte el reparto:

- `contexts/global.md` §1.2: sin reparto o sin pesos declarados, la nota se divide a partes iguales.
- Prompts `grading.problem.system` (§1.3.1) y `grading.topic.system` (§1.5), con la aclaración de que
  ser más largo o estar peor resuelto no hace que un apartado valga más.
- En la ficha de actividad: el estado vacío ya no dice «la IA repartirá como mejor le parezca», y hay
  un botón **«A partes iguales»** que reparte la nota máxima en cuartos de punto cuadrando la suma.

Los prompts que no hayas editado a mano se actualizarán solos en el próximo despliegue.

## 3. «forum-29» · hecho

Salía dos veces porque el `slug` interno **se calcula desde** la referencia de Moodle: la cabecera
enseñaba `forum-29 · Moodle forum-29`. Ahora hay un solo identificador y con nombre: «Foro 29 en
Moodle». Las incidencias de los procesos también dejan de enseñar el `slug` y enseñan el nombre de la
actividad, enlazado a su ficha.

## 4. ¿Están bien planteados los procesos? · análisis

El diseño es correcto en lo esencial: ingesta y corrección en la misma pasada (una entrega de hace un
minuto se corrige esta noche y no la siguiente), un solo proceso a la vez para no pagar dos veces lo
mismo, y lo que se queda a medias vuelve a la cola en vez de darse por fallido. Cuatro reservas:

1. **Un reproceso individual bloquea, y es bloqueado por, el proceso nocturno.** El cerrojo es de
   instalación: si el planificador está corriendo, un profesor que pulsa «Volver a procesar» recibe
   «Ya hay un proceso de corrección en marcha». Es correcto para el gasto pero malo de explicar. Lo
   razonable sería encolar la petición en lugar de rechazarla.
2. **Cada reproceso individual abre su propia fila en Procesos.** Con uso real, la lista se llena de
   procesos de una sola entrega y el proceso nocturno —el que interesa— queda enterrado. Convendría
   separarlos o filtrarlos.
3. **`MAX_PER_RUN = 25`.** Un atasco de 200 entregas necesita ocho pasadas. Con la cadencia de
   entregas por defecto (cada hora) son ocho horas. No es un fallo, pero conviene saberlo antes de
   subir un histórico.
4. **«Autopublicadas» es una columna muerta hoy.** La publicación autónoma está fuera de alcance
   (`motor-ia.md` D15) y toda actividad opera como `review_all`, así que ese número será siempre
   cero. Ocupa una quinta parte de la tarjeta.

## 5. La operativa de la cola · hecho

- **5.1** La pestaña «Pendiente» dice ahora cuándo pasará Vega, por tipo de actividad y con la
  cadencia («Entregas: cada hora · la próxima a las 03:00»). Si hay un proceso en marcha, lo dice; si
  el planificador está parado, también.
- **5.2** «Aparcada» pasa a llamarse **«Descartada»** en toda la interfaz. Administración puede
  devolverla a pendientes desde la propia fila, con confirmación: borra la corrección y la
  transcripción, así que cuesta otra pasada del motor.
- **5.3** Los fallos se pueden **marcar como vistos** (y deshacerlo). No cambia el estado: sigue en
  «Error», pero deja de contar. Si la entrega vuelve a fallar, la marca se borra sola. Administración
  puede además devolverlos a la cola.
- **5.4** Las validadas se pueden cerrar con **«Ya la he entregado»**: Vega no manda nada a Moodle y
  queda anotado que la nota salió por otro camino, para que las métricas no cuenten como enviado algo
  que nadie envió.
- **5.5** El número de cada pestaña es **trabajo pendiente**, no filas: los fallos vistos no suman y
  «Publicadas» no lleva contador, porque es un archivo. Un cero tampoco se pinta.
- **5.6** Las pestañas van en el orden del trabajo: **Por revisar → Validada → Pendiente → Error →
  Descartada → Publicada**. Las tres acciones que antes obligaban a abrir la ficha están en la propia
  fila. La ayuda («?» junto a las pestañas) explica el camino completo de una entrega.

  Un renombrado que conviene tener presente: **«Descartar propuesta» ahora es «Devolver a
  pendientes»**, que es lo que hace. «Descartar» queda libre para el estado del punto 5.2.

## 6 y 7. Panel del profesor · hecho

`/panel` es ahora el panel del profesor:

- **Por hacer**: correcciones por revisar, validadas sin publicar y errores sin revisar, cada una con
  su número y su enlace directo a la pestaña correspondiente.
- **En camino**: cuántas pendientes y cuándo se corregirán.
- **Último proceso**: cuándo terminó y qué dejó **en tus entregas** —traídas, corregidas, con fallo—,
  no las cifras del claustro.

Las métricas de instalación (coste, fiabilidad, tokens, cola global) se han movido a **`/metricas`**,
en el menú de administración. Contestan a «cuánto se está gastando la academia», que no es la
pregunta que trae a un profesor.

## 8. Trazabilidad · hecho

Las cifras de un proceso son ahora navegables: **Ingeridas**, **Procesadas** y **Fallidas** abren la
lista de esas entregas concretas, cada una con enlace a su ficha. Ha hecho falta guardar en cada
entrega **qué proceso la trajo** (`ingested_run_id`), porque `batch_run_id` es el proceso que la
corrige y se limpia en cada reproceso.

Cada profesor ve sólo sus entregas en esa lista, aunque las cifras de la cabecera sean las de la
instalación entera.

---

## Migración

`0011_operativa_de_la_cola.sql` añade `submissions.ingested_run_id`, `submissions.error_seen_at` /
`error_seen_by` y `corrections.published_manually`. Todo con `IF NOT EXISTS` y valores por defecto: no
requiere parada ni toca datos existentes.
