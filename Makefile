# ═══════════════════════════════════════════════════════════════════════
# Waymark — Makefile
# ═══════════════════════════════════════════════════════════════════════
#
#   make up    ← THE ONE COMMAND. Starts everything, opens the UI.
#   make down  ← Stops everything.
#
# After `make up`, use the Waymark UI to drive everything:
#   • Drop tasks in the kanban workboard → agents pick them up
#   • Edit tuning strings in the Agent Registry → agents reload on restart
#   • The UI IS the control plane. No more CLI flags needed.
#
# ═══════════════════════════════════════════════════════════════════════

# Load .env if present (silently — don't fail if missing)
-include .env
export

COMPOSE       := docker compose -f dev-worker/docker-compose.yml
CONTAINER     ?= waymark-dev-worker
SERVER_PID    := .server.pid

# Agent fleet config — comes from .env, not CLI flags
# Set AGENT_NAMES in .env to control which agents start (space-separated)
AGENT_NAMES   ?= Alex
PROVIDER      ?= auto
MODEL         ?= claude-sonnet-4.6
CLAUDE_MODEL  ?= claude-opus-4-5
COMMAND       ?= @waymark-builder start
AGENTS_SHEET  ?= $(AGENTS_SHEET_ID)

# Fleet alias: FLEET_NAMES falls back to AGENT_NAMES
FLEET_NAMES   ?= $(AGENT_NAMES)

# Service-account key
export GOOGLE_APPLICATION_CREDENTIALS ?= $(HOME)/.config/gcloud/waymark-service-account-key.json

# Derived compose env block
define AGENT_ENV
AGENT_HUMAN_NAME="$(NAME)" \
AGENT_NAME="$(NAME)" \
AI_PROVIDER="$(PROVIDER)" \
AGENT_MODEL="$(MODEL)" \
CLAUDE_MODEL="$(CLAUDE_MODEL)" \
AGENT_COMMAND="$(COMMAND)" \
AGENTS_SHEET_ID="$(AGENTS_SHEET)" \
CONTAINER_NAME="$(CONTAINER)"
endef

.PHONY: help up down \
        dev test test-watch test-full \
        agent-start agent-stop agent-restart agent-build agent-rebuild agent-logs agent-status agent-shell \
        agent-test agent-test-boot agent-test-suite \
        fleet-start fleet-stop fleet-status \
        auth-copilot auth-claude auth-check token-extract \
        workboard clean

# ── THE ONE COMMAND ───────────────────────────────────────────────────

