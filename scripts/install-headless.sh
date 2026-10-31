#!/usr/bin/env bash
# ============================================================
# install-headless.sh — Headless One-Liner Installer for Waymark
# and The Wayside AGY Autonomous Orchestrator.
#
# Usage:
#   # Run from inside repository:
#   ./scripts/install-headless.sh
#
#   # Run directly via curl from any headless machine:
#   curl -fsSL https://raw.githubusercontent.com/tekjanson/Waymark/feature/agy-wayside-orchestrator/scripts/install-headless.sh | bash
#
# Environment variables:
#   WAYMARK_DIR         Target install directory (default: ~/Waymark or current dir)
#   WAYMARK_BRANCH      Git branch to checkout (default: feature/agy-wayside-orchestrator)
#   WAYMARK_SHEET_ID    Wayside Share Ledger spreadsheet ID
#   NON_INTERACTIVE     Set to 1 to skip interactive prompts (default: 0)
#   INSTALL_SYSTEMD     Set to 1 to auto-enable user systemd service (default: 0)
# ============================================================

set -eo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

echo -e "\n${CYAN}${BOLD}===============================================================${NC}"
echo -e "${CYAN}${BOLD}  Waymark + Wayside AGY Orchestrator — Headless Installer${NC}"
echo -e "${CYAN}${BOLD}===============================================================${NC}\n"

# 1. Environment & Target Directory Detection
DEFAULT_BRANCH="${WAYMARK_BRANCH:-feature/agy-wayside-orchestrator}"
TARGET_DIR="${WAYMARK_DIR:-}"

if [ -z "$TARGET_DIR" ]; then
  if [ -f "package.json" ] && grep -q '"name": "waymark"' package.json 2>/dev/null; then
    TARGET_DIR="$(pwd)"
    echo -e "${GREEN}✓ Detected existing Waymark workspace at:${NC} $TARGET_DIR"
  else
    TARGET_DIR="$HOME/Waymark"
  fi
fi

# 2. Check System Prerequisites
echo -e "\n${BLUE}→ [1/6] Checking system prerequisites...${NC}"

# Check git
if ! command -v git >/dev/null 2>&1; then
  echo -e "${RED}❌ git is not installed.${NC} Please install git (e.g. sudo apt install -y git) and rerun."
  exit 1
fi
echo -e "  ${GREEN}✓${NC} git $(git --version | awk '{print $3}')"

# Check node
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}❌ node is not installed.${NC} Node.js >= 18 is required."
  echo "Install Node.js via nvm or package manager: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}❌ Node.js version $NODE_VERSION is too old.${NC} Please upgrade to Node.js 18 or higher."
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js v$NODE_VERSION"

# Check npm
if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}❌ npm is not installed.${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} npm v$(npm -v)"

# Check agy (Antigravity CLI)
if command -v agy >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} agy CLI is installed"
else
  echo -e "  ${YELLOW}⚠️  Warning: agy CLI was not found in PATH.${NC}"
  echo -e "     Ensure Antigravity CLI is installed and available in your environment before running orchestrator tasks."
fi

# 3. Clone or Update Repository
echo -e "\n${BLUE}→ [2/6] Preparing repository at $TARGET_DIR...${NC}"
if [ -e "$TARGET_DIR/.git" ]; then
  echo -e "  Updating existing git repository..."
  cd "$TARGET_DIR"
  git fetch origin 2>/dev/null || true
else
  echo -e "  Cloning Waymark repository..."
  git clone -b "$DEFAULT_BRANCH" https://github.com/tekjanson/Waymark.git "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

# 4. Install Dependencies
echo -e "\n${BLUE}→ [3/6] Installing npm dependencies...${NC}"
npm install --no-audit --no-fund --silent
cd mcp && npm install --no-audit --no-fund --silent && cd ..
echo -e "  ${GREEN}✓${NC} Dependencies installed successfully."

