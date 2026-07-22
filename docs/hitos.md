# Hitos de desarrollo

Cinco hitos. Cada uno se puede enseñar funcionando; ninguno depende de que el siguiente exista.
Este documento manda sobre el orden de trabajo: las HU dicen *qué*, esto dice *cuándo*.

## Qué es Vega (y qué no)

Vega es un **motor de corrección y de respuesta a dudas de foro** sobre Moodle. Dos trabajos, un
mismo mecanismo, una diferencia que lo decide todo:

| | Entrega (`assignment`) | Foro (`forum`) |
|---|---|---|
| Trae | Fichero del alumno | Texto escrito |
| Vega redacta | Puntuación por apartados + feedback | Una respuesta a la duda |
| ¿Publica nota? | **Sí** | **No, nunca** |
| Transcripción (OCR) | Sí, si es manuscrito | No |

**Matemáticas no está en el producto: está en los prompts.** Todo lo que la IA sabe de la materia
vive en `contexts/*.md`, que el profesorado edita. Un departamento de lengua castellana escribe
otras reglas en los mismos tres niveles y el motor no cambia. El OCR y KaTeX existen porque hay
trabajo manuscrito, no porque Vega sea una herramienta de matemáticas.

## Estado de partida

El código dio el giro de dominio mucho antes que la documentación. La migración
`0002_activities.sql` renombró `mailboxes → activities`, hizo la nota opcional (`graded` +
`max_score` nullable) y añadió `course_name`, `autonomy` y `text_content`; `docs/` seguía hablando
de buzones, `TaskType` y simulacros, hasta el punto de que `grep -i foro docs/` no devolvía nada.

**Esa deriva ya está saldada**: glosario, modelo de datos, arquitectura, contextos y las HU
afectadas se han reescrito sobre el dominio real. Lo que queda no es documentación desactualizada
sino huecos declarados: cada HU lleva sus preguntas abiertas, y las bloqueantes están citadas en el
hito que las necesita.

---

## H1 — Login, maquetación y CI/CD

**Objetivo:** entrar en la aplicación, moverse por ella y que un push a `main` llegue desplegado.
Con datos de semilla; sin IA todavía.

**HU implicadas:** HU-01 (login), HU-02 (usuarios), HU-03 (ajustes y estado), HU-14 (cola de
revisión como pantalla de inicio), HU-18 (panel).

**Estado:**

| | Trabajo | Estado |
|---|---|---|
| a | Renombrar `apps/web` → `apps/frontend` | **Hecho.** Paquete `@vega/frontend`, imagen `vega-frontend`, CI y compose actualizados. `web` queda libre para la landing de SEO |
| b | Anclar la barra de navegación inferior en móvil | **Cerrado sin cambios**: se ancla bien. El CSS era correcto (`fixed inset-x-0 bottom-0`, sin ancestro con `transform`) |
| c | Dejar explícita la distinción foro / entrega | **Hecho en documentación**: glosario, modelo de datos, arquitectura, contextos y HU. Queda repasarlo en la UI |
| d | Rediseñar el panel con zoom sobre el gasto | **Hecho.** Ver abajo |
| e | Linter y tests en el frontend | **Pendiente, sin cambios en H2.** `lint` y `test` siguen siendo `echo` en `apps/frontend` y en `packages/shared`; `lint` lo es además en `apps/api` y `packages/core`. El CI pasa sin comprobar nada del front ni del contrato. Es el agujero que queda para dar H1 por cerrado |

### H1.d — El panel

Hoy `GET /api/stats/overview` devuelve una foto plana del mes en curso: recuentos por estado,
tokens, coste total y desviación media. No hay periodo elegible ni desglose, así que la pregunta
que de verdad importa —*¿en qué se me está yendo el dinero?*— no se puede contestar.

El panel debe permitir **bajar del agregado al detalle en tres saltos**:

