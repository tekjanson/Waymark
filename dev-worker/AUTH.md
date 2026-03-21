# GitHub Copilot Auth — Dev Worker Container

This document explains how authentication works in the `dev-worker` container,
how to set it up for the first time, how to re-authenticate when tokens expire,
and how to troubleshoot problems.

---

## How Authentication Works

### The challenge: tokens can't just be copied from your host VS Code

Your normal desktop VS Code stores GitHub tokens encrypted with **gnome-keyring**
(the system keychain). Tokens in that format are tied to your desktop session and
can't be read by VS Code running inside Docker — you'd get a `safeStorage.decryptString`
error and the sign-in would fail silently.

### The solution: `--password-store=basic`

The container's VS Code is launched with `--password-store=basic`. This flag tells
VS Code to use its own simple AES encryption instead of gnome-keyring. Tokens saved
under `basic` mode are portable — they can be written on the host and read inside
the container as long as both are using the same flag.

### Where tokens are stored

Tokens land in the **named Docker volume** `dev-worker_waymark-vscode-auth`, which
maps to `/root/.config/Code/User/globalStorage/` inside the container.

Depending on your VS Code build, tokens appear in one or both of:
- `globalStorage/vscode.github-authentication/` — newer VS Code builds (a directory of JSON files)
- `globalStorage/state.vscdb` — a SQLite database. On some Linux builds this is the
  only storage location. A fresh (unsigned-in) `state.vscdb` is ~8 KB; one with live
  tokens is generally 40 KB or larger.

**Important:** The seed process that copies your host `~/.config/Code/User/` into the
container deliberately **skips** `globalStorage` to avoid importing gnome-keyring-encrypted
tokens from your regular VS Code install. The `setup-auth.sh` script handles auth separately.

---

## Signs the Container Has Valid Auth

When everything is working you should see:

- **Copilot icon in the status bar** (bottom of VS Code in the noVNC window) is solid
  blue / white — not crossed out and not a warning triangle
- **Copilot Chat responds** when you open the chat panel (left sidebar)
- **Agent command fires on boot** — the watchdog types the `AGENT_COMMAND` into chat
  and the agent begins work; visible in the noVNC window at http://localhost:6080/vnc.html

---

## Signs Auth Has Expired or Is Missing

- Copilot chat shows: *"GitHub Copilot could not connect to the server. Extension
  activation failure: You are not signed in."*
- VS Code shows a sign-in notification in the bottom-right corner
- The Copilot icon has a warning symbol or is greyed out
- The agent watchdog injects the command but nothing happens (the agent can't start
  tasks without Copilot access)
- `bash dev-worker/test.sh auth` reports auth tests as SKIPPED

---

## First-Time Auth Setup

### Prerequisites

- The container must be running: `docker compose -f dev-worker/docker-compose.yml up -d`
- Your host machine has VS Code in PATH: `code --version`
- You have a GitHub account with access to GitHub Copilot
- noVNC is reachable at http://localhost:6080/vnc.html

### Steps

1. **From the repo root, run:**
   ```bash
   bash dev-worker/setup-auth.sh
   ```

2. **An isolated VS Code window opens on your desktop.**
   This window uses a temporary data directory and your host's extensions folder
   (so Copilot Chat is available). It does NOT interact with your normal VS Code
   install.

3. **In that VS Code window:**
   - Wait for it to fully load (~10–20 seconds, progress indicator in the bottom bar)
   - Press `Ctrl+Shift+P`
   - Type `GitHub Copilot: Sign in` and press Enter
   - Your default host browser opens the GitHub OAuth page
   - Authorize the application
   - Switch back to VS Code — the Copilot icon in the status bar should turn active

4. **Close the VS Code window** (the script is blocked waiting for it).

5. The script validates that tokens were saved, injects them into the container,
   restarts VS Code inside the container, and runs `test.sh auth` to confirm.

6. **Open http://localhost:6080/vnc.html** and verify the Copilot icon is active
   in the container's VS Code window.

