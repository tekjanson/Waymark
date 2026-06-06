# GitHub Copilot Auth — Dev Worker Container

The dev worker uses the **GitHub Copilot CLI** (`@github/copilot` npm package).
Auth is a simple JSON file — no gnome-keyring, no VS Code token stores, no SQLite hacking.

---

## How Authentication Works

The Copilot CLI stores its OAuth token in `~/.copilot/config.json` on your host.

The container mounts your host `~/.copilot/` directory directly at `/root/.copilot/`.
When the CLI starts inside the container, it reads the same config file you already
have from your interactive sessions. **No re-auth needed — it just works.**

---

## First-Time Auth Setup

If you haven't authenticated the Copilot CLI on your host yet:

```bash
# On your HOST machine:
copilot --login
```

Follow the OAuth flow in your browser. The token saves to `~/.copilot/config.json`.
Start the container — it picks up the token automatically.

---

## Signs the Container Has Valid Auth

- `docker logs waymark-dev-worker` shows the agent session starting and working
- No `authentication failed` or `not logged in` errors in the logs
- `bash dev-worker/test.sh agent` shows the auth config as present

---

## Signs Auth Has Expired or Is Missing

- Logs show: `authentication failed` or `please run copilot --login`
- `bash dev-worker/test.sh agent` reports the auth config as skipped

---

## Re-Auth When Token Expires

```bash
# On your HOST machine:
copilot --login

# Then restart the container to pick up the refreshed token:
docker compose -f dev-worker/docker-compose.yml restart
```

---

## Manual Verification

```bash
bash dev-worker/test.sh agent
```

Expected output:
```
3. Copilot CLI Agent
  ✓ copilot CLI installed: 1.0.x
  ✓ agent-runner.sh is present and executable
  ✓ Copilot auth config present at /root/.copilot/config.json
```

---

## Architecture Reference

| Component | Value |
|---|---|
| Auth token location (host) | `~/.copilot/config.json` |
| Auth token location (container) | `/root/.copilot/config.json` |
| Volume mount | `~/.copilot:/root/.copilot` (read-write) |
| Token format | Plain JSON — no encryption, no keyring |
| Re-auth command | `copilot --login` (on host) |
