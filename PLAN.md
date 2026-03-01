# WayMark — Project Plan

## 1. Overview

WayMark is a lightweight tool that turns Google Sheets into interactive checklists, honey-do lists, and other structured views — with keyword search and 18+ interactive templates. It ships as:

- **A web app** — static frontend served from a Docker container (Node.js/Express for auth only), behind an Nginx reverse proxy on `swiftirons.com`
- **An Android app** — WebView wrapper sharing the same frontend code, with offline support

The server stores **zero user data** and performs **zero business logic**. All data lives in the user's own Google Drive. The server's only job is serving static files and brokering the OAuth flow.

### Core Data Philosophy — CREATE + READ Only

WayMark follows a strict **CR (Create + Read)** data model — no updates, no deletes:

| Operation | Allowed? | Details |
|---|---|---|
| **CREATE** | ✅ | WayMark can create new files (sheets, logs, records) in the user's Drive folders for historical tracking |
| **READ** | ✅ | WayMark reads existing sheets and renders them as checklists, lists, etc. |
| **UPDATE** | ❌ | WayMark never modifies existing sheet data — all edits are done by the user in Google Sheets directly |
| **DELETE** | ❌ | WayMark never deletes any files or data |

This means:
- Existing data is **immutable** from WayMark's perspective — it only reads what's there
- WayMark **can write new records** to Drive (e.g., completion logs, result snapshots) so they can be shared and reviewed historically
- New records are append-only — once written, WayMark won't modify or delete them
- Users maintain full control over their data in Google Sheets
- Sheets can be shared via Google Drive's native sharing — WayMark reads whatever the user has access to

### Use Cases for CREATE

- **Completion snapshots** — when a user views a checklist, WayMark can log a timestamped snapshot (new sheet/row in a log file) for historical tracking
- **AI search logs** — ~~Removed~~ Search is now keyword-based; no logs needed
- **Result records** — any generated output or report can be written as a new file in Drive, shareable with others

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     User's Browser / Android App         │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Frontend (HTML / JS / CSS)                        │  │
│  │  - Google Sheets API (READ existing, CREATE new)   │  │
│  │  - Google Drive API (browse/list/search/create)    │  │
│  │  - All UI rendering & business logic               │  │
│  └──────────────┬─────────────────────────────────────┘  │
│                 │                                         │
│        OAuth token (bearer)                               │
│                 │                                         │
└─────────────────┼─────────────────────────────────────────┘
                  │
    ┌─────────────▼──────────────┐
    │  Google APIs               │
    │  - Sheets (read + create)  │
    │  - Drive (browse + create) │
    │  - Identity (OAuth)        │
    └────────────────────────────┘

