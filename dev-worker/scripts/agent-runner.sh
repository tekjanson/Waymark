#!/usr/bin/env bash
# agent-runner.sh — Multi-provider AI agent watchdog loop.
#
# Supports two AI providers side-by-side, selected at runtime:
#
#   AI_PROVIDER=copilot  → GitHub Copilot CLI
#     copilot --allow-all --autopilot --model $AGENT_MODEL --add-dir /workspace -p "$CMD"
#     Reads: ~/.copilot/config.json (OAuth), ~/.copilot/mcp.json, .github/agents/*.agent.md
#
#   AI_PROVIDER=claude   → Anthropic Claude Code
#     claude --dangerously-skip-permissions --model $CLAUDE_MODEL --print "$CMD"
#     Reads: ANTHROPIC_API_KEY env, CLAUDE.md, .mcp.json in workspace root
#
#   AI_PROVIDER=auto     → resolved by learn-repo.sh at startup (written to agent-env.sh)
#
# Parallelism:
#   - Copilot: /fleet command spawns parallel AI subagents within one session
#   - Claude: use multiple containers (DooD) or multiple claude invocations
#   - Both: Docker socket lets the agent spin up sibling containers
#
# Personality:
#   Each agent has a human name (AGENT_HUMAN_NAME = Alex, Sam, Jordan…).
#   On boot, read-agent-tuning.sh reads this agent's row from the Agent Registry
#   sheet and loads the operator-configured tuning string. The tuning string is
#   prepended to every session prompt so the agent starts with its personality baked in.
#
# Environment (sourced from /etc/agent-env.sh, written by entrypoint.sh):
#   AI_PROVIDER      — copilot | claude (resolved from "auto" by learn-repo.sh)
#   AGENT_COMMAND    — prompt for Copilot, e.g. "@waymark-builder start"
#   CLAUDE_COMMAND   — prompt for Claude (defaults to AGENT_COMMAND if not set)
#   AGENT_MODEL      — model for Copilot CLI (e.g. "claude-sonnet-4.6")
#   CLAUDE_MODEL     — model for Claude Code (e.g. "claude-opus-4-5")
#   AGENT_HUMAN_NAME — human-readable name (Alex, Sam, Jordan…)
#   AGENTS_SHEET_ID  — Google Sheet ID of the Agent Registry (for tuning reads)
#   AGENT_ROLE       — "qa" enables QA patrol mode: polls --qa-details instead of
#                      the standard To Do queue, dispatches @waymark-qa per task

set -uo pipefail

source /etc/agent-env.sh 2>/dev/null || true

# Resolve "auto" → detect available provider (same logic as learn-repo.sh)
if [[ "${AI_PROVIDER:-auto}" == "auto" ]]; then
    if [[ -f /root/.copilot/config.json ]]; then
        AI_PROVIDER="copilot"
    elif command -v claude >/dev/null 2>&1 && [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        AI_PROVIDER="claude"
    else
        AI_PROVIDER="copilot"  # default — validate_copilot will surface a helpful error
    fi
    log "AI_PROVIDER=auto → resolved to '${AI_PROVIDER}'"
fi
AI_PROVIDER="${AI_PROVIDER:-copilot}"
AGENT_COMMAND="${AGENT_COMMAND:-@waymark-builder start}"
# Claude gets its own command var because @-mentions are Copilot-specific.
# Default: strip the @agent-name mention and pass the rest as a plain prompt.
CLAUDE_COMMAND="${CLAUDE_COMMAND:-${AGENT_COMMAND/@waymark-builder /}}"
AGENT_MODEL="${AGENT_MODEL:-claude-sonnet-4.6}"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4-5}"
AGENT_HUMAN_NAME="${AGENT_HUMAN_NAME:-}"
AGENTS_SHEET_ID="${AGENTS_SHEET_ID:-}"
RESTART_DELAY=5

log() { echo "[agent-runner $(date +%T)] $*"; }

# ── Wait for Xvfb ────────────────────────────────────────────────────────────
log "Waiting for Xvfb on DISPLAY=:99..."
for (( i=0; i<30; i++ )); do
    xdpyinfo -display :99 >/dev/null 2>&1 && { log "Xvfb ready (${i}s)"; break; }
    sleep 1
    [[ $i -eq 29 ]] && log "WARNING: Xvfb not ready — continuing anyway"
