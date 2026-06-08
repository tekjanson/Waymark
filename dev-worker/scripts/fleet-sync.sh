#!/usr/bin/env bash
# fleet-sync.sh — Sync running dev-worker containers with the Agent Registry sheet.
#
# Run this on the HOST (not inside a container) after editing the Agent Registry sheet.
# It reads all agent rows from the sheet, lists running containers, and starts a new
# container for any agent that is not already running.
#
# Usage (from project root):
#   make fleet-sync
#   ./dev-worker/scripts/fleet-sync.sh
#
# Required env (loaded from .env if present):
#   AGENTS_SHEET_ID         — Google Sheet ID of the Agent Registry
#   COPILOT_GITHUB_TOKEN    — GitHub personal access token for Copilot CLI
#   DOCKER_SOCKET_PATH      — Docker socket path (default: /var/run/docker.sock)
#
# Required files:
#   dev-worker/credentials/gsa-key.json — Service Account JSON key
#
# Required tools on host: curl, jq, openssl, base64, docker

set -uo pipefail

# ── Load .env if present ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${REPO_ROOT}/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "${REPO_ROOT}/.env"; set +a
fi

# SA key: prefer dev-worker/credentials/gsa-key.json, fall back to GOOGLE_APPLICATION_CREDENTIALS
SA_KEY="${REPO_ROOT}/dev-worker/credentials/gsa-key.json"
if [[ ! -f "$SA_KEY" && -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
    SA_KEY="$(readlink -f "${GOOGLE_APPLICATION_CREDENTIALS}")"
fi
SHEET_ID="${AGENTS_SHEET_ID:-}"
SHEET_TAB="Sheet1"
IMAGE_NAME="waymark-dev-worker:latest"
DOCKER_SOCKET="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"
CONTAINER_PREFIX="dev-worker-"

# Point docker CLI at the correct daemon (rootless on Linux: /run/user/1000/docker.sock)
export DOCKER_HOST="unix://${DOCKER_SOCKET}"

log()  { echo "[fleet-sync $(date +%T)] $*"; }
info() { echo "[fleet-sync] $*"; }

# ── Validate ──────────────────────────────────────────────────────────────────
if [[ -z "$SHEET_ID" ]]; then
    echo "[fleet-sync] ERROR: AGENTS_SHEET_ID not set. Add it to .env or export it."; exit 1; fi
if [[ ! -f "$SA_KEY" ]]; then
    echo "[fleet-sync] ERROR: SA key not found at ${SA_KEY}"; exit 1; fi
if ! command -v docker &>/dev/null; then
    echo "[fleet-sync] ERROR: docker not found on PATH"; exit 1; fi

# ── Get Google API access token ───────────────────────────────────────────────
log "Authenticating with Google API..."
CLIENT_EMAIL=$(jq -r .client_email "$SA_KEY")
PRIVATE_KEY=$(jq -r .private_key "$SA_KEY")
NOW=$(date +%s)
EXP=$((NOW + 3600))

b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
HDR=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
PAY=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/spreadsheets","aud":"https://oauth2.googleapis.com/token","exp":%d,"iat":%d}' \
    "$CLIENT_EMAIL" "$EXP" "$NOW" | b64url)
TMP_KEY=$(mktemp)
printf '%s' "$PRIVATE_KEY" > "$TMP_KEY"
SIG=$(printf '%s' "${HDR}.${PAY}" | openssl dgst -sha256 -sign "$TMP_KEY" -binary | b64url)
rm -f "$TMP_KEY"
JWT="${HDR}.${PAY}.${SIG}"

TOKEN_JSON=$(curl -s -X POST https://oauth2.googleapis.com/token \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
    --data-urlencode "assertion=${JWT}")
ACCESS_TOKEN=$(printf '%s' "$TOKEN_JSON" | jq -r '.access_token // empty')

if [[ -z "$ACCESS_TOKEN" ]]; then
    echo "[fleet-sync] ERROR: Failed to get access token"
    printf '%s\n' "$TOKEN_JSON" >&2
    exit 1
fi
log "Authenticated as ${CLIENT_EMAIL}"

# ── Read agent rows from the sheet ────────────────────────────────────────────
log "Reading agent registry from sheet ${SHEET_ID}..."

SHEET_DATA=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_TAB}")

# Parse headers → build column index map
HEADERS=$(printf '%s' "$SHEET_DATA" | jq -r '.values[0] // [] | map(ascii_downcase)')
col_idx() {
    printf '%s' "$HEADERS" | jq -r --arg h "$1" 'index($h) // -1'
}

