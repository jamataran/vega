# Backlog de implementación con Claude Code — Corrector v1.1

> **Documento histórico.** Para el motor de IA manda
> [`motor-ia.md`](motor-ia.md). En particular, T03 queda sustituida por T4 de ese documento: los
> contextos se siembran una vez y después viven, con historial, en PostgreSQL. No se implementan
> commits Git desde la aplicación.

Tareas secuenciales. Cada una está redactada para pegarla como prompt de arranque en Claude Code. No empezar una tarea sin cumplir los criterios de aceptación de la anterior.

## Stack técnico (decidido)

- **Backend**: Python 3.12 + FastAPI + SQLAlchemy + Alembic · PostgreSQL 16 (JSONB para correcciones)
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS · **mobile-first** (el profesor corrige desde el móvil) · PWA instalable
- **Núcleo IA**: SDK Anthropic (evolución de `corrige.py`) · prompt caching · Message Batches API para el lote nocturno
- **Infra dev**: monorepo, docker-compose (api + postgres + web), pytest + Playwright
- **Licencia**: AGPL-3.0 (proteger el open source frente a SaaS cerrados; cambiar a Apache-2.0 si se prioriza adopción)

```
corrector/
├── CLAUDE.md                  # convenciones del proyecto (T00)
├── .claude/skills/ux-review/  # skill de UX (adjunta)
├── core/          # motor de corrección puro: sin web, sin LMS, testeable en CLI
├── connectors/    # interfaz LMSConnector + moodle3/ + filesystem/
├── api/           # FastAPI: auth, buzones, contextos, cola, metering
├── web/           # React PWA
├── contexts/      # markdown del profesor (git)
└── docker-compose.yml
```

## Diseño visual — tokens corporativos

⚠️ **Acción previa del profesor**: la web de Opotrack no expone la paleta (SPA JHipster). Extraer de su repo los valores reales (`$primary`, etc. en los SCSS) y fijarlos en `web/src/design-tokens.css` en la T01. Hasta entonces, placeholders:

```css
:root {
  --color-primary: #1e3a5f;      /* SUSTITUIR por primario Opotrack */
  --color-accent:  #d97706;      /* SUSTITUIR por acento Opotrack */
  --color-surface: #fafaf9;  --color-text: #1c1917;
  --color-ok: #15803d;  --color-warn: #b45309;  --color-error: #b91c1c;
  --radius: 8px;  --font-sans: system-ui, sans-serif;
}
```

Dirección de diseño: **sobrio y elegante** — mucho blanco, una sola familia tipográfica, color solo con significado (estados, acciones primarias), sin sombras ni degradados decorativos. LaTeX renderizado con KaTeX en todo el frontend.

---

## T00 — Fundaciones del repo

Crear el monorepo con la estructura anterior, `CLAUDE.md` (stack, convenciones de commits, cómo correr tests, prohibido hardcodear secretos, español en UI / inglés en código), docker-compose con Postgres, linters (ruff, eslint, prettier), CI mínima en GitHub Actions (lint + tests), LICENSE y README con la visión del proyecto.

**Aceptación**: `docker compose up` levanta Postgres; `make test` pasa en verde vacío; CI ejecuta en push.

## T01 — Scaffolding + maqueta navegable (LA TAREA MODELO)

Doble entregable: el esqueleto técnico funcionando y una **maqueta navegable de toda la aplicación** con datos ficticios, que fija cómo será el producto antes de implementar lógica.

1. **API**: FastAPI con health-check, SQLAlchemy + Alembic, migración inicial del esquema (usuarios, buzones, entregas, transcripciones, correcciones, uso_api — según diseño v1.0 §8 + tabla `usuarios`).
2. **Web**: React PWA con `design-tokens.css`, layout mobile-first con navegación inferior de 4 pestañas: **Bandeja · Buzones · Contextos · Métricas** (+ menú de cuenta).
3. **Maqueta**: todas las pantallas navegables con mocks estáticos:
   - Login
   - Bandeja de revisión (lista agrupada por buzón, badges de confianza)
   - **Pantalla de revisión** — la crítica en móvil: pestañas deslizables `Original (PDF) | Transcripción | Corrección`; la corrección como tarjetas por apartado con stepper de puntuación, análisis plegable y feedback editable; barra inferior fija con nota total y botón **Validar y publicar**
   - Configuración de buzón (tipo, nota máx., reparto de puntos, ficheros de contexto)
   - Editor de contexto markdown (global y por buzón) con preview KaTeX
   - Dashboard de métricas (coste/corrección, desviación IA↔profesor)
4. **Validación UX**: ejecutar la skill `ux-review` (adjunta) sobre cada pantalla y aplicar sus correcciones antes de cerrar la tarea.

**Aceptación**: la app instala como PWA en un móvil real; todas las operativas descritas son alcanzables con el pulgar; la pantalla de revisión permite (en mock) cambiar una puntuación, editar feedback y "validar" en un iPhone SE (375 px) sin scroll horizontal; informe de `ux-review` sin issues bloqueantes.