```
Periodo (mes en curso · últimos 30 días · trimestre · a medida)
  │
  ├── Gasto total, nº de correcciones, coste medio, ahorro por caché
  │
  ├─► Por tipo de actividad ──────► Entregas 12,40 € · Foros 3,10 €
  │
  ├─► Por curso ──────────────────► Matemáticas I 9,80 € · Lengua II 5,70 €
  │
  └─► Por actividad ──────────────► tema04 4,20 € (38 correcciones · 0,11 €/u)
        │
        └─► Correcciones de esa actividad, con su coste y su estado
```

Cada nivel es un filtro acumulable, no una pantalla distinta. Reglas que ya trae HU-18 y siguen
valiendo: con `AI_PROVIDER=mock` los ceros se marcan como *modo simulado* y no como medida real;
sin correcciones validadas, la desviación se muestra como *sin datos suficientes*, nunca como `0`.

Regla nueva: **la desviación media no aplica a actividades no puntuables.** En un foro no hay
puntos que restar, así que el agregado de desviación excluye los foros y lo dice.

**Implementado**: `GET /api/stats/cost?period=&dimension=` y
`apps/frontend/src/components/overview/CostBreakdown.tsx`. HU-18 reescrita en consecuencia. Quedan
dos preguntas bloqueantes en la HU: cómo se versiona la tarifa que produce `costCents`, y cómo sabe
el panel que está en modo simulado — hoy **no hay ningún campo en el contrato que lo diga**.

---

## H2 — Configuración de actividades

**Objetivo:** dar de alta desde la aplicación las actividades a vigilar, recuperándolas de Moodle.

**HU implicadas:** HU-04 (configuración de actividad) y HU-05 (solución de referencia y reparto),
reescritas sobre `Activity`; HU-06 (editor de contextos); HU-07 (contexto efectivo); **HU-19 (alta
de actividades desde Moodle)**, que es la que cierra el agujero; y HU-03, enmendada porque la
credencial de Moodle ya no es de la instalación.

**Flujo, ya implementado:**

```
Elegir curso  ─►  ver sus actividades  ─►  marcar las que Vega vigila  ─►  configurar cada una
 (de Moodle)      (entregas y foros,        (alta idempotente:            (nombre, puntuable,
                   con las ya dadas          re-sincronizar no             nota máxima, reparto,
                   de alta marcadas)         duplica ni pisa)              contexto, autonomía)
```

**Estado:**

| | Trabajo | Estado |
|---|---|---|
| a | Entidad `courses` | **Hecho.** `0003_courses.sql`: tabla `courses` (`moodle_course_id UNIQUE`, `name`), FK `activities.course_id` y `GET /api/courses/discover`. HU-19, pregunta abierta 1, resuelta por la opción (c) |
| b | `moodleRef` con prefijo de tipo e índice único | **Hecho.** `assign-42` / `forum-42`, con índice **parcial** `activities_moodle_ref_key` para que varias actividades locales (`NULL`) no colisionen entre sí. La migración normaliza los refs numéricos antiguos y deshace las colisiones previas. HU-19, pregunta abierta 2, opción (a) |
| c | Selector de curso como paso previo | **Hecho.** `GET /api/courses/discover` nuevo y `GET /api/activities/discover` **exige** `?moodleCourseId=`. HU-19, pregunta abierta 3, opción (a) |
| d | El API llama al conector de verdad | **Hecho.** `MOODLE_CATALOGUE` ha desaparecido de `routes/activities.ts`; `apps/api` depende de `@vega/connector-{lms,moodle3,filesystem}` |
| e | Token de Moodle por usuario | **Hecho.** `users.moodle_token`, `PUT`/`POST /api/auth/me/moodle-token[/test]`, y `app_settings.moodle.token` eliminado. Ver abajo |
| f | Ficheros de contexto con contenido real | **Hecho para texto.** `.tex`, `.md`, `.markdown` y `.txt` se guardan en `activity_files.content`; los binarios quedan como referencia y la UI dice que no llegan al modelo |
| g | `referenceSolution` y ficheros en el contexto | **A medias.** `resolveContext()` los monta y `GET /api/contexts/resolved/{id}` los enseña, pero **el lote no se los pasa**. Ver abajo |
| h | Errores del LMS distinguibles | **Hecho.** `LMS_AUTH` (422) y `LMS_UNAVAILABLE` (502), que cierran los escenarios 7 y 8 de HU-19 |
| i | Alcance por curso | **Hecho.** `0004_course_access.sql` y `apps/api/src/auth/scope.ts`: un profesor ve las actividades y entregas de sus cursos, un `admin` lo ve todo. Antes `GET /api/activities` devolvía **todo a cualquier usuario autenticado** y el `PATCH` dejaba editar la actividad de otro |

