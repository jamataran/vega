#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  vega-admin — cliente de la API de administración de Vega
#
#  Existe para depurar prompts contra un entorno desplegado sin pasar por la
#  interfaz: editar un prompt, reprocesar UNA entrega y leer exactamente lo que
#  se envió al modelo y lo que devolvió. Todo eso ya lo expone la API; esto sólo
#  se encarga del login, del token y de que la salida sea legible.
#
#  Configuración, por orden de precedencia:
#    1. Variables de entorno VEGA_API_URL / VEGA_ADMIN_EMAIL / VEGA_ADMIN_PASSWORD
#    2. El fichero que indique $VEGA_ADMIN_ENV
#    3. scripts/.vega-admin.env   (ignorado por git; ver scripts/vega-admin.env.example)
#
#  El token se cachea en ~/.cache/vega/<host>.token con permisos 600 y se
#  renueva solo cuando caduca o cuando la API responde 401.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Configuración ────────────────────────────────────────────────────────────

ENV_FILE="${VEGA_ADMIN_ENV:-$SCRIPT_DIR/.vega-admin.env}"
if [[ -f "$ENV_FILE" ]]; then
  # Sólo rellena lo que no venga ya del entorno: una variable exportada a mano
  # tiene que poder ganarle al fichero (útil para apuntar a test un momento).
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${VEGA_API_URL:=}"
: "${VEGA_ADMIN_EMAIL:=}"
: "${VEGA_ADMIN_PASSWORD:=}"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_config() {
  [[ -n "$VEGA_API_URL" ]] || die "Falta VEGA_API_URL. Copia scripts/vega-admin.env.example a $ENV_FILE y rellénalo."
  [[ -n "$VEGA_ADMIN_EMAIL" ]] || die "Falta VEGA_ADMIN_EMAIL en $ENV_FILE."
  [[ -n "$VEGA_ADMIN_PASSWORD" ]] || die "Falta VEGA_ADMIN_PASSWORD en $ENV_FILE."
}

command -v jq >/dev/null 2>&1 || die "Hace falta jq (brew install jq)."

# Sin barra final: todas las rutas de la API empiezan por /api.
VEGA_API_URL="${VEGA_API_URL%/}"

# ── Caché del token ──────────────────────────────────────────────────────────

cache_dir() {
  local dir="${XDG_CACHE_HOME:-$HOME/.cache}/vega"
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true
  printf '%s' "$dir"
}

# Un fichero por entorno: depurar en test no debe invalidar la sesión de prod.
token_file() {
  local slug
  slug="$(printf '%s' "$VEGA_API_URL" | tr -c 'A-Za-z0-9' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//')"
  printf '%s/%s.token' "$(cache_dir)" "$slug"
}

# Formato del fichero: primera línea el JWT, segunda el instante de caducidad
# en epoch. Así se puede comprobar sin decodificar el token.
read_cached_token() {
  local file expires now
  file="$(token_file)"
  [[ -f "$file" ]] || return 1
  expires="$(sed -n '2p' "$file")"
  [[ -n "$expires" ]] || return 1
  now="$(date +%s)"
  # 60 s de margen: un token que caduca a mitad de la petición es un 401 tonto.
  (( expires - 60 > now )) || return 1
  sed -n '1p' "$file"
}

login() {
  require_config
  local body http out
  out="$(mktemp)"
  # Las credenciales van por stdin (`--data @-`) para que no aparezcan en la
  # lista de procesos de la máquina.
  http="$(jq -n --arg email "$VEGA_ADMIN_EMAIL" --arg password "$VEGA_ADMIN_PASSWORD" \
    '{email: $email, password: $password}' |
    curl -sS -o "$out" -w '%{http_code}' \
      -X POST "$VEGA_API_URL/api/auth/login" \
      -H 'Content-Type: application/json' \
      --data @-)"
  body="$(cat "$out")"
  rm -f "$out"

  if [[ "$http" != "200" ]]; then
    printf '%s\n' "$body" >&2
    die "Login rechazado (HTTP $http) en $VEGA_API_URL."
  fi

  local token expires_iso expires_epoch file
  token="$(printf '%s' "$body" | jq -r '.token')"
  expires_iso="$(printf '%s' "$body" | jq -r '.expiresAt')"
  expires_epoch="$(iso_to_epoch "$expires_iso")"

  file="$(token_file)"
  umask 077
  printf '%s\n%s\n' "$token" "$expires_epoch" > "$file"
  printf '%s' "$token"
}

