#!/usr/bin/env bash
# docker.test.sh — Docker-outside-of-Docker (DooD) capability tests.
#
# Verifies the container can reach the host Docker daemon and spawn
# sibling containers for parallel workloads.
#
# Tests:
#   1. Docker CLI is installed in the container
#   2. Docker socket is mounted and reachable
#   3. Container can list running containers (reads host state)
#   4. Container can run and remove a sibling container (full lifecycle)
#   5. Container can run docker compose (parallel workers)
#
# Usage:
#   bash dev-worker/tests/docker.test.sh [container-name]

set -uo pipefail

CONTAINER="${1:-waymark-dev-worker}"
source "$(dirname "$0")/lib/helpers.sh"

header "Docker-outside-of-Docker (parallel container spawning)"

# ── Docker CLI is installed ───────────────────────────────────────────────────
if exec_q "command -v docker >/dev/null 2>&1"; then
    DOCKER_CLI_VER=$(exec_q "docker --version 2>/dev/null" || echo "unknown")
    pass "Docker CLI installed: ${DOCKER_CLI_VER}"
else
    fail "Docker CLI not found in container"
    echo "  Check Dockerfile: apt-get install docker-ce-cli"
    summary; exit 1
fi

# ── Docker socket is mounted ───────────────────────────────────────────────────
if exec_q "test -S /var/run/docker.sock"; then
    pass "Docker socket mounted at /var/run/docker.sock"
else
    fail "Docker socket NOT mounted"
    echo "  Add to docker-compose.yml volumes:"
    echo "    - /var/run/docker.sock:/var/run/docker.sock"
    summary; exit 1
fi

# ── Container can reach Docker daemon ────────────────────────────────────────
DOCKER_INFO=$(exec_timeout 10 "docker info --format '{{.ServerVersion}}' 2>&1" || echo "FAILED")
if [[ "$DOCKER_INFO" != "FAILED" && -n "$DOCKER_INFO" && "$DOCKER_INFO" != *"error"* ]]; then
    pass "Docker daemon reachable — server version: ${DOCKER_INFO}"
else
    fail "Cannot reach Docker daemon"
    echo "  docker info output: ${DOCKER_INFO}"
    echo "  The socket is mounted but may have permission issues."
    echo "  Check: docker exec ${CONTAINER} ls -la /var/run/docker.sock"
    summary; exit 1
fi

# ── Can list running containers ───────────────────────────────────────────────
CONTAINER_LIST=$(exec_timeout 10 "docker ps --format '{{.Names}}' 2>&1" || echo "FAILED")
if [[ "$CONTAINER_LIST" != "FAILED" ]]; then
    COUNT=$(echo "$CONTAINER_LIST" | grep -c . || echo "0")
    pass "Can list running containers — ${COUNT} container(s) visible"
    # The current container should be in the list
    if echo "$CONTAINER_LIST" | grep -q "$CONTAINER"; then
        pass "  Self-visible: '${CONTAINER}' appears in docker ps"
    else
        skip "  Self not visible in docker ps (may use different container name)"
    fi
else
    fail "docker ps failed inside container"
fi

# ── Can spawn and remove a sibling container ──────────────────────────────────
# Run a minimal container (busybox), execute a command, then remove it.
# This is the core DooD capability: agent → spawn → verify → cleanup.
echo ""
echo "  Spawning a sibling container (busybox, 15s timeout)..."
TEST_CONTAINER="dood-test-$$"
SPAWN_RESULT=$(
    exec_timeout 15 \
        "docker run --rm --name '${TEST_CONTAINER}' busybox echo 'DOOD_OK' 2>&1" \
    || echo "SPAWN_FAILED"
)

if echo "$SPAWN_RESULT" | grep -q "DOOD_OK"; then
    pass "Sibling container spawned and executed successfully"
    pass "  (busybox container ran, output: DOOD_OK, auto-removed)"
elif echo "$SPAWN_RESULT" | grep -qi "pull\|Unable to find image"; then
    # Docker had to pull the image first — retry
    echo "  (pulling busybox image...)"
    SPAWN_RESULT2=$(exec_timeout 60 "docker run --rm busybox echo 'DOOD_OK' 2>&1" || echo "SPAWN_FAILED")
    if echo "$SPAWN_RESULT2" | grep -q "DOOD_OK"; then
        pass "Sibling container spawned (after image pull)"
    else
        fail "Sibling container spawn failed after pull: ${SPAWN_RESULT2}"
    fi
else
    fail "Sibling container spawn failed: ${SPAWN_RESULT}"
fi

# ── docker compose is available ───────────────────────────────────────────────
if exec_q "docker compose version >/dev/null 2>&1"; then
    COMPOSE_VER=$(exec_q "docker compose version --short 2>/dev/null" || echo "unknown")
    pass "docker compose available: ${COMPOSE_VER}"
else
    fail "docker compose not available"
    echo "  Check Dockerfile: apt-get install docker-compose-plugin"
fi

# ── Agent can scale itself ────────────────────────────────────────────────────
# This is a documentation test — we verify the compose file exists and the
# agent COULD scale (we don't actually scale to avoid spawning real agents).
if exec_q "test -f /workspace/dev-worker/docker-compose.yml"; then
    pass "dev-worker/docker-compose.yml accessible from container"
    echo "  Agent can scale: docker compose -f /workspace/dev-worker/docker-compose.yml up --scale agent=N -d"
else
    skip "dev-worker/docker-compose.yml not in workspace (different project mounted)"
fi

summary