### H2.e — El token es de cada profesor

`core_enrol_get_users_courses` devuelve los cursos **del dueño del token**, así que la credencial
decide qué cursos ofrece la aplicación. Un token compartido enseñaría a todo el claustro los cursos
de todo el claustro. La URL y el conector siguen siendo de instalación y los pone el administrador;
el token lo pega cada uno, y nadie puede pegarlo por él.

Consecuencia sobre el resto de la documentación: **HU-03 RN-7 decía que las credenciales son
variables de entorno y no se editan desde la UI, y eso ya no es cierto.** La HU está enmendada.
`/ajustes` tampoco es ya una pantalla sólo de administración: cualquier usuario entra y ve su
conexión con Moodle y el estado del sistema.

Ver [ADR 0010](decisiones/0010-credencial-moodle-por-usuario.md), y
[ADR 0009](decisiones/0009-interfaz-lms-siete-operaciones.md) para el crecimiento de la interfaz
`LmsConnector`, que sustituye al [ADR 0006](decisiones/0006-conectores-lms-interfaz-minima.md).

### Revisión de cierre de H2

Antes de empezar H3 se revisó si la casa estaba montada para enchufar el motor de IA. El informe
completo —eje por eje, con lo que se comprobó ejecutándolo— está en
[`revision/h2-preparacion-motor-ia.md`](revision/h2-preparacion-motor-ia.md). El resumen:

**Estaba montado lo que se ve; faltaba tubería en lo que no se ve.** Se cerraron en esa revisión, con
la migración `0005` y el [ADR 0012](decisiones/0012-ingesta-almacen-y-publicacion-en-dos-fases.md):

| | Trabajo | Estado |
|---|---|---|
| j | **Ingesta desde el LMS** | **Hecho.** `apps/api/src/ingest/`: el lote llama a `listSubmissions()` y `download()` con la credencial de `activities.imported_by`, guarda el fichero y cuenta sus páginas. Idempotente por `remote_id` |
| k | **Almacén de las entregas** | **Hecho.** `STORAGE_ROOT` y `submissions.storage_path`. El lote deja de fabricar rutas falsas, que era el camino crítico oculto de `motor-ia.md` §14 |
| l | **Publicación en el LMS** | **Hecho.** `publishGrade` + `publishFeedbackFile` con lo efectivo, en dos marcas para que el reintento no republique la nota. Un conector sin fichero de feedback deja de ser un error |
| l bis | **Publicación en foro y verificación de la escritura** | **Hecho.** `publishForumReply` como octava operación, con `mod_forum_add_discussion_post`. Cierra la pregunta 1 de HU-20 y, de paso, un fallo que publicaba respuestas de foro como notas de otra actividad **sin dar error**. Las funciones de escritura se comprueban en Ajustes sin llamarlas. Ver [ADR 0014](decisiones/0014-publicar-en-foro-y-verificar-la-escritura.md) |
| m | **Foros de Moodle** | **Hecho.** `listSubmissions()` ya no lanza: primera duda sin responder de cada debate. Sin verificar contra Moodle real |
| n | **Orquestación** | **Hecho.** Recuperación al arrancar de lo que quedó a medias, un solo lote a la vez (`409`) y disparo manual restringido a administración |
| o | **Ficha del alumno y contexto al modelo** | **Hecho.** Tabla `students`, migración `0006`: la ingesta trae el perfil de Moodle y la **comunidad autónoma** (`CCAA`), que es el dato que cambia el criterio de corrección y que hasta ahora el modelo no veía. Enmienda HU-08 RN-4; ver [ADR 0013](decisiones/0013-ficha-del-alumno-y-contexto-al-modelo.md) |
| ñ | **Persistencia de prompts** | **Hecho en H3.** Tabla `prompts` versionada, edición desde la pantalla «Prompts» y semillas embebidas en `apps/api/src/prompts/seeds.ts`. La carpeta `prompts/` del repositorio se eliminó: la base de datos es la única fuente de verdad en ejecución |

