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
| e | Linter y tests en el frontend | **Pendiente.** `lint` y `test` son `echo` en `apps/frontend/package.json`: el CI pasa sin comprobar nada del front. Es el agujero que queda para dar H1 por cerrado |

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

**Lo que ya hay:** el conector de Moodle lista cursos, tareas y foros
(`connectors/moodle3/src/connector.ts`), existen `GET /api/activities/discover` y
`POST /api/activities/import`, y el diálogo `DiscoverActivitiesDialog.tsx` importa en bloque.

**Lo que falta:** el **selector de curso como paso previo**. Hoy el diálogo lista todo de golpe,
agrupado por curso; el flujo que quieres es elegir curso primero y ver dentro sus actividades. Y
hay un fallo silencioso que arreglar antes: `moodleRef` no lleva prefijo de tipo, así que **una
tarea y un foro con el mismo id numérico colisionan** y la segunda importación se pierde sin avisar
por el `ON CONFLICT DO NOTHING`.

**Flujo:**

```
Elegir curso  ─►  ver sus actividades  ─►  marcar las que Vega vigila  ─►  configurar cada una
 (de Moodle)      (entregas y foros,        (alta idempotente:            (nombre, puntuable,
                   con las ya dadas          re-sincronizar no             nota máxima, reparto,
                   de alta marcadas)         duplica ni pisa)              contexto, autonomía)
```

**HU implicadas:** HU-04 (configuración de actividad) y HU-05 (solución de referencia y reparto),
reescritas sobre `Activity`; HU-06 (editor de contextos); HU-07 (contexto efectivo); y **HU-19
(alta de actividades desde Moodle)**, nueva, que es la que cierra el agujero.

**A decidir:** `Activity.courseName` es hoy texto libre. Si el selector de curso debe recordar
qué cursos existen —para agrupar en el panel y para no depender de Moodle en cada carga— hace falta
entidad `courses`, y con ella una migración. Es la decisión de diseño que abre H2.

---

## H3 — Procesos batch contra IA simulada

**Objetivo:** el circuito completo corriendo de extremo a extremo con `AI_PROVIDER=mock`. Sin gastar
un céntimo y sin depender de la red, se puede ver una entrega entrar y salir corregida.

**HU implicadas:** HU-08 (ingesta idempotente), HU-09 (lote ordenado por actividad para aprovechar
el prompt caching), HU-10 (transcripción).

**Ojo:** la máquina de estados documentada pasa **siempre** por `transcribing`. Un post de foro no
tiene fichero y debe ir `pending → grading` directo. El código ya lo distingue con `hasStudentFile()`;
la documentación no, y ninguna HU describe ese camino. Se arregla aquí.

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
foro, que es un camino distinto: `mod_forum_add_discussion_post`, sin nota.

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