done

# ── Load agent tuning from the Agent Registry sheet ───────────────────────────
# The operator edits tuning strings in the Waymark UI (Agent Registry sheet).
# We read this agent's row on boot so the personality is baked into every session.
# The tuning string is prepended to the prompt in build_prompt() below.
AGENT_TUNING=""
if [[ -n "$AGENT_HUMAN_NAME" && -n "$AGENTS_SHEET_ID" ]]; then
    log "Loading tuning for agent '${AGENT_HUMAN_NAME}' from sheet ${AGENTS_SHEET_ID}..."
    # source the output so exports (AGENT_TUNING, AGENT_MODEL, AI_PROVIDER) take effect
    source <(bash /workspace/dev-worker/scripts/read-agent-tuning.sh 2>/dev/null) || true
    if [[ -n "${AGENT_TUNING:-}" ]]; then
        log "Tuning loaded (${#AGENT_TUNING} chars)"
    else
        log "No tuning found — agent will use default behavior"
    fi
else
    log "AGENT_HUMAN_NAME or AGENTS_SHEET_ID not set — skipping tuning read"
fi

log "Identity: ${AGENT_HUMAN_NAME:-<unnamed>} | Provider: ${AI_PROVIDER} | Model: ${AGENT_MODEL}"

# ── Sheet write-back helper ───────────────────────────────────────────────────
# Writes status / heartbeat / task to the Agent Registry sheet.
# Silently no-ops if AGENTS_SHEET_ID or AGENT_HUMAN_NAME is missing.
sheet_write() {
    if [[ -x /workspace/dev-worker/scripts/write-agent-sheet.sh ]]; then
        /workspace/dev-worker/scripts/write-agent-sheet.sh "$@" 2>&1 | sed 's/^/  /' || true
    fi
}

# ── Background heartbeat loop ─────────────────────────────────────────────────
# Updates the Heartbeat column every 2 minutes so the fleet UI shows "last seen".
heartbeat_loop() {
    while true; do
        sleep 120
        sheet_write --heartbeat
    done
}
heartbeat_loop &
HEARTBEAT_PID=$!
trap 'kill ${HEARTBEAT_PID} 2>/dev/null || true' EXIT

# Write initial Online status + heartbeat
sheet_write --status Online --heartbeat

# ── Verify Docker socket (DooD) ───────────────────────────────────────────────
if docker info >/dev/null 2>&1; then
    DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
    log "Docker socket: server v${DOCKER_VER} — agent can spawn sibling containers"
else
    log "WARNING: Docker socket not available — agent cannot spawn containers"
fi

# ── Validate selected provider ────────────────────────────────────────────────
validate_copilot() {
    if ! command -v copilot >/dev/null 2>&1; then
        log "ERROR: copilot CLI not found — is @github/copilot installed?"
        return 1
    fi
    if [[ ! -f /root/.copilot/config.json ]]; then
        log "ERROR: ~/.copilot/config.json missing — run 'copilot --login' on the host"
        return 1
    fi
    return 0
}

validate_claude() {
    if ! command -v claude >/dev/null 2>&1; then
        log "ERROR: claude CLI not found — is @anthropic-ai/claude-code installed?"
        return 1
    fi
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
        log "ERROR: ANTHROPIC_API_KEY not set — cannot authenticate with Claude"
        return 1
    fi
    return 0
}

# ── Build prompt with tuning prefix ──────────────────────────────────────────
# The tuning string (loaded from the Agent Registry sheet) is prepended to every
# session prompt so the agent's personality is active from the first token.
#
# Format: "[AGENT: Alex] Your personality: <tuning>. Now: <base command>"
build_prompt() {
    local base_prompt="$1"
    local full=""

    if [[ -n "${AGENT_HUMAN_NAME:-}" ]]; then
        full="You are ${AGENT_HUMAN_NAME}, an AI developer agent."
        if [[ -n "${AGENT_TUNING:-}" ]]; then
            full="${full} Personality and behavior: ${AGENT_TUNING}"
        fi
        full="${full} Task: ${base_prompt}"
    else
        full="$base_prompt"
    fi

    echo "$full"
}