up: ## Start everything and open the Waymark UI  (the only command you need)
	@echo ""
	@echo "  ╔══════════════════════════════════════════╗"
	@echo "  ║         Starting Waymark                 ║"
	@echo "  ╚══════════════════════════════════════════╝"
	@echo ""
	@# ── 1. Credentials check ──────────────────────────────────────────
	@# Auto-extract Copilot token from keychain if not in .env
	@if [ -z "$(COPILOT_GITHUB_TOKEN)" ] && python3 -c "import secretstorage" 2>/dev/null; then \
		TOKEN=$$(python3 -c "\
import secretstorage; \
bus = secretstorage.dbus_init(); \
coll = secretstorage.get_default_collection(bus); \
[print(item.get_secret().decode()) for item in coll.get_all_items() if item.get_label() and 'copilot-cli' in item.get_label()]; \
" 2>/dev/null | head -1); \
		if [ -n "$$TOKEN" ]; then \
			if grep -q "COPILOT_GITHUB_TOKEN=" .env 2>/dev/null; then \
				sed -i "s|COPILOT_GITHUB_TOKEN=.*|COPILOT_GITHUB_TOKEN=$$TOKEN|" .env; \
			else \
				printf "\n# GitHub Copilot OAuth token (auto-extracted)\nCOPILOT_GITHUB_TOKEN=$$TOKEN\n" >> .env; \
			fi; \
			echo "  ✓  Auto-extracted Copilot token from keychain"; \
			export COPILOT_GITHUB_TOKEN=$$TOKEN; \
		fi; \
	fi
	@missing=0; \
	test -n "$(COPILOT_GITHUB_TOKEN)" || test -n "$(ANTHROPIC_API_KEY)" || { \
		echo "  ✗  No AI credentials found."; \
		echo "     Copilot: make auth-copilot  (or: make token-extract if already logged in)"; \
		echo "     Claude:  export ANTHROPIC_API_KEY=sk-ant-... (add to .env)"; \
		missing=1; \
	}; \
	test -f "$(GOOGLE_APPLICATION_CREDENTIALS)" || { \
		echo "  ✗  Google service-account key not found:"; \
		echo "     $(GOOGLE_APPLICATION_CREDENTIALS)"; \
		missing=1; \
	}; \
	[ "$$missing" = "0" ] || { echo ""; echo "  Fix the above and re-run: make up"; echo ""; exit 1; }
	@echo "  ✓  Credentials OK"
	@echo ""
	@# ── Ensure Docker socket is accessible (rootless Docker) ─────────────
	@SOCK=$${DOCKER_SOCKET_PATH:-/var/run/docker.sock}; \
	if [ -S "$$SOCK" ]; then chmod o+rw "$$SOCK" 2>/dev/null || true; fi
	@# ── 2. Waymark web server ─────────────────────────────────────────
	@if [ -f $(SERVER_PID) ] && kill -0 $$(cat $(SERVER_PID)) 2>/dev/null; then \
		echo "  ✓  Web server already running (PID $$(cat $(SERVER_PID)))"; \
	else \
		nohup node server/index.js > /tmp/waymark-server.log 2>&1 & echo $$! > $(SERVER_PID); \
		sleep 1; \
		kill -0 $$(cat $(SERVER_PID)) 2>/dev/null \
			&& echo "  ✓  Web server started → http://localhost:$(PORT)" \
			|| { echo "  ✗  Web server failed — check /tmp/waymark-server.log"; exit 1; }; \
	fi
	@echo ""
	@# ── 3. Build image if needed ──────────────────────────────────────
	@if docker image inspect waymark-dev-worker:latest > /dev/null 2>&1; then \
		echo "  ✓  Container image ready"; \
	else \
		echo "  ⏳  Building container image (first time, ~2 min)..."; \
		$(COMPOSE) build; \
	fi
	@echo ""
	@# ── 4. Start agent fleet ──────────────────────────────────────────
	@echo "  ⏳  Starting agents: $(AGENT_NAMES)"
	@for name in $(AGENT_NAMES); do \
		cname="dev-worker-$$(echo $$name | tr '[:upper:]' '[:lower:]')"; \
		if docker ps --filter "name=^$$cname$$" --filter "status=running" \
				--format "{{.Names}}" 2>/dev/null | grep -q "^$$cname$$"; then \
			echo "  ✓  $$name ($$cname) already running"; \
		else \
			AGENT_HUMAN_NAME="$$name" \
			AGENT_NAME="$$name" \
			AI_PROVIDER="$(PROVIDER)" \
			AGENT_MODEL="$(MODEL)" \
			CLAUDE_MODEL="$(CLAUDE_MODEL)" \
			AGENT_COMMAND="$(COMMAND)" \
			AGENTS_SHEET_ID="$(AGENTS_SHEET)" \
			CONTAINER_NAME="$$cname" \
			$(COMPOSE) up -d 2>/dev/null \
			&& echo "  ✓  $$name started ($$cname)" \
			|| echo "  ✗  $$name failed to start — run: make agent-logs CONTAINER=$$cname"; \
		fi; \
	done
	@echo ""
	@# ── 5. Open the UI ────────────────────────────────────────────────
	@sleep 1
	@xdg-open http://localhost:$(PORT) 2>/dev/null \
		|| open http://localhost:$(PORT) 2>/dev/null \
		|| true
	@echo "  ════════════════════════════════════════════════"
	@echo "  Waymark UI →  http://localhost:$(PORT)"
	@echo ""
	@echo "  Use the UI to drive everything from here:"
	@echo "    • Kanban workboard → drop tasks → agents pick up"
	@echo "    • Agent Registry   → edit tuning → agents reload"
	@echo ""
	@echo "  Logs:   make agent-logs"
	@echo "  Stop:   make down"
	@echo "  ════════════════════════════════════════════════"
	@echo ""