## T02 — Autenticación y usuarios

Tabla `usuarios` (email, hash argon2, rol `admin|profesor`, activo), login JWT con refresh, middleware de autorización, pantalla de login real, gestión de usuarios para admin, preparado multi-tenant (columna `tenant_id` nullable desde ya, sin UI).

**Aceptación**: rutas protegidas; tests de auth; sesión persiste en PWA tras cerrar la app.

## T03 — Gestión de contextos

**Sustituida por [T4 de `motor-ia.md`](motor-ia.md#t4--registro-versionado-niveles-y-permisos-de-contextos).**
El diseño anterior de guardar con commits Git no debe implementarse. La tarea vigente define
semilla inicial, versiones inmutables en PostgreSQL y permisos por nivel; la pantalla administrativa
del historial queda para una fase posterior.

**Aceptación**: la de la T4 vigente.

## T04 — Motor de corrección en `core/`

Portar `corrige.py` a `core/` como librería: `transcribir(pdf, contexto) -> Transcripcion`, `corregir(pdf, transcripcion, contexto) -> Correccion`, sin acoplamiento a web ni LMS. Máquina de estados de la entrega en BD, cola de trabajos (arq/celery o loop asyncio simple — decidir por simplicidad), registro de `usage` por llamada, CLI de desarrollo (`python -m core corrige --buzon X --pdf Y`).

**Aceptación**: los artefactos del CLI coinciden con los validados en Fase 0; estados transicionan correctamente; `uso_api` se puebla; tests con PDFs de fixture.

## T05 — Flujo de revisión real

Conectar la pantalla de revisión de T01 al backend: visor PDF, transcripción renderizada, edición de puntuaciones con recálculo, edición de feedback, "recorregir con transcripción corregida", rechazar/relanzar, validar (estado `VALIDADA`), validación en bloque para confianza alta. Re-ejecutar `ux-review` con datos reales.

**Aceptación**: ciclo completo entrega→corrección→edición→validación desde un móvil, sin tocar el escritorio.

## T06 — Capa de conectores LMS

Interfaz `LMSConnector` (`list_assignments`, `list_submissions`, `download_file`, `publish_grade`, `publish_feedback_file`) + `FilesystemConnector` (carpetas entrada/salida, para desarrollo y para academias sin LMS) + `Moodle3Connector` (WS REST con token; mapeo buzón↔assignment_id configurable desde la UI de buzones).

**Aceptación**: tests del conector contra un Moodle 3 de pruebas en docker; una entrega real subida a un buzón aparece como `NUEVA`.

## T07 — Batch nocturno y optimización de coste

Scheduler configurable (hora en config), lote ordenado por buzón, Message Batches API con fallback a Messages, `cache_control` verificado (assert de `cache_read > 0` a partir de la 2ª entrega del mismo buzón en modo estándar), reintentos con backoff, email de resumen al profesor al terminar el lote ("12 corregidas, 2 con avisos, coste 0,84 €").

**Aceptación**: lote de ≥5 entregas de 2 buzones procesado de madrugada; coste/corrección medido y visible.

## T08 — Publicación en Moodle (incluye el spike de riesgo)

Render del feedback a PDF (plantilla con marca de la academia, markdown+LaTeX → PDF), y **spike**: subida del fichero al área `assignfeedback_file` vía WS + `mod_assign_save_grade`. Si no es viable limpio en Moodle 3 → plan B documentado (nota + feedback HTML como comentario, PDF por canal alternativo) e implementado.

**Aceptación**: un alumno de prueba ve en Moodle su nota y su PDF de corrección tras la validación.

## T09 — Metering y dashboard

Dashboard real: coste por corrección/alumno/mes, tokens y ratio de caché, desviación |nota IA − nota final del profesor| por buzón, % validadas sin edición, exportación CSV.

**Aceptación**: métricas correctas contra los datos de T07-T08.

## T10 — Endurecimiento y open source

Backups de Postgres y `contexts/`, rate limiting, logs estructurados, página de estado del lote, documentación de despliegue (docker compose de producción + HTTPS), CONTRIBUTING.md, issues templates, anonimización del alumno hacia la API (ID interno, nunca nombre), revisión RGPD de la política de privacidad.

**Aceptación**: despliegue reproducible en un VPS limpio siguiendo solo el README.

---

## Cómo trabajar cada tarea en Claude Code

1. Abrir sesión limpia (`/clear`), pegar la tarea completa + referencia al diseño v1.0/v1.1.
2. Pedir primero plan y esquema de ficheros; revisar; luego implementar.
3. En tareas con UI, invocar la skill `ux-review` antes de dar por cerrada la tarea.
4. Commit por tarea con tests en verde; las tareas grandes (T01, T05) admiten worktrees paralelos para frontend/backend.