# ── Build the run command for the selected provider ───────────────────────────
run_copilot() {
    CONTEXT_DIR="${CONTEXT_DIR:-/workspace/dev-worker/context}"
    local prompt
    prompt="$(build_prompt "${AGENT_COMMAND}")"
    log "  Provider:  GitHub Copilot CLI"
    log "  Model:     ${AGENT_MODEL}"
    log "  Identity:  ${AGENT_HUMAN_NAME:-<unnamed>}"
    log "  MCP:       $( [[ -f /root/.copilot/mcp.json ]] && echo "~/.copilot/mcp.json" || echo "none" )"
    log "  Context:   $( [[ -d "$CONTEXT_DIR" ]] && echo "$CONTEXT_DIR" || echo "none" )"
    [[ -n "${AGENT_TUNING:-}" ]] && log "  Tuning:    ${AGENT_TUNING:0:60}..."

    local ADD_DIRS=("--add-dir" "/workspace")
    [[ -d "$CONTEXT_DIR" ]] && ADD_DIRS+=("--add-dir" "$CONTEXT_DIR")

    copilot \
        --allow-all \
        --autopilot \
        --model "${AGENT_MODEL}" \
        "${ADD_DIRS[@]}" \
        -p "${prompt}" \
        || true
}

run_claude() {
    CONTEXT_DIR="${CONTEXT_DIR:-/workspace/dev-worker/context}"
    local base_prompt="${CLAUDE_COMMAND}"
    [[ -f "${CONTEXT_DIR}/claude-agent.md" ]] && \
        base_prompt="Read and follow the instructions in ${CONTEXT_DIR}/claude-agent.md, then: ${CLAUDE_COMMAND}"
    local prompt
    prompt="$(build_prompt "${base_prompt}")"

    log "  Provider:  Claude Code (Anthropic)"
    log "  Model:     ${CLAUDE_MODEL}"
    log "  Identity:  ${AGENT_HUMAN_NAME:-<unnamed>}"
    log "  MCP:       $( [[ -f /workspace/.mcp.json ]] && echo ".mcp.json" || echo "none" )"
    log "  CLAUDE.md: $( [[ -f /workspace/CLAUDE.md ]] && echo "present" || echo "missing" )"
    [[ -n "${AGENT_TUNING:-}" ]] && log "  Tuning:    ${AGENT_TUNING:0:60}..."

    # Claude Code auto-reads CLAUDE.md and .mcp.json from the working directory
    (
        cd /workspace
        claude \
            --dangerously-skip-permissions \
            --model "${CLAUDE_MODEL}" \
            --print "${prompt}" \
            || true
    )
}

