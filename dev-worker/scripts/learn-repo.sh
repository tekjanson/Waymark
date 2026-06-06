#!/usr/bin/env bash
# learn-repo.sh — Repo introspection and AI tool configuration.
#
# Called by entrypoint.sh after the workspace is ready. Works with ANY repo —
# not just Waymark. Scans the mounted workspace for AI config, merges container-
# bundled defaults for anything missing, and emits unified config files so every
# AI tool (Copilot CLI, Claude Code) starts fully informed about the project.
#
# Container-bundled defaults (always available, even for bare repos):
#   /defaults/agents/           — CLI-native agent definitions
#   /defaults/skills/           — reusable skill files
#   /defaults/copilot-instructions.md — baseline Copilot instructions
#   /defaults/context/          — operator identity + working style
#   /defaults/.claude/          — Claude settings, hooks, slash commands
#
# Outputs:
#   /etc/repo-context.md        — human-readable project summary (used in prompts)
#   /workspace/.mcp.json        — MCP config for Claude Code (auto-generated)
#   ~/.copilot/mcp.json         — MCP config for Copilot CLI (auto-generated)
#   /workspace/CLAUDE.md        — Claude project instructions (generated/updated)
#   /workspace/.github/copilot-instructions.md  — Copilot global instructions
#   /workspace/.github/agents/  — merged agent definitions (repo + defaults)
#   /workspace/.github/copilot-skills/ — merged skills (repo + defaults)
#   /workspace/.claude/         — Claude settings + commands (merged from defaults)

set -euo pipefail

WORKSPACE="${WORKSPACE_PATH:-/workspace}"
DEFAULTS="/defaults"

log()  { echo "[learn-repo $(date +%T)] $*"; }
ok()   { echo "[learn-repo $(date +%T)] ✓  $*"; }
info() { echo "[learn-repo $(date +%T)] ℹ  $*"; }
warn() { echo "[learn-repo $(date +%T)] ⚠  $*"; }

log "Scanning workspace: ${WORKSPACE}"

# ── 1. Discover what the repo already has ─────────────────────────────────────

FOUND_AGENTS=()
FOUND_INSTRUCTIONS=()
FOUND_SKILLS=()
FOUND_MCP=""
FOUND_CLAUDE_MD=""
FOUND_AGENTS_MD=""
FOUND_COPILOT_INSTRUCTIONS=""
FOUND_README=""

# Agent definitions
if [[ -d "${WORKSPACE}/.github/agents" ]]; then
    while IFS= read -r f; do FOUND_AGENTS+=("$f"); done \
        < <(find "${WORKSPACE}/.github/agents" -name "*.agent.md" -type f 2>/dev/null | sort)
fi

# Instructions
if [[ -d "${WORKSPACE}/.github/instructions" ]]; then
    while IFS= read -r f; do FOUND_INSTRUCTIONS+=("$f"); done \
        < <(find "${WORKSPACE}/.github/instructions" -name "*.instructions.md" -type f 2>/dev/null | sort)
fi

# Skills
if [[ -d "${WORKSPACE}/.github/copilot-skills" ]]; then
    while IFS= read -r f; do FOUND_SKILLS+=("$f"); done \
        < <(find "${WORKSPACE}/.github/copilot-skills" -name "*.md" -type f 2>/dev/null | sort)
fi

# MCP config
for candidate in \
    "${WORKSPACE}/.vscode/mcp.json" \
    "${WORKSPACE}/.github/mcp.json" \
    "${WORKSPACE}/.github/copilot/mcp.json" \
    "${WORKSPACE}/.mcp.json"
do
    if [[ -f "$candidate" ]]; then FOUND_MCP="$candidate"; break; fi
done

[[ -f "${WORKSPACE}/CLAUDE.md" ]]                          && FOUND_CLAUDE_MD="${WORKSPACE}/CLAUDE.md"
[[ -f "${WORKSPACE}/AGENTS.md" ]]                          && FOUND_AGENTS_MD="${WORKSPACE}/AGENTS.md"
[[ -f "${WORKSPACE}/.github/copilot-instructions.md" ]]    && FOUND_COPILOT_INSTRUCTIONS="${WORKSPACE}/.github/copilot-instructions.md"

