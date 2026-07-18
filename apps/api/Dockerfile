# syntax=docker/dockerfile:1.7-labs
# ─────────────────────────────────────────────────────────────────────────────
#  Vega · imagen del API (Fastify, Node 22)
#
#  Se construye SIEMPRE desde la raíz del monorepo:
#      docker build -f apps/api/Dockerfile .
#
#  Requiere la sintaxis "labs" por dos motivos:
#    · COPY --parents  → copiar sólo los manifiestos conservando la ruta, que es
#                        lo que permite cachear `pnpm install` de verdad.
#    · heredocs (COPY <<EOF) → el entrypoint vive dentro del propio Dockerfile,
#                        sin ensuciar el árbol de la aplicación con un .sh suelto.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:22-alpine

# ── base ────────────────────────────────────────────────────────────────────
# Corepack activa el pnpm exacto que fija "packageManager" en package.json,
# así el build reproduce la misma resolución de dependencias que en local.
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# ── deps ────────────────────────────────────────────────────────────────────
# Capa cara y muy estable: sólo se invalida si cambia el lockfile o algún
# package.json. El código fuente entra después, en la etapa `build`.
FROM base AS deps
COPY --parents \
     package.json \
     pnpm-lock.yaml \
     pnpm-workspace.yaml \
     .npmrc* \
     apps/*/package.json \
     packages/*/package.json \
     connectors/*/package.json \
     ./
# El store de pnpm se monta como caché de BuildKit: no engorda la imagen y
# sobrevive entre builds (en CI lo respalda el caché de GitHub Actions).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# `@vega/api...` = el paquete y todas sus dependencias de workspace
# (@vega/shared, @vega/core, connectors/*…), en orden topológico.
RUN pnpm --filter "@vega/api..." build

# El script `build` del API sólo empaqueta src/index.ts, así que el migrador se
# queda fuera de dist/ (en desarrollo se ejecuta con tsx, que no existe en la
# imagen final). Lo empaquetamos aparte —sin --clean, para no borrar el bundle
# del servidor— porque las migraciones tienen que poder correr en runtime.
RUN pnpm --filter "@vega/api" exec tsup src/db/migrate.ts \
      --format esm --target node22 --no-splitting --out-dir dist

# `pnpm deploy` genera un directorio autocontenido (código + node_modules de
# producción, con las deps de workspace ya materializadas) listo para copiar a
# la imagen final. `--legacy` es necesario mientras el repo no active
# inject-workspace-packages; el fallback cubre versiones de pnpm que ya no
# aceptan ese flag.
RUN set -eu; \
    rm -rf /prod/api; \
    pnpm --filter "@vega/api" deploy --prod --legacy /prod/api \
      || { rm -rf /prod/api; pnpm --filter "@vega/api" deploy --prod /prod/api; }

# ── runtime ─────────────────────────────────────────────────────────────────
# Imagen final mínima: ni pnpm, ni toolchain, ni devDependencies.
FROM ${NODE_IMAGE} AS runtime

LABEL org.opencontainers.image.title="vega-api" \
      org.opencontainers.image.description="API Fastify de Vega (aplica las migraciones al arrancar)" \
      org.opencontainers.image.source="https://github.com/jamataran/vega" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000

# tini como PID 1: reparte SIGTERM al proceso Node y siega zombies, de modo que
# `docker stop` / redespliegue de Portainer cierren limpio y no a los 10s.
RUN apk add --no-cache tini \
 && addgroup -S vega \
 && adduser -S -G vega -h /app vega

WORKDIR /app

COPY --from=build --chown=vega:vega /prod/api ./

# Las migraciones SQL versionadas VIAJAN DENTRO DE LA IMAGEN y se aplican al
# arrancar (requisito del README: el flujo GitOps despliega imágenes, nunca
# ejecuta pasos manuales de migración). Se copian de forma explícita para que
# el requisito sea evidente aunque el empaquetado del paquete cambie.
COPY --from=build --chown=vega:vega /repo/apps/api/migrations ./migrations

# src/db/migrate.ts resuelve las migraciones como '../../migrations' respecto a
# su propia ubicación: en el árbol de fuentes (apps/api/src/db/) eso da
# apps/api/migrations, pero en el bundle (/app/dist/) da /migrations, porque
# tsup aplana todo a dist/. El enlace hace que ambas rutas apunten al mismo
# sitio, así que la imagen funciona sin tocar el código de la aplicación.
# TODO(api): si algún día MIGRATIONS_DIR se resuelve desde la raíz del paquete,
# este enlace sobra.
RUN ln -s /app/migrations /migrations

# Entrypoint: migrar y, sólo si la migración va bien, arrancar el servidor.
#
# Ojo: dist/index.js TAMBIÉN aplica las migraciones antes de escuchar. Pasarlas
# aquí primero no las duplica —el ledger _vega_migrations y el pg_advisory_lock
# hacen que la segunda pasada sea un no-op de milisegundos— y a cambio un fallo
# de esquema se ve como tal en los logs, antes de que Fastify llegue a arrancar.
#
# Los puntos de entrada se resuelven entre varias convenciones para no acoplar
# la imagen a un nombre de fichero; se pueden forzar con VEGA_MIGRATE_ENTRY /
# VEGA_SERVER_ENTRY si el build cambia de layout.
COPY <<'ENTRYPOINT' /usr/local/bin/vega-entrypoint
#!/bin/sh
set -eu

resolver() {
  for candidato in "$@"; do
    if [ -f "$candidato" ]; then
      printf '%s' "$candidato"
      return 0
    fi
  done
  return 1
}

# dist/migrate.js es lo que produce el paso extra de tsup del Dockerfile; el
# resto son alternativas por si el layout del build cambia.
migrador="${VEGA_MIGRATE_ENTRY:-}"
if [ -z "$migrador" ]; then
  migrador="$(resolver \
    dist/migrate.js \
    dist/db/migrate.js \
    dist/scripts/migrate.js \
    || true)"
fi

if [ -n "$migrador" ]; then
  echo "[vega] aplicando migraciones SQL ($migrador)…"
  node "$migrador"
  echo "[vega] esquema al día."
else
  # No abortamos: una imagen sin migrador es un error de build, pero conviene
  # que el fallo salga en el healthcheck del API y no en un crash-loop mudo.
  echo "[vega] AVISO: no se encontró el migrador; se arranca sin migrar." >&2
fi

# dist/index.js es el bundle que genera `pnpm --filter @vega/api build`
# (tsup sobre src/index.ts), y lo que arranca el script `start` del paquete.
servidor="${VEGA_SERVER_ENTRY:-}"
if [ -z "$servidor" ]; then
  servidor="$(resolver \
    dist/index.js \
    dist/server.js \
    dist/main.js)"
fi

echo "[vega] arrancando API ($servidor) en ${API_HOST}:${API_PORT}…"
exec node "$servidor"
ENTRYPOINT
RUN chmod +x /usr/local/bin/vega-entrypoint

USER vega

EXPOSE 3000

# El healthcheck usa el fetch global de Node 22: no hace falta curl ni wget en
# la imagen final. `start-period` da margen a que corran las migraciones.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/vega-entrypoint"]