# `date -d` (GNU) y `date -j -f` (BSD/macOS) no comparten sintaxis, y no merece
# la pena depender de coreutils sólo para esto.
iso_to_epoch() {
  local iso="${1%%.*}"
  iso="${iso%Z}"
  if date -j -f '%Y-%m-%dT%H:%M:%S' "$iso" +%s 2>/dev/null; then
    return 0
  fi
  date -u -d "${1}" +%s 2>/dev/null && return 0
  # Si no se puede interpretar, damos el token por caducado en 1 h: peor caso,
  # un login de más.
  printf '%s' "$(( $(date +%s) + 3600 ))"
}

token() {
  read_cached_token || login
}

# ── Llamadas a la API ────────────────────────────────────────────────────────
#
# api <MÉTODO> <ruta> [fichero-de-cuerpo]
#
# Devuelve el cuerpo por stdout. Un 401 se reintenta una vez con token nuevo:
# el JWT dura 12 h y esto se usa en sesiones largas.
api() {
  local method="$1" path="$2" body_file="${3:-}"
  local retried="${VEGA_RETRIED:-0}"
  local out http tok
  tok="$(token)"
  out="$(mktemp)"

  local -a args=(-sS -o "$out" -w '%{http_code}' -X "$method"
    "$VEGA_API_URL$path"
    -H "Authorization: Bearer $tok"
    --max-time "${VEGA_TIMEOUT:-600}")
  if [[ -n "$body_file" ]]; then
    args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  fi

  http="$(curl "${args[@]}")"
  local body
  body="$(cat "$out")"
  rm -f "$out"

  if [[ "$http" == "401" && "$retried" == "0" ]]; then
    rm -f "$(token_file)"
    VEGA_RETRIED=1 api "$method" "$path" "$body_file"
    return $?
  fi

  if [[ "$http" -ge 400 ]]; then
    printf '%s\n' "$body" | jq . 2>/dev/null >&2 || printf '%s\n' "$body" >&2
    die "HTTP $http en $method $path"
  fi

  printf '%s' "$body"
}

# ── Comandos ─────────────────────────────────────────────────────────────────

# Directorio de trabajo de `pull`/`push`. Fuera del repositorio por defecto:
# un prompt de producción no debería acabar commiteado sin querer.
work_dir() {
  local slug
  slug="$(printf '%s' "$VEGA_API_URL" | sed 's|https\?://||; s|[:/].*||')"
  printf '%s' "${VEGA_PROMPTS_DIR:-$SCRIPT_DIR/../var/prompts/$slug}"
}

cmd_health() {
  curl -sS "$VEGA_API_URL/api/health" | jq .
}

cmd_whoami() {
  api GET /api/auth/me | jq -r '.user | "\(.name) <\(.email)>  rol=\(.role)"'
}

cmd_prompts() {
  api GET /api/prompts | jq -r '
    ["CLAVE","VER","ACTUALIZADO","BYTES"],
    (.items[] | [.key, ("v" + (.version|tostring)), (.updatedAt|.[0:16]), (.content|length|tostring)])
    | @tsv' | column -t -s $'\t'
}

cmd_prompt() {
  local key="${1:?uso: prompt <clave>}"
  api GET /api/prompts | jq -er --arg k "$key" '.items[] | select(.key == $k) | .content' ||
    die "No existe el prompt «$key». Lista las claves con: $0 prompts"
}