for readme in README.md readme.md README; do
    if [[ -f "${WORKSPACE}/${readme}" ]]; then FOUND_README="${WORKSPACE}/${readme}"; break; fi
done

log "Repo scan: agents=${#FOUND_AGENTS[@]} instructions=${#FOUND_INSTRUCTIONS[@]} skills=${#FOUND_SKILLS[@]} mcp=${FOUND_MCP:-none}"

# ── 2. Merge container defaults into workspace ────────────────────────────────
# Copy default agents/skills/instructions that the repo doesn't already have.
# Files are prefixed with "dw-" to avoid collisions with repo-native files.

mkdir -p "${WORKSPACE}/.github/agents"
mkdir -p "${WORKSPACE}/.github/copilot-skills"

# Default agents → .github/agents/ (only if not already present)
if [[ -d "${DEFAULTS}/agents" ]]; then
    for src in "${DEFAULTS}/agents/"*.agent.md; do
        [[ -f "$src" ]] || continue
        name="$(basename "$src")"
        dst="${WORKSPACE}/.github/agents/${name}"
        if [[ ! -f "$dst" ]]; then
            cp "$src" "$dst"
            FOUND_AGENTS+=("$dst")
            ok "Injected default agent: ${name}"
        fi
    done
fi

# Default skills → .github/copilot-skills/
if [[ -d "${DEFAULTS}/skills" ]]; then
    for src in "${DEFAULTS}/skills/"*.md; do
        [[ -f "$src" ]] || continue
        name="dw-$(basename "$src")"
        dst="${WORKSPACE}/.github/copilot-skills/${name}"
        if [[ ! -f "$dst" ]]; then
            cp "$src" "$dst"
            FOUND_SKILLS+=("$dst")
            ok "Injected default skill: ${name}"
        fi
    done
fi

# copilot-instructions.md — inject dev-worker context into ~/.copilot/ (not the repo)
# We write to the agent's HOME config so the repo working tree stays clean.
COPILOT_EXTRA="${HOME}/.copilot/dev-worker-instructions.md"
{
    echo "<!-- injected by dev-worker learn-repo.sh -- do not edit -->"
    echo ""
    if [[ -n "$FOUND_COPILOT_INSTRUCTIONS" ]]; then
        cat "$FOUND_COPILOT_INSTRUCTIONS"
        echo ""
        echo "---"
        echo ""
    fi
    grep -v "^#" "${DEFAULTS}/copilot-instructions.md" | tail -n +3
} > "${COPILOT_EXTRA}" 2>/dev/null
ok "Wrote dev-worker context to ${COPILOT_EXTRA} (repo unchanged)"

# If repo has no copilot-instructions.md at all, create a minimal one
if [[ -z "$FOUND_COPILOT_INSTRUCTIONS" ]]; then
    mkdir -p "${WORKSPACE}/.github"
    cp "${DEFAULTS}/copilot-instructions.md" "${WORKSPACE}/.github/copilot-instructions.md"
    FOUND_COPILOT_INSTRUCTIONS="${WORKSPACE}/.github/copilot-instructions.md"
    ok "Injected default copilot-instructions.md (no existing file found)"
fi

# Claude settings + commands → .claude/ in workspace
if [[ -d "${DEFAULTS}/.claude" ]]; then
    mkdir -p "${WORKSPACE}/.claude/commands"
    # settings.json — only if repo doesn't have one
    if [[ ! -f "${WORKSPACE}/.claude/settings.json" ]] && [[ -f "${DEFAULTS}/.claude/settings.json" ]]; then
        cp "${DEFAULTS}/.claude/settings.json" "${WORKSPACE}/.claude/settings.json"
        ok "Injected .claude/settings.json"
    fi
    # Slash commands — prefix with dw- to avoid collisions
    if [[ -d "${DEFAULTS}/.claude/commands" ]]; then
        for src in "${DEFAULTS}/.claude/commands/"*.md; do
            [[ -f "$src" ]] || continue
            name="$(basename "$src")"
            dst="${WORKSPACE}/.claude/commands/${name}"
            if [[ ! -f "$dst" ]]; then
                cp "$src" "$dst"
                ok "Injected Claude command: /${name%.md}"
            fi
        done
    fi