down: ## Stop everything (web server + all agent containers)
	@echo "Stopping Waymark..."
	@# Stop web server
	@if [ -f $(SERVER_PID) ]; then \
		kill $$(cat $(SERVER_PID)) 2>/dev/null && echo "  ✓  Web server stopped" || true; \
		rm -f $(SERVER_PID); \
	fi
	@# Stop all dev-worker containers
	@docker ps --filter "name=dev-worker" --format "{{.Names}}" | \
		xargs -r -I{} sh -c 'docker stop {} && docker rm {} && echo "  ✓  {} stopped"'
	@echo "  ✓  Done"

# ── Help ──────────────────────────────────────────────────────────────

help: ## Show this help
	@echo ""
	@echo "  Waymark"
	@echo "  ═══════════════════════════════════════"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(firstword $(MAKEFILE_LIST)) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Configure in .env (not CLI flags):"
	@echo "    AGENT_NAMES       Space-separated list of agent names  (default: Alex)"
	@echo "    PROVIDER          copilot | claude | auto              (default: auto)"
	@echo "    MODEL             Copilot model                        (default: claude-sonnet-4.6)"
	@echo "    CLAUDE_MODEL      Anthropic model                      (default: claude-opus-4-5)"
	@echo "    AGENTS_SHEET_ID   Google Sheet ID of Agent Registry"
	@echo "    ANTHROPIC_API_KEY Claude API key (if using Claude)"
	@echo ""



dev: ## Start the Waymark dev server on localhost:3000
	GITHUB_SOURCE_LOCAL=true node server/index.js

test: ## Run Playwright E2E suite (headless)
	@# Kill any user-facing server so Playwright can start WAYMARK_LOCAL=true server
	@if [ -f $(SERVER_PID) ] && kill -0 $$(cat $(SERVER_PID)) 2>/dev/null; then \
		kill $$(cat $(SERVER_PID)) 2>/dev/null; rm -f $(SERVER_PID); sleep 1; \
	fi
	@# Kill any stray non-test server on port 3000
	@for pid in $$(lsof -ti:3000 -sTCP:LISTEN 2>/dev/null); do \
		cmd=$$(ps -p $$pid -o args= 2>/dev/null); \
		if echo "$$cmd" | grep -qv "WAYMARK_LOCAL=true"; then \
			kill $$pid 2>/dev/null || true; \
		fi; \
	done; sleep 1
	npx playwright test --config tests/playwright.config.js

test-watch: ## Run tests headed (see the browser)
	@if [ -f $(SERVER_PID) ] && kill -0 $$(cat $(SERVER_PID)) 2>/dev/null; then \
		kill $$(cat $(SERVER_PID)) 2>/dev/null; rm -f $(SERVER_PID); sleep 1; \
	fi
	npx playwright test --config tests/playwright.config.js --headed --workers 1

test-full: ## Run full E2E suite including slow tests
	@if [ -f $(SERVER_PID) ] && kill -0 $$(cat $(SERVER_PID)) 2>/dev/null; then \
		kill $$(cat $(SERVER_PID)) 2>/dev/null; rm -f $(SERVER_PID); sleep 1; \
	fi
	npx playwright test --config tests/playwright.config.js --workers 4

# ── Dev-worker: single agent ──────────────────────────────────────────

agent-start: ## Start one agent container  [NAME=Alex PROVIDER=auto MODEL=...]
	$(AGENT_ENV) $(COMPOSE) up -d --build
	@echo ""
	@echo "  ✓ Agent started — $(if $(NAME),$(NAME),<unnamed>) [$(PROVIDER)/$(MODEL)]"
	@echo "    Logs:   make agent-logs"
	@echo "    Shell:  make agent-shell"
	@echo "    Stop:   make agent-stop"
	@echo ""

agent-stop: ## Stop the agent container
	CONTAINER_NAME="$(CONTAINER)" $(COMPOSE) down
	@echo "  ✓ $(CONTAINER) stopped"

