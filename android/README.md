# Waymark Android App

A native Android companion app that renders the Waymark web app in a full-screen WebView and establishes a native WebRTC P2P connection to the orchestrator peer mesh for background notifications.

---

## Architecture

```
Android App
├── WebView (full-screen)            — loads https://waymark.app
│     └── JavaScript (webrtc.js)    — existing P2P mesh in-browser
│           └── window.Android.*    — JavascriptInterface bridge
│
└── WebRtcService (Foreground)       — native WebRTC for background
      └── OrchestratorPeer
            └── SignalingClient    — Google Sheets-based ICE signaling
```

### How It Works

1. The WebView loads the full Waymark web app — all templates, editing, and
   social features work exactly as in the browser.

2. `WaymarkBridge` is registered as `window.Android` in JavaScript. The web
   app calls three native methods:
   - `Android.onAuthToken(token)` — after each OAuth refresh (in `auth.js`)
   - `Android.onSheetOpened(sheetId)` — when the user opens a sheet (in `checklist.js`)
   - `Android.onPeerMessage(json)` — when a DataChannel message arrives (in `webrtc.js`)
   - `Android.showNotification(title, body)` — direct notification request

3. `WebRtcService` runs as a foreground service and keeps a native WebRTC
   peer connection alive even when the WebView is in the background. It uses
   the same Google Sheets signaling protocol as `webrtc.js`, so the Android
   device appears as a peer in the mesh.

4. When any peer sends a `waymark-notification` or `orchestrator-alert`
   DataChannel message, both the in-browser handler (via `WaymarkBridge`) and
   the background service show an Android notification.

---

## Getting Started

### Prerequisites

- Android Studio Hedgehog (2023.1.1) or newer
- Android SDK 34
- JDK 17+

### Open in Android Studio

1. `File → Open` → select the `android/` directory
2. Sync Gradle (Android Studio will prompt)
3. Connect a device or launch an emulator
4. Click Run (▶)

### Configuration

The app loads `https://waymark.app` by default. To point it at a local dev
server, change `WaymarkConfig.BASE_URL`:

```kotlin
// android/app/src/main/kotlin/com/waymark/app/WaymarkConfig.kt
const val BASE_URL = "http://10.0.2.2:3000"  // emulator → host localhost
```

The emulator's `10.0.2.2` maps to the host machine's `localhost`. The
`network_security_config.xml` already permits cleartext to `10.0.2.2`.

---

## WebRTC Signaling Protocol

The native client replicates exactly the protocol in `public/js/webrtc.js`:

| Constant     | Value | Meaning |
|---|---|---|
| `SIG_COL`    | 20    | Column used for signaling (1-based) |
| `BLOCK_SIZE` | 5     | Rows per peer block |
| `MAX_SLOTS`  | 8     | Max simultaneous peers |
| `POLL_MS`    | 5000  | Poll interval (ms) |
| `HEART_MS`   | 15000 | Heartbeat interval (ms) |
| `ALIVE_TTL`  | 50000 | Peer expiry (ms) |

Block layout per peer (0-based row offset from block start):
- `+0` PRESENCE `{ peerId, name, ts }`
- `+1` OFFERS   `{ targetPeerId: { sdp, ts } }`
- `+2` ANSWERS  `{ toPeerId: { sdp, ts } }`

---

## Notification Message Format

Send a DataChannel message with one of these types to trigger an Android
notification from any peer in the mesh:

```json
{ "type": "waymark-notification", "title": "Task complete", "body": "Row 42 moved to Done." }
{ "type": "orchestrator-alert",   "title": "Waymark",        "body": "Builder finished." }
```

---

## Running Tests

### Unit Tests (JVM, no device needed)

```bash
cd android
./gradlew :app:test
```

### Instrumentation Tests (requires device/emulator)

```bash
./gradlew :app:connectedAndroidTest
```