### Lo que H2 deja sin cerrar

- **El conector `moodle3` sigue sin verificarse contra un Moodle real, y ahora tiene más
  superficie.** Tiene tests unitarios con `fetchImpl` inyectado y nada más. Es el riesgo principal
  del proyecto y **ha subido**: ahora también se apoyan en él la ingesta, la descarga, la lectura de
  foros y la publicación.
- **`referenceSolution` y el contenido de los ficheros no llegan al modelo.** `resolveContext()` ya
  sabe montarlos —y en actividad no puntuable rotula la sección **«Material asociado»** en vez de
  «Solución de referencia», porque en un foro ese campo no es la respuesta correcta sino el material
  del que se pregunta—, pero `batch.ts` construye el `ResolveContextInput` con **sólo los tres
  niveles**. Hoy se ven en la pantalla de contexto efectivo y no pesan en la corrección. Cerrarlo es
  una línea del lote, y hasta que se haga la pantalla promete algo que no ocurre.
- **El token se guarda en claro en la base de datos.** Marcado para que la API no lo devuelva, sin
  cifrado en reposo. Limitación conocida, escrita en el ADR 0010.
- **`pendingCount` de una entrega sigue siendo `0`** en `moodle3`: contarlo exigiría
  `mod_assign_get_submissions` completo. En los foros es `numdiscussions`, que son **debates**, no
  mensajes. La UI ya nombra la unidad en vez de decir siempre «entregas pendientes», pero el `0` de
  las entregas sigue siendo falso. HU-19, pregunta abierta 5, sigue abierta.
- **HU-19 preguntas abiertas 4 y 6, y HU-05 preguntas abiertas 1, 3, 4 y 5**, siguen abiertas.
- ~~**La ingesta y la publicación no se han tocado.**~~ **Cerradas** en la revisión de cierre de H2.
  Lo que queda de H5 es verificarlas contra un Moodle real y resolver el spike de
  `assignfeedback_file`.
- **La subida de ficheros va troceada** (`UPLOAD_CHUNK_BYTES` = 256 KiB, tope de 4 MiB por fichero)
  porque delante hay un proxy inverso y el `bodyLimit` de Fastify está fijado a 2 MiB. Una subida a
  medias (`activity_files.upload_complete = false`) no se lista ni entra en el contexto, y se barre a
  la hora. **Los ficheros de contexto binarios siguen sin almacén**: se registran como referencia y
  no se guardan bytes. Las entregas de los alumnos sí, desde el ADR 0012.

---

## H3 — Procesos batch contra IA simulada

**Objetivo:** el circuito completo corriendo de extremo a extremo con `AI_PROVIDER=mock`. Sin gastar
un céntimo y sin depender de la red, se puede ver una entrega entrar y salir corregida.

**HU implicadas:** HU-08 (ingesta idempotente), HU-09 (lote ordenado por actividad para aprovechar
el prompt caching), HU-10 (transcripción).

**Ojo:** la máquina de estados documentada pasa **siempre** por `transcribing`. Un post de foro no
tiene fichero y debe ir `pending → grading` directo. El código ya lo distingue con `hasStudentFile()`;
la documentación no, y ninguna HU describe ese camino. Se arregla aquí.

