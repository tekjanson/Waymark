# ═══════════════════════════════════════════════════════════════════════
# Waymark Agent — Makefile
# ═══════════════════════════════════════════════════════════════════════
#
# Quick start:
#   make start          Start the agent container (default: @waymark-builder)
#   make qa-patrol      Start the QA patrol agent (reviews workboard QA items)
#   make stop           Stop the agent container
#   make logs           Tail live agent logs
#   make status         Show container + workboard status
#   make qa-status      Show pending QA items with verdict status
#   make test           Run diagnostic test suite
#   make help           Show all available commands
#
# Multi-agent:
#   make start AGENT_NAME=alpha
#   make start AGENT_NAME=beta AGENT_COMMAND="@waymark-builder-sub-board start"#
#   QA patrol:
#   make qa-patrol                              # Start QA patrol agent
#   make qa-status                              # Show QA items with verdicts#
# ═══════════════════════════════════════════════════════════════════════

COMPOSE     := docker compose -f dev-worker/docker-compose.yml
P2P_COMPOSE := docker compose -f docker-compose.yml
CONTAINER := waymark-dev-worker
CYCLE_HOURS := 4
PIDFILE   := .agent-cycle.pid

# Overridable from the command line or environment
AGENT_COMMAND ?= @waymark-orchestrator start
AGENT_NAME    ?=
AGENT_MODEL   ?= copilot/claude-sonnet-4.6
BOARD_URL     ?=