agent-restart: ## Restart the agent (picks up new tuning from sheet)
	CONTAINER_NAME="$(CONTAINER)" $(COMPOSE) restart
	@echo "  ✓ $(CONTAINER) restarted — tuning will reload on next session"

agent-build: ## Rebuild the container image (no cache)
	$(COMPOSE) build --no-cache
	@echo "  ✓ Image rebuilt"

agent-rebuild: ## Stop → rebuild → start (full reset with new image)
	$(AGENT_ENV) $(COMPOSE) down
	$(COMPOSE) build --no-cache
	$(AGENT_ENV) $(COMPOSE) up -d
	@echo "  ✓ Rebuilt and started — $(if $(NAME),$(NAME),<unnamed>)"
	@echo "    Logs: make agent-logs"

agent-logs: ## Tail live agent output (Ctrl+C to stop)
	docker logs -f $(CONTAINER) 2>&1

agent-status: ## Show running agents + workboard summary
	@echo "── Containers ──────────────────────────────────────────"
	@docker ps --filter "name=dev-worker" \
		--format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}" 2>/dev/null \
		|| echo "  (none running)"
	@echo ""
	@echo "── Workboard ───────────────────────────────────────────"
	@node scripts/check-workboard.js 2>/dev/null \
		| python3 -c "import json,sys; d=json.load(sys.stdin); \
		  print(f'  To Do: {len(d.get(\"todo\",[]))}  In Progress: {len(d.get(\"inProgress\",[]))}  QA: {d.get(\"qa\",0)}  Done: {d.get(\"done\",0)}')" \
		2>/dev/null || echo "  (workboard unavailable — check credentials)"
	@echo ""

agent-shell: ## Open a bash shell inside the running agent container
	docker exec -it $(CONTAINER) bash

# ── Dev-worker: tests ──────────────────────────────────────────────────

agent-test: ## Quick health check (boot + auth, ~30s, no AI calls)
	bash dev-worker/tests/run-tests.sh --only boot,auth --container $(CONTAINER)

agent-test-boot: ## Just the boot suite (fastest, infra only)
	bash dev-worker/tests/run-tests.sh --only boot --container $(CONTAINER)

agent-test-suite: ## Full E2E suite — real AI creds, real browser, real workspace
	bash dev-worker/tests/run-tests.sh --container $(CONTAINER) $(if $(ONLY),--only $(ONLY),) $(if $(SKIP),--skip $(SKIP),)



fleet-start: ## Start all fleet agents in parallel  [FLEET_NAMES="Alex Sam Jordan" AGENTS_SHEET=...]
	@echo "Starting fleet: $(FLEET_NAMES)"
	@for name in $(FLEET_NAMES); do \
		cname="dev-worker-$$(echo $$name | tr '[:upper:]' '[:lower:]')"; \
		echo "  → Starting $$name ($$cname)..."; \
		AGENT_HUMAN_NAME="$$name" \
		AGENT_NAME="$$name" \
		AI_PROVIDER="$(PROVIDER)" \
		AGENT_MODEL="$(MODEL)" \
		CLAUDE_MODEL="$(CLAUDE_MODEL)" \
		AGENT_COMMAND="$(COMMAND)" \
		AGENTS_SHEET_ID="$(AGENTS_SHEET)" \
		CONTAINER_NAME="$$cname" \
		$(COMPOSE) up -d --build; \
	done
	@echo ""
	@echo "  ✓ Fleet started: $(FLEET_NAMES)"
	@echo "    Status: make fleet-status"
	@echo "    Stop:   make fleet-stop"
	@echo ""

fleet-stop: ## Stop all dev-worker containers
	@echo "Stopping all dev-worker containers..."
	@docker ps --filter "name=dev-worker" --format "{{.Names}}" | \
		xargs -r docker stop
	@docker ps -a --filter "name=dev-worker" --format "{{.Names}}" | \
		xargs -r docker rm
	@echo "  ✓ All dev-worker containers stopped"