**Lo primero de H3 no era código, era una decisión**: dónde viven los prompts. **Decidido y hecho:
en la base de datos** (tabla `prompts` versionada, editable desde la aplicación), con las semillas
embebidas en el código. La segunda decisión —el PDF llega al motor como documento, no como N
páginas— se resolvió troceando sin rasterizar con `pdf-lib` y un manifiesto exacto de páginas. Ver
[`revision/h2-preparacion-motor-ia.md`](revision/h2-preparacion-motor-ia.md) §5.

**Implementado en el motor IA**: doble lectura, troceado PDF con manifiesto, cuatro operaciones,
contextos y prompts versionados, triaje de foros, verificación mecánica/IA y ledger. La validación
T14 contra corpus y clave reales es la puerta de salida antes de considerar H4 cerrado.

**Decisión de alcance (2026-07-22)**: mientras la publicación en Moodle esté fuera de alcance
(motor-ia.md D15), el «modo de autonomía» desaparece de la interfaz — nada se publica solo y toda
actividad opera como `review_all`. La columna y el enum se conservan para cuando la publicación
vuelva al alcance. Las rúbricas y criterios de corrección viven en el contexto de la actividad,
no en una sección propia de la ficha.

---

## H4 — Llamadas reales y precorrección visible

**Objetivo:** llamadas de verdad a la API de Anthropic y la propuesta de corrección visible y
editable en la aplicación.

**HU implicadas:** HU-11 (revisar transcripción y reprocesar), HU-12 (propuesta por apartados),
HU-13 (métodos alternativos y confianza), HU-15 (revisión en móvil), HU-16 (editar y validar).

**HU nueva: HU-20 (respuesta a dudas de foro)**, el otro caso de uso del producto. Escrita: entrada
por `textContent` sin descarga ni OCR, salida única en `aiLatex`, y la garantía de que en actividad
no puntuable ningún camino de código escribe una nota en el LMS.

Aquí se cierra el coste real, que es lo que da sentido al panel de H1.d.

---

## H5 — Aplicación 100 % funcional

**Objetivo:** publicar en Moodle y cerrar el círculo.

**HU implicadas:** HU-17 (publicar nota y PDF de feedback), más la publicación de respuesta en el
foro, que es un camino distinto: `mod_forum_add_discussion_post`, sin nota. **El transporte de las
dos ya está hecho en H2** (ADR 0012 y ADR 0014); lo que queda para aquí es verificarlo contra un
Moodle real y resolver el formato del mensaje de foro.

**HU nueva: HU-21 (modos de autonomía)**, escrita. Es lo que permite que Vega deje de necesitar
validación cuando el contexto ya está afinado, y por tanto lo que decide si el producto ahorra
tiempo de verdad. Trae un conflicto que hay que resolver antes de implementarla: **`autonomous`
contradice de frente al [ADR 0004](decisiones/0004-validacion-humana-obligatoria.md)**. O se enmienda
el ADR o se restringe la autonomía.

---

## Trabajo transversal

No pertenece a un hito; se hace cuando toca el archivo que le corresponde.

- ~~**Reescribir `docs/` sobre el dominio real.**~~ **Hecho**: `glosario.md`, `modelo-de-datos.md`,
  `arquitectura.md` y `contexts/README.md` reescritos sobre `Activity`, `ActivityKind`, nota
  opcional, curso, `textContent`, autonomía, `activity_files` y `app_settings`.
- ~~**Sacar matemáticas del núcleo.**~~ **Hecho** en documentación y en el copy del producto. La
  materia vive ahora en `contexts/`, y el juego de ficheros del repositorio queda declarado como
  ejemplo de un despliegue de matemáticas, no como parte del núcleo.
- **`docs/tareas-claude-code.md` está obsoleto**: describe un backend Python/FastAPI y una marca
  anterior. Contradice la arquitectura actual. Archivarlo o borrarlo.
