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
WATCHDOG  := dev-worker/scripts/host-watchdog.sh
PIDFILE   := .watchdog.pid

# Overridable from the command line or environment
AGENT_COMMAND ?= @waymark-builder start
AGENT_NAME    ?=
AGENT_MODEL   ?= copilot/claude-sonnet-4.6

# Service-account key path for host-side Google Sheets API calls
export GOOGLE_APPLICATION_CREDENTIALS ?= $(HOME)/.config/gcloud/waymark-service-account-key.json

.PHONY: help start stop restart build logs status vnc test auth workboard watchdog watchdog-stop watchdog-logs clean

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

start: ## Start the agent container + host watchdog
	AGENT_COMMAND="$(AGENT_COMMAND)" \
	AGENT_NAME="$(AGENT_NAME)" \
	AGENT_MODEL="$(AGENT_MODEL)" \
	$(COMPOSE) up -d --build
	@# Start the host-side watchdog (monitors heartbeats, restarts stale containers)
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "  Host watchdog already running (pid $$(cat $(PIDFILE)))"; \
	else \
		nohup bash $(WATCHDOG) --loop > /tmp/waymark-watchdog.log 2>&1 & echo $$! > $(PIDFILE); \
		echo "  Host watchdog started (pid $$(cat $(PIDFILE)), log: /tmp/waymark-watchdog.log)"; \
	fi
	@echo ""
	@echo "  ✓ Agent started"
	@echo "    Desktop: http://localhost:6080/vnc.html"
	@echo "    Logs:    make logs"
	@echo "    Watchdog: make watchdog-logs"
	@echo ""

stop: ## Stop the agent container + host watchdog
	@# Kill host watchdog first
	@if [ -f $(PIDFILE) ]; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null && echo "  Host watchdog stopped" || true; \
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

# ── Host watchdog ─────────────────────────────────────────────────────

watchdog: ## Start the host watchdog (standalone, without starting the container)
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "  Host watchdog already running (pid $$(cat $(PIDFILE)))"; \
	else \
		nohup bash $(WATCHDOG) --loop > /tmp/waymark-watchdog.log 2>&1 & echo $$! > $(PIDFILE); \
		echo "  Host watchdog started (pid $$(cat $(PIDFILE)), log: /tmp/waymark-watchdog.log)"; \
	fi

watchdog-stop: ## Stop the host watchdog
	@if [ -f $(PIDFILE) ]; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null && echo "  Host watchdog stopped" || echo "  Watchdog not running"; \
		rm -f $(PIDFILE); \
	else \
		echo "  No watchdog PID file found"; \
	fi

watchdog-logs: ## Tail the host watchdog log
	@tail -f /tmp/waymark-watchdog.log 2>/dev/null || echo "  No watchdog log found (is it running?)"

# ── Cleanup ───────────────────────────────────────────────────────────

clean: ## Stop container, remove image and auth volume (full reset)
	@echo "This will remove the container, image, and auth tokens."
	@echo "You will need to re-authenticate GitHub Copilot after this."
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@if [ -f $(PIDFILE) ]; then kill $$(cat $(PIDFILE)) 2>/dev/null || true; rm -f $(PIDFILE); fi
	$(COMPOSE) down --rmi local -v
	@echo "  ✓ Cleaned (re-run: make auth && make start)"