fleet-status: ## Show status of every named dev-worker container
	@echo "── Fleet status ────────────────────────────────────────"
	@docker ps --filter "name=dev-worker" \
		--format "table {{.Names}}\t{{.Status}}\t{{.RunningFor}}" 2>/dev/null \
		|| echo "  (no dev-worker containers running)"
	@echo ""
	@echo "  Hint: make fleet-start FLEET_NAMES=\"Alex Sam Jordan\""
	@echo ""

# ── Auth ──────────────────────────────────────────────────────────────

token-extract: ## Auto-extract Copilot OAuth token from OS keychain → writes COPILOT_GITHUB_TOKEN to .env
	@echo "  ⏳ Extracting Copilot token from OS keychain..."
	@TOKEN=$$(python3 -c "\
import secretstorage; \
bus = secretstorage.dbus_init(); \
coll = secretstorage.get_default_collection(bus); \
[print(item.get_secret().decode()) for item in coll.get_all_items() if item.get_label() and 'copilot-cli' in item.get_label()]; \
" 2>/dev/null | head -1) && \
	if [ -z "$$TOKEN" ]; then \
		echo "  ✗ No copilot-cli token found in keychain."; \
		echo "    Run: copilot --login   (then re-run: make token-extract)"; \
		exit 1; \
	fi && \
	if grep -q "COPILOT_GITHUB_TOKEN=" .env 2>/dev/null; then \
		sed -i "s|COPILOT_GITHUB_TOKEN=.*|COPILOT_GITHUB_TOKEN=$$TOKEN|" .env; \
	else \
		printf "\n# GitHub Copilot OAuth token (auto-extracted from OS keychain)\nCOPILOT_GITHUB_TOKEN=$$TOKEN\n" >> .env; \
	fi && \
	echo "  ✓ COPILOT_GITHUB_TOKEN written to .env"

auth-copilot: ## Log in to GitHub Copilot (run on host, token saved to OS keychain)
	copilot --login
	@echo "  ✓ Copilot auth saved to keychain"
	@echo "    Extract token for containers: make token-extract"
	@$(MAKE) token-extract

auth-claude: ## Show how to set ANTHROPIC_API_KEY for Claude Code
	@echo ""
	@echo "  Claude Code auth uses an API key — no login flow needed."
	@echo ""
	@echo "  1. Get your key from https://console.anthropic.com"
	@echo "  2. Add to your shell profile:"
	@echo "     export ANTHROPIC_API_KEY=sk-ant-..."
	@echo "  3. Start the agent:"
	@echo "     make agent-start PROVIDER=claude NAME=Alex"
	@echo ""

auth-check: ## Check which AI credentials are available
	@echo "── AI Credentials ──────────────────────────────────────"
	@test -n "$(COPILOT_GITHUB_TOKEN)" \
		&& echo "  ✓ Copilot  COPILOT_GITHUB_TOKEN is set" \
		|| { test -f ~/.copilot/config.json \
			&& echo "  ⚠ Copilot  config exists but no token in .env — run: make token-extract" \
			|| echo "  ✗ Copilot  not set up — run: make auth-copilot"; }
	@test -n "$$ANTHROPIC_API_KEY" \
		&& echo "  ✓ Claude   ANTHROPIC_API_KEY is set" \
		|| echo "  ✗ Claude   ANTHROPIC_API_KEY not set (see: make auth-claude)"
	@test -f "$(GOOGLE_APPLICATION_CREDENTIALS)" \
		&& echo "  ✓ Google   $(GOOGLE_APPLICATION_CREDENTIALS) (OK)" \
		|| echo "  ✗ Google   $(GOOGLE_APPLICATION_CREDENTIALS) (missing)"
	@echo ""

# ── Workboard ─────────────────────────────────────────────────────────

workboard: ## Print current workboard state as JSON
	node scripts/check-workboard.js

# ── Cleanup ───────────────────────────────────────────────────────────

clean: ## Stop all containers, remove images and volumes (full reset)
	@echo "This removes all dev-worker containers, images, and mounted volumes."
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@docker ps -a --filter "name=dev-worker" --format "{{.Names}}" | xargs -r docker rm -f
	@$(COMPOSE) down --rmi local -v 2>/dev/null || true
	@echo "  ✓ Cleaned — re-run: make agent-start"