fi

# ── 3. Collect operator context files ─────────────────────────────────────────
# Context files describe the operator, system architecture, and working style.
# Priority: container-bundled /defaults/context/ (always present) then
# any context/ the repo itself ships.

FOUND_CONTEXT_FILES=()
for context_dir in "${DEFAULTS}/context" "${WORKSPACE}/dev-worker/context"; do
    [[ -d "$context_dir" ]] || continue
    for f in \
        "${context_dir}/operator.md" \
        "${context_dir}/system.md" \
        "${context_dir}/working-style.md" \
        "${context_dir}/claude-agent.md"
    do
        if [[ -f "$f" ]]; then
            # Avoid duplicates
            already=false
            for known in "${FOUND_CONTEXT_FILES[@]:-}"; do [[ "$known" == "$f" ]] && already=true; done
            $already || FOUND_CONTEXT_FILES+=("$f")
        fi
    done
    # Pick up any other .md files in that context dir
    while IFS= read -r f; do
        already=false
        for known in "${FOUND_CONTEXT_FILES[@]:-}"; do [[ "$known" == "$f" ]] && already=true; done
        $already || FOUND_CONTEXT_FILES+=("$f")
    done < <(find "$context_dir" -name "*.md" -type f 2>/dev/null | sort)
done

ok "Operator context files: ${#FOUND_CONTEXT_FILES[@]}"

# ── 4. Translate MCP config for both providers ────────────────────────────────

translate_mcp_vars() {
    local content="$1"
    content="${content//\$\{workspaceFolder\}/${WORKSPACE}}"
    content="${content//\$\{userHome\}/\/root}"
    while [[ "$content" =~ \$\{env:([A-Za-z_][A-Za-z0-9_]*)\} ]]; do
        local var="${BASH_REMATCH[1]}"
        local val="${!var:-}"
        content="${content//\$\{env:${var}\}/${val}}"
    done
    echo "$content"
}

