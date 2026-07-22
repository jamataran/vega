# Revisión de H2: ¿está todo listo para implementar el motor de IA?

Fecha de la revisión: **2026-07-22**. Rama revisada: `feat/h3-motor-ia` en su punto `062bf42`,
que es `main` más el trabajo de diseño del motor (documentos, `prompts/`, ADR 0011 y la factoría
de IA).

La pregunta que contesta este documento es concreta: **cuando alguien se siente a escribir el
motor de IA, ¿se encuentra la casa montada?** Es decir, ¿están la persistencia de prompts, la
importación desde Moodle, las llamadas simuladas, el registro, la depuración y el planificador en
un estado en el que el motor sólo tenga que enchufarse, o hay que construir tubería antes?

No es una lista de deseos: todo lo que se afirma aquí se ha comprobado ejecutando el sistema. Al
final está [cómo reproducirlo](#cómo-se-ha-comprobado).

---

## 1. Veredicto

**La casa está montada en lo que se ve y a medio montar en lo que no se ve.**

Lo que el profesor toca —cursos, actividades, contextos, cola, revisión, validación, ajustes,
alcance por curso— funciona, persiste y está probado a mano. Lo que el motor necesita por debajo
tenía **tres agujeros de tubería** y **un agujero de diseño**:

| | Estado antes de esta revisión | Ahora |
|---|---|---|
| **Ingesta** — nada traía entregas del LMS | Agujero de tubería | **Cerrado** ([§4.2](#42-importación-desde-moodle)) |
| **Publicación** — `POST .../publish` no llamaba a nadie | Agujero de tubería | **Cerrado** ([§4.2](#42-importación-desde-moodle)) |
| **Almacén de binarios** — el lote fabricaba rutas falsas | Agujero de tubería | **Cerrado** ([§4.2](#42-importación-desde-moodle)) |
| **Persistencia de prompts** — no existe | Agujero de diseño | **Sigue abierto** ([§4.1](#41-persistencia-de-prompts)) |

El agujero de diseño es el que importa, porque no se arregla escribiendo tubería: hay que decidir
algo. Los ocho ficheros de `prompts/` que se escribieron con el diseño del motor **no los lee
nadie**, no tienen tabla, no tienen versionado y no hay forma de editarlos desde la aplicación. Y
la única capa que sí está resuelta —`grading_contexts`— resuelve el problema contrario: guarda lo
que escribe el profesorado, no lo que escribe Vega.

Ninguna de las dos cosas es un fallo: los prompts se escribieron como diseño y todavía no tocaba
implementarlos. Lo que sí sería un fallo es empezar el motor sin haber decidido dónde viven.

---

## 2. Qué corre hoy, de extremo a extremo

Con `AI_PROVIDER=mock` y `LMS_CONNECTOR=mock`, este circuito completo se ejecuta y se ha
verificado en esta revisión:

```
descubrir cursos ─► descubrir actividades ─► importar (idempotente)
        │
        └─► INGESTA: listSubmissions() + download() ─► fichero en disco + páginas contadas
                │
                └─► LOTE: contexto resuelto ─► gradeSubmission() ─► transcripción + corrección
                        │
                        └─► cola ─► editar ─► validar ─► PUBLICAR: publishGrade() + publishFeedbackFile()
```

Cifras de una ejecución real de esta revisión (base de datos limpia, conector y proveedor
simulados):

- 20 entregas ingeridas de 5 actividades, 21 corregidas, 0 fallidas, 12 autopublicadas por modo de
  autonomía.
- Segunda ejecución seguida: **0 ingeridas** — la ingesta es idempotente.
- Ficheros guardados en disco, `page_count = 3` leído del PDF de verdad, no inventado.
- Validar y publicar una entrega deja `grade_published_at`, `feedback_file_published_at` y
  `published_at`; republicar responde `409`.

**Las siete operaciones de `LmsConnector` se invocan ya desde `apps/api`.** Antes eran tres.

---

## 3. Qué se ha implementado en esta revisión

Todo lo de abajo es código nuevo de este trabajo, con la migración `0005_ingesta_y_publicacion.sql`.
Está en la rama de revisión, **no en `feat/h3-motor-ia`**.

| Pieza | Dónde | Qué resuelve |
|---|---|---|
| Ingesta desde el LMS | `apps/api/src/ingest/run.ts` | Nadie llamaba a `listSubmissions()`/`download()`. Las entregas sólo entraban por `pnpm db:demo` |
| Almacén de ficheros | `apps/api/src/storage/files.ts` | `storage_path` era siempre `NULL`: de un PDF no se guardaba ni un byte |
| Recuento de páginas | `apps/api/src/ingest/pages.ts` | `page_count` decide cuántas llamadas de visión se pagan. Un fichero ilegible se detecta al ingerir, no al corregir |
| Publicación real | `apps/api/src/publish/publish.ts` | `POST .../publish` marcaba una fecha y no hablaba con ningún LMS |
| Lectura de foros de Moodle | `connectors/moodle3` | `listSubmissions()` **lanzaba** si el `kind` era `forum` |
| Recuperación al arrancar | `apps/api/src/batch/recovery.ts` | Un reinicio a mitad de lote dejaba entregas atrapadas para siempre |
| Un solo lote a la vez | `apps/api/src/routes/batch.ts` | Dos disparos simultáneos corregían lo mismo dos veces, y **pagaban dos veces** |
| Lote sólo para administración | `apps/api/src/routes/batch.ts` | Lo lanzaba cualquier usuario autenticado |
| Ficha del alumno y contexto al modelo | `students` · `apps/api/src/ingest/` · `@vega/shared` | El modelo corregía **sin saber la comunidad autónoma** del alumno, que es lo que decide el tribunal y los criterios. Ver abajo |
| Primeros tests de `apps/api` y de `packages/shared` | 4 ficheros, 32 casos | Los dos paquetes tenían **cero** |

Las decisiones de producto que ha habido que tomar para esto están en
[ADR 0012](../decisiones/0012-ingesta-almacen-y-publicacion-en-dos-fases.md).

---

## 4. Eje por eje

### 4.1 Persistencia de prompts

**Este es el hueco importante y es de diseño, no de código.**

Hay **dos capas de texto** que van al modelo y hoy sólo una está resuelta:

| Capa | Quién la escribe | Dónde vive hoy | Editable desde la app | Versionada |
|---|---|---|---|---|
| **Contexto de corrección** (criterios) | El profesorado | Tabla `grading_contexts` + `contexts/*.md` en git | Sí | Por git, y por `updated_at` en la tabla |
| **Prompt de sistema** (rol y formato) | Vega | Constantes en `packages/core/src/ai/anthropic.ts` | **No** | No |

Y hay una tercera cosa que no es ninguna de las dos: los **ocho ficheros de `prompts/`**
(`entrega-problema.md`, `transcripcion.md`, `verificador.md`, `clasificador-dudas.md`…), escritos
con el diseño del motor. `grep -r "prompts/" apps packages connectors` **no devuelve nada**: no los
lee ningún proceso, ninguna prueba y ningún script de siembra. Son diseño en Markdown.

Lo mismo le pasa a dos ficheros de `contexts/`:

- `contexts/installation.md` — el nivel `installation` que propone `motor-ia.md` §4. El `CHECK` de
  `grading_contexts.level` sólo admite `global | activity_kind | activity`
  (`0002_activities.sql:146`), así que **ese fichero no se puede guardar** ni aunque alguien lo
  intentara.
- `contexts/activity-kinds/assignment-tema.md` — no corresponde a ningún `ActivityKind` y no lo
  carga nadie. `motor-ia.md` lo cita como la prueba de que falta el nivel `template`.

**Y un detalle de despliegue que conviene no descubrir en producción**: `bootstrap()` sólo siembra
los niveles `global` y `activity_kind` (`apps/api/src/db/bootstrap.ts:47-51`). Los contextos de
actividad de `contexts/activities/*.md` los vuelca **sólo** `pnpm db:demo`, que es un script de
desarrollo. En una instalación real esos contextos no llegan.

#### Lo que hay que decidir antes de escribir el motor

1. **¿Los prompts de sistema se persisten o se quedan en código?** Argumento para dejarlos en
   código: los escribe Vega, definen el **formato de salida** que valida Zod, y un profesor que los
   edite rompe el parseo. Argumento para persistirlos: hoy cambiar una coma de un prompt exige un
   despliegue, y ajustar prompts es la actividad principal de los primeros meses.
   **Recomendación**: tabla `prompts (key, version, content, updated_at, updated_by)` con siembra
   desde `prompts/*.md` al arrancar —igual que `contexts/`, mismo patrón, mismo `ON CONFLICT DO
   NOTHING`—, edición restringida a `admin`, y el fichero de git como fuente de verdad de la
   versión por defecto. Es barato y reutiliza fontanería que ya existe.
2. **¿Los niveles `installation` y `template` entran?** `motor-ia.md` §4 los pide y ADR 0011 los da
   por hechos. Exigen migración del `CHECK`, `activities.template_key`, y tocar `resolveContext()`,
   `routes/contexts.ts`, la CLI, la siembra y el frontend. Es el paso 3 del orden de implementación
   de `motor-ia.md` §14.
3. **¿Qué versión de prompt produjo cada nota?** Hoy no se puede reconstruir con qué criterio se
   puntuó una entrega (`diseno-motor-ia.md` §7, punto 10). Con notas de alto impacto y reclamaciones
   posibles, atar `corrections` a la versión de contexto y de prompt que la generó no es un lujo.

> **Lo que sí está resuelto y conviene no romper**: `resolveContext()` es el único sitio donde se
> monta el texto que ve el modelo, y **la pantalla de contexto efectivo y el lote usan la misma
> función**. Lo que el profesor lee en `GET /api/contexts/resolved/{id}` es exactamente lo que se
> envía, incluida la solución de referencia y el contenido de los ficheros de texto. Esa propiedad
> es cara de conseguir y fácil de perder.

### 4.2 Importación desde Moodle

Tres fases, y hasta esta revisión sólo la primera existía.

| Fase | Antes | Ahora | Verificado contra Moodle real |
|---|---|---|---|
| **Catálogo** — cursos y actividades | Cableado desde H2 | Igual | **No** |
| **Ingesta** — entregas y ficheros | Sin cablear | **Cableada** | **No** |
| **Publicación** — nota y PDF | Sin cablear | **Cableada** | **No** |

#### Ingesta

Vive en `apps/api/src/ingest/run.ts` y la ejecuta el lote antes de corregir, de modo que una
entrega que llegó hace un minuto se corrige esa misma noche.

Tres cosas que conviene saber al tocarla:

- **La credencial es la de quien importó la actividad** (`activities.imported_by`). El token de
  Moodle es de cada profesor (ADR 0010) y el planificador corre sin nadie en sesión, así que la
  actividad tiene que llevar consigo con qué credencial se lee. Una actividad cuyo importador se dio
  de baja **se queda sin ingesta**, y lo dice en el parte del lote en vez de fallar en silencio.
- **Sólo se descarga si el `INSERT` ha creado fila.** Al revés se bajaría el examen de toda la clase
  cada noche para tirarlo.
- **Un fichero ilegible se registra igualmente, en `error`.** Descartarlo lo haría invisible: el
  alumno habría entregado y nadie lo sabría.

#### Publicación

Vive en `apps/api/src/publish/publish.ts`. Lo que cambia respecto al `TODO(vega)` que había:

- Se publica **lo efectivo** (`teacherPoints ?? aiPoints`), nunca la propuesta de la IA. Hay un test
  que comprueba que el `aiFeedback` sustituido no aparece por ninguna vía.
- **La publicación son dos operaciones y puede quedarse a medias.** Con una sola marca
  `published_at` no había forma de saber qué se llegó a publicar, así que un reintento habría vuelto
  a mandar la nota. Ahora hay dos marcas separadas y el reintento reenvía sólo lo que falta.
- **Un conector que no admite el fichero de feedback no es un fallo.** Es el caso de Moodle 3 con
  `assignfeedback_file`. La nota se publica, la entrega llega a `published`, y el motivo se guarda
  en `corrections.publish_notice` y se enseña en la pantalla de revisión.

#### El riesgo que no ha bajado

**`connectors/moodle3` sigue sin ejecutarse nunca contra un Moodle real, y ahora tiene más
superficie que antes.** Sigue siendo el riesgo principal del proyecto. Lo que hay escrito y sin
verificar, por orden de probabilidad de dar problemas:

1. **`publishFeedbackFile()` rechaza siempre.** Moodle 3 no expone un web service limpio para
   `assignfeedback_file`. Es la pregunta abierta 1 de HU-17 y sigue sin resolver: hace falta un spike
   contra un Moodle de verdad.
2. **`mod_forum_get_forum_discussion_posts` quedó obsoleta en Moodle 3.8** en favor de
   `mod_forum_get_discussion_posts`, que devuelve otra forma. Habrá que elegir según la versión del
   sitio.
3. **La paginación de debates** asume `page` en base 0 y que Moodle respeta `perpage`. Si el sitio
   ignora `perpage`, el recorrido para en el tope de seguridad de 20 páginas.
4. **`download()` depende de un estado en memoria**: guarda las URL que devolvió `listSubmissions()`
   en la instancia del conector. Funciona porque la ingesta usa la misma instancia, pero es un
   acoplamiento que no está en la firma y que se rompería con un conector por petición.
5. **La escala de la nota.** `publishGrade()` manda la nota tal cual: una nota sobre 10 en una tarea
   configurada sobre 100 en Moodle se publica mal, sin error.
6. **`pendingCount` de una entrega sigue siendo `0`** a propósito, y la interfaz lo enseña. Sigue
   siendo falso.

### 4.2 bis  Qué sabe el modelo del alumno

Añadido después de la revisión inicial, a petición del cliente, y merece su propio apartado porque
**contradice una regla escrita** del proyecto (`HU-08` RN-4, ahora enmendada).

El problema real: la corrección de una oposición de matemáticas **depende de la comunidad
autónoma** —cambian el tribunal y los criterios— y ese dato vive en Moodle como campo personalizado
del perfil (`CCAA` en la instalación del cliente, configurable). No llegaba a Vega, así que el modelo
corregía sin saber contra qué convocatoria.

Lo que se ha hecho: tabla `students`, la ingesta trae el perfil y lo refresca en cada pasada, y
`submissions.student_alias` deja de estar vacío —era la pregunta abierta 6 de HU-08—.

**Lo que Vega guarda y lo que el modelo ve son cosas distintas**, y esa distinción es ahora la
frontera de protección de datos del producto:

| | Se guarda | Va al modelo |
|---|---|---|
| Nombre y apellidos | Sí | **Sí** — decisión explícita del cliente |
| Comunidad autónoma | Sí | **Sí** — es el motivo de todo esto |
| Provincia, población | Sí | **Sí** |
| Correo, teléfono, usuario, `idnumber` | Sí | No |
| NIF, DNI validado, dirección, código postal | Sí | **Nunca** |

Tres cosas que conviene no perder de vista al implementar el motor:

1. **El recorte está en una función con pruebas**, `studentContextFor()` de `@vega/shared`, y no en
   una regla escrita en una HU. Hay tests que fallan si un dato de identidad se cuela, incluso
   ampliando por descuido la lista configurable.
2. **Los datos del alumno viajan aparte del contexto, y no dentro.** El contexto es el prefijo
   cacheado que comparten todas las entregas de una actividad: meter ahí un dato que cambia en cada
   entrega invalidaría la caché en todas. Ese fallo no da error, sólo multiplica la factura. Hay un
   test en `packages/core` que lo fija.
3. **Vega pasa a custodiar datos personales de verdad.** No hay cifrado en reposo, ni política de
   retención, ni forma de borrar un alumno desde la aplicación. Se suma a los secretos en claro del
   ADR 0010, y ahora pesa más.

### 4.3 Llamadas simuladas a la IA

**Es lo mejor resuelto del sistema.** No hace falta tocar nada aquí para empezar el motor.

- `MockAiProvider` (969 líneas) es **determinista**: la misma entrega produce siempre el mismo
  resultado, sembrando un PRNG con el `submissionId`. Genera transcripciones LaTeX creíbles con
  marcas `[ILEGIBLE]`/`[DUDA]` colocadas dentro de su página, correcciones por apartados y un
  documento LaTeX. 16 tests.
- La factoría `aiProviderForInstall()` lee **`app_settings` con respaldo del `.env`**, así que el
  proveedor, los modelos, la clave y `maxTokens` que el administrador configura en la web **se
  usan**. Esto era una deuda declarada en `motor-ia.md` §5 («cablearla es el paso 1») y ya está
  cerrada en la rama de H3.
- El coste simulado lleva prefijo `mock-` en el modelo, que es lo que permitiría al panel distinguir
  ceros reales de ceros simulados. **Ese campo no llega al contrato**: `GET /api/stats/*` no dice si
  está en modo simulado. Es la pregunta abierta de HU-18 y sigue abierta.

Lo que el motor **sí** va a tener que cambiar aquí, y está escrito en ADR 0011:

- `AiProvider` pasa de 2 a 4 operaciones (`triage`, `verify`). **El mock tiene que implementar las
  cuatro o los tests dejan de compilar**, y las nuevas también deben devolver datos incómodos.
- `GradeInput.context` deja de ser un único string y viaja segmentado.

### 4.4 Registro y depuración

Lo que hay:

- **Pino con redacción de secretos** en diez rutas (`authorization`, `password`, `token`,
  `moodleToken`, `apiKey` y sus variantes anidadas), censor `'[oculto]'`. Está bien hecho.
- **Errores tipados** con nueve códigos, incluidos `LMS_AUTH` (422) y `LMS_UNAVAILABLE` (502), que
  es lo que permite al profesor distinguir «tu token no vale» de «Moodle no responde».
- **Rastro por columnas**: `validated_by`, `triggered_by`, `updated_by`, `imported_by`, `seen_at`.
- **La CLI del motor** (`pnpm --filter @vega/core cli grade`), que corrige sin base de datos ni API
  leyendo los contextos de la carpeta. Es el banco de pruebas de prompts y funciona.
- **`GET /api/contexts/resolved/{id}`**, que enseña exactamente el texto que se envía.

Lo que falta, y hace falta **antes** de encender llamadas reales:

| Hueco | Por qué importa con el motor encendido |
|---|---|
| **No hay `ai_call_logs`** | `motor-ia.md` §11 la da por hecha. Sin ella, cuando una corrección salga rara no hay forma de saber qué prompt se mandó ni qué contestó el modelo. Con `AI_LOG_REASONING=false` por defecto y purga programada, como dice el diseño |
| **No hay correlación de peticiones** | Sólo el `reqId` por defecto de Fastify. Una corrección que atraviesa ingesta, lote, dos llamadas al modelo y publicación no se puede seguir de punta a punta en el log |
| **`submissions` no sabe qué lote la procesó** | No hay `batch_run_id`. Cuando un lote salga mal no se puede listar lo que tocó ni reprocesarlo en bloque. Es la pregunta abierta 1 de HU-09, y una migración pequeña |
| **`cache_creation_input_tokens` no se contabiliza** | `toUsage()` sólo guarda `cache_read`. La escritura de caché se factura a 1,25× y hoy **no se paga en el panel**: el coste se infravalora |
| **No hay señal de «modo simulado» en el contrato** | El panel no puede distinguir un cero real de un cero del mock |
| **`GET /api/health` no comprueba nada de IA ni de LMS** | Devuelve el valor de configuración, no una comprobación. Es correcto que no llame a Anthropic en cada sondeo, pero entonces la salud no dice nada del estado real |

### 4.5 Motor de crons

Existe, es correcto en lo que hace, y tiene tres cosas que conviene mirar antes de encender el
motor.

Lo que hace bien: vive dentro del proceso del API (sin Redis ni worker aparte, que para el volumen
de una academia sería coste sin beneficio), se protege con `pg_try_advisory_lock` por si algún día
hay dos réplicas, evita solaparse consigo mismo y marca `lastRunAt` **antes** de ejecutar para no
entrar en bucle si el lote falla.

| Punto | Estado | Consecuencia con llamadas reales |
|---|---|---|
| **Está apagado por defecto** (`schedule.enabled = false`) | Correcto | Nadie se lleva una sorpresa al desplegar, pero conviene saberlo: recién instalado, **no corre nada solo** |
| **Es un intervalo, no una hora** (`schedule.everyMinutes`, por defecto 60) | Discrepa de la documentación | HU-09 habla del «lote de las 03:00» y de una hora fija por variable de entorno. Lo que hay es «cada N minutos» editable desde la web. Con llamadas reales, la diferencia entre corregir a las 3 de la mañana y corregir cada hora es de dinero y de carga sobre Moodle |
| **`POST /api/batch/run` es síncrono** | Sin resolver | **Es el hueco de orquestación que queda.** Hoy responde en milisegundos porque el proveedor es simulado; con llamadas reales, 25 entregas de 4 páginas son minutos de petición colgada, un proxy inverso que corta a los 60 segundos y un profesor que vuelve a pulsar el botón. HU-09 RN-8 pide `202` y respuesta inmediata |

**Recomendación para el `202`**, para que quien lo implemente no tenga que rediseñarlo: dar a
`runBatch` un callback `onStarted(run)` que se dispare justo después del `INSERT` en `batch_runs`;
la ruta espera **sólo** a ese callback, responde `202` con el lote en `running`, y deja el resto
corriendo. El cerrojo de un solo lote a la vez que se ha añadido en esta revisión es lo que hace
seguro no esperar. La pantalla de procesos ya refresca sola.

### 4.6 Orquestación: estados, reintentos y concurrencia

| Punto | Estado |
|---|---|
| Un solo lote en `running` a la vez | **Resuelto aquí.** Devuelve `409` |
| Recuperación de un reinicio a mitad de lote | **Resuelto aquí.** Al arrancar, los lotes parados más de 30 minutos se cierran como `failed` y sus entregas vuelven a `pending` |
| Un fallo de una entrega no aborta el lote | Ya estaba |
| Un fallo de una actividad no aborta la ingesta | **Resuelto aquí** |
| Fallo de configuración vs. fallo transitorio | **Resuelto aquí** en la ingesta (`IngestProblem.kind`). **No se persiste**: se cuenta en `activities_failed` y se registra en el log, pero no hay columna |
| Reintento automático de entregas en `error` | No existe, y es deliberado. Exige guardar la clase de error |
| Procesamiento en serie, sin concurrencia ni backoff | Sin cambios. Con la Batches API bajo evaluación, no tiene sentido optimizarlo ahora |
| **Estados fantasma** | Sin cambios. `transcribed` figura en el `CHECK`, en las etiquetas y en los recuentos, pero **ninguna ejecución real lo escribe**: sólo lo siembra el demo |
| Deduplicación de entregas | **Resuelta aquí** para foros, con `UNIQUE (activity_id, remote_id)` parcial |
| Reentregas del mismo alumno | **Sin resolver.** Es la pregunta abierta 1 de HU-08 y sigue siendo pérdida de datos silenciosa: quien reentrega con el mismo nombre de fichero no crea entrega nueva y su versión buena se pierde |

---

## 5. Lo que queda abierto, por si bloquea el motor

### Bloqueante: hay que decidirlo antes de escribir código

1. **Dónde viven los prompts** ([§4.1](#41-persistencia-de-prompts)). Sin esto, los ocho ficheros de
   `prompts/` siguen siendo documentación.
2. **Si entran los niveles `installation` y `template`.** ADR 0011 los da por hechos y el `CHECK` de
   la base de datos no los admite.
3. **Cómo se trocea un PDF para la transcripción.** Con la ingesta cerrada, el fichero real llega al
   motor como **un documento**, no como N páginas: partirlo exigiría rasterizar, que es la
   dependencia nativa que el proyecto evita (ADR 0001). `page_count` sigue siendo metadato. Quien
   escriba la transcripción tiene que decidir si manda el PDF entero, si trocea por rango de páginas
   con `pdf-lib`, o si acepta el tope de 32 MB y 600 páginas de la API como límite duro.
4. **Si `autonomous` sobrevive.** Contradice de frente al ADR 0004, y hoy el lote marca `published`
   **sin llamar al conector** aunque la publicación ya esté cableada: la autonomía publica en la
   base de datos y no en Moodle. Con la publicación real disponible, esa incoherencia ya no tiene
   excusa técnica, sólo una decisión de producto pendiente (HU-21).

### Importante, pero se puede hacer sobre la marcha

5. `POST /api/batch/run` asíncrono con `202` ([§4.5](#45-motor-de-crons)).
6. Tabla `ai_call_logs` y correlación de peticiones ([§4.4](#44-registro-y-depuración)).
7. `submissions.batch_run_id`.
8. Contabilizar `cache_creation_input_tokens`.
9. Señal de «modo simulado» en el contrato.
10. Reentregas (HU-08, pregunta 1).
11. **Retención y borrado de datos de alumnos** (HU-08, pregunta 3). Con la ficha guardada, un
    derecho de supresión hoy se atiende con SQL a mano. Sube de prioridad desde el ADR 0013.
12. Unificar el umbral 0,75, hoy duplicado en `engine.ts` y `batch.ts`.

### Deuda declarada que no bloquea

- **Los secretos se guardan en claro** (`users.moodle_token`, `anthropic.apiKey`). Un volcado de la
  base de datos expone credenciales de Moodle y de Anthropic. Está en ADR 0010 y en
  `diseno-motor-ia.md` §7.
- **`lint` es `echo` en los siete paquetes.** El CI no comprueba nada de estilo en ningún sitio.
- **`apps/frontend` no tiene tests.** `apps/api` y `packages/shared` tenían cero y ahora suman 32
  casos, todos sobre lógica pura: **no hay ninguna prueba que levante Fastify ni que toque
  Postgres**, así que el cableado que el motor va a modificar sigue sin red.
- **Los escaneos de la interfaz siguen siendo SVG generados al vuelo** (`routes/scans.ts`), aunque
  ahora el PDF de verdad esté guardado. Enseñar el original exige rasterizar o embeber el PDF en un
  visor; no se ha tocado.
- **`course_teachers` no caduca.** El acceso se anota al listar cursos y nadie lo limpia.

---

## 6. Cómo se ha comprobado

Todo en un worktree aislado y contra una base de datos propia (`vega_revision`), sin tocar la del
entorno de desarrollo.

```bash
pnpm install
pnpm typecheck                 # 7 paquetes, sin errores
pnpm test                      # core, moodle3 y api

# Entorno aislado
cat > .env.local <<'EOF'
DATABASE_URL=postgres://vega:vega@localhost:5433/vega_revision
API_PORT=4100
AI_PROVIDER=mock
LMS_CONNECTOR=mock
EOF

pnpm db:migrate && pnpm db:demo
pnpm --filter @vega/api dev

# Circuito completo
curl -X POST localhost:4100/api/batch/run -H "authorization: Bearer $TOKEN"
#   → submissionsIngested: 20 · submissionsProcessed: 21 · submissionsFailed: 0
curl -X POST localhost:4100/api/batch/run -H "authorization: Bearer $TOKEN"
#   → submissionsIngested: 0   (idempotente)
```

Además se ha levantado el frontend contra ese API y se han revisado con Playwright las pantallas de
procesos, cola y panel: renderizan, la cifra nueva de «Ingeridas» cabe en la rejilla y **no hay
ningún error de consola**.

**Lo que no se ha probado, y se dice en voz alta**: nada de esto se ha ejecutado contra un Moodle
real. Era el encargo. Sigue siendo el riesgo principal del proyecto.

---

## 7. Documentación que esta revisión corrige

- `docs/arquitectura.md` § «Estado real» — la ingesta, la publicación, el almacén de binarios y la
  lectura de foros de `moodle3` ya no están donde decía la tabla.
- `docs/hitos.md` — «La ingesta y la publicación no se han tocado. Son H3 y H5» deja de ser cierto.
- `docs/modelo-de-datos.md` — la migración `0005` añade columnas y resuelve el aviso de que «la
  clave natural no protege los foros».
- `docs/hu/HU-08` y `HU-17` siguen redactadas sobre **buzones** (`mailbox_id`, `Mailbox.connector`),
  vocabulario que el código eliminó en la migración `0002`. No se han reescrito en esta revisión;
  quien las toque debería hacerlo antes de implementar sobre ellas.