cmd_pull() {
  local dir="${1:-$(work_dir)}"
  mkdir -p "$dir"
  local json
  json="$(api GET /api/prompts)"
  printf '%s' "$json" | jq -r '.items[] | .key' | while read -r key; do
    printf '%s' "$json" | jq -r --arg k "$key" '.items[] | select(.key == $k) | .content' > "$dir/$key.md"
  done
  # Manifiesto: `push` lee la versión del servidor, pero tener aquí la que se
  # descargó permite ver de un vistazo si alguien tocó el prompt por la UI.
  printf '%s' "$json" | jq '[.items[] | {key, version, updatedAt}]' > "$dir/.versions.json"
  printf 'Descargados %s prompts en %s\n' "$(printf '%s' "$json" | jq '.items | length')" "$dir"
}

cmd_diff() {
  local key="${1:?uso: diff <clave> [fichero]}"
  local file="${2:-$(work_dir)/$key.md}"
  [[ -f "$file" ]] || die "No existe $file. Ejecuta primero: $0 pull"
  local remote
  remote="$(mktemp)"
  cmd_prompt "$key" > "$remote"
  diff -u --label "servidor:$key" "$remote" --label "local:$file" "$file" || true
  rm -f "$remote"
}

cmd_push() {
  local key="${1:?uso: push <clave> [fichero]}"
  local file="${2:-$(work_dir)/$key.md}"
  [[ -f "$file" ]] || die "No existe $file. Ejecuta primero: $0 pull"

  # La versión esperada se lee del servidor en el momento de guardar: si otra
  # persona ha tocado el prompt desde el último `pull`, la API rechaza el
  # guardado en lugar de pisarlo.
  local version
  version="$(api GET /api/prompts | jq -er --arg k "$key" '.items[] | select(.key == $k) | .version')" ||
    die "No existe el prompt «$key» en $VEGA_API_URL."

  local payload
  payload="$(mktemp)"
  jq -n --rawfile content "$file" --argjson expectedVersion "$version" \
    '{content: $content, expectedVersion: $expectedVersion}' > "$payload"

  api PUT "/api/prompts/$key" "$payload" |
    jq -r '.prompt | "Guardado \(.key) v\(.version) (\(.content|length) bytes)"'
  rm -f "$payload"
}

cmd_restore() {
  local key="${1:?uso: restore <clave>}"
  local version payload
  version="$(api GET /api/prompts | jq -er --arg k "$key" '.items[] | select(.key == $k) | .version')" ||
    die "No existe el prompt «$key»."
  payload="$(mktemp)"
  jq -n --argjson expectedVersion "$version" '{expectedVersion: $expectedVersion}' > "$payload"
  api POST "/api/prompts/$key/restore" "$payload" |
    jq -r '.prompt | "Restaurado \(.key) a v\(.version)"'
  rm -f "$payload"
}

