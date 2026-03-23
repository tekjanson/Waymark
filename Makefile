# ═══════════════════════════════════════════════════════════════════════
# Waymark Agent — Makefile
# ═══════════════════════════════════════════════════════════════════════
#
# Quick start:
#   make start          Start the agent container (default: @waymark-builder)
#   make stop           Stop the agent container
#   make logs           Tail live agent logs
#   make status         Show container + workboard status
#   make test           Run diagnostic test suite
#   make help           Show all available commands
#
# Multi-agent:
#   make start AGENT_NAME=alpha
#   make start AGENT_NAME=beta AGENT_COMMAND="@waymark-builder-sub-board start"
#
# ═══════════════════════════════════════════════════════════════════════

COMPOSE   := docker compose -f dev-worker/docker-compose.yml
CONTAINER := waymark-dev-worker
CYCLE_HOURS := 4
PIDFILE   := .agent-cycle.pid

# Overridable from the command line or environment
AGENT_COMMAND ?= @waymark-builder start
AGENT_NAME    ?=
AGENT_MODEL   ?= copilot/claude-sonnet-4.6

# Service-account key path for host-side Google Sheets API calls
export GOOGLE_APPLICATION_CREDENTIALS ?= $(HOME)/.config/gcloud/waymark-service-account-key.json

.PHONY: help run start stop restart build logs status vnc test auth workboard clean

# ── Core commands ─────────────────────────────────────────────────────

help: ## Show this help
	@echo ""
	@echo "  Waymark Agent Commands"
	@echo "  ══════════════════════"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Variables (override with VAR=value):"
	@echo "    AGENT_COMMAND   Command sent to Copilot Chat (default: @waymark-builder start)"
	@echo "    AGENT_NAME      Named agent identity for multi-agent (default: unset)"
	@echo "    AGENT_MODEL     LLM model (default: copilot/claude-sonnet-4.6)"
	@echo ""
	@echo "  Examples:"
	@echo "    make start                                          # Default agent"
	@echo "    make start AGENT_NAME=alpha                         # Named agent"
	@echo "    make start AGENT_COMMAND='@waymark-builder-sub-board start'"
	@echo "    make logs                                           # Tail live output"
	@echo ""

start: ## Start the agent container
	AGENT_COMMAND="$(AGENT_COMMAND)" \
	AGENT_NAME="$(AGENT_NAME)" \
	AGENT_MODEL="$(AGENT_MODEL)" \
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  ✓ Agent started"
	@echo "    Desktop: http://localhost:6080/vnc.html"
	@echo "    Logs:    make logs"
	@echo ""

run: ## Start the agent + restart it every 4 hours
	@# Kill any existing cycle loop
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null || true; \
	fi
	AGENT_COMMAND="$(AGENT_COMMAND)" \
	AGENT_NAME="$(AGENT_NAME)" \
	AGENT_MODEL="$(AGENT_MODEL)" \
	$(COMPOSE) up -d --build
	@# Background loop: sleep CYCLE_HOURS then rebuild+restart
	@nohup bash -c 'while true; do sleep $$(($(CYCLE_HOURS) * 3600)); \
		echo "[cycle $$(date)] Restarting agent ($(CYCLE_HOURS)h cycle)..."; \
		AGENT_COMMAND="$(AGENT_COMMAND)" AGENT_NAME="$(AGENT_NAME)" AGENT_MODEL="$(AGENT_MODEL)" \
		$(COMPOSE) up -d --build; \
	done' > /tmp/waymark-cycle.log 2>&1 & echo $$! > $(PIDFILE)
	@echo ""
	@echo "  ✓ Agent started (restarts every $(CYCLE_HOURS)h)"
	@echo "    Desktop: http://localhost:6080/vnc.html"
	@echo "    Logs:    make logs"
	@echo "    Cycle:   tail -f /tmp/waymark-cycle.log"
	@echo ""

stop: ## Stop the agent container
	@# Kill cycle loop if running
	@if [ -f $(PIDFILE) ]; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null || true; \
		rm -f $(PIDFILE); \
	fi
	$(COMPOSE) down
	@echo "  ✓ Agent stopped"

restart: ## Restart the agent container
	$(COMPOSE) restart
	@echo "  ✓ Agent restarted"

build: ## Rebuild the container image (no cache)
	$(COMPOSE) build --no-cache

# ── Observability ─────────────────────────────────────────────────────

logs: ## Tail live agent logs (Ctrl+C to stop)
	docker logs -f $(CONTAINER) 2>&1

status: ## Show container status and workboard summary
	@echo "── Container ──"
	@docker ps --filter name=$(CONTAINER) --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  Not running"
	@echo ""
	@echo "── Workboard ──"
	@GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/waymark-service-account-key.json \
		node scripts/check-workboard.js 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  (unavailable)"

vnc: ## Open the VNC desktop in your browser
	xdg-open http://localhost:6080/vnc.html 2>/dev/null || open http://localhost:6080/vnc.html 2>/dev/null || echo "Open http://localhost:6080/vnc.html"

# ── Testing & diagnostics ────────────────────────────────────────────

test: ## Run the container diagnostic test suite
	bash dev-worker/test.sh

auth: ## Run GitHub Copilot auth setup for the container
	bash dev-worker/setup-auth.sh

# ── Workboard ─────────────────────────────────────────────────────────

workboard: ## Show current workboard state (todo/in-progress counts)
	@GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/waymark-service-account-key.json \
		node scripts/check-workboard.js

# ── Cleanup ───────────────────────────────────────────────────────────

clean: ## Stop container, remove image and auth volume (full reset)
	@echo "This will remove the container, image, and auth tokens."
	@echo "You will need to re-authenticate GitHub Copilot after this."
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	$(COMPOSE) down --rmi local -v
	@echo "  ✓ Cleaned (re-run: make auth && make start)"
