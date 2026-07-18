# Vega

**Corrección asistida por IA de exámenes de matemáticas manuscritos — con el profesor siempre al mando.**

Vega automatiza la parte tediosa de corregir exámenes de matemáticas escaneados y escritos a mano: transcribe el desarrollo del alumno, lo contrasta con la solución de referencia del profesor (o evalúa por sí mismos los métodos alternativos), propone una puntuación desglosada por apartados con feedback detallado, y lo deja todo en una cola de revisión para que el profesor edite y valide — desde el móvil. Solo tras la validación explícita se publica algo en el LMS.

Nacida para academias de *oposiciones* españolas; útil para cualquier curso con entregas manuscritas de matemáticas.

## Cómo funciona

```
Buzón del LMS ──► lote nocturno ──► transcripción (manuscrito → LaTeX)
                                          │
                                          ▼
                              corrección IA contra la rúbrica
                              y la solución del profesor
                                          │
                                          ▼
                   📱 cola de revisión — el profesor edita y valida
                                          │
                                          ▼
                    nota + PDF de feedback publicados en el LMS
```

**Humano en el circuito por diseño.** La IA propone; el profesor dispone. Las correcciones de baja confianza y las dudas de transcripción llegan señaladas. Nada alcanza al alumno sin aprobación.

## Funcionalidades

- **OCR de matemáticas manuscritas** con visión de Claude: transcripción íntegra a LaTeX con marcas `[ILEGIBLE]` / `[DUDA]`, mostrada junto al escaneo original.
- **Contexto de corrección a tres niveles**, todo editable por el profesor en Markdown: instrucciones globales → tipo de tarea (*simulacro de problema* / *simulacro de tema*) → buzón (solución de referencia en PDF o LaTeX, indicaciones específicas, reparto de puntos).
- **Interfaz de revisión mobile-first**: desliza entre original / transcripción / corrección, ajusta puntuaciones por apartado, edita el feedback y valida con el pulgar.
- **Conectores LMS** tras una interfaz mínima (`list_submissions`, `download`, `publish_grade`, `publish_feedback_file`). Moodle 3 es el primero; se incluye conector de sistema de ficheros para uso sin LMS. PRs para otros LMS bienvenidas.
- **Coste optimizado**: los lotes nocturnos ordenados por buzón explotan el prompt caching y la Batches API de Anthropic; el uso de tokens y el coste por corrección quedan medidos y visibles en el panel.
- **Autosuficiente**: usuarios propios (roles profesor / administrador), pantalla de ajustes, instalable como PWA, sin dependencias de autenticación externas.

## Stack

TypeScript de punta a punta, en monorepo:

| Pieza | Elección |
|---|---|
| API | Node 22 + Fastify, validación Zod, tipos compartidos con el front |
| Front | React 18 + Vite + Tailwind, PWA, renderizado KaTeX |
| Base de datos | PostgreSQL 16 · Drizzle ORM, migraciones SQL planas versionadas |
| IA | SDK de Anthropic (Messages + Batches, prompt caching) |
| Empaquetado | Docker multi-stage → GitHub Container Registry (GHCR) |
| CI/CD | GitHub Actions: lint + tests en PR; build y push de imágenes en `main` |

```
apps/api        servidor Fastify (aplica además las migraciones al arrancar)
apps/web        PWA React
packages/core   motor de corrección — puro, agnóstico del LMS, ejecutable por CLI
packages/shared esquemas Zod y tipos compartidos por api/web/core
connectors/     interfaz lms + moodle3/ + filesystem/
contexts/       contextos markdown del profesor (versionados con git)
deploy/         docker-compose.prod.yml + notas de proxy inverso
docs/           diseño y documentación
```

## Arranque rápido (desarrollo)

```bash
git clone https://github.com/<tu-usuario>/vega && cd vega
cp .env.example .env            # como mínimo, ANTHROPIC_API_KEY
docker compose up -d postgres
pnpm install
pnpm db:migrate                 # aplica las migraciones SQL
pnpm dev                        # api :3000 · web :5173
pnpm --filter api create-admin  # crea el primer usuario administrador
```

Corregir un examen desde la CLI, sin LMS:

```bash
pnpm --filter core cli grade --buzon tema04 --pdf examen.pdf
```

## Despliegue (GitOps)

Cada push a `main` publica dos imágenes en GHCR:

- `ghcr.io/<tu-usuario>/vega-api`
- `ghcr.io/<tu-usuario>/vega-web`

Apunta tu orquestador (stack de Portainer, compose plano, etc.) a
[`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml). **Los cambios de esquema viajan dentro de la imagen del API**: las migraciones SQL versionadas se aplican de forma idempotente al arrancar el contenedor, de modo que tu flujo GitOps solo despliega imágenes — sin pasos manuales de migración. Endpoints de salud para el proxy inverso: `GET /api/health` (verifica la BD) y `/health.txt` en el front.

TLS y enrutado quedan en manos de tu proxy inverso (nginx, Plesk, Traefik…); ver [`deploy/README.md`](deploy/README.md).

## Configuración y marca

Todos los secretos por variables de entorno (`.env.example` es la referencia): URL de base de datos, secreto JWT, API key de Anthropic, SMTP para los resúmenes nocturnos, credenciales del LMS.

Dale la cara de tu academia sin hacer fork: monta tu logo y define un nombre —

```yaml
services:
  web:
    volumes:
      - ./branding/logo.png:/usr/share/nginx/html/branding/logo.png:ro
    environment:
      - BRAND_NAME=Academia Ejemplo
```

## Privacidad

Las entregas de los alumnos se envían a la API de Anthropic para transcripción y corrección. Quien despliega Vega es responsable de reflejarlo en su política de privacidad (RGPD). Vega minimiza la exposición enviando identificadores internos en lugar de nombres de alumnos.

## Licencia

[AGPL-3.0](LICENSE). Puedes autoalojar, modificar y usar Vega comercialmente; si ofreces una versión modificada como servicio en red, debes compartir tus cambios. Configurar la marca (logo, nombre) no constituye modificación.

## Estado y hoja de ruta

En desarrollo temprano. Hoja de ruta: conector Moodle 4+ · conector Canvas · modo multi-tenant · analítica de desviación (IA vs. profesor). El diseño completo, en [`docs/`](docs/).
