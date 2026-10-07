# G2 AR Drawing

A dual-IMU AR drawing system for the Even Realities G2 smart glasses. The user
holds the phone (camera) and wears the glasses; both move independently. Finger
coordinates from the phone camera are mapped into the glasses' 3D head space via
quaternion sensor fusion, compensating for the rotation of **both** devices, and
drawn on the G2's 576×288 display.

## Architecture

| File | Role |
|------|------|
| [src/mathUtils.js](src/mathUtils.js) | `SpatialMapper` — quaternion sensor-fusion engine and the finger→glasses projection |
| [src/sensors.js](src/sensors.js) | Phone `DeviceOrientation` IMU + G2 IMU via `EvenAppBridge` |
| [src/g2Bridge.js](src/g2Bridge.js) | SDK init, page setup (4×288×144 image tiles + text), `drawToGlasses`, Hello World |
| [src/vision.js](src/vision.js) | Rear camera + MediaPipe Hands, index-finger tracking, debug overlay |
| [src/main.js](src/main.js) | Orchestrator, UI, camera + touch pipelines |

## Running on real glasses (development)

Requirements: Even App **2.2.10+** on the phone, glasses paired, Developer Mode
enabled (sign in at https://evenhub.evenrealities.com, then restart the app).

```bash
npm install
npm run dev:android
```

This starts Vite, opens an HTTPS tunnel (required — `getUserMedia` and the Even
WebView need a secure context), and prints an EvenHub QR code. Scan it from the
Even App's Developer Mode.

If a phone is connected over USB with debugging enabled, the launcher uses
`adb reverse` (fastest, most reliable) and serves `http://localhost:5173`.

### iPhone / Safari

If you are testing the phone side on an iPhone, use:

```bash
npm run dev:ios
```

That forces the HTTPS tunnel path and prints a URL you can open directly in
Safari. iPhone camera access is much more reliable in Safari than inside the
Even app WebView.

### Using the app

1. **🕶️ Connect Glasses** — connects and immediately renders a "G2 LINK OK"
   Hello World pattern so you can confirm the BLE pipeline works.
2. **📱 Request Phone IMU** — enables the phone orientation sensor.
3. **📷 Start Camera** — live finger tracking. **Only works in the phone
   browser** — the Even app WebView has no `getUserMedia` (see below).
4. **📸 Capture & Draw (Even camera)** — the on-device camera path: snaps one
   photo via the SDK, runs hand-tracking on it, and draws the fingertip to the
   glasses. Tap repeatedly to add points.
5. **✍️ Touch Draw Mode** — camera-free fallback: drag on the phone screen to
   draw on the glasses. Proves the full rendering pipeline without a camera.
6. **🎯 Sync Origin** — look forward + point forward, then tap to zero both IMUs.

### Camera — IMPORTANT (platform limitation)

The Even app runs your web app inside a **Flutter `flutter_inappwebview` WebView
that does not implement `getUserMedia`** (live video). This is a platform
limitation — **not** a permission you can grant, and **packing the app does not
change it**. The `camera` permission in [app.json](app.json) applies to the
SDK's native photo API, not to web `getUserMedia`.

**What works on the glasses:**

| Path | How | Notes |
|------|-----|-------|
| 📸 **Capture & Draw (Even camera)** | SDK [`captureImageFromCamera()`](node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts) → MediaPipe on the still → map → draw | Single shot per tap (native camera UI). The supported on-device camera path. |
| ✍️ **Touch Draw** | drag on the phone screen | Camera-free; exercises the full glasses pipeline. |
| 📷 **Start Camera** (live getUserMedia) | continuous tracking | **Only works in the phone browser (Safari/Chrome)**, not inside the Even app. |

So for **live, continuous** finger tracking you must run the page in the phone's
real browser (`npm run dev:android` / `npm run dev:ios` and open the tunnel URL
directly). Inside the Even app, use **📸 Capture & Draw** (single shot) or
**✍️ Touch Draw**.

If **📷 Start Camera** is tapped inside the Even app it now prints an on-screen
diagnostics panel explaining exactly this and pointing at the working paths.

### MediaPipe is bundled locally (required for on-device)

The Even WebView **blocks every network request whose domain is not in
`app.json`'s network whitelist**. MediaPipe Hands (its `hands.js` UMD bundle plus
~24 MB of WASM/model/data assets) is therefore served **locally** from
[public/mediapipe/hands/](public/mediapipe/hands) — a CDN load would be silently
dropped on the glasses, leaving `window.Hands` undefined and killing the camera
pipeline before it starts. No network permission is needed for MediaPipe.

