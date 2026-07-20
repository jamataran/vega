# syntax=docker/dockerfile:1.7-labs
# ─────────────────────────────────────────────────────────────────────────────
#  Vega · imagen de la PWA (React + Vite servida por nginx)
#
#  Se construye SIEMPRE desde la raíz del monorepo:
#      docker build -f apps/frontend/Dockerfile .
#
#  Vite hornea las variables VITE_* en tiempo de BUILD, no de arranque: por eso
#  llegan como ARG y no como ENV del contenedor. Si algún día hacen falta
#  valores por entorno sin reconstruir (y por tanto sin poder promocionar la
#  misma imagen de test a producción), habría que pasar a config en runtime
#  vía /config.json servido por nginx.
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine

# ── base ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# ── deps ────────────────────────────────────────────────────────────────────
# Mismos manifiestos que la imagen del API → misma capa cacheada en el runner.
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build

# Ruta base de la API tal y como la ve el navegador. Por defecto relativa: el
# proxy inverso enruta /api al contenedor del API bajo el mismo dominio y así
# no hay CORS ni dominios horneados en el bundle.
ARG VITE_API_BASE_URL=/api
ARG VITE_BRAND_NAME=Vega
ARG VITE_APP_VERSION=dev
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_BRAND_NAME=${VITE_BRAND_NAME} \
    VITE_APP_VERSION=${VITE_APP_VERSION}

COPY . .
# `@vega/frontend...` arrastra @vega/shared y demás deps de workspace.
RUN pnpm --filter "@vega/frontend..." build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM ${NGINX_IMAGE} AS runtime

LABEL org.opencontainers.image.title="vega-frontend" \
      org.opencontainers.image.description="PWA React de Vega servida por nginx" \
      org.opencontainers.image.source="https://github.com/jamataran/vega" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html

# nginx sin root: escucha en 8080 (>1024) y mueve el pidfile a /tmp, que es lo
# único que el usuario `nginx` puede escribir. Los directorios de caché y de
# configuración se le ceden para que el entrypoint de la imagen oficial no
# reviente al arrancar.
#
# La sustitución del pidfile ataca la directiva `pid ...;` sea cual sea su valor
# actual: la imagen oficial la fijaba en /var/run/nginx.pid, pero las versiones
# recientes (nginx:alpine ≥1.25) ya la traen en /run/nginx.pid, y un sed atado
# al valor viejo dejaba de casar en silencio → el usuario `nginx` no puede
# escribir en /run y el contenedor entra en crash-loop con "open() /run/nginx.pid
# failed (13: Permission denied)".
RUN sed -i -E 's|^\s*pid\s+\S+;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
 && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d /usr/share/nginx/html \
 && touch /tmp/nginx.pid \
 && chown nginx:nginx /tmp/nginx.pid

USER nginx

EXPOSE 8080

# wget viene en el busybox de alpine; /health.txt lo sirve nginx sin tocar disco.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/health.txt || exit 1

CMD ["nginx", "-g", "daemon off;"]
