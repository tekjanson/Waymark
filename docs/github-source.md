# GitHub Source Serving — Experimental Branch

> **Branch:** `feature/github-source-serving`
>
> This is an exploratory branch. The standard AI_laws rule about no new
> server-side files is intentionally relaxed here to test a fundamentally
> different serving model.

## Concept

Instead of baking the frontend (`public/`) into the Docker image at build time,
the server pulls frontend files **directly from the GitHub repo** at a
configurable commit hash, branch, or tag. This makes the frontend version
completely flexible without redeploying:

```
┌───────────┐     GET /js/app.js     ┌─────────────────┐
│  Browser   │ ──────────────────────▶│  WayMark Server  │
└───────────┘                        │                   │
                                     │  1. Check memory   │
                                     │  2. Check disk     │
                                     │  3. Fetch GitHub   │
                                     │     raw content    │
                                     │  4. Cache + serve  │
                                     └────────┬──────────┘
                                              │
                                              ▼
                                   raw.githubusercontent.com
                                   /{owner}/{repo}/{ref}/public/js/app.js
```

## Usage

### Local Development

```bash
GITHUB_SOURCE=true \
GITHUB_OWNER=your-username \
GITHUB_REPO=Waymark \
GITHUB_REF=main \
WAYMARK_LOCAL=true \
node server/index.js
```

### With a Specific Commit

```bash
GITHUB_SOURCE=true \
GITHUB_OWNER=your-username \
GITHUB_REPO=Waymark \
GITHUB_REF=abc1234 \
node server/index.js
```

### Private Repos

Set `GITHUB_TOKEN` to a GitHub Personal Access Token with `repo` scope:

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
GITHUB_SOURCE=true \
...
```

### Docker

```bash
docker build \
  --build-arg GITHUB_SOURCE=true \
  --build-arg GITHUB_OWNER=your-username \
  --build-arg GITHUB_REPO_NAME=Waymark \
  --build-arg GITHUB_REF=main \
  -t waymark:github-source .

# Override ref at runtime without rebuilding:
docker run -e GITHUB_REF=v2.0.0 waymark:github-source
```

## Runtime API

Once the server is running with `GITHUB_SOURCE=true`, you can switch the
frontend version without restarting:

### `GET /api/source`
Returns the current source configuration:
```json
{
  "mode": "github",
  "owner": "your-username",
  "repo": "Waymark",
  "ref": "main",
  "cachedRefs": ["main", "abc1234"]
}
```

### `POST /api/source/ref`
Switch to a different ref (commit SHA, branch, or tag):
```bash
curl -X POST http://localhost:3000/api/source/ref \
  -H 'Content-Type: application/json' \
  -d '{"ref": "abc1234"}'
```

### `POST /api/source/purge`
Clear the disk + memory cache for the current ref:
```bash
curl -X POST http://localhost:3000/api/source/purge
```

## How Caching Works

1. **Memory LRU** — 500-entry in-memory cache for hot files (~instant)
2. **Disk cache** — `server/.github-cache/{ref}/` stores fetched files
3. **Tree pre-warm** — on startup (and ref switch), the GitHub Trees API is
   called to learn every file path. This lets the server 404 immediately for
   unknown files instead of hitting GitHub each time.

When you switch refs, the memory cache is cleared but the disk cache persists
(keyed by ref), so switching back to a previous ref is nearly instant.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_SOURCE` | Yes | `false` | Set to `true` to enable |
| `GITHUB_OWNER` | Yes | — | GitHub repo owner |
| `GITHUB_REPO` | Yes | — | GitHub repo name |
| `GITHUB_REF` | No | `main` | Commit SHA, branch, or tag |
| `GITHUB_TOKEN` | No | — | PAT for private repos |

## Things to Explore Next

- **Webhook-triggered ref switching** — GitHub webhook on push → auto-update ref
- **A/B testing** — serve different refs to different users via cookie
- **Rollback UI** — admin panel to switch refs with one click
- **CDN layer** — put Cloudflare/Fastly in front for edge caching
- **Selective file overrides** — serve most files from GitHub but override
  specific files locally (e.g. config, branding)