┌──────────────────────────────────────────────┐
│  Self-Hosted Server (swiftirons.com)         │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Nginx (reverse proxy / TLS)         │    │
│  │  - Routes waymark.swiftirons.com     │    │
│  │    → waymark Docker container :3000  │    │
│  │  - Routes other subdomains/paths     │    │
│  │    → other containers                │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ┌────────────────────────────┐              │
│  │  WayMark Container         │              │
│  │  - Express: static files   │              │
│  │  - Express: /auth/* routes │              │
│  │  - No DB, no user data     │              │
│  └────────────────────────────┘              │
│                                              │
│  ┌────────────────────────────┐              │
│  │  Other containers...       │              │
│  └────────────────────────────┘              │
└──────────────────────────────────────────────┘
```

### Key Principles

| Principle | Detail |
|---|---|
| Frontend-first | All business logic, data fetching, and rendering happen client-side |
| Zero server state | Server has no database; tokens live in browser/app only |
| CR-only data | **Create + Read** only — no updates, no deletes. Existing data is immutable. |
| Google as backend | Google Sheets = data source, Google Drive = file system + record store |
| Multi-directory | Users can browse and pin multiple Drive folders, including shared folders from other people |
| AI-powered search | Keyword search across sheet names |
| Docker-packaged | Single container: `node` image, Express for auth + static serving |
| Vanilla stack | Raw HTML/CSS/JS — no CSS frameworks, no frontend frameworks — fast and simple to maintain |
| Testable by design | Local-only mock mode replaces all Google APIs with local fixtures; Playwright E2E tests cover real user behavior |

---

## 3. Tech Stack

### 3.1 Web App

| Layer | Technology |
|---|---|
| Runtime | Node.js (LTS) |
| Server framework | Express.js (minimal — auth routes + static file serving) |
| Frontend | Vanilla HTML + CSS + JavaScript (no framework) |
| CSS | Raw/vanilla CSS — no framework or library |
| Auth | Google OAuth 2.0 (Authorization Code flow with PKCE, server-side token exchange) |
| Token storage | httpOnly cookie for refresh token; in-memory JS variable for access token |
| Google API access | `fetch` against REST endpoints with bearer token (Sheets, Drive) |
| AI | Removed — all features are code-based |
| Containerization | Docker (node:lts-alpine base image) |
| Reverse proxy | Nginx (existing self-hosted setup on swiftirons.com) |
| E2E Testing | Playwright — real user behavior tests against a local-only mock mode |
| Test runner | `npm test` runs Playwright; CI-friendly (headless) |

### 3.2 Android App (WebView Wrapper)

| Layer | Technology |
|---|---|
| Language | Kotlin |
| Min SDK | API 26 (Android 8.0) |
| UI | **WebView** wrapping the same frontend code as the web app |
| Auth | Google Sign-In SDK / Credential Manager → inject token into WebView |
| Google API access | Same frontend JS in WebView (Sheets, Drive via REST with bearer token) |
| Offline | Service Worker + cached sheet data in IndexedDB for offline viewing |

The Android app is a thin native shell that handles Google Sign-In, injects the auth token into a WebView, and loads the same HTML/JS/CSS frontend. This shares 95%+ of code with the web version. Native UI can be considered in the future if needed.

---

## 4. Google OAuth & API Scopes

### 4.1 OAuth Flow (Web)

1. User clicks "Sign in with Google" → redirected to Google consent screen
2. Google redirects back to `/auth/callback` with an authorization code
3. Server exchanges code for access + refresh tokens (server-side, keeps nothing in memory long-term)
4. Server sets refresh token as an **httpOnly secure cookie** and returns the access token in the response body
5. Frontend stores access token **in memory only** (JS variable) for Google API calls
6. On page reload, frontend calls `/auth/refresh` — server reads the httpOnly cookie and returns a fresh access token
7. Access tokens expire after ~1 hour; the frontend refreshes transparently via `/auth/refresh`

### 4.2 OAuth Flow (Android)

1. Google Sign-In SDK handles consent natively on the device
2. App receives access token directly from the SDK
3. Token is injected into the WebView via a JavaScript bridge
4. WebView frontend uses the token for all Google API calls

### 4.3 Required Scopes

| Scope | Purpose |
|---|---|
| `openid` | User identity |
| `email` | Display user email |
| `profile` | Display user name/avatar |
| `https://www.googleapis.com/auth/spreadsheets` | Read existing sheets + create new sheets (for logging/records) |
| `https://www.googleapis.com/auth/drive.readonly` | Browse and read files/folders across Drive (including "Shared with me" and shared drives) |
| `https://www.googleapis.com/auth/drive.file` | Create new files in Drive (logs, records, snapshots) — only affects files WayMark creates |

> **Scope rationale:**
> - `drive.readonly` — lets users browse their entire Drive folder tree, including shared items. WayMark never modifies or deletes anything via this scope.
> - `drive.file` — lets WayMark create new files (logs, snapshots). This scope only grants access to files the app itself creates, so it can't touch existing user files.
> - `spreadsheets` (not `readonly`) — needed because WayMark creates new sheets for record-keeping. **The app code will never issue update or delete calls against existing sheets.**

### 4.4 OAuth Configuration

| Setting | Value |
|---|---|
| Authorized redirect URIs | `https://swiftirons.com/auth/callback`, `http://localhost:3000/auth/callback` |
| Application type | Web application + Android |
| Consent screen | External (supports both personal Gmail and Google Workspace accounts) |
| Test users | Personal Gmail accounts during development; publish for production |
| APIs to enable | Google Sheets API, Google Drive API |

---

## 5. Search — Keyword Matching

### Overview

WayMark provides a keyword search bar that matches queries against sheet names across the user's Drive. Search is fast, client-side, and requires no external APIs.

### How It Works

1. User types a search query into the WayMark search bar (e.g., "grocery")
2. Frontend filters the list of known sheets by name (case-insensitive substring match)
3. Matching sheets are displayed as clickable results
4. User clicks a result to navigate to that sheet

---

## 6. Feature Roadmap

### Phase 1 — MVP (Checklist Viewer + Keyword Search)

- [ ] Google OAuth sign-in (web) with httpOnly cookie token storage
- [ ] **Drive Explorer** — browse the user's Drive folder tree (including "Shared with me"), lazy-loaded on expand
- [ ] Let user select / pin one or more Drive folders as checklist sources
- [ ] List Google Sheets within the selected folders
- [ ] Open a sheet and render it as a read-only checklist view
- [ ] Manual refresh button + auto-refresh every 60 seconds (toggleable)
- [ ] **Keyword search** — search bar to find sheets by name across pinned folders
- [ ] **Record creation** — write completion snapshots to user's Drive
- [ ] Basic responsive UI (mobile-friendly, vanilla CSS)
- [ ] **API abstraction layer** (`api-client.js`) — switchable between real Google APIs and local mock
- [ ] **Local-only mode** — `WAYMARK_LOCAL=true` boots with fixture data, no Google account needed
- [ ] **Playwright E2E tests** for all Phase 1 features (auth, explorer, checklist, search, records)
- [ ] Docker container build & run
- [ ] Nginx reverse proxy config for swiftirons.com
- [ ] Deploy to self-hosted server + CI pipeline running Playwright tests

### Phase 2 — Android App

- [ ] Android project scaffolding (Kotlin + WebView wrapper)
- [ ] Google Sign-In integration via Credential Manager
- [ ] Inject auth token into WebView via JavaScript bridge
- [ ] Verify Drive Explorer, keyword search, and multi-folder support in WebView
- [ ] **Offline support** — Service Worker caches frontend assets; IndexedDB caches last-fetched sheet data for offline viewing
- [ ] Build & test APK
- [ ] Play Store listing (if desired)

### Phase 3 — Sharing & Collaboration

- [ ] Shared folder workflow — User A shares a Drive folder with User B; both see the same checklists in WayMark
- [ ] Visual indicators for shared vs. personal folders
- [ ] Honey-do list rendering (assignee, due date, priority columns)
- [ ] Multiple list views (checklist, kanban-style, table)
- [ ] Push notifications (Android) for sheet changes (via polling)

### Phase 4 — Complex Data Sets

- [ ] Support for arbitrary sheet schemas (auto-detect columns, types)
- [ ] Filtering, sorting, search within a sheet
- [ ] Dashboard view — summary across multiple sheets/folders
- [ ] Folder-level aggregation (show completion stats across all sheets in a folder)

---

## 7. Project Structure

```
Waymark/
├── PLAN.md                  # This file
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env.example             # Google OAuth client ID/secret, port
├── nginx/
│   └── waymark.conf         # Nginx site config (reverse proxy to container)
├── server/
│   ├── index.js             # Express entry point
│   ├── auth.js              # /auth/login, /auth/callback, /auth/refresh, /auth/logout
│   └── config.js            # Environment variable loader
├── public/                  # Static frontend files (served by Express)
│   ├── index.html           # Main entry page
│   ├── css/
│   │   └── style.css        # Vanilla CSS — all styles
│   ├── js/
│   │   ├── app.js           # App initialization, routing
│   │   ├── auth.js          # Client-side auth helpers (in-memory token, refresh calls)
│   │   ├── sheets.js        # Google Sheets API wrapper (read existing + create new)
│   │   ├── drive.js         # Google Drive API wrapper (browse folders, list files, create files)
│   │   ├── explorer.js      # Drive Explorer UI (folder tree, lazy-load, folder pinning)
│   │   ├── search.js        # Search UI (keyword search bar, results display)
│   │   ├── checklist.js     # Checklist rendering logic (read-only)
│   │   ├── records.js       # Record creation (snapshots, logs → write to Drive)
│   │   ├── storage.js       # localStorage helpers (pinned folders, preferences)
│   │   └── ui.js            # Shared UI utilities (modals, toasts, etc.)
│   └── assets/
│       └── logo.svg
├── tests/                   # Playwright E2E tests
│   ├── playwright.config.js # Playwright configuration
│   ├── fixtures/            # Test data (mock sheets, folders, users)
│   │   ├── folders.json     # Mock Drive folder tree
│   │   ├── sheets/          # Mock sheet data (one JSON per sheet)
│   │   │   ├── groceries.json
│   │   │   ├── home-projects.json
│   │   │   └── shared-chores.json
│   │   └── users.json       # Mock user profiles (no real Google accounts)
│   ├── e2e/                 # Test specs organized by user flow
│   │   ├── auth.spec.js     # Login, logout, session restore
│   │   ├── explorer.spec.js # Drive explorer: browse, expand, pin/unpin folders
│   │   ├── checklist.spec.js# View checklist, verify rendering, refresh behavior
│   │   ├── search.spec.js   # Keyword search bar, results display, result navigation
│   │   ├── records.spec.js  # Record creation, verify log files appear
│   │   └── sharing.spec.js  # Multi-user shared folder scenarios
│   └── helpers/
│       ├── mock-server.js   # Express middleware that serves mock API responses
│       └── test-utils.js    # Shared helpers (login as mock user, seed data, etc.)
├── public/
│   └── js/
│       └── api-client.js    # Abstraction layer — real Google APIs vs. local mock (see §15)
└── android/                 # Android project (added in Phase 2)
    ├── app/
    │   └── src/main/
    │       ├── java/.../     # Kotlin: MainActivity, WebView setup, Google Sign-In
    │       ├── assets/       # Bundled copy of public/ for offline
    │       └── res/          # Android resources
    ├── build.gradle
    └── ...
```

---

## 8. Server Endpoints

The server is intentionally minimal. Only auth-related routes exist:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Serve `index.html` (static) |
| `GET` | `/auth/login` | Redirect to Google OAuth consent screen (with PKCE) |
| `GET` | `/auth/callback` | Receive auth code, exchange for tokens, set httpOnly cookie (refresh token), return access token |
| `POST` | `/auth/refresh` | Read httpOnly cookie, exchange refresh token for new access token, return it |
| `POST` | `/auth/logout` | Clear the httpOnly refresh token cookie |
| `GET` | `/*` | Serve static files from `public/` |

Everything else — reading sheets, browsing Drive folders, creating records, querying Drive — happens **entirely in the browser** via the Google APIs.

---

## 9. Data Model (Google Sheets Conventions)

WayMark reads existing sheets and can create new ones, but **never updates or deletes**.

### Checklist Sheet Format (expected by WayMark — read only)

| Column A | Column B | Column C | Column D |
|---|---|---|---|
| **done** | **item** | **created** | **notes** |
| `FALSE` | Buy milk | 2026-02-27 | 2% |
| `TRUE` | Fix fence | 2026-02-25 | Back yard |
| `FALSE` | Call plumber | 2026-02-26 | |

- Row 1 = header row (used by WayMark to identify column purpose)
- Column A (`done`) = boolean checkbox state — rendered as a visual checkmark in WayMark
- **All edits** to these sheets **are done by the user in Google Sheets directly** — WayMark only reads and displays

### Records Created by WayMark (write — append-only)

WayMark creates new files in a dedicated `_waymark_logs/` folder within each pinned folder (or a top-level `WayMark Logs` folder in the user's Drive):

| Record Type | Format | Content |
|---|---|---|
| Completion snapshot | New sheet (or new rows in a log sheet) | Timestamp + checklist state at time of viewing |


These logs are regular Google Sheets, so they're:
- Readable by anyone the folder is shared with
- Browsable in Google Drive
- Never modified or deleted by WayMark

### Multi-Directory & Sharing Model

WayMark allows users to browse and pin **multiple Drive folders** as data sources:

```
┌─────────────────────────────────────────────┐
│  Drive Explorer (in WayMark)                │
│                                             │
│  📁 My Drive                                │
│    📁 Groceries          [⭐ pinned]        │
│    📁 Home Projects      [⭐ pinned]        │
│  📁 Shared with me                          │
│    📁 Family Chores (from spouse@...)       │
│    📁 Team Tasks (from boss@...)  [⭐ pinned]│
│  📁 Shared drives                           │
│    📁 Household                             │
└─────────────────────────────────────────────┘
```

- **Lazy-loaded** — folders are only fetched when the user expands them (fast, lightweight)
- **Pinned folders** appear on the home screen for quick access
- Pinned folder IDs are stored in the browser's `localStorage` (no server state)
- Shared folders work automatically — if someone shares a Drive folder containing sheets with the user, those sheets appear when browsing "Shared with me"
- **Sharing checklists = sharing a Drive folder** using Google's native sharing

### How Sharing Works (User Story)

1. **User A** creates a Google Sheets checklist in a Drive folder called "Family Chores"
2. **User A** shares that folder with **User B** via Google Drive's share dialog
3. **User B** opens WayMark, browses "Shared with me", sees "Family Chores"
4. **User B** pins the folder and can now view the checklist
5. When **User A** updates the sheet in Google Sheets, **User B** sees the changes on next refresh (manual or auto every 60s)
6. WayMark's log records in the folder are also visible to both users

### Client-Side Preferences (localStorage)

| Key | Value | Purpose |
|---|---|---|
| `waymark_pinned_folders` | JSON array of `{id, name, owner}` | Folders shown on home screen |
| `waymark_last_folder` | Folder ID string | Resume where the user left off |
| `waymark_view_prefs` | JSON object | Per-sheet view preferences (list style, sort order) |
| `waymark_auto_refresh` | `true` / `false` | Whether 60s auto-refresh is enabled (default: `true`) |

---

## 10. Hosting & Nginx Setup

### Existing Infrastructure

WayMark will run alongside other self-hosted services behind an existing Nginx reverse proxy on `swiftirons.com`.

### Nginx Site Config (`nginx/waymark.conf`)

```nginx
server {
    listen 443 ssl http2;
    server_name swiftirons.com;  # or waymark.swiftirons.com if using a subdomain

    ssl_certificate     /etc/letsencrypt/live/swiftirons.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/swiftirons.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name swiftirons.com;
    return 301 https://$host$request_uri;
}
```

> **Note:** Adjust `server_name` and `ssl_certificate` paths to match your existing Nginx setup. If you're using a subdomain (e.g., `waymark.swiftirons.com`), update accordingly and add a DNS record.

### Multi-Container Strategy

Since the server already hosts other containers, WayMark's `docker-compose.yml` should use a dedicated port and Nginx routes traffic based on `server_name` or URL path:

- **Option: Subdomain routing** — `waymark.swiftirons.com` → WayMark container on port 3000
- **Option: Path routing** — `swiftirons.com/waymark/` → WayMark container (requires base path config)

---

## 11. Docker Setup

### Dockerfile

```dockerfile
FROM node:lts-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
CMD ["node", "server/index.js"]
```

### docker-compose.yml

```yaml
version: "3.8"
services:
  waymark:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    restart: unless-stopped
```

### Environment Variables (`.env`)

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | `https://swiftirons.com/auth/callback` (prod) or `http://localhost:3000/auth/callback` (dev) |
| `COOKIE_SECRET` | Random string for signing the httpOnly refresh token cookie |
| `PORT` | Server port (default `3000`) |
| `NODE_ENV` | `production` or `development` |

---

## 12. Security Considerations

- **httpOnly cookies** — refresh token stored in a secure, httpOnly, SameSite=Strict cookie; access token in memory only
- **No server-side data storage** — server is stateless; cookie is the only server-touching credential
- **HTTPS enforced** — Nginx terminates TLS with Let's Encrypt; HTTP redirects to HTTPS
- **PKCE** used in the OAuth flow for added security
- **CR-only enforcement** — app code only calls Sheets/Drive create and read methods; update and delete methods are never invoked. Code review and linting should enforce this.
- **Scoped writes** — `drive.file` scope limits WayMark's write access to only files it creates; it cannot modify pre-existing files
- **Token expiry** — access tokens are short-lived (~1 hour); refreshed transparently via `/auth/refresh`
- **CSP headers** — restrict scripts to same-origin + Google APIs
- **CORS** — not needed since the frontend and server are same-origin (both on swiftirons.com)
- **Cookie flags** — `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/auth`
- **Search privacy** — all search is client-side keyword matching; no data is sent to external APIs

---

## 13. Android Offline Support

The Android app (Phase 2) will support offline viewing:

### Strategy

1. **Service Worker** — caches all static assets (HTML, CSS, JS) for instant offline load
2. **IndexedDB** — caches the last-fetched sheet data for each pinned folder
3. **Stale-while-revalidate** — show cached data immediately, refresh in background when online
4. **Visual indicator** — show "offline" badge and "last updated" timestamp when viewing cached data

### What Works Offline

| Feature | Offline? | Notes |
|---|---|---|
| View cached checklists | ✅ | Shows last-fetched data |
| Browse pinned folders | ✅ | Folder list is cached |
| Keyword search | ✅ | Works offline with cached sheet names |
| Expand new Drive folders | ❌ | Requires API call |
| See live updates | ❌ | Requires API call |
| Create records | ❌ | Queued for sync when back online |
| Sign in | ❌ | Requires Google OAuth |

### Implementation

- The Service Worker is registered in the frontend JS and works in both the web browser and the Android WebView
- On the web, offline support is a nice-to-have (users can just refresh when online)
- On Android, offline is a priority — users expect mobile apps to show something even without connectivity

---

## 14. Refresh Behavior

### Manual Refresh

- A visible refresh button/pull-to-refresh on the checklist view
- Fetches the latest data from Google Sheets API

### Auto-Refresh

- Default: **enabled**, every **60 seconds**
- User can toggle auto-refresh on/off (saved in `localStorage` as `waymark_auto_refresh`)
- Auto-refresh only runs when the app/tab is in the foreground (uses `document.visibilityState`)
- A subtle "last updated X seconds ago" indicator shows data freshness

---

## 15. Testing Strategy — Playwright E2E with Local-Only Mode

### The Problem

WayMark depends entirely on Google APIs (OAuth, Drive, Sheets). You can't scale real Google accounts for testing — OAuth requires real credentials, consent screens, and rate limits. Every test would be flaky, slow, and impossible to run in CI.

### The Solution: Data Isolation via an API Abstraction Layer

All Google API calls in the frontend go through a single **API client abstraction layer** (`api-client.js`). This layer has two implementations:

| Mode | When | What it does |
|---|---|---|
| **Production** | `NODE_ENV=production` or no flag | Calls real Google APIs with the user's OAuth token |
| **Local / Test** | `NODE_ENV=test` or `WAYMARK_LOCAL=true` | Returns mock data from local JSON fixtures — no network calls, no Google account needed |

The app boots, checks the mode, and wires up the correct implementation. **All business logic, rendering, and UI behavior are identical in both modes** — only the data source changes.

### Data Isolation Boundaries

```
┌──────────────────────────────────────────────────────┐
│  Frontend (HTML / JS / CSS)                          │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │
│  │ explorer.js  │  │ checklist.js│  │  search.js   │ │
│  │ records.js   │  │   ui.js     │  │  storage.js  │ │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘ │
│         │                 │                │         │
│         ▼                 ▼                ▼         │
│  ┌─────────────────────────────────────────────────┐ │
│  │              api-client.js                      │ │
│  │     ┌──────────────┬───────────────┐            │ │
│  │     │  PRODUCTION  │  LOCAL / TEST │            │ │
│  │     │  google-api   │  mock-api     │            │ │
│  │     │  (real OAuth) │  (JSON files) │            │ │
│  │     └──────────────┴───────────────┘            │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
         │                        │
    Real Google APIs        Local JSON fixtures
    (prod only)             (test / dev)
```

**What is isolated behind `api-client.js`:**

| Concern | Production impl | Local/Test impl |
|---|---|---|
| Auth (login/logout/token) | Google OAuth flow | Auto-login with mock user from `users.json` |
| Drive browsing | Google Drive API | Reads `folders.json` — returns mock folder tree |
| Sheet reading | Google Sheets API | Reads `sheets/*.json` — returns mock sheet data |
| Record creation | Google Sheets API (create) | Writes to an in-memory array (inspectable by tests) |
| Keyword search | Client-side name matching | Returns matching sheet names from fixture data |
| User profile | Google Identity | Returns mock `{name, email, avatar}` from fixtures |

**What is NOT behind the abstraction (tested directly):**

- All UI rendering and DOM manipulation
- Checklist display logic (checkmarks, formatting, column detection)
- Drive Explorer tree behavior (expand, collapse, pin, unpin)
- Search bar UX (typing, submitting, displaying results, fallback)
- Refresh behavior (manual button, auto-refresh timer, "last updated" indicator)
- localStorage read/write (pinned folders, preferences)
- Navigation and routing
- Error states and toast notifications

This boundary means **100% of the UI and business logic is testable** without any Google account.

### Local-Only Mode — How It Works

1. Start the server with `WAYMARK_LOCAL=true`:
   ```bash
   WAYMARK_LOCAL=true npm start
   ```
2. The server injects `window.__WAYMARK_LOCAL = true` into the HTML (or reads it from a query param)
3. `api-client.js` checks this flag at startup:
   - If `true` → imports `mock-api` functions that return fixture data
   - If `false` → imports real Google API wrappers
4. A mock auth flow auto-logs in a test user (no OAuth redirect)
5. The app renders normally with fixture data — all UI interactions work identically

### Mock Server (for tests)

Playwright tests start a lightweight Express server (`tests/helpers/mock-server.js`) that:
- Serves the WayMark frontend with `WAYMARK_LOCAL=true`
- Serves fixture JSON files from `tests/fixtures/`
- Captures "created" records in memory for assertion
- Can simulate error conditions (API failures, slow responses, empty folders)

### Test Fixtures

Fixture data mirrors real Google API response shapes:

**`tests/fixtures/folders.json`** — mock Drive folder tree:
```json
{
  "myDrive": [
    {"id": "f1", "name": "Groceries", "mimeType": "application/vnd.google-apps.folder"},
    {"id": "f2", "name": "Home Projects", "mimeType": "application/vnd.google-apps.folder"}
  ],
  "sharedWithMe": [
    {"id": "f3", "name": "Family Chores", "owner": "spouse@gmail.com", "mimeType": "application/vnd.google-apps.folder"},
    {"id": "f4", "name": "Team Tasks", "owner": "boss@work.com", "mimeType": "application/vnd.google-apps.folder"}
  ]
}
```

**`tests/fixtures/sheets/groceries.json`** — mock sheet data:
```json
{
  "spreadsheetId": "sheet-001",
  "properties": {"title": "Grocery List"},
  "sheets": [{
    "data": [{
      "rowData": [
        {"values": [{"formattedValue": "done"}, {"formattedValue": "item"}, {"formattedValue": "created"}, {"formattedValue": "notes"}]},
        {"values": [{"formattedValue": "FALSE"}, {"formattedValue": "Buy milk"}, {"formattedValue": "2026-02-27"}, {"formattedValue": "2%"}]},
        {"values": [{"formattedValue": "TRUE"}, {"formattedValue": "Buy eggs"}, {"formattedValue": "2026-02-26"}, {"formattedValue": ""}]}
      ]
    }]
  }]
}
```

### Playwright E2E Test Plan

Tests are organized by **real user flows**, not by code modules:

#### `auth.spec.js` — Authentication
| Test | What it verifies |
|---|---|
| User sees login screen when not authenticated | Landing page shows "Sign in with Google" button |
| User can log in | Mock login → redirects to home screen with user name/avatar |
| User can log out | Click logout → returns to login screen, localStorage cleared |
| Session restore on page reload | Reload page → user stays logged in (mock token refresh) |

#### `explorer.spec.js` — Drive Explorer
| Test | What it verifies |
|---|---|
| Explorer shows My Drive and Shared with me | Top-level categories render |
| Expanding a folder lazy-loads children | Click folder → spinner → children appear (mock delay) |
| Pinning a folder adds it to home screen | Click pin icon → folder appears in pinned section |
| Unpinning a folder removes it from home | Click unpin → folder disappears from pinned section |
| Shared folders show owner info | "Family Chores" shows "from spouse@gmail.com" |
| Empty folder shows empty state | Expand empty folder → "No sheets found" message |

#### `checklist.spec.js` — Checklist Viewing
| Test | What it verifies |
|---|---|
| Opening a sheet renders a checklist | Click sheet → checklist items render with checkmarks |
| Completed items show visual checkmark | Items with `done=TRUE` have checkmark styling |
| Incomplete items show empty checkbox | Items with `done=FALSE` have unchecked styling |
| Header row is not rendered as a list item | Row 1 column names are used as headers, not items |
| Manual refresh re-fetches data | Click refresh → loading indicator → updated data |
| Auto-refresh triggers after 60s | Wait 60s (fake timer) → data re-fetched silently |
| Auto-refresh toggle works | Disable toggle → no refresh after 60s; re-enable → resumes |
| "Last updated" indicator updates | Shows correct relative time since last fetch |

#### `search.spec.js` — Keyword Search
| Test | What it verifies |
|---|---|
| Search bar is visible | Search bar shows with placeholder text |
| Typing a query and submitting returns results | Type "grocery" → submit → results panel shows matching sheet |
| Clicking a search result navigates to sheet | Click result → checklist view for that sheet |
| No results shows empty state | Query with no matches → "No results found" message |



#### `records.spec.js` — Record Creation
| Test | What it verifies |
|---|---|
| Viewing a checklist creates a snapshot | Open sheet → mock record store receives a snapshot entry |

| Records contain correct timestamps | Snapshot/log entries have ISO timestamp |
| Records contain correct data | Snapshot matches current checklist state |

#### `sharing.spec.js` — Multi-User / Shared Folders
| Test | What it verifies |
|---|---|
| Shared folder appears under "Shared with me" | Fixture folder with `owner` field renders in shared section |
| Shared folder can be pinned and browsed | Pin shared folder → browse → sheets render correctly |
| Shared indicator is visible | Shared folders show visual "shared" badge |
| Different mock users see different data | Switch mock user fixture → different folders/sheets appear |

### Running Tests

```bash
# Run all E2E tests (headless)
npm test

# Run with browser visible (debugging)
npm run test:headed

# Run a specific test file
npx playwright test tests/e2e/explorer.spec.js

# Run in local-only mode for manual testing (no Playwright)
WAYMARK_LOCAL=true npm start
```

### CI Integration

Playwright tests run in CI (GitHub Actions or similar) with:
- `WAYMARK_LOCAL=true` — no Google credentials needed in CI
- Headless Chromium (Playwright's bundled browser)
- Screenshot + trace on failure for debugging
- No secrets, no flakiness from OAuth, no rate limits

```yaml
# Example CI step
- name: Run E2E tests
  run: |
    npm ci
    npx playwright install --with-deps chromium
    npm test
  env:
    WAYMARK_LOCAL: "true"
```

---

## 16. Development Milestones & Timeline (Estimated)

| Milestone | Tasks | Est. Duration |
|---|---|---|
| **M0 — Setup** | Repo, Node project, Docker skeleton, Google Cloud project + OAuth credentials, Nginx config, Playwright install | 1 day |
| **M1 — API Abstraction + Local Mode** | Build `api-client.js` abstraction layer, mock-api implementation, test fixtures (folders, sheets, users), `WAYMARK_LOCAL=true` boot mode | 2–3 days |
| **M2 — Auth** | OAuth login/callback/refresh with PKCE, httpOnly cookie for refresh token, in-memory access token | 2–3 days |
| **M3 — Auth Tests** | Playwright: `auth.spec.js` — login, logout, session restore (against local mode) | 1 day |
| **M4 — Drive Explorer** | Browse Drive folder tree (lazy-loaded), pin folders, list sheets within folders, "Shared with me" support | 3–4 days |
| **M5 — Explorer Tests** | Playwright: `explorer.spec.js` — browse, expand, pin/unpin, shared folders, empty states | 1–2 days |
| **M6 — Checklist Viewer** | Read sheet → render as read-only checklist, manual refresh + 60s auto-refresh | 2–3 days |
| **M7 — Checklist Tests** | Playwright: `checklist.spec.js` — render, checkmarks, refresh, auto-refresh, timer | 1–2 days |
| **M8 — Search** | Keyword search UI, results display | 1 day |
| **M9 — Search Tests** | Playwright: `search.spec.js` — keyword search, results, empty state | 1 day |
| **M10 — Record Creation** | Create completion snapshots and search logs in user's Drive (append-only) | 2–3 days |
| **M11 — Record + Sharing Tests** | Playwright: `records.spec.js` + `sharing.spec.js` — log creation, multi-user scenarios | 1–2 days |
| **M12 — UI Polish** | Responsive vanilla CSS, loading states, error handling, toast notifications | 2–3 days |
| **M13 — Docker & Deploy** | Finalize Dockerfile, test container, configure Nginx on swiftirons.com, deploy, CI pipeline for Playwright | 1–2 days |
| **M14 — Android WebView** | Android project, Google Sign-In, WebView + token injection, offline caching (Service Worker + IndexedDB) | 4–6 days |
| **M15 — Enhanced Views** | Honey-do rendering, kanban view, multi-folder dashboard | 5–7 days |

**Total estimated: ~31–44 days** (includes test development alongside features)

---

## 17. Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | Android: WebView vs. Native UI? | **WebView wrapper** — share code with web, native later if needed |
| 2 | Token storage (web)? | **httpOnly cookie** for refresh token, **in-memory** for access token |
| 3 | CSS framework? | **Vanilla CSS** — raw CSS is faster and simpler to maintain |
| 4 | Hosting target? | **Self-hosted** on existing server with **Nginx** reverse proxy (multi-container setup) |
| 5 | Domain? | **swiftirons.com** (production), **localhost** (development) |
| 6 | Google account support? | **Both** personal Gmail and Workspace — testing with personal accounts |
| 7 | Offline support? | **Android app yes** (Service Worker + IndexedDB); web app is nice-to-have |
| 8 | Drive browsing depth? | **Lazy-load** — fetch children only when user expands a folder |
| 9 | Auto-refresh interval? | **Manual refresh** + **60s auto-refresh** (toggleable, on by default) |
| 10 | Data model? | **CREATE + READ only** — no updates, no deletes. Existing data is immutable. New records are append-only. |
| 11 | AI features? | **Removed** — all search is keyword-based, all import analysis is code-based |
| 12 | Gemini access method? | N/A — Gemini removed |
| 13 | AI timing? | N/A — no AI dependencies |
| 14 | E2E testing? | **Playwright** — tests focused on real user behavior, not code internals |
| 15 | Test isolation? | **Local-only mock mode** — `api-client.js` abstraction swaps Google APIs for local JSON fixtures; no real Google accounts needed |
| 16 | When to test? | **Alongside each feature** — every milestone has a paired test milestone |

---

## 18. Getting Started (Next Steps)

1. **Finalize this plan** — review and confirm
2. **Google Cloud setup** — create project, enable Sheets API + Drive API, create OAuth 2.0 credentials for web (`swiftirons.com` + `localhost` redirect URIs) and Android
3. **Init repo** — `npm init`, install Express + Playwright, set up project structure
4. **Build M1 (API abstraction + local mode)** — the testing foundation; everything builds on this
5. **Docker scaffold** — Dockerfile + docker-compose.yml
6. **Nginx config** — add reverse proxy rule for WayMark on swiftirons.com
7. **Build M2 (Auth)** — the runtime foundation
8. **Iterate through milestones** M3 → M15, writing tests alongside each feature

---

*Last updated: 2026-02-27*