if [[ -n "$FOUND_MCP" ]]; then
    RAW_MCP=$(cat "$FOUND_MCP")
    TRANSLATED=$(translate_mcp_vars "$RAW_MCP")

    # Claude Code: { "mcpServers": { ... } }
    CLAUDE_MCP=$(node -e "
        const src = JSON.parse(process.argv[1]);
        const servers = src.servers || src.mcpServers || {};
        process.stdout.write(JSON.stringify({ mcpServers: servers }, null, 2));
    " "$TRANSLATED" 2>/dev/null || echo "")

    if [[ -n "$CLAUDE_MCP" ]]; then
        echo "$CLAUDE_MCP" > "${WORKSPACE}/.mcp.json"
        ok "Generated .mcp.json for Claude Code"
    fi

    # Copilot CLI: { "servers": { ... } }
    COPILOT_MCP=$(node -e "
        const src = JSON.parse(process.argv[1]);
        const servers = src.servers || src.mcpServers || {};
        process.stdout.write(JSON.stringify({ servers }, null, 2));
    " "$TRANSLATED" 2>/dev/null || echo "")

    if [[ -n "$COPILOT_MCP" ]]; then
        mkdir -p /root/.copilot
        echo "$COPILOT_MCP" > /root/.copilot/mcp.json
        ok "Generated ~/.copilot/mcp.json for Copilot CLI"
    fi
else
    info "No MCP config found — agents will run without MCP tools"
fi

# ── 5. Generate CLAUDE.md ─────────────────────────────────────────────────────

if [[ "${CLAUDE_MD_LOCKED:-false}" != "true" ]]; then
    [[ -z "$FOUND_CLAUDE_MD" ]] \
        && log "CLAUDE.md not found — generating..." \
        || log "Regenerating CLAUDE.md with latest operator context..."

    {
        echo "# Claude Project Instructions"
        echo ""
        echo "> Auto-generated by dev-worker learn-repo.sh — do not edit manually."
        echo "> Set CLAUDE_MD_LOCKED=true to prevent regeneration. Updated: $(date)"
        echo ""

        # Operator context (highest priority — injected first)
        if [[ ${#FOUND_CONTEXT_FILES[@]} -gt 0 ]]; then
            for f in "${FOUND_CONTEXT_FILES[@]}"; do
                cat "$f"
                echo ""
                echo "---"
                echo ""
            done
        fi

        # Project identity
        if [[ -n "$FOUND_README" ]]; then
            echo "## Project Overview"
            echo ""
            head -80 "$FOUND_README" | grep -v "^$" | head -50
            echo ""
        fi

        # Project-specific instructions
        if [[ ${#FOUND_INSTRUCTIONS[@]} -gt 0 ]]; then
            echo "## Project Rules"
            echo ""
            for f in "${FOUND_INSTRUCTIONS[@]}"; do
                echo "<!-- from: $(basename "$f") -->"
                cat "$f"
                echo ""
            done
        fi

        # Copilot global instructions (contains operator defaults)
        if [[ -n "$FOUND_COPILOT_INSTRUCTIONS" ]]; then
            echo "## Operator Defaults (from copilot-instructions.md)"
            echo ""
            cat "$FOUND_COPILOT_INSTRUCTIONS"
            echo ""
        fi

        # Agent definitions summary
        if [[ ${#FOUND_AGENTS[@]} -gt 0 ]]; then
            echo "## Available Agents"
            echo ""
            for f in "${FOUND_AGENTS[@]}"; do
                AGENT_NAME=$(basename "$f" .agent.md)
                DESC=$(grep "^description:" "$f" 2>/dev/null | head -1 | sed 's/^description: *//')
                echo "- **\`@${AGENT_NAME}\`**: ${DESC:-no description}"
            done
            echo ""
        fi

        # Skills summary
        if [[ ${#FOUND_SKILLS[@]} -gt 0 ]]; then
            echo "## Available Skills"
            echo ""
            for f in "${FOUND_SKILLS[@]}"; do
                SKILL_NAME=$(basename "$f" .md | sed 's/^dw-//')
                DESC=$(grep "^description:" "$f" 2>/dev/null | head -1 | sed 's/^description: *//')
                echo "- **${SKILL_NAME}**: ${DESC:-see file}"
            done
            echo ""
        fi

        # AGENTS.md passthrough
        if [[ -n "$FOUND_AGENTS_MD" ]]; then
            echo "## Multi-Agent Instructions"
            echo ""
            cat "$FOUND_AGENTS_MD"
            echo ""
        fi

        echo "## Execution Environment"
        echo ""
        echo "- Workspace: \`${WORKSPACE}\`"
        echo "- Container: Debian bookworm, Node.js $(node --version 2>/dev/null || echo 'LTS')"
        echo "- Docker socket mounted — can spawn sibling containers"
        [[ -f /credentials/gsa-key.json ]] && echo "- Google SA credentials: \`/credentials/gsa-key.json\`"
        echo "- MCP config: \`${WORKSPACE}/.mcp.json\` (if present)"
        echo "- Slash commands: \`/pick\`, \`/done\`, \`/status\`"
        echo ""

    } > "${WORKSPACE}/CLAUDE.md"

    ok "Generated ${WORKSPACE}/CLAUDE.md"
    FOUND_CLAUDE_MD="${WORKSPACE}/CLAUDE.md"
else
    ok "CLAUDE.md locked: ${FOUND_CLAUDE_MD}"
fi

# ── 6. Resolve AI provider ────────────────────────────────────────────────────

AI_PROVIDER="${AI_PROVIDER:-auto}"
RESOLVED_PROVIDER=""

if [[ "$AI_PROVIDER" == "auto" ]]; then
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        RESOLVED_PROVIDER="claude"
        info "AI_PROVIDER=auto → claude (ANTHROPIC_API_KEY set)"
    elif [[ -f /root/.copilot/config.json ]]; then
        RESOLVED_PROVIDER="copilot"
        info "AI_PROVIDER=auto → copilot (config.json found)"
    else
        RESOLVED_PROVIDER="copilot"
        warn "AI_PROVIDER=auto → copilot (no creds yet — auth check will fail)"
    fi
else
    RESOLVED_PROVIDER="$AI_PROVIDER"
    info "AI_PROVIDER=${AI_PROVIDER} (explicit)"
fi

# ── 7. Write /etc/repo-context.md ─────────────────────────────────────────────

{
    echo "# Workspace Context (auto-generated by learn-repo.sh)"
    echo ""
    echo "- **Workspace**: \`${WORKSPACE}\`"
    echo "- **AI Provider**: \`${RESOLVED_PROVIDER}\`"
    echo "- **Agent**: \`${AGENT_HUMAN_NAME:-unnamed}\`"

    if [[ -n "$FOUND_README" ]]; then
        PROJECT_NAME=$(head -5 "$FOUND_README" | grep "^#" | head -1 | sed 's/^#* *//')
        echo "- **Project**: ${PROJECT_NAME:-$(basename "$WORKSPACE")}"
    fi

    echo ""
    echo "## Tech Stack"
    echo ""
    [[ -f "${WORKSPACE}/package.json" ]] && echo "- Node.js (package.json)"
    [[ -f "${WORKSPACE}/Makefile" ]]     && echo "- Make (run ops via \`make\`)"
    [[ -f "${WORKSPACE}/Dockerfile" ]]   && echo "- Docker"
    [[ -f "${WORKSPACE}/go.mod" ]]       && echo "- Go"
    [[ -f "${WORKSPACE}/Cargo.toml" ]]   && echo "- Rust"
    [[ -f "${WORKSPACE}/pyproject.toml" || -f "${WORKSPACE}/setup.py" ]] && echo "- Python"
    echo ""

    echo "## AI Config"
    echo ""
    echo "- Agents: ${#FOUND_AGENTS[@]} (in .github/agents/)"
    echo "- Skills: ${#FOUND_SKILLS[@]} (in .github/copilot-skills/)"
    echo "- Instructions: ${#FOUND_INSTRUCTIONS[@]}"
    echo "- MCP: $([[ -n "$FOUND_MCP" ]] && echo "yes (${FOUND_MCP})" || echo "none")"
    echo "- Operator context: ${#FOUND_CONTEXT_FILES[@]} file(s)"
    echo ""

    echo "## Available Agents"
    for f in "${FOUND_AGENTS[@]}"; do
        NAME=$(basename "$f" .agent.md)
        DESC=$(grep "^description:" "$f" 2>/dev/null | head -1 | sed 's/^description: *//')
        echo "- **@${NAME}**: ${DESC:-no description}"
    done
    echo ""

    echo "## Available Skills"
    for f in "${FOUND_SKILLS[@]}"; do
        NAME=$(basename "$f" .md | sed 's/^dw-//')
        echo "- ${NAME}"
    done

} > /etc/repo-context.md

ok "Wrote /etc/repo-context.md"

# ── 8. Append to /etc/agent-env.sh ───────────────────────────────────────────
{
    echo ""
    echo "# learn-repo.sh — $(date)"
    echo "export AI_PROVIDER=\"${RESOLVED_PROVIDER}\""
    echo "export REPO_CONTEXT_FILE=\"/etc/repo-context.md\""
    [[ -n "$FOUND_CLAUDE_MD" ]]             && echo "export CLAUDE_MD_PATH=\"${FOUND_CLAUDE_MD}\""
    [[ -f "${WORKSPACE}/.mcp.json" ]]       && echo "export MCP_CONFIG_FILE=\"${WORKSPACE}/.mcp.json\""
    [[ -n "$FOUND_COPILOT_INSTRUCTIONS" ]]  && echo "export COPILOT_INSTRUCTIONS=\"${FOUND_COPILOT_INSTRUCTIONS}\""
} >> /etc/agent-env.sh

log "Done — provider=${RESOLVED_PROVIDER} agents=${#FOUND_AGENTS[@]} skills=${#FOUND_SKILLS[@]} context=${#FOUND_CONTEXT_FILES[@]}"