Verified in headless Chrome (fake camera): MediaPipe loads from the local assets
and processes ~3–4 frames/sec through the single-stream pipeline with zero
network requests.

## Testing

```bash
npm test          # unit tests for the SpatialMapper quaternion math
npm run qc:visual # VISUAL quality check of the drawing pipeline (see below)
npm run build     # production build
```

### Visual QC — `npm run qc:visual`

This is the tool that lets you actually *see and assert* what the glasses render.
It launches headless Chrome, loads the real app, and injects a **mock bridge
that reconstructs the 576×288 glasses framebuffer** from the exact tile PNGs the
app transmits — pixel-for-pixel what the lenses would show. It then runs drawing
scenarios, writes PNG snapshots to `test-output/visual-qc/`, and asserts on the
result:

| Scenario | What it guarantees |
|----------|--------------------|
| `diagonal-all-quadrants` | a stroke crossing all four 288×144 tiles renders continuously (no seam/gap at the center boundary) |
| `two-strokes-persist` | drawing in one quadrant then another does **not** delete the first (the reported "collisions delete instead of combining" bug) |
| `single-quadrant-efficiency` | a stroke confined to one quadrant sends **only that one tile**, not all four (the speed fix) |
| `accumulates-within-quadrant` | ink accumulates — new strokes don't wipe old ones |

Open the PNGs in `test-output/visual-qc/` to eyeball the render. Exit code is
non-zero if any assertion fails, so it works in CI.

### Simulator (headless, no hardware)

The EvenHub simulator validates page/container config and BLE sends without
glasses. On a headless Linux box it runs under Xvfb:

```bash
npm run dev &
xvfb-run -a node_modules/@evenrealities/sim-linux-x64/bin/evenhub-simulator \
  "http://localhost:5173/?autotest=1" --automation-port 9898
# then:
curl -s http://127.0.0.1:9898/api/console   # look for page result: 0 and no warnings
```

`?autotest=1` auto-runs the connect + draw sweep so the pipeline can be checked
programmatically. Note: the glasses framebuffer screenshot is not GPU-composited
under Xvfb, so use `npm run qc:visual` (not simulator screenshots) for visual
verification.

## Drawing model

There is one persistent 576×288 layer that **accumulates** strokes; it is never
cleared per-frame. `strokeTo(x, y)` draws a connected line and marks only the
**tiles it touched** as dirty; a throttled flush sends just the dirty tiles.
This means a stroke crossing a quadrant boundary re-sends *both* quadrants with
their accumulated ink (strokes combine, never delete), and a stroke inside one
quadrant sends a single tile (fast). `endStroke()` lifts the pen; `clearDrawing()`
resets. Stroke gaps > 250 ms auto-break the line (handles finger-loss / touch
lift-off).

## Key hardware facts (verified against the simulator)

- Display: **576 × 288**, 4-bit greyscale (16 shades of green on black).
- A single image container is capped at **288 × 144** — a 576×288 image makes
  `createStartUpPageContainer` return `1` (invalid). We tile the screen **2×2**.
- `updateImageRawData` takes **encoded PNG/JPEG bytes**; the SDK converts to
  4-bit greyscale internally. A dot frame is well under 1 KB per tile.
- Image containers cannot capture input, so a full-screen text layer with
  `isEventCapture: 1` sits behind them to catch taps.

## Publishing (later)

```bash
npm run build
npx evenhub pack app.json dist    # produces out.ehpk
# upload out.ehpk at https://evenhub.evenrealities.com
```