---

## Re-Auth When Tokens Expire

GitHub Copilot tokens typically last several weeks to months. When they expire:

```bash
bash dev-worker/setup-auth.sh
```

Same command as first-time auth. The script overwrites the old tokens in the
container's auth volume with fresh ones.

---

## Manual Verification

After running `setup-auth.sh`:

```bash
bash dev-worker/test.sh auth
```

Expected output (tokens present):
```
[auth] globalStorage volume is writable: PASS
[auth] state.vscdb exists: PASS
[auth] auth token directory present: PASS
```

If the third test shows SKIP, the `vscode.github-authentication/` directory wasn't
created — but tokens may still be in `state.vscdb`; check by looking in noVNC.

---

## Emergency: Full Auth Reset

If the container's auth volume is corrupted or you want to start completely fresh:

```bash
# 1. Stop and remove the container + named volume
docker compose -f dev-worker/docker-compose.yml down
docker volume rm dev-worker_waymark-vscode-auth

# 2. Restart the container (volume is recreated empty)
docker compose -f dev-worker/docker-compose.yml up -d

# 3. Re-authenticate
bash dev-worker/setup-auth.sh
```

---

## Inspecting Auth State Inside the Container

```bash
CONTAINER=waymark-dev-worker

# List globalStorage contents
docker exec $CONTAINER ls -lh /root/.config/Code/User/globalStorage/

# Check if auth directory exists (newer VS Code builds)
docker exec $CONTAINER ls /root/.config/Code/User/globalStorage/vscode.github-authentication/ 2>/dev/null \
    && echo "auth dir present" || echo "auth dir absent"

# Check state.vscdb size
docker exec $CONTAINER du -h /root/.config/Code/User/globalStorage/state.vscdb

# Check for safeStorage errors in VS Code logs
docker exec $CONTAINER grep -r "safeStorage" /root/.config/Code/logs/ 2>/dev/null | tail -5
```

---

## Troubleshooting

### "safeStorage.decryptString" errors in VS Code logs

The globalStorage volume was seeded from gnome-keyring-encrypted host tokens.

**Fix:** Wipe the auth volume and re-authenticate from scratch (Emergency Reset above).

### Script says "no token data found" even though I signed in

VS Code may not have finished syncing tokens to disk before you closed the window.
Re-run `setup-auth.sh`, open Copilot Chat in the temporary VS Code (send one
message), confirm the response, then close.

### Injection succeeded but Copilot still shows as signed out

The container's VS Code may not have restarted cleanly. Check:

```bash
# 1. Did VS Code actually restart?
docker exec waymark-dev-worker pgrep -a code | head -2

# 2. Open noVNC and look at the Copilot icon
# http://localhost:6080/vnc.html

# 3. Force VS Code restart
docker exec waymark-dev-worker pkill -f "code.*--no-sandbox"
# Watchdog relaunches it within ~15s
```

### Container is not running / won't start

```bash
docker compose -f dev-worker/docker-compose.yml logs --tail=50
```

Look for errors in the xtigervnc, openbox, or novnc lines. A common issue is that
port 5901 or 6080 is already in use on the host.

### Agent command fires but nothing happens in chat

This means VS Code launched but Copilot is not authenticated. Run setup-auth.sh.

---

## Architecture Reference

| Component | Value |
|---|---|
| Auth volume | `dev-worker_waymark-vscode-auth` |
| Volume mount path | `/root/.config/Code/User/globalStorage` |
| Token format | `--password-store=basic` (portable AES, not gnome-keyring) |
| Token locations | `vscode.github-authentication/` and/or `state.vscdb` |
| Host seed behavior | Copies `~/.config/Code/User/*` EXCEPT `globalStorage` |
| Watchdog re-inject interval | 600 seconds (heartbeat stale threshold) |
| Container VS Code launch flags | `--no-sandbox --disable-gpu --user-data-dir /root/.config/Code --password-store=basic` |
