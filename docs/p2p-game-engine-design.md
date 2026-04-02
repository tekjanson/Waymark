# P2P Game Arcade — Design Document

> **Status:** Research & Planning  
> **Constraint:** 100% vanilla JavaScript, CSS, HTML — no frameworks, no build step  
> **Foundation:** Existing Waymark WebRTC mesh (webrtc.js)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Existing Infrastructure Audit](#2-existing-infrastructure-audit)
3. [Game Networking Models — Deep Analysis](#3-game-networking-models--deep-analysis)
4. [Architecture Design](#4-architecture-design)
5. [Engine Layer Breakdown](#5-engine-layer-breakdown)
6. [DataChannel Strategy](#6-datachannel-strategy)
7. [Game Loop & Timestep](#7-game-loop--timestep)
8. [Input System](#8-input-system)
9. [Rendering Pipeline](#9-rendering-pipeline)
10. [Networking Protocol](#10-networking-protocol)
11. [Game-Specific Designs](#11-game-specific-designs)
12. [Performance Budget](#12-performance-budget)
13. [Implementation Phases](#13-implementation-phases)
14. [Open Questions & Risks](#14-open-questions--risks)

---

## 1. Executive Summary

Build a browser-based P2P game engine on top of Waymark's existing WebRTC mesh.
Players already connected via a shared sheet can launch games against each other —
chess, checkers, slime volleyball, slime soccer, and potentially fast-input
games. The engine is a layered system: a **net transport** layer wrapping
DataChannels, a **deterministic game loop** with fixed timestep, **canonical input
handling**, and a **Canvas 2D renderer**. Each game is a self-contained module
that plugs into the engine.

### Why This Works

Waymark already solves the hard problems:
- **Peer discovery** — Sheets-based signaling finds peers automatically
- **Connection establishment** — Full mesh WebRTC with STUN
- **Reliable messaging** — DataChannel already delivers chat/call signals
- **Identity** — Each peer has a `peerId` (8 hex chars) and `displayName`

What's missing is a **game-aware transport layer** and a **deterministic
simulation framework**. This document designs both.

---

## 2. Existing Infrastructure Audit

### What We Have (webrtc.js)

| Feature | Current State | Game Suitability |
|---------|--------------|-----------------|
| DataChannel label | `'waymark'` (single) | Need separate game channel |
| DataChannel reliability | `ordered: true`, reliable (default) | Good for turn-based; need unreliable for action |
| Message format | JSON strings via `dc.send(JSON.stringify())` | Too slow for 60Hz; need binary |
| Peer tracking | `_rtc` Map → `{ pc, dc, state }` | Good — can add game channels per-peer |
| Max peers | 8 (signaling constraint) | Fine — most games are 2-4 players |
| Topology | Full mesh | Perfect for P2P games |
| Signaling | Google Sheets, 5s poll | Already works — game state is over DataChannel |
| Reconnection | Auto via 5s poll cycle | Games need faster detection |
| BroadcastChannel | Same-browser fallback | Free local multiplayer testing |
| ICE/STUN | Google STUN, no TURN | Works for most NAT types; symmetric NAT will fail |
| `binaryType` | Not explicitly set (default: `'arraybuffer'`) | Perfect for binary protocol |

### Key Insight: Multiple DataChannels

RTCPeerConnection supports up to **65,534 DataChannels** per connection. We can
create a **second DataChannel** specifically for game traffic without touching
the existing `'waymark'` channel used for chat/calls. This is the cleanest
integration path — zero changes to existing social features.

```
Existing:   pc.createDataChannel('waymark')     → chat, calls, renegotiation
New:        pc.createDataChannel('arcade')      → game state, inputs
New:        pc.createDataChannel('arcade-fast', { ordered: false, maxRetransmits: 0 })
                                                → unreliable for action games
```

### What We Must NOT Change

Per AI_LAWS:
- No frameworks, no build step, no TypeScript
- All business logic in the browser
- Server does nothing new
- ES Modules loaded directly via `<script type="module">`
- DOM via `el()` factory
- No `innerHTML` with dynamic content

---

## 3. Game Networking Models — Deep Analysis

Based on research from Glenn Fiedler (Gaffer on Games) and Gabriel Gambetta's
seminal work on multiplayer architecture, here's how each model maps to our
use case:

### 3.1 Deterministic Lockstep

**How it works:** Both peers run the exact same simulation. Only player inputs
are transmitted. Given identical initial state + identical inputs applied at
identical frames → identical results on both machines.

**Bandwidth:** Minimal — just input bits per frame  
**Latency model:** Both players experience delay equal to the slower peer's RTT/2  
**Determinism requirement:** ABSOLUTE — bit-identical results required  
**Best for:** Turn-based games, RTS, fighting games with input delay

**P2P suitability:** ★★★★★ — No server needed. Peers exchange inputs and
simulate locally. Age of Empires, Starcraft, and most RTS games use this.

**JavaScript challenge:** Floating-point determinism across browsers.
`Math.sin(x)` can return different results on Chrome vs Firefox. We must:
- Use integer arithmetic for physics (fixed-point)
- Avoid `Math.random()` — use seeded PRNG (e.g., xoshiro128)
- Avoid sorts that aren't stable (use explicit tie-breaking)
- No `Date.now()` in simulation — use frame counter only

**Our verdict:** **Primary model for turn-based games (chess, checkers).
Primary model for physics games (slime volleyball/soccer) with integer
physics.**

### 3.2 Rollback Netcode (GGPO-style)

**How it works:** Extension of lockstep. Both peers predict ahead using local
input + last-known remote input. When the actual remote input arrives, if it
differs from prediction, the simulation **rolls back** to the divergence point
and **replays** forward with correct inputs.

**Bandwidth:** Same as lockstep — just inputs  
**Latency model:** Local player sees zero delay. Remote player may "teleport"
on misprediction, but this is masked by visual smoothing.  
**Determinism requirement:** Same as lockstep (must be deterministic for
rollback/replay to work)  
**Best for:** Fighting games, fast-paced 1v1 action, up to ~150ms RTT

**P2P suitability:** ★★★★★ — Born for P2P. GGPO was designed for P2P
fighting games. No server.

**Implementation cost:** High. Must be able to snapshot and restore full game
state. Simulation must run fast enough to replay N frames on rollback (where N
≈ RTT / frame_duration). At 60fps with 100ms RTT, that's replaying 6 frames.

**Our verdict:** **Best model for slime volleyball/soccer if we want responsive
controls. Worth the implementation cost because it's reusable across all
action games.**

### 3.3 Snapshot Interpolation

**How it works:** One peer (or server) runs the simulation and sends full
state snapshots. The other side doesn't simulate — it just interpolates between
received snapshots for smooth rendering.

**Bandwidth:** High — full state every update  
**Latency model:** Always rendering the past (~100-350ms behind real state)  
**Determinism requirement:** None  
**Best for:** Large-state games, spectator mode

**P2P suitability:** ★★★☆☆ — Works but one peer becomes the "host" (authority).
The guest always sees the past.

**Our verdict:** **Useful for spectator mode and games with large state. Not
primary model — prefer lockstep/rollback for fairness.**

### 3.4 Host-Authority + Client Prediction

**How it works:** One peer is the "host" (mini-server). Sends authoritative
state. Guest peer predicts locally and reconciles with host updates.

**Bandwidth:** Medium — state diffs from host, inputs from guest  
**Latency model:** Host has zero latency. Guest predicts + reconciles.  
**Determinism requirement:** Low (only guest predicts)  
**Best for:** Fast-action games where rollback would need too many frames

**P2P suitability:** ★★★☆☆ — Inherently unfair (host advantage). Acceptable
for casual games.

**Our verdict:** **Fallback for action games where RTT > 150ms makes rollback
impractical. Simple to implement. Consider for FPS-like experiments.**

### Recommended Strategy (Hybrid)

| Game Type | Primary Model | Fallback |
|-----------|--------------|----------|
| Chess, Checkers | Lockstep (turn-based) | N/A |
| Slime Volleyball/Soccer | Rollback (GGPO) | Host-Authority at high RTT |
| FPS-like experiments | Host-Authority + Prediction | Rollback if RTT < 80ms |

---

## 4. Architecture Design

### Module Hierarchy

```
public/js/
  arcade/
    engine.js           ← Core game engine (loop, ECS-lite, scenes)
    net.js              ← Game networking layer (wraps DataChannel)
    input.js            ← Keyboard/touch/gamepad input capture
    renderer.js         ← Canvas 2D rendering primitives
    physics.js          ← Deterministic integer physics
    rollback.js         ← Rollback/replay state machine
    audio.js            ← Sound effects (Web Audio API)
    lobby.js            ← Game selection & matchmaking UI
    games/
      chess.js          ← Chess rules, board renderer, AI stub
      checkers.js       ← Checkers rules, board renderer
      slime-volley.js   ← Slime Volleyball physics + renderer
      slime-soccer.js   ← Slime Soccer physics + renderer

public/css/
  templates/
    arcade.css          ← Arcade UI styles

public/js/templates/
  arcade/
    index.js            ← Template barrel (registers as Waymark template)
    helpers.js          ← Constants, game registry
    cards.js            ← Game selection cards
    modal.js            ← Game viewport modal/fullscreen
```

### Integration with Waymark

The arcade is a **Waymark template** — just like kanban, budget, or social.
Users create a sheet → template detects "Arcade" type → renders game lobby.
Connected peers (already paired via social/webrtc.js) can invite each other.

```
                    ┌──────────────────────┐
                    │   Waymark App Shell   │
                    │   (app.js routing)    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Arcade Template      │
                    │  (templates/arcade/)  │
                    │  lobby.js ← game UI   │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                 │
     ┌────────▼──────┐ ┌──────▼──────┐ ┌───────▼───────┐
     │  engine.js     │ │  net.js      │ │  renderer.js   │
     │  (game loop)   │ │  (transport) │ │  (canvas 2D)   │
     └────────┬──────┘ └──────┬──────┘ └───────┬───────┘
              │                │                 │
     ┌────────▼──────┐ ┌──────▼──────┐ ┌───────▼───────┐
     │  physics.js    │ │  DataChannel │ │  <canvas>      │
     │  (integer sim) │ │  'arcade'    │ │  element       │
     └───────────────┘ └─────────────┘ └───────────────┘
```

---

## 5. Engine Layer Breakdown

### 5.1 Entity-Component Lite

No need for a full ECS — a simple entity list with typed components:

```javascript
// Entity is just an integer ID
let _nextId = 0;
const entities = new Map();  // id → { components }

function createEntity(components) {
  const id = _nextId++;
  entities.set(id, { id, ...components });
  return id;
}

// Components are plain objects:
// { pos: { x, y }, vel: { vx, vy }, sprite: { sheet, frame }, collider: { r } }
```

### 5.2 Scene Management

```javascript
const scenes = new Map();    // name → { init, update, render, cleanup }
let _activeScene = null;

function switchScene(name, data) {
  if (_activeScene) _activeScene.cleanup?.();
  _activeScene = scenes.get(name);
  _activeScene.init?.(data);
}
```

Scenes: `'lobby'`, `'playing'`, `'postgame'`

### 5.3 Game Registration

Each game module self-registers (same pattern as Waymark templates):

```javascript
// In slime-volley.js
import { registerGame } from '../arcade/engine.js';

registerGame({
  key: 'slime-volley',
  name: 'Slime Volleyball',
  description: '1v1 slime volleyball',
  maxPlayers: 2,
  tickRate: 60,                  // simulation Hz
  netModel: 'rollback',         // 'lockstep' | 'rollback' | 'host-authority'
  inputSchema: ['left', 'right', 'jump'],
  init, update, render, serialize, deserialize,
});
```

---

## 6. DataChannel Strategy

### 6.1 Dual-Channel Architecture

```javascript
// Reliable channel — game setup, turn-based moves, chat
const dcReliable = pc.createDataChannel('arcade', {
  ordered: true,
  // default reliability (TCP-like)
});

// Unreliable channel — real-time input/state for action games
const dcFast = pc.createDataChannel('arcade-fast', {
  ordered: false,
  maxRetransmits: 0,   // fire-and-forget (UDP-like)
});
```

**Why two channels?**
- Turn-based games (chess, checkers) need reliable delivery — a lost move would
  corrupt state. Use `'arcade'`.
- Action games (slime volleyball) send inputs 60 times/second. A lost packet is
  immediately superseded by the next one. Retransmission would add latency and
  is pointless. Use `'arcade-fast'` with `maxRetransmits: 0`.

### 6.2 Binary Protocol

JSON is ~10x larger and ~5x slower to parse than binary for game state.
Use `ArrayBuffer` + `DataView` for all game traffic:

```javascript
// Message format: [1 byte type][2 bytes seq][N bytes payload]
//
// Types:
//   0x01  INPUT        — player input for frame N
//   0x02  INPUT_ACK    — acknowledge receipt up to frame N
//   0x03  STATE_SNAP   — full state snapshot (rollback/spectate)
//   0x04  GAME_START   — both peers agreed, begin
//   0x05  GAME_END     — game over
//   0x06  PING         — RTT measurement
//   0x07  PONG         — RTT response
//   0x10  MOVE         — turn-based move (reliable channel)
//   0x11  MOVE_ACK     — move acknowledged

function encodeInput(seq, frame, inputBits) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint8(0, 0x01);           // type
  view.setUint16(1, seq, true);     // sequence (little-endian)
  view.setUint32(3, frame, true);   // frame number
  view.setUint8(7, inputBits);      // packed input bits
  return buf;
}

function decodeMessage(buffer) {
  const view = new DataView(buffer);
  const type = view.getUint8(0);
  const seq = view.getUint16(1, true);
  // ... type-specific decode
  return { type, seq, /* ... */ };
}
```

**Input bit packing** — most games need < 8 buttons. Pack into a single byte:

```
Bit 0: left
Bit 1: right
Bit 2: up / jump
Bit 3: down
Bit 4: action1
Bit 5: action2
Bit 6: action3
Bit 7: action4
```

At 60fps, input packets are **8 bytes each = 480 bytes/sec = 3.84 kbps**.
With 6x redundancy (include last 6 inputs per packet):
**8 + 6*1 = 14 bytes per packet = 6.72 kbps**. Negligible.

### 6.3 Redundant Input Transmission

Following Gaffer on Games' approach — include recent un-acked inputs in every
packet so packet loss doesn't require retransmission:

```javascript
function buildInputPacket(currentFrame, inputHistory, lastAckedFrame) {
  const unacked = currentFrame - lastAckedFrame;
  const count = Math.min(unacked, 30);  // max 30 redundant inputs
  const buf = new ArrayBuffer(4 + count);
  const view = new DataView(buf);
  view.setUint8(0, 0x01);
  view.setUint16(1, currentFrame, true);
  view.setUint8(3, count);
  for (let i = 0; i < count; i++) {
    view.setUint8(4 + i, inputHistory[currentFrame - count + 1 + i] || 0);
  }
  return buf;
}
```

---

## 7. Game Loop & Timestep

### Fixed Timestep with Interpolation

Following "Fix Your Timestep" (Gaffer on Games):

```javascript
const TICK_RATE = 60;
const DT = 1000 / TICK_RATE;     // 16.667ms per tick
const MAX_FRAME_TIME = 250;       // prevent spiral of death

let accumulator = 0;
let prevState = null;
let currState = null;
let simTime = 0;
let frameCounter = 0;

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  let frameTime = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  // Clamp to prevent spiral of death
  if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

  accumulator += frameTime;

  // Fixed-step simulation
  while (accumulator >= DT) {
    prevState = snapshotState(currState);

    // 1. Read network inputs
    processNetworkMessages();

    // 2. Sample local input
    const localInput = sampleInput();
    sendInput(frameCounter, localInput);

    // 3. Tick simulation
    currState = game.update(frameCounter, localInput, remoteInput);

    frameCounter++;
    simTime += DT;
    accumulator -= DT;
  }

  // Interpolation alpha for smooth rendering
  const alpha = accumulator / DT;
  game.render(prevState, currState, alpha);
}
```

### Why Fixed Timestep Matters

1. **Determinism** — both peers step at exactly `DT` ms intervals
2. **Reproducibility** — replay works frame-perfectly
3. **Physics stability** — no variable-dt explosions
4. **Rollback** — can replay N frames from snapshot cheaply

---

## 8. Input System

### 8.1 Keyboard Capture

```javascript
const _keys = new Set();
const _keyMap = new Map();   // game-specific key→action mapping

document.addEventListener('keydown', (e) => {
  _keys.add(e.code);
  e.preventDefault();  // prevent scrolling etc.
});

document.addEventListener('keyup', (e) => {
  _keys.delete(e.code);
});

function sampleInput() {
  let bits = 0;
  if (_keys.has(_keyMap.get('left')  || 'ArrowLeft'))  bits |= 0x01;
  if (_keys.has(_keyMap.get('right') || 'ArrowRight')) bits |= 0x02;
  if (_keys.has(_keyMap.get('up')    || 'ArrowUp'))    bits |= 0x04;
  if (_keys.has(_keyMap.get('down')  || 'ArrowDown'))  bits |= 0x08;
  if (_keys.has(_keyMap.get('action1') || 'Space'))    bits |= 0x10;
  return bits;
}
```

### 8.2 Touch Controls (Mobile)

Virtual D-pad + action buttons rendered on canvas or as DOM overlays:

```
┌─────────────────────────────────────────┐
│                 GAME AREA               │
│                                         │
│                                         │
│  ┌───┐                          ┌───┐  │
│  │ ← │  ┌───┐              ┌───┐│ A │  │
│  └───┘  │ → │              │ B │└───┘  │
│         └───┘              └───┘       │
└─────────────────────────────────────────┘
```

Touch areas map to the same `sampleInput()` bit pattern.

### 8.3 Gamepad API

```javascript
function sampleGamepad() {
  const gp = navigator.getGamepads()[0];
  if (!gp) return 0;
  let bits = 0;
  if (gp.axes[0] < -0.5) bits |= 0x01;  // left
  if (gp.axes[0] > 0.5)  bits |= 0x02;  // right
  if (gp.axes[1] < -0.5) bits |= 0x04;  // up
  if (gp.axes[1] > 0.5)  bits |= 0x08;  // down
  if (gp.buttons[0].pressed) bits |= 0x10;  // A
  if (gp.buttons[1].pressed) bits |= 0x20;  // B
  return bits;
}
```

---

## 9. Rendering Pipeline

### Canvas 2D — Why Not WebGL?

- **Simplicity** — Canvas 2D API is vanilla, no shaders to write
- **Sufficient** — 2D sprite games at 60fps are well within Canvas 2D capability
- **Compatibility** — works everywhere, even old mobile browsers
- **Debugging** — can inspect draw calls visually
- **AI_LAWS** — no build step, no frameworks

### Renderer Design

```javascript
let _canvas, _ctx;
const VIRTUAL_W = 640;   // fixed virtual resolution
const VIRTUAL_H = 360;   // 16:9 aspect ratio
let _scale = 1;

function initRenderer(canvasEl) {
  _canvas = canvasEl;
  _ctx = canvasEl.getContext('2d');
  _ctx.imageSmoothingEnabled = false;  // pixel-art friendly
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  const parent = _canvas.parentElement;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  const scaleX = w / VIRTUAL_W;
  const scaleY = h / VIRTUAL_H;
  _scale = Math.min(scaleX, scaleY);
  _canvas.width = VIRTUAL_W * _scale * devicePixelRatio;
  _canvas.height = VIRTUAL_H * _scale * devicePixelRatio;
  _canvas.style.width = (VIRTUAL_W * _scale) + 'px';
  _canvas.style.height = (VIRTUAL_H * _scale) + 'px';
  _ctx.setTransform(
    _scale * devicePixelRatio, 0,
    0, _scale * devicePixelRatio,
    0, 0
  );
}

// Drawing primitives
function clear(color = '#000') {
  _ctx.fillStyle = color;
  _ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
}

function drawCircle(x, y, r, color) {
  _ctx.beginPath();
  _ctx.arc(x, y, r, 0, Math.PI * 2);
  _ctx.fillStyle = color;
  _ctx.fill();
}

function drawRect(x, y, w, h, color) {
  _ctx.fillStyle = color;
  _ctx.fillRect(x, y, w, h);
}

function drawText(text, x, y, { color = '#fff', size = 16, align = 'left' } = {}) {
  _ctx.fillStyle = color;
  _ctx.font = `${size}px monospace`;
  _ctx.textAlign = align;
  _ctx.fillText(text, x, y);
}

function drawSprite(img, sx, sy, sw, sh, dx, dy, dw, dh) {
  _ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
```

### Interpolation for Smooth Rendering

Render at display framerate, interpolate between simulation states:

```javascript
function renderInterpolated(prev, curr, alpha) {
  // Position = prev.pos * (1 - alpha) + curr.pos * alpha
  for (const entity of entities.values()) {
    const px = entity.prevPos.x * (1 - alpha) + entity.pos.x * alpha;
    const py = entity.prevPos.y * (1 - alpha) + entity.pos.y * alpha;
    drawCircle(px, py, entity.radius, entity.color);
  }
}
```

---

## 10. Networking Protocol

### 10.1 Rollback State Machine

```
States:
  SYNCING    → exchanging initial config (seed, player assignment)
  RUNNING    → game in progress
  ROLLBACK   → replaying frames after input correction
  PAUSED     → waiting for remote input (too far ahead)
  ENDED      → game over

Transitions:
  SYNCING  → RUNNING     (both peers send GAME_START)
  RUNNING  → ROLLBACK    (received input differs from prediction)
  ROLLBACK → RUNNING     (replay complete, back to present)
  RUNNING  → PAUSED      (local frame > remote frame + MAX_PREDICTION)
  PAUSED   → RUNNING     (remote input received)
  RUNNING  → ENDED       (win/loss/draw detected)
```

### 10.2 Rollback Algorithm

```javascript
const MAX_PREDICTION = 8;   // max frames to predict ahead
const inputHistory = [];     // frame → { local, remote, predicted }
const stateHistory = [];     // frame → serialized state snapshot

function onRemoteInput(frame, inputBits) {
  if (frame < confirmedFrame) return;  // too old, ignore

  const entry = inputHistory[frame];
  if (!entry) return;

  if (entry.predicted !== undefined && entry.predicted !== inputBits) {
    // MISPREDICTION — must rollback
    entry.remote = inputBits;
    rollbackTo(frame);
  } else {
    entry.remote = inputBits;
  }

  // Advance confirmed frame
  while (inputHistory[confirmedFrame + 1]?.remote !== undefined) {
    confirmedFrame++;
    // Can release state snapshots older than confirmedFrame - MAX_PREDICTION
  }
}

function rollbackTo(frame) {
  // 1. Restore state at frame
  deserializeState(stateHistory[frame]);

  // 2. Replay from frame to currentFrame using corrected inputs
  for (let f = frame; f < currentFrame; f++) {
    const local = inputHistory[f].local;
    const remote = inputHistory[f].remote ?? inputHistory[f].predicted;
    game.update(f, local, remote);
    stateHistory[f + 1] = serializeState();
  }
}

function predictInput(frame) {
  // Simple: assume remote player continues doing whatever they did last
  const lastKnown = findLastKnownRemoteInput(frame);
  return lastKnown;
}
```

### 10.3 RTT Measurement

Continuous ping/pong for adaptive prediction depth:

```javascript
let _rtt = 100;  // initial estimate

function sendPing() {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, 0x06);  // PING
  view.setFloat64(1, performance.now(), true);
  dcFast.send(buf);
}

function onPong(sentTime) {
  _rtt = _rtt * 0.8 + (performance.now() - sentTime) * 0.2;  // EWMA
}

// Send ping every 500ms
setInterval(sendPing, 500);
```

### 10.4 Turn-Based Protocol (Chess/Checkers)

Much simpler — no rollback needed:

```javascript
// Over reliable 'arcade' channel:
// MOVE: [0x10][2 bytes seq][N bytes move data]
// MOVE_ACK: [0x11][2 bytes seq]

// Chess move: from_square (6 bits) + to_square (6 bits) + promotion (3 bits)
// = 15 bits, fits in 2 bytes

function encodeChessMove(from, to, promotion) {
  const buf = new ArrayBuffer(5);
  const view = new DataView(buf);
  view.setUint8(0, 0x10);
  view.setUint16(1, _seq++, true);
  view.setUint8(3, from);
  view.setUint8(4, (to & 0x3F) | ((promotion & 0x07) << 5));
  return buf;
}
```

---

## 11. Game-Specific Designs

### 11.1 Chess

**Net model:** Lockstep (turn-based)  
**State size:** 64 squares × 4 bits = 32 bytes + metadata  
**Input:** Click square (from) → click square (to)  
**Validation:** Both peers validate moves locally. Reject illegal moves.  
**Special rules:** Castling, en passant, promotion, 50-move rule, threefold repetition

```
Board representation: array of 64 bytes
  0x00 = empty
  0x01-0x06 = white pawn/knight/bishop/rook/queen/king
  0x81-0x86 = black pawn/knight/bishop/rook/queen/king
```

**Rendering:** 8×8 grid of colored squares + piece sprites (CSS-drawn or
Unicode chess characters: ♔♕♖♗♘♙♚♛♜♝♞♟)

**Complexity:** Low. Focus on correct rule implementation, move validation,
check/checkmate detection.

### 11.2 Checkers

**Net model:** Lockstep (turn-based)  
**State size:** 32 playable squares × 2 bits = 8 bytes  
**Input:** Click piece → click destination  
**Validation:** Both peers validate. Handle multi-jump sequences.

**Rendering:** 8×8 board, pieces are circles with optional crown (king).

### 11.3 Slime Volleyball

**Net model:** Rollback (GGPO-style)  
**Tick rate:** 60 Hz  
**State size:** ~40 bytes (2 slimes × {x, y, vx, vy} + ball × {x, y, vx, vy})  
**Input:** 3 bits per player (left, right, jump)  

**Physics (integer/fixed-point):**

```
World: 640 × 360 virtual pixels
Gravity: constant per-tick downward acceleration
Slime: half-circle, radius 40px, collider is circle
Ball: circle, radius 10px
Net: thin rectangle at center, height 120px
Floor: y = 340

All values stored as integers × 100 (fixed-point with 2 decimal places)
Example: position (32050, 18000) = screen (320.50, 180.00)
```

**Collision:**
- Ball↔Slime: circle-circle. Reflect ball velocity based on contact normal.
- Ball↔Net: circle-rect. Bounce off net.
- Ball↔Floor: score point for opposite side.
- Slime↔Boundaries: clamp to own half.

**Scoring:** First to 7 points. Ball resets to loser's side.

### 11.4 Slime Soccer

**Net model:** Rollback  
**Tick rate:** 60 Hz  
**State:** 2 slimes + ball + 2 goals  
**Input:** 4 bits per player (left, right, jump, kick)  

Similar physics to slime volleyball but:
- Full-width field instead of halves
- Goals at left/right edges
- "Kick" action applies extra impulse to nearby ball
- No net in center

### 11.5 Future: Fast-Input Games

For something approaching FPS speeds:
- **Host-authority model** with client prediction
- Unreliable channel only (`maxRetransmits: 0`)
- State snapshots at 20Hz from host, inputs at 60Hz from guest
- Entity interpolation for remote players (render 100ms in past)
- Requires more sophisticated prediction/reconciliation

This is Phase 3+ work. Get the foundation right first.

---

## 12. Performance Budget

### Per-Frame Budget at 60fps

Total frame time: **16.67ms**

| Task | Budget | Notes |
|------|--------|-------|
| Input sampling | 0.1ms | Trivial |
| Network read/write | 0.5ms | Parse binary, build packets |
| Simulation tick | 2.0ms | Physics + collision (integer math) |
| Rollback replay (worst case) | 2.0ms | 8 re-simulated frames × 0.25ms each |
| Canvas render | 4.0ms | Clear + draw all entities |
| Overhead (GC, events) | 2.0ms | Buffer for browser work |
| **Total** | **~8.6ms** | **~50% headroom** |

### Bandwidth Budget

| Stream | Bytes/sec | kbps |
|--------|-----------|------|
| Input packets (60Hz, 14 bytes) | 840 | 6.7 |
| Ping/pong (2Hz, 9 bytes) | 18 | 0.14 |
| State sync (fallback, 10Hz, 64 bytes) | 640 | 5.1 |
| **Total per peer** | **~1500** | **~12** |

Compare to WebRTC audio call: 16-64 kbps. Game traffic is negligible.

### Memory Budget

| Item | Size |
|------|------|
| State history (256 frames) | ~10 KB |
| Input history (256 frames) | ~512 bytes |
| Canvas backbuffer | ~900 KB (640×360×4 bytes) |
| Sprite assets | ~100 KB (tiny 2D games) |
| **Total** | **~1 MB** |

---

## 13. Implementation Phases

### Phase 1: Foundation + Chess (Turn-Based Proof of Concept)

**Goal:** Prove the architecture works end-to-end.

1. Create `arcade/` module structure
2. Implement `net.js` — dual DataChannel creation alongside existing 'waymark'
3. Implement binary message encode/decode
4. Implement `engine.js` — fixed timestep loop, scene management
5. Implement `renderer.js` — Canvas 2D primitives
6. Implement `input.js` — keyboard capture
7. Build chess game:
   - Board representation & rendering
   - Move validation (legal move generation)
   - Turn-based networking (reliable channel)
   - Check/checkmate/stalemate detection
8. Build basic lobby UI (game selection card, invite peer)
9. Integrate as Waymark template

**Deliverable:** Two peers on the same sheet can play chess.

### Phase 2: Action Games + Rollback

**Goal:** Prove rollback netcode works for real-time P2P games.

1. Implement `physics.js` — deterministic integer physics
2. Implement `rollback.js` — state snapshot/restore, replay
3. Build slime volleyball:
   - Circle physics (integer)
   - Scoring system
   - Rollback integration
4. RTT measurement + adaptive prediction depth
5. Visual smoothing for rollback corrections
6. Add slime soccer (variation of volleyball)

**Deliverable:** Two peers can play slime volleyball with responsive controls.

### Phase 3: Polish + More Games

1. Touch controls for mobile
2. Gamepad support
3. Sound effects (Web Audio)
4. Checkers
5. Win/loss tracking (stored in sheet?)
6. Spectator mode (third peer watches via snapshot interpolation)
7. Game replay (record inputs → deterministic replay)

### Phase 4: Experimental — Fast Action

1. Host-authority model implementation
2. Client-side prediction + reconciliation
3. Simple top-down shooter or arena game
4. Evaluate whether RTT allows playable experience

---

## 14. Open Questions & Risks

### Open Questions

1. **Where does game state persist?**
   - Option A: Sheet cells (like social chat). Allows resumption.
   - Option B: Ephemeral — lives only in DataChannel. Simpler.
   - **Recommendation:** Option B for action games, Option A for chess (save game state to allow resume).

2. **How to handle peer disconnection mid-game?**
   - If DataChannel closes, other player wins by forfeit after timeout.
   - For chess: serialize game state to sheet so it can resume later.

3. **NAT traversal limitations?**
   - STUN-only means symmetric NAT users can't connect.
   - Adding a TURN server solves this but requires infrastructure.
   - **For now:** Accept the limitation. Most home networks work with STUN.

4. **Floating-point determinism across browsers?**
   - Critical for lockstep/rollback. Integer-only physics avoids this entirely.
   - Chess/checkers don't use floating-point at all.
   - Slime physics uses fixed-point integers — deterministic by construction.

5. **Fair peer assignment (who is player 1)?**
   - Use `peerId` comparison (already used for initiator/answerer in WebRTC).
   - Lower peerId = Player 1 (left side in slime games, white in chess).

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Integer physics feels "wrong" | Medium | Tune constants carefully, use FP for rendering interpolation only |
| Rollback frame budget exceeded | High | Cap prediction depth, gracefully degrade to input delay |
| Canvas 2D too slow on mobile | Medium | Reduce virtual resolution, simpler sprites |
| DataChannel unreliable mode drops too many packets | Low | Redundant input transmission compensates |
| Symmetric NAT blocks connection | Medium | Document limitation, TURN is future work |
| Chrome vs Firefox physics divergence | High (if FP) | Eliminated by integer physics |
| Tab backgrounding pauses rAF | Medium | Detect and pause game, wait for resume |

### Performance Escape Hatches

If Canvas 2D becomes a bottleneck:
1. **OffscreenCanvas + Web Worker** — move rendering off main thread
2. **WebGL** — still vanilla JS, no framework needed, just raw GL calls
3. **Reduce virtual resolution** — 320×180 still looks fine for pixel-art games
4. **Sprite batching** — draw all same-sprite entities in one drawImage call

These are optimizations, not architecture changes. The engine design supports
swapping the renderer without touching game logic.

---

## Summary

The Waymark WebRTC mesh gives us **free peer discovery, connection management,
and reliable + unreliable data transport**. The game engine is a thin layer on
top: a fixed-timestep loop, integer physics, binary protocol, and Canvas 2D
renderer. Turn-based games (chess, checkers) work over reliable DataChannels with
trivial lockstep. Action games (slime volleyball/soccer) use rollback netcode
over unreliable DataChannels for responsive controls. Everything is vanilla
JS/CSS/HTML, no build step, plugs into Waymark as a standard template.

Build Phase 1 (chess) to prove the architecture, then Phase 2 (rollback + slime
games) to prove it can handle real-time action. Each phase delivers a playable
game.