# Allow passing a URL as a positional argument, e.g.: make run https://...
# Extract any http(s):// goal and treat it as BOARD_URL if not already set
_URL_GOAL := $(filter https://%,$(MAKECMDGOALS))$(filter http://%,$(MAKECMDGOALS))
ifneq ($(_URL_GOAL),)
  override BOARD_URL := $(_URL_GOAL)
endif

# Suppress "No rule to make target" for URL arguments (and any other non-target args)
.DEFAULT: ; @true

# Service-account key path for host-side Google Sheets API calls
export GOOGLE_APPLICATION_CREDENTIALS ?= $(HOME)/.config/gcloud/waymark-service-account-key.json
# Signaling sheet ID consumed by the p2p-server container (can also be set in .env)
export WAYMARK_SIGNALING_SHEET_ID ?=1oHfqlGmbKovZgLNaVCCd3QeGBWbaJNiIVCJsS7ZFCCQ

.PHONY: help run start stop restart build logs status vnc test mesh-test auth ensure-auth workboard qa-patrol qa-status clean

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
	@echo "    AGENT_COMMAND   Command sent to Copilot Chat (default: @waymark-orchestrator start)"
	@echo "    AGENT_NAME      Named agent identity for multi-agent (default: unset)"
	@echo "    AGENT_MODEL     LLM model (default: copilot/claude-sonnet-4.6)"
	@echo "    BOARD_URL       Google Sheets URL to target (persisted to workboard-config.json)"
	@echo ""
	@echo "  Examples:"
	@echo "    make run https://docs.google.com/spreadsheets/d/SHEET_ID/edit  # Orchestrator on board"
	@echo "    make run BOARD_URL=https://...                                  # Same, explicit var"
	@echo "    make start                                                      # Default orchestrator"
	@echo "    make qa-patrol                                                  # QA patrol agent"
	@echo "    make start AGENT_NAME=alpha                                     # Named agent"
	@echo "    make qa-status                                                  # Show QA verdicts"
	@echo "    make logs                                                       # Tail live output"
	@echo ""

ensure-auth: ## Check for Copilot auth tokens; run setup-auth.sh if missing
	@AUTH_VOLUME_DATA="/home/$(USER)/.local/share/docker/volumes/dev-worker_waymark-vscode-auth/_data"; \
	AUTH_DIR="$$AUTH_VOLUME_DATA/vscode.github-authentication"; \
	VSCDB="$$AUTH_VOLUME_DATA/state.vscdb"; \
	AUTH_OK=false; \
	[ -d "$$AUTH_DIR" ] && AUTH_OK=true; \
	if [ -f "$$VSCDB" ] && command -v sqlite3 >/dev/null 2>&1; then \
		ROWS=$$(sqlite3 "$$VSCDB" "SELECT count(*) FROM ItemTable WHERE key LIKE 'secret://%github%';" 2>/dev/null || echo 0); \
		[ "$$ROWS" -gt 0 ] && AUTH_OK=true; \
	fi; \
	if $$AUTH_OK; then \
		echo "  ✓ Copilot auth tokens present — skipping setup"; \
	else \
		echo "  ⚠ No Copilot auth tokens found — running setup-auth.sh..."; \
		bash dev-worker/setup-auth.sh; \
	fi

start: ensure-auth ## Start the agent container
	@if [ -n "$(BOARD_URL)" ]; then node scripts/save-board-url.js "$(BOARD_URL)"; fi
	AGENT_COMMAND="$(AGENT_COMMAND)" \
	AGENT_NAME="$(AGENT_NAME)" \
	AGENT_MODEL="$(AGENT_MODEL)" \
	WAYMARK_WORKBOARD_URL="$(BOARD_URL)" \
	$(COMPOSE) up -d --build
	WAYMARK_SIGNALING_SHEET_ID="$(WAYMARK_SIGNALING_SHEET_ID)" \
	$(P2P_COMPOSE) up -d --build p2p-server
	@echo ""
	@echo "  ✓ Agent started"
	@echo "    Desktop: http://localhost:6080/vnc.html"
	@echo "    Logs:    make logs"
	@echo ""

qa-patrol: ensure-auth ## Start the QA patrol agent (reviews workboard QA items)
	AGENT_COMMAND="@waymark-manual-qa qa patrol" \
	AGENT_NAME="QA" \
	AGENT_MODEL="$(AGENT_MODEL)" \
	WAYMARK_WORKBOARD_URL="$(BOARD_URL)" \
	$(COMPOSE) up -d --build
	WAYMARK_SIGNALING_SHEET_ID="$(WAYMARK_SIGNALING_SHEET_ID)" \
	$(P2P_COMPOSE) up -d --build p2p-server
	@echo ""
	@echo "  ✓ QA Patrol agent started"
	@echo "    Desktop: http://localhost:6080/vnc.html"
	@echo "    Logs:    make logs"
	@echo "    Status:  make qa-status"
	@echo ""

run: ensure-auth ## Start the orchestrator + restart it every 4 hours  (usage: make run BOARD_URL=https://...)
	@# Persist board URL to workboard-config.json so host-side scripts use it too
	@if [ -n "$(BOARD_URL)" ]; then node scripts/save-board-url.js "$(BOARD_URL)"; fi
	@# Kill any existing cycle loop
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null || true; \
	fi
	AGENT_COMMAND="$(AGENT_COMMAND)" \
	AGENT_NAME="$(AGENT_NAME)" \
	AGENT_MODEL="$(AGENT_MODEL)" \
	WAYMARK_WORKBOARD_URL="$(BOARD_URL)" \
	$(COMPOSE) up -d --build
	WAYMARK_SIGNALING_SHEET_ID="$(WAYMARK_SIGNALING_SHEET_ID)" \
	$(P2P_COMPOSE) up -d --build p2p-server
	@# Background loop: sleep CYCLE_HOURS then rebuild+restart
	@nohup bash -c 'while true; do sleep $$(($(CYCLE_HOURS) * 3600)); \
		echo "[cycle $$(date)] Restarting agent ($(CYCLE_HOURS)h cycle)..."; \
		AGENT_COMMAND="$(AGENT_COMMAND)" AGENT_NAME="$(AGENT_NAME)" AGENT_MODEL="$(AGENT_MODEL)" WAYMARK_WORKBOARD_URL="$(BOARD_URL)" \
		$(COMPOSE) up -d --build; \
		WAYMARK_SIGNALING_SHEET_ID="$(WAYMARK_SIGNALING_SHEET_ID)" \
		$(P2P_COMPOSE) up -d --build p2p-server; \
	done' > /tmp/waymark-cycle.log 2>&1 & echo $$! > $(PIDFILE)
	@echo ""
	@echo "  ✓ Orchestrator started (restarts every $(CYCLE_HOURS)h)"
	@if [ -n "$(BOARD_URL)" ]; then echo "    Board:   $(BOARD_URL)"; fi
	@echo "    Desktop: http://localhost:6080/vnc.html"
	@echo "    Logs:    make logs"
	@echo "    Cycle:   tail -f /tmp/waymark-cycle.log"
	@echo ""

stop: ## Stop the agent container and p2p-server
	@# Kill cycle loop if running
	@if [ -f $(PIDFILE) ]; then \
		kill $$(cat $(PIDFILE)) 2>/dev/null || true; \
		rm -f $(PIDFILE); \
	fi
	$(COMPOSE) down
	$(P2P_COMPOSE) rm -sf p2p-server
	@echo "  ✓ Agent and p2p-server stopped"

restart: ## Restart the agent container and p2p-server
	$(COMPOSE) restart
	$(P2P_COMPOSE) restart p2p-server
	@echo "  ✓ Agent and p2p-server restarted"

build: ## Rebuild the container image (no cache)
	$(COMPOSE) build --no-cache

# ── Observability ─────────────────────────────────────────────────────

logs: ## Tail live agent logs (Ctrl+C to stop)
	docker logs -f $(CONTAINER) 2>&1

agent-logs: ## Tail the latest agent session log file from the container (Ctrl+C to stop)
	@mkdir -p agent-logs
	@LATEST=$$(ls -t agent-logs/session-*.log 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then \
		echo "  No agent session logs yet. Start the container and wait for the first cycle."; \
	else \
		echo "  Tailing $$LATEST (Ctrl+C to stop)"; \
		tail -f "$$LATEST"; \
	fi

agent-logs-list: ## List all agent session log files
	@ls -lht agent-logs/session-*.log 2>/dev/null || echo "  No session logs found."

chat-logs: ## Tail the latest Copilot chat debug log from the container (Ctrl+C to stop)
	@mkdir -p agent-logs/vscode-workspace-storage
	@LATEST=$$(find agent-logs/vscode-workspace-storage -path '*/GitHub.copilot-chat/debug-logs/*' -name '*.txt' -o -name '*.log' 2>/dev/null | xargs ls -t 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then \
		echo "  No Copilot chat logs yet. Start the container and wait for the first agent turn."; \
	else \
		echo "  Tailing $$LATEST (Ctrl+C to stop)"; \
		tail -f "$$LATEST"; \
	fi

chat-logs-list: ## List all Copilot chat debug log files from the container
	@find agent-logs/vscode-workspace-storage -path '*/GitHub.copilot-chat/debug-logs/*' \( -name '*.txt' -o -name '*.log' \) 2>/dev/null \
		| xargs ls -lht 2>/dev/null \
		|| echo "  No Copilot chat logs found. Is the container running?"

status: ## Show container status and workboard summary
	@echo "── Container ──"
	@docker ps --filter name=$(CONTAINER) --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "  Not running"
	@echo ""
	@echo "── Workboard ──"
	@GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/waymark-service-account-key.json \
		node scripts/check-workboard.js --qa-details 2>/dev/null | \
		node -e " \
			const d=JSON.parse(require('fs').readFileSync(0,'utf8')); \
			const qa=Array.isArray(d.qa)?d.qa:[]; \
			const reviewed=qa.filter(i=>(i.notes||[]).some(n=>n.text.startsWith('QA VERDICT:'))).length; \
			console.log('  To Do:        '+d.todo.length); \
			console.log('  In Progress:  '+d.inProgress.length); \
			console.log('  QA:           '+qa.length+' ('+reviewed+' reviewed, '+(qa.length-reviewed)+' pending)'); \
			console.log('  Done:         '+d.done); \
		" 2>/dev/null || echo "  (unavailable)"
	@echo ""
	@echo "── QA Verdicts ──"
	@ls -1 generated/qa-verdicts/*.md 2>/dev/null | wc -l | xargs -I{} echo "  {} local verdict reports" || echo "  None yet"

vnc: ## Open the VNC desktop in your browser
	xdg-open http://localhost:6080/vnc.html 2>/dev/null || open http://localhost:6080/vnc.html 2>/dev/null || echo "Open http://localhost:6080/vnc.html"

# ── Testing & diagnostics ────────────────────────────────────────────

test: ## Run the container diagnostic test suite
	bash dev-worker/test.sh

mesh-test: ## Run the WebRTC P2P mesh E2E test jig against the real signaling sheet + Android (usage: make mesh-test [ADB_DEVICE=ip:port] [SCENARIO=fresh-join])
	@WAYMARK_OAUTH_TOKEN_PATH=~/.config/gcloud/waymark-oauth-token.json \
	GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/waymark-service-account-key.json \
	ADB_DEVICE="$(ADB_DEVICE)" \
	SIGNAL_SHEET="$(SIGNAL_SHEET)" \
	node scripts/mesh-test.mjs $(if $(SCENARIO),--scenario $(SCENARIO),--all)

auth: ## Run GitHub Copilot auth setup for the container
	bash dev-worker/setup-auth.sh

# ── Workboard ─────────────────────────────────────────────────────────

workboard: ## Show current workboard state (todo/in-progress counts)
	@GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/waymark-service-account-key.json \
		node scripts/check-workboard.js

compile-all: ## Compile all 35 template agents (skip unchanged; use FORCE=1 to recompile all)
	@if [ "$(FORCE)" = "1" ]; then \
		node scripts/compile-all-agents.mjs --force; \
	else \
		node scripts/compile-all-agents.mjs; \
	fi

qa-status: ## Show QA items with verdict status (pass/fail/pending)
	@GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/waymark-service-account-key.json \
		node scripts/check-workboard.js --qa-details 2>/dev/null | \
		node -e " \
			const d=JSON.parse(require('fs').readFileSync(0,'utf8')); \
			const qa=Array.isArray(d.qa)?d.qa:[]; \
			if(!qa.length){console.log('  No items in QA');process.exit(0)} \
			console.log('  ── QA Items (' + qa.length + ') ──'); \
			console.log(''); \
			qa.forEach(i=>{ \
				const v=(i.notes||[]).find(n=>n.text.startsWith('QA VERDICT:')); \
				const icon=v?(v.text.includes('PASS')?'✅':v.text.includes('FAIL')?'❌':'⚠️'):'⏳'; \
				const verdict=v?v.text.replace('QA VERDICT: ','').substring(0,80):'Pending review'; \
				console.log('  '+icon+' Row '+i.row+': '+i.task); \
				console.log('    Branch: '+(i.branch||'N/A')); \
				console.log('    Verdict: '+verdict); \
				console.log(''); \
			}); \
		" 2>/dev/null || echo "  (unavailable — check GOOGLE_APPLICATION_CREDENTIALS)"

# ── Cleanup ───────────────────────────────────────────────────────────

clean: ## Stop container, remove image and auth volume (full reset)
	@echo "This will remove the container, image, auth tokens, and p2p-server container."
	@echo "You will need to re-authenticate GitHub Copilot after this."
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	$(COMPOSE) down --rmi local -v
	$(P2P_COMPOSE) rm -sf p2p-server
	@echo "  ✓ Cleaned (re-run: make auth && make start)"