NAME_IDX=$(col_idx "name")
PROVIDER_IDX=$(col_idx "provider")
MODEL_IDX=$(col_idx "model")

if [[ "$NAME_IDX" == "-1" ]]; then
    echo "[fleet-sync] ERROR: No 'name' column in sheet — is this the right sheet?"; exit 1; fi

# Extract agent rows (skip header)
AGENTS=$(printf '%s' "$SHEET_DATA" | jq -r \
    --argjson ni "$NAME_IDX" \
    --argjson pi "$PROVIDER_IDX" \
    --argjson mi "$MODEL_IDX" \
    '.values[1:] | map(select(.[($ni | tonumber)] != null and .[($ni | tonumber)] != "")) |
     map({
       name:     .[($ni | tonumber)],
       provider: (if $pi >= 0 then .[($pi | tonumber)] // "copilot" else "copilot" end | ascii_downcase),
       model:    (if $mi >= 0 then .[($mi | tonumber)] // "" else "" end)
     }) | .[]' 2>/dev/null)

if [[ -z "$AGENTS" ]]; then
    log "No agent rows found in sheet — nothing to sync"; exit 0; fi

# ── Ensure image is built ─────────────────────────────────────────────────────
if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
    log "Building ${IMAGE_NAME}..."
    docker build -t "$IMAGE_NAME" "${REPO_ROOT}/dev-worker/"
fi

# ── List running dev-worker containers ────────────────────────────────────────
RUNNING=$(docker ps --filter "name=${CONTAINER_PREFIX}" --format '{{.Names}}')
log "Running containers: ${RUNNING:-none}"

# ── Start missing agent containers ────────────────────────────────────────────
STARTED=0
SKIPPED=0

while IFS= read -r agent_json; do
    NAME=$(printf '%s' "$agent_json" | jq -r .name)
    PROVIDER=$(printf '%s' "$agent_json" | jq -r .provider)
    MODEL=$(printf '%s' "$agent_json" | jq -r .model)

    NAME_LOWER=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    CONTAINER_NAME="${CONTAINER_PREFIX}${NAME_LOWER}"

    if printf '%s' "$RUNNING" | grep -qF "$CONTAINER_NAME"; then
        log "  ✓ ${NAME} — already running (${CONTAINER_NAME})"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # If container exists but is stopped, remove it so we can re-create with fresh config
    if docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' | grep -qF "$CONTAINER_NAME"; then
        log "  ♻️  Removing stopped container ${CONTAINER_NAME}..."
        docker rm "${CONTAINER_NAME}" &>/dev/null || true
    fi

    # Default model per provider
    if [[ -z "$MODEL" ]]; then
        case "$PROVIDER" in
            claude) MODEL="claude-opus-4-5" ;;
            *)      MODEL="claude-sonnet-4.6" ;;
        esac
    fi

    log "  ➕ Starting ${NAME} (provider=${PROVIDER}, model=${MODEL})..."

    docker run -d \
        --name "${CONTAINER_NAME}" \
        --env "AGENT_HUMAN_NAME=${NAME}" \
        --env "AGENTS_SHEET_ID=${SHEET_ID}" \
        --env "AI_PROVIDER=${PROVIDER}" \
        --env "AGENT_MODEL=${MODEL}" \
        --env "COPILOT_GITHUB_TOKEN=${COPILOT_GITHUB_TOKEN:-}" \
        --env "GH_TOKEN=${COPILOT_GITHUB_TOKEN:-}" \
        --env "GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json" \
        --volume "${SA_KEY}:/credentials/gsa-key.json:ro" \
        --volume "${HOME}/.copilot:/root/.copilot" \
        --volume "${DOCKER_SOCKET}:/var/run/docker.sock" \
        --volume "${REPO_ROOT}:/workspace" \
        --restart unless-stopped \
        "$IMAGE_NAME" \
        || { log "  ✗ Failed to start ${CONTAINER_NAME}"; continue; }

    log "  ✓ Started ${CONTAINER_NAME}"
    STARTED=$((STARTED + 1))
done < <(printf '%s' "$AGENTS" | jq -c '.')

info ""
info "Fleet sync complete: ${STARTED} started, ${SKIPPED} already running."
info "View containers:  docker ps --filter 'name=${CONTAINER_PREFIX}'"
info "View logs:        docker logs -f <container-name>"