# 5. Compile AGY Skills & Catalog
echo -e "\n${BLUE}→ [4/6] Compiling 42 AGY workspace skills & catalog...${NC}"
node scripts/compile-all-agents.mjs --force
echo -e "  ${GREEN}✓${NC} 42 skills compiled in .agents/skills/ and catalog generated."

# 6. Configure MCP Servers
echo -e "\n${BLUE}→ [5/6] Registering Waymark MCP servers in AGY configuration...${NC}"
node scripts/setup-mcp-config.mjs
echo -e "  ${GREEN}✓${NC} MCP servers registered (waymark: 12 tools, google-sheets: 11 tools)."

# 7. Check / Setup Google Authentication
echo -e "\n${BLUE}→ [6/6] Checking Google authentication...${NC}"
if node scripts/setup-headless-auth.mjs --check >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Google credentials (OAuth and/or Service Account) are verified and ready!"
else
  echo -e "  ${YELLOW}⚠️  Google credentials need configuration.${NC}"
  if [ "${NON_INTERACTIVE:-0}" != "1" ] && [ -t 0 ]; then
    echo -e "  Launching headless OAuth setup...\n"
    node scripts/setup-headless-auth.mjs || true
  else
    echo -e "  To authenticate on this headless machine, run:\n"
    echo -e "    ${BOLD}node scripts/setup-headless-auth.mjs${NC}\n"
  fi
fi

# 8. Create convenient run-wayside.sh runner
RUN_SCRIPT="$TARGET_DIR/run-wayside.sh"
cat << 'RUNNER_EOF' > "$RUN_SCRIPT"
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LEDGER_ID="${1:-${WAYSIDE_LEDGER_ID:-$WAYMARK_SHEET_ID}}"
if [ -z "$LEDGER_ID" ]; then
  echo "Usage: ./run-wayside.sh <ledgerSpreadsheetId>"
  echo "   or: WAYSIDE_LEDGER_ID=<id> ./run-wayside.sh"
  exit 1
fi

export AGY_MODEL="${AGY_MODEL:-gemini-3.8-flash-high}"
exec node scripts/wayside-orchestrator.mjs --sheet "$LEDGER_ID"
RUNNER_EOF
chmod +x "$RUN_SCRIPT"

# 9. Optional Systemd User Service Generation
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/waymark-wayside.service"
mkdir -p "$SYSTEMD_USER_DIR"

cat << SYSTEMD_EOF > "$SERVICE_FILE"
[Unit]
Description=Waymark Wayside AGY Autonomous Orchestrator
After=network.target

[Service]
Type=simple
WorkingDirectory=$TARGET_DIR
Environment=NODE_ENV=production
Environment=PATH=$PATH
Environment=AGY_MODEL=gemini-3.8-flash-high
Environment=WAYSIDE_LEDGER_ID=${WAYMARK_SHEET_ID:-}
ExecStart=$(command -v node) $TARGET_DIR/scripts/wayside-orchestrator.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
SYSTEMD_EOF

if [ "${INSTALL_SYSTEMD:-0}" = "1" ] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable --now waymark-wayside.service
  echo -e "  ${GREEN}✓${NC} systemd user service enabled and started!"
fi

echo -e "\n${CYAN}${BOLD}===============================================================${NC}"
echo -e "${GREEN}${BOLD}  ✓ Headless Installation & Configuration Complete!${NC}"
echo -e "${CYAN}${BOLD}===============================================================${NC}\n"

echo -e "${BOLD}Next Steps:${NC}"
echo -e "  1. Launch Wayside Orchestrator:"
echo -e "     ${CYAN}./run-wayside.sh <ledgerSpreadsheetId>${NC}"
echo -e ""
echo -e "  2. Or run as a background service via systemd:"
echo -e "     ${CYAN}systemctl --user enable --now waymark-wayside${NC}"
echo -e ""
echo -e "  3. Test AGY directly with Gemini Flash:"
echo -e "     ${CYAN}node scripts/agy-agent-runner.mjs -m \"List all my waymark files\"${NC}"
echo -e ""