# ── Resolve "auto" provider (after tuning may have re-exported AI_PROVIDER) ───
# read-agent-tuning.sh exports AI_PROVIDER from the sheet value. Normalize to
# lowercase and resolve "auto" here, after tuning has loaded.
AI_PROVIDER="${AI_PROVIDER,,}"  # lowercase
if [[ "${AI_PROVIDER:-auto}" == "auto" ]]; then
    if [[ -f /root/.copilot/config.json ]]; then
        AI_PROVIDER="copilot"
    elif command -v claude >/dev/null 2>&1 && [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        AI_PROVIDER="claude"
    else
        AI_PROVIDER="copilot"
    fi
    log "AI_PROVIDER=auto → resolved to '${AI_PROVIDER}'"
fi

# ── Workboard polling: claim a task before starting a session ─────────────────
# Queries check-workboard.js with --agent <name> to get only tasks for this agent
# (unassigned To Do + assigned To Do + own In Progress). Claims the highest-priority
# task, then passes "Task row: N | Task: <title> | Details: <desc>" to the session
# so the LLM never needs to poll the workboard itself (prevents agent racing).
#
# Returns: sets CLAIMED_ROW, CLAIMED_TASK, CLAIMED_DESC
# Returns 1 if no task is available (caller should sleep and retry).
claim_next_task() {
    CLAIMED_ROW=""
    CLAIMED_TASK=""
    CLAIMED_DESC=""

    if [[ -z "${WAYMARK_WORKBOARD_ID:-}" ]]; then
        log "WAYMARK_WORKBOARD_ID not set — cannot poll workboard"
        return 1
    fi

    local wb_json
    wb_json=$(
        cd /workspace
        GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
        WAYMARK_WORKBOARD_ID="$WAYMARK_WORKBOARD_ID" \
        node scripts/check-workboard.js --agent "${AGENT_HUMAN_NAME}" 2>/dev/null
    ) || true

    if [[ -z "$wb_json" ]]; then
        log "Workboard query failed or returned empty"
        return 1
    fi

    # Pick first In Progress task (resume interrupted work), then first To Do
    local row task desc
    row=$(echo "$wb_json" | jq -r '(.inProgress[0].row // .todo[0].row // empty)' 2>/dev/null)
    task=$(echo "$wb_json" | jq -r '(.inProgress[0].task // .todo[0].task // empty)' 2>/dev/null)
    desc=$(echo "$wb_json" | jq -r '(.inProgress[0].desc // .todo[0].desc // "")' 2>/dev/null)
    local stage
    stage=$(echo "$wb_json" | jq -r '(if .inProgress | length > 0 then "In Progress" else "To Do" end)' 2>/dev/null)
    local assignee
    assignee=$(echo "$wb_json" | jq -r '(.inProgress[0].assignee // .todo[0].assignee // "")' 2>/dev/null)

    if [[ -z "$row" || -z "$task" ]]; then
        local todo_count inprogress_count
        todo_count=$(echo "$wb_json" | jq '.todo | length' 2>/dev/null || echo 0)
        inprogress_count=$(echo "$wb_json" | jq '.inProgress | length' 2>/dev/null || echo 0)
        log "No tasks available for ${AGENT_HUMAN_NAME} (todo=${todo_count} inprogress=${inprogress_count})"
        return 1
    fi

    # Claim the task if it's To Do (not already In Progress / already ours)
    if [[ "$stage" == "To Do" ]]; then
        log "Claiming row ${row}: ${task}"
        (
            cd /workspace
            GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
            WAYMARK_WORKBOARD_ID="$WAYMARK_WORKBOARD_ID" \
            node scripts/update-workboard.js claim "$row" --agent "${AGENT_HUMAN_NAME}" 2>&1
        ) | sed 's/^/  [claim] /' || true
    else
        log "Resuming In Progress row ${row}: ${task} (assignee: ${assignee})"
    fi

    CLAIMED_ROW="$row"
    CLAIMED_TASK="$task"
    CLAIMED_DESC="$desc"
    return 0
}

# ── QA patrol: claim one task from the QA stage ───────────────────────────────
# Used when AGENT_ROLE=qa. Polls --qa-details (QA stage only) instead of the
# standard To Do queue. Sets the same CLAIMED_* variables as claim_next_task().
# Returns 1 if no QA tasks are available so the caller can sleep and retry.
claim_next_qa_task() {
    CLAIMED_ROW=""
    CLAIMED_TASK=""
    CLAIMED_DESC=""
    CLAIMED_BRANCH=""

    if [[ -z "${WAYMARK_WORKBOARD_ID:-}" ]]; then
        log "WAYMARK_WORKBOARD_ID not set — cannot poll workboard for QA tasks"
        return 1
    fi

    local wb_json
    wb_json=$(
        cd /workspace
        GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
        WAYMARK_WORKBOARD_ID="$WAYMARK_WORKBOARD_ID" \
        node scripts/check-workboard.js --qa-details 2>/dev/null
    ) || true

    if [[ -z "$wb_json" ]]; then
        log "Workboard QA query failed or returned empty"
        return 1
    fi

    # qa field is an array of {row, task, notes, branch?, testingInstructions?}
    local qa_count
    qa_count=$(echo "$wb_json" | jq 'if .qa | type == "array" then .qa | length else 0 end' 2>/dev/null || echo 0)

    if [[ "$qa_count" -eq 0 ]]; then
        log "No QA tasks available (qa_count=0)"
        return 1
    fi

    local row task branch notes testing_instructions
    row=$(echo "$wb_json" | jq -r '.qa[0].row // empty' 2>/dev/null)
    task=$(echo "$wb_json" | jq -r '.qa[0].task // empty' 2>/dev/null)
    branch=$(echo "$wb_json" | jq -r '.qa[0].branch // ""' 2>/dev/null)
    notes=$(echo "$wb_json" | jq -r '.qa[0].notes // "" | if type == "array" then map(.text // .) | join(" | ") else . end' 2>/dev/null)
    testing_instructions=$(echo "$wb_json" | jq -r '.qa[0].testingInstructions // ""' 2>/dev/null)

    if [[ -z "$row" || -z "$task" ]]; then
        log "QA task data incomplete — skipping"
        return 1
    fi

    log "Picked up QA task row ${row}: ${task} (branch: ${branch:-unknown})"

    CLAIMED_ROW="$row"
    CLAIMED_TASK="$task"
    CLAIMED_BRANCH="$branch"
    # Combine notes + testing instructions into the desc passed to the agent
    CLAIMED_DESC="${notes}"
    [[ -n "$testing_instructions" ]] && CLAIMED_DESC="${CLAIMED_DESC} | ${testing_instructions}"
    return 0
}

# ── Check for incoming notes on a task ────────────────────────────────────────
# After the agent session completes, check if any new notes have been added to
# the task by the operator. If so, surface them and optionally let the agent
# respond inline (stay on same task) instead of moving to the next task.
#
# Returns: sets HAS_NEW_NOTES and NEW_NOTES_TEXT
# Returns 0 if notes were found (caller should resume this task)
# Returns 1 if no new notes (caller should claim next task)
check_for_task_notes() {
    HAS_NEW_NOTES=""
    NEW_NOTES_TEXT=""

    if [[ -z "${CLAIMED_ROW:-}" || -z "${WAYMARK_WORKBOARD_ID:-}" ]]; then
        return 1
    fi

    local notes_json
    notes_json=$(
        cd /workspace
        GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
        node scripts/check-task-notes.js \
            --row "${CLAIMED_ROW}" \
            --agent "${AGENT_HUMAN_NAME}" \
            2>/dev/null
    ) || true

    if [[ -z "$notes_json" ]]; then
        return 1
    fi

    local has_new_notes
    has_new_notes=$(echo "$notes_json" | jq -r '.hasNewNotes // false' 2>/dev/null)

    if [[ "$has_new_notes" == "true" ]]; then
        local note_count
        note_count=$(echo "$notes_json" | jq '.notes | length' 2>/dev/null || echo 0)
        log "  ↳ New notes detected: ${note_count} message(s) from operator"

        # Format notes as a chat-like string for the agent prompt
        local formatted_notes=""
        while IFS= read -r note_line; do
            formatted_notes="${formatted_notes}${note_line}\n"
        done < <(echo "$notes_json" | jq -r '.notes[] | "\(.author) (\(.date)): \(.text)"' 2>/dev/null)

        HAS_NEW_NOTES="true"
        NEW_NOTES_TEXT="$formatted_notes"
        return 0
    fi

    return 1
}


# ── Main agent loop ───────────────────────────────────────────────────────────
AGENT_ROLE="${AGENT_ROLE:-}"
log "Starting agent loop — provider: ${AI_PROVIDER} | role: ${AGENT_ROLE:-builder}"
log "  Copilot CLI: $(copilot --version 2>/dev/null || echo 'not available')"
log "  Claude Code: $(claude --version 2>/dev/null || echo 'not available')"
log "  Workboard:   ${WAYMARK_WORKBOARD_ID:-<not set>}"

SESSION=0
IDLE_CYCLES=0
while true; do
    # ── Poll workboard for next task ──────────────────────────────────────────
    if [[ -n "${WAYMARK_WORKBOARD_ID:-}" ]]; then
        # QA patrol mode: poll the QA stage instead of To Do
        if [[ "${AGENT_ROLE}" == "qa" ]]; then
            if ! claim_next_qa_task; then
                IDLE_CYCLES=$(( IDLE_CYCLES + 1 ))
                sheet_write --status Idle --task "Idle — no QA tasks" --heartbeat
                log "No QA tasks available — sleeping 60s (idle cycle ${IDLE_CYCLES})"
                sleep 60
                continue
            fi
            IDLE_CYCLES=0
            # Build QA-specific prompt: branch field is extracted by claim_next_qa_task()
            TASK_PROMPT="@waymark-qa Task row: ${CLAIMED_ROW} | Task: ${CLAIMED_TASK} | Branch: ${CLAIMED_BRANCH:-unknown} | Details: ${CLAIMED_DESC}"
        else
            if ! claim_next_task; then
                IDLE_CYCLES=$(( IDLE_CYCLES + 1 ))
                sheet_write --status Idle --task "Idle — no tasks for ${AGENT_HUMAN_NAME}" --heartbeat
                log "No task available — sleeping 60s (idle cycle ${IDLE_CYCLES})"
                sleep 60
                continue
            fi
            IDLE_CYCLES=0
            # Override AGENT_COMMAND with task-specific prompt for the session
            TASK_PROMPT="@waymark-builder Task row: ${CLAIMED_ROW} | Task: ${CLAIMED_TASK} | Details: ${CLAIMED_DESC}"
        fi
    else
        # No workboard configured — fall through to generic AGENT_COMMAND
        TASK_PROMPT="${AGENT_COMMAND}"
        CLAIMED_TASK="${AGENT_COMMAND}"
        CLAIMED_ROW=""
    fi

    SESSION=$(( SESSION + 1 ))
    log "━━━ Session ${SESSION} starting — row ${CLAIMED_ROW:-?}: ${CLAIMED_TASK} ━━━"

    sheet_write --status Busy --task "${CLAIMED_TASK}" --heartbeat

    # Temporarily override AGENT_COMMAND so build_prompt() uses the task prompt
    _orig_cmd="${AGENT_COMMAND}"
    AGENT_COMMAND="${TASK_PROMPT}"

    case "$AI_PROVIDER" in
        copilot)
            if validate_copilot; then
                run_copilot
            else
                log "Copilot validation failed — will retry after ${RESTART_DELAY}s"
            fi
            ;;
        claude)
            if validate_claude; then
                run_claude
            else
                log "Claude validation failed — will retry after ${RESTART_DELAY}s"
            fi
            ;;
        *)
            log "ERROR: Unknown AI_PROVIDER='${AI_PROVIDER}' — expected copilot or claude"
            log "  Set AI_PROVIDER env var in docker-compose.yml or .env"
            ;;
    esac

    AGENT_COMMAND="${_orig_cmd}"

    # ── Check for incoming notes after session ────────────────────────────────
    # If the operator added notes while the agent was working, surface them
    # and optionally let the agent resume the same task to respond.
    if [[ -n "${CLAIMED_ROW:-}" ]] && check_for_task_notes; then
        log "━━━ Operator interrupt: incoming notes on row ${CLAIMED_ROW} ━━━"
        log "$NEW_NOTES_TEXT"
        
        # Build a "continue" prompt that surfaces the notes as incoming messages
        AGENT_COMMAND="Continue working on row ${CLAIMED_ROW} (${CLAIMED_TASK}). You received these messages from the operator:\n\n${NEW_NOTES_TEXT}\n\nRespond to the feedback, make requested changes, and update the workboard with a note when done. If this completes the task, mark it QA."
        
        SESSION=$(( SESSION + 1 ))
        log "━━━ Session ${SESSION} starting (notes response) — row ${CLAIMED_ROW}: ${CLAIMED_TASK} ━━━"
        sheet_write --status Busy --task "${CLAIMED_TASK} (responding to notes)" --heartbeat
        
        # Re-run agent with notes context
        case "$AI_PROVIDER" in
            copilot)
                if validate_copilot; then
                    run_copilot
                fi
                ;;
            claude)
                if validate_claude; then
                    run_claude
                fi
                ;;
        esac
        
        AGENT_COMMAND="${_orig_cmd}"
    fi

    log "━━━ Session ${SESSION} ended — restarting in ${RESTART_DELAY}s ━━━"
    sheet_write --status Idle --task "Idle — last ran session ${SESSION}" --heartbeat
    sleep "${RESTART_DELAY}"
done