cmd_queue() {
  local query="${1:-pageSize=20}"
  api GET "/api/submissions?$query" | jq -r '
    ["ID","ESTADO","ACTIVIDAD","ALUMNO","NOTA"],
    (.items[] | [.id, .status, (.activityName // .activityId // "-"), (.studentName // .studentRef // "-"), ((.correction.totalPoints // "-")|tostring)])
    | @tsv' | column -t -s $'\t'
}

cmd_reprocess() {
  local id="${1:?uso: reprocess <id-entrega> [full|grade_only]}"
  local scope="${2:-grade_only}"
  local payload
  payload="$(mktemp)"
  jq -n --arg scope "$scope" '{scope: $scope}' > "$payload"
  api POST "/api/submissions/$id/reprocess" "$payload" | jq .
  rm -f "$payload"
}

cmd_calls() {
  local query="${1:-pageSize=20}"
  api GET "/api/ai-calls?$query" | jq -r '
    ["ID","OPERACIÓN","MODELO","PROMPT","OK","ms","COSTE¢","ERROR"],
    (.items[] | [
      .id[0:8], .operation, (.modelRequested // "-"),
      ((.promptKey // "-") + (if .promptVersion then " v" + (.promptVersion|tostring) else "" end)),
      (if .parsedOk then "sí" else "NO" end),
      ((.latencyMs // 0)|tostring),
      ((.costCents // 0)|tostring),
      ((.error // "-")[0:40])
    ]) | @tsv' | column -t -s $'\t'
}

cmd_call() {
  local id="${1:?uso: call <id-llamada>}"
  api GET "/api/ai-calls/$id" | jq .
}

# Lo que de verdad se mandó al modelo, sin el resto del registro alrededor.
cmd_sent() {
  local id="${1:?uso: sent <id-llamada>}"
  api GET "/api/ai-calls/$id" | jq '.call.requestParams'
}

cmd_received() {
  local id="${1:?uso: received <id-llamada>}"
  api GET "/api/ai-calls/$id" | jq '.call.responseRaw'
}

cmd_resolved() {
  local id="${1:?uso: resolved <id-actividad>}"
  api GET "/api/contexts/resolved/$id" | jq .
}

cmd_raw() {
  local method="${1:?uso: raw <MÉTODO> <ruta> [fichero-json]}"
  local path="${2:?uso: raw <MÉTODO> <ruta> [fichero-json]}"
  local file="${3:-}"
  api "$method" "$path" "$file" | jq . 2>/dev/null || true
}

usage() {
  cat <<'AYUDA'
vega-admin — API de administración de Vega desde la terminal

  health                       Sonda pública del API (no necesita token)
  whoami                       Usuario del token en uso
  login                        Fuerza un login nuevo y cachea el token

Prompts
  prompts                      Lista claves, versión activa y última edición
  prompt <clave>               Vuelca el contenido del prompt por stdout
  pull [dir]                   Descarga todos los prompts a ficheros .md
  diff <clave> [fichero]       Compara el fichero local con el del servidor
  push <clave> [fichero]       Guarda una versión nueva (lee expectedVersion del servidor)
  restore <clave>              Vuelve al valor predeterminado del código

Depuración de correcciones
  queue [query]                Cola de entregas            (p. ej. 'status=needs_review')
  reprocess <id> [scope]       Reprocesa UNA entrega. scope: grade_only (por defecto) | full
  calls [query]                Registro de llamadas de IA  (p. ej. 'submissionId=<id>&errorsOnly=true')
  call <id>                    La llamada entera, en JSON
  sent <id>                    Sólo lo que se envió al modelo
  received <id>                Sólo lo que devolvió el modelo
  resolved <idActividad>       Contexto efectivo que se enviaría para esa actividad

  raw <MÉTODO> <ruta> [json]   Cualquier otro endpoint

Entorno: VEGA_API_URL, VEGA_ADMIN_EMAIL, VEGA_ADMIN_PASSWORD
         (o scripts/.vega-admin.env; VEGA_ADMIN_ENV apunta a otro fichero)

`reprocess` gasta dinero de verdad y `grade_only` reaprovecha la transcripción:
por eso es el valor por defecto. `full` vuelve a pasar el examen por visión.
AYUDA
}

main() {
  local cmd="${1:-}"
  [[ $# -gt 0 ]] && shift || true
  case "$cmd" in
    health)    cmd_health "$@" ;;
    whoami)    cmd_whoami "$@" ;;
    login)     login > /dev/null && cmd_whoami ;;
    prompts)   cmd_prompts "$@" ;;
    prompt)    cmd_prompt "$@" ;;
    pull)      cmd_pull "$@" ;;
    diff)      cmd_diff "$@" ;;
    push)      cmd_push "$@" ;;
    restore)   cmd_restore "$@" ;;
    queue)     cmd_queue "$@" ;;
    reprocess) cmd_reprocess "$@" ;;
    calls)     cmd_calls "$@" ;;
    call)      cmd_call "$@" ;;
    sent)      cmd_sent "$@" ;;
    received)  cmd_received "$@" ;;
    resolved)  cmd_resolved "$@" ;;
    raw)       cmd_raw "$@" ;;
    ''|-h|--help|help) usage ;;
    *)         usage; die "Comando desconocido: $cmd" ;;
  esac
}

main "$@"
