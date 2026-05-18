/**
 * @module city
 *
 * Main entry point for the Waymark Code City 3D steampunk visualisation.
 *
 * Architecture:
 *   CityScene         — Three.js renderer, scene graph, render loop
 *   Building          — per-module 3D structure with animated state machine
 *   OrbitCamera       — pointer-drag orbit + scroll zoom + click-to-focus
 *
 * MQTT events drive real-time building state transitions:
 *   stage/status    → AWAITING_QA (holographic marker above building)
 *   stage/execution → COMPILING / RETRYING / DONE_IN_REVIEW animations
 *
 * Human approval is published back via mqtt-bridge → SheetSyncDaemon.
 */

import * as THREE from 'three';
import { RainSystem, SteamEmitter, SootBurst, FireworkBurst } from './particles.mjs';
import { HudPanel, HologramMarker }                           from './hud.mjs';
import { CityMqttBridge }                                     from './mqtt-bridge.mjs';

// ── Grid constants ────────────────────────────────────────────────────────────

const GRID_COLS = 12;
const GRID_ROWS = 10;
const CELL      = 8;          // world units between building centres
const LOC_SCALE = 0.055;      // world height units per line of code
const MIN_H     = 2;
const MAX_H     = 28;

// ── Seed city manifest ────────────────────────────────────────────────────────
// Pre-populates the city with representative modules from the Waymark codebase.
// New modules discovered via MQTT are added dynamically to the next free slot.

const SEED_MANIFEST = [
  // P2P server
  { jobId: 'notification-store', filePath: 'p2p-server/src/notification-store.mjs', loc: 119, safetyScore: 0 },
  { jobId: 'p2p-server-main',    filePath: 'p2p-server/src/index.mjs',              loc: 240, safetyScore: 0 },
  // Public JS
  { jobId: 'mqtt-client',        filePath: 'public/js/mqtt-client.js',              loc: 210, safetyScore: 92 },
  { jobId: 'mqtt-bridge',        filePath: 'public/js/mqtt-bridge.js',              loc: 280, safetyScore: 87 },
  { jobId: 'app',                filePath: 'public/js/app.js',                      loc: 580, safetyScore: 54 },
  { jobId: 'sheets',             filePath: 'public/js/sheets.js',                   loc: 340, safetyScore: 61 },
  { jobId: 'webrtc',             filePath: 'public/js/webrtc.js',                   loc: 450, safetyScore: 38 },
  { jobId: 'auth',               filePath: 'public/js/auth.js',                     loc: 190, safetyScore: 72 },
  { jobId: 'drive',              filePath: 'public/js/drive.js',                    loc: 260, safetyScore: 65 },
  { jobId: 'ui',                 filePath: 'public/js/ui.js',                       loc: 310, safetyScore: 48 },
  // Server
  { jobId: 'server-index',       filePath: 'server/index.js',                       loc: 690, safetyScore: 29 },
  { jobId: 'server-config',      filePath: 'server/config.js',                      loc: 45,  safetyScore: 95 },
  { jobId: 'github-source',      filePath: 'server/github-source.js',               loc: 320, safetyScore: 42 },
  // Compiler
  { jobId: 'DecomposeOrchestrator', filePath: 'src/compiler/decomposer/DecomposeOrchestrator.mjs', loc: 260, safetyScore: 80 },
  { jobId: 'TestSplitter',          filePath: 'src/compiler/decomposer/TestSplitter.mjs',          loc: 180, safetyScore: 85 },
  { jobId: 'MockWriter',            filePath: 'src/compiler/adapters/MockWriter.mjs',              loc: 110, safetyScore: 90 },
  { jobId: 'MqttReporter',          filePath: 'src/compiler/adapters/MqttReporter.mjs',           loc: 130, safetyScore: 88 },
  { jobId: 'SheetSyncDaemon',       filePath: 'src/compiler/adapters/SheetSyncDaemon.mjs',        loc: 310, safetyScore: 82 },
  { jobId: 'IntegrationSmokeWriter',filePath: 'src/compiler/decomposer/IntegrationSmokeWriter.mjs',loc: 90, safetyScore: 88 },
  // MCP
  { jobId: 'mcp-waymark',       filePath: 'mcp/waymark.mjs',          loc: 420, safetyScore: 35 },
  { jobId: 'mcp-orchestrator',  filePath: 'mcp/orchestrator.mjs',     loc: 380, safetyScore: 30 },
  { jobId: 'google-sheets',     filePath: 'mcp/google-sheets.mjs',    loc: 510, safetyScore: 25 },
  { jobId: 'mqtt-bridge-mcp',   filePath: 'mcp/mqtt-bridge.mjs',      loc: 95,  safetyScore: 60 },
  // Scripts
  { jobId: 'check-workboard',   filePath: 'scripts/check-workboard.js', loc: 140, safetyScore: 40 },
];

// ── Material palette helpers ──────────────────────────────────────────────────

function safetyEmissive(score) {
  if (score > 80) return new THREE.Color(0x00cc44);
  if (score >= 40) return new THREE.Color(0xcc5500);
  return new THREE.Color(0x000000);
}

function safetyEmissiveIntensity(score) {
  if (score > 80) return 0.35;
  if (score >= 40) return 0.12;
  return 0;
}

function clampHeight(loc) {
  return Math.min(MAX_H, Math.max(MIN_H, loc * LOC_SCALE));
}

// ── Building ──────────────────────────────────────────────────────────────────

class Building {
  jobId; filePath; loc; safetyScore;
  state = 'IDLE';
  /** @type {THREE.Group} */     group;
  /** @type {THREE.Mesh} */      body;
  /** @type {THREE.Material} */  bodyMat;
  /** @type {THREE.Mesh[]} */    pipes = [];
  /** @type {THREE.PointLight} */pointLight = null;
  /** @type {HologramMarker} */  hologram   = null;
  /** @type {SteamEmitter} */    steam      = null;
  criticalEdgeCases = [];
  totalTests        = null;
  compilerLog       = '';

  #height;
  #animT     = 0;         // local animation clock
  #flashT    = 0;         // flash timer (RETRYING)
  #flashOn   = false;
  #pipeRotT  = 0;
  #scene;                 // needed for world-pos firework / soot

  constructor(scene, { jobId, filePath, loc, safetyScore, gridX, gridZ }) {
    this.jobId       = jobId;
    this.filePath    = filePath;
    this.loc         = loc;
    this.safetyScore = safetyScore;
    this.#scene      = scene;
    this.#height     = clampHeight(loc);

    this.group = new THREE.Group();
    this.group.position.set(
      (gridX - GRID_COLS / 2) * CELL,
      0,
      (gridZ - GRID_ROWS / 2) * CELL,
    );

    this.#buildBody();
    if (safetyScore > 55)  this.#buildPipes();
    this.#buildChimneys();
    this.#buildWindows();

    if (safetyScore > 80) {
      this.pointLight = new THREE.PointLight(0x00ff88, 0.4, CELL * 2.2);
      this.pointLight.position.set(0, this.#height + 1.2, 0);
      this.group.add(this.pointLight);
    }

    scene.add(this.group);
  }

  // ── Visual state machine ───────────────────────────────────────────────────

  setState(newState, extras = {}) {
    const prev = this.state;
    this.state = newState;

    if (extras.criticalEdgeCases) this.criticalEdgeCases = extras.criticalEdgeCases;
    if (extras.totalTests != null) this.totalTests        = extras.totalTests;
    if (extras.log       != null) this.compilerLog       = extras.log;

    // Clear previous transient visuals
    if (prev !== newState) {
      this.#removeSteam();
      this.#removeHologram();
    }

    switch (newState) {
      case 'AWAITING_QA':
        this.#applyMaterialColor(0x005533, safetyEmissive(this.safetyScore), 0.3);
        this.#showHologram();
        break;

      case 'COMPILING':
        this.#applyMaterialColor(0x331500, new THREE.Color(0xff6600), 0.6);
        if (this.pointLight) this.pointLight.color.set(0xff6600);
        this.#startSteam('steam');
        break;

      case 'RETRYING':
        // Brief crimson flash handled in tick(); soot burst is one-shot
        this.#fireOneShotSoot();
        this.#startSteam('steam');
        break;

      case 'DONE_IN_REVIEW':
      case 'SUCCESS':
        this.#applyMaterialColor(0x002211, new THREE.Color(0x00ff44), 0.55);
        if (this.pointLight) {
          this.pointLight.color.set(0x00ff88);
          this.pointLight.intensity = 0.8;
        } else {
          this.pointLight = new THREE.PointLight(0x00ff88, 0.8, CELL * 3);
          this.pointLight.position.set(0, this.#height + 1.2, 0);
          this.group.add(this.pointLight);
        }
        this.#removeSteam();
        this.#fireOneShotFirework();
        this.#upgradePipes();
        break;

      default:  // IDLE
        this.#applyMaterialColor(0x2d1f14, safetyEmissive(this.safetyScore),
                                 safetyEmissiveIntensity(this.safetyScore));
        if (this.pointLight) this.pointLight.color.set(0x00ff88);
        break;
    }
  }

  // ── Per-frame tick ─────────────────────────────────────────────────────────

  tick(dt, clock) {
    this.#animT    += dt;
    this.#pipeRotT += dt * 0.7;

    // Hologram hover
    if (this.hologram) this.hologram.tick(clock);

    // Steam / soot
    this.steam?.tick(dt);

    // RETRYING crimson flash
    if (this.state === 'RETRYING') {
      this.#flashT += dt;
      if (this.#flashT > 0.18) {
        this.#flashOn  = !this.#flashOn;
        this.#flashT   = 0;
        const em       = this.#flashOn ? new THREE.Color(0xff0022) : new THREE.Color(0x440011);
        this.bodyMat.emissive.set(em);
        this.bodyMat.emissiveIntensity = this.#flashOn ? 0.7 : 0.15;
      }
    }

    // COMPILING pulsing
    if (this.state === 'COMPILING') {
      const pulse = 0.4 + Math.sin(this.#animT * 4) * 0.2;
      this.bodyMat.emissiveIntensity = pulse;
    }

    // Pipe rotation (decorative for all states)
    for (const pipe of this.pipes) {
      pipe.rotation.z = this.#pipeRotT * (pipe.userData.dir ?? 1);
    }

    // DONE glow pulse
    if (this.state === 'DONE_IN_REVIEW' || this.state === 'SUCCESS') {
      if (this.pointLight) {
        this.pointLight.intensity = 0.6 + Math.sin(this.#animT * 2) * 0.2;
      }
    }
  }

  // ── Getters for HUD ────────────────────────────────────────────────────────

  get hudData() {
    return {
      jobId:             this.jobId,
      filePath:          this.filePath,
      loc:               this.loc,
      safetyScore:       this.safetyScore,
      state:             this.state,
      totalTests:        this.totalTests,
      criticalEdgeCases: this.criticalEdgeCases,
      log:               this.compilerLog,
    };
  }

  get topWorldPos() {
    const wp = new THREE.Vector3();
    this.group.getWorldPosition(wp);
    wp.y += this.#height + 1;
    return wp;
  }

  get centerWorldPos() {
    const wp = new THREE.Vector3();
    this.group.getWorldPosition(wp);
    wp.y += this.#height / 2;
    return wp;
  }

  dispose() {
    this.#removeSteam();
    this.#removeHologram();
    this.#scene.remove(this.group);
  }

  // ── Private: construction helpers ─────────────────────────────────────────

  #buildBody() {
    const w   = CELL * 0.72;
    const geo = new THREE.BoxGeometry(w, this.#height, w);
    this.bodyMat = new THREE.MeshStandardMaterial({
      color:             0x2d1f14,
      roughness:         0.88,
      metalness:         0.12,
      emissive:          safetyEmissive(this.safetyScore),
      emissiveIntensity: safetyEmissiveIntensity(this.safetyScore),
    });
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.body.position.y      = this.#height / 2;
    this.body.castShadow      = true;
    this.body.receiveShadow   = true;
    this.body.userData.building = this;   // for raycasting
    this.group.add(this.body);
  }

  #buildPipes() {
    const score    = this.safetyScore;
    const pipeCol  = score > 80 ? 0x00ff55 : 0xdd7700;
    const pipeMat  = new THREE.MeshStandardMaterial({
      color:             0xaa6622,
      emissive:          new THREE.Color(pipeCol),
      emissiveIntensity: 0.45,
      metalness:         0.75,
      roughness:         0.3,
    });
    const w = CELL * 0.72;
    const levels = [0.3, 0.6, 0.85].map(t => t * this.#height);
    levels.forEach((y, i) => {
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(w * 0.56, 0.11, 6, 14),
        pipeMat,
      );
      torus.rotation.x      = Math.PI / 2;
      torus.position.y      = y;
      torus.userData.dir    = i % 2 === 0 ? 1 : -1;
      this.group.add(torus);
      this.pipes.push(torus);
    });
  }

  #buildChimneys() {
    const chimMat = new THREE.MeshStandardMaterial({ color: 0x1a1212, roughness: 1 });
    const count   = 1 + Math.floor(Math.random() * 2);
    const w       = CELL * 0.72;
    for (let i = 0; i < count; i++) {
      const ch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, 1.6, 7),
        chimMat,
      );
      ch.position.set(
        (Math.random() - 0.5) * w * 0.45,
        this.#height + 0.8,
        (Math.random() - 0.5) * w * 0.45,
      );
      this.group.add(ch);
    }
  }

  #buildWindows() {
    const floors = Math.max(1, Math.floor(this.#height / 2.2));
    const score  = this.safetyScore;
    const winCol = score > 80 ? 0x88ffaa : score >= 40 ? 0xffcc44 : 0x334433;
    const winMat = new THREE.MeshStandardMaterial({
      color:             winCol,
      emissive:          new THREE.Color(winCol),
      emissiveIntensity: score > 80 ? 0.5 : score >= 40 ? 0.25 : 0.05,
    });
    const w    = CELL * 0.72;
    const half = w / 2 + 0.01;

    for (let fl = 1; fl < floors; fl++) {
      const y = fl * 2.2;
      // Two windows per face, four faces
      const faces = [
        { pos: [half, y, 0],  rotY: 0 },
        { pos: [-half, y, 0], rotY: Math.PI },
        { pos: [0, y, half],  rotY: Math.PI / 2 },
        { pos: [0, y, -half], rotY: -Math.PI / 2 },
      ];
      for (const { pos, rotY } of faces) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.55), winMat);
        win.position.set(...pos);
        win.rotation.y = rotY;
        this.group.add(win);
      }
    }
  }

  // ── Private: state helpers ─────────────────────────────────────────────────

  #applyMaterialColor(color, emissive, emissiveIntensity) {
    this.bodyMat.color.set(color);
    this.bodyMat.emissive.copy(emissive);
    this.bodyMat.emissiveIntensity = emissiveIntensity;
  }

  #showHologram() {
    if (this.hologram) return;
    this.hologram = new HologramMarker();
    this.hologram.draw({
      jobId:              this.jobId,
      totalTests:         this.totalTests,
      criticalEdgeCases:  this.criticalEdgeCases,
    });
    this.hologram.sprite.position.set(0, this.#height + 3.5, 0);
    this.group.add(this.hologram.sprite);
  }

  #removeHologram() {
    if (!this.hologram) return;
    this.group.remove(this.hologram.sprite);
    this.hologram.dispose();
    this.hologram = null;
  }

  #startSteam(kind) {
    if (this.steam) return;
    this.steam = new SteamEmitter(this.group, this.#height + 1, kind);
  }

  #removeSteam() {
    if (!this.steam) return;
    this.steam.dispose();
    this.steam = null;
  }

  #fireOneShotSoot() {
    const burst = new SootBurst(this.#scene, this.topWorldPos);
    // Registered with the scene-level one-shot list via custom event
    this.group.dispatchEvent({ type: '_oneshot', burst });
  }

  #fireOneShotFirework() {
    const fw = new FireworkBurst(this.#scene, this.topWorldPos);
    this.group.dispatchEvent({ type: '_oneshot', burst: fw });
  }

  #upgradePipes() {
    const newMat = new THREE.MeshStandardMaterial({
      color:             0xaa6622,
      emissive:          new THREE.Color(0x00ff55),
      emissiveIntensity: 0.7,
      metalness:         0.75,
      roughness:         0.3,
    });
    for (const pipe of this.pipes) {
      pipe.material = newMat;
    }
    if (!this.pipes.length) this.#buildPipes();
  }
}

// ── OrbitCamera ───────────────────────────────────────────────────────────────

class OrbitCamera {
  camera;
  #theta    = 0.7;
  #phi      = 1.15;    // polar angle from Y+ (radians)
  #radius   = 75;
  #target   = new THREE.Vector3(0, 4, 0);
  #dragging = false;
  #lastX    = 0;
  #lastY    = 0;
  #focusLerp = null;   // { from, to, t } while animating

  MIN_RADIUS = 8;
  MAX_RADIUS = 140;
  MIN_PHI    = 0.15;
  MAX_PHI    = 1.45;

  constructor(canvas) {
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 400);
    this.#syncCamera();

    canvas.addEventListener('pointerdown',  e => this.#onDown(e));
    canvas.addEventListener('pointermove',  e => this.#onMove(e));
    canvas.addEventListener('pointerup',    ()  => { this.#dragging = false; });
    canvas.addEventListener('pointercancel',()  => { this.#dragging = false; });
    canvas.addEventListener('wheel',        e => this.#onWheel(e), { passive: true });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  /** Smoothly fly camera toward a building. */
  focusOn(building) {
    const cp = building.centerWorldPos;
    const from = {
      theta:  this.#theta,
      phi:    this.#phi,
      radius: this.#radius,
      target: this.#target.clone(),
    };

    // Position camera ~10 units away from the building centre
    const to = {
      theta:  this.#theta + 0.1,
      phi:    1.0,
      radius: 14,
      target: cp,
    };

    this.#focusLerp = { from, to, t: 0 };
  }

  tick(dt) {
    if (this.#focusLerp) {
      const L = this.#focusLerp;
      L.t = Math.min(1, L.t + dt * 2.5);
      const s     = smoothstep(L.t);
      this.#theta  = lerp(L.from.theta,  L.to.theta,  s);
      this.#phi    = lerp(L.from.phi,    L.to.phi,    s);
      this.#radius = lerp(L.from.radius, L.to.radius, s);
      this.#target.lerpVectors(L.from.target, L.to.target, s);
      if (L.t >= 1) this.#focusLerp = null;
      this.#syncCamera();
    }
  }

  #onDown(e) {
    this.#dragging = true;
    this.#lastX    = e.clientX;
    this.#lastY    = e.clientY;
    this.#focusLerp = null;
  }

  #onMove(e) {
    if (!this.#dragging) return;
    const dx = e.clientX - this.#lastX;
    const dy = e.clientY - this.#lastY;
    this.#lastX = e.clientX;
    this.#lastY = e.clientY;

    this.#theta -= dx * 0.005;
    this.#phi    = Math.max(this.MIN_PHI, Math.min(this.MAX_PHI, this.#phi + dy * 0.005));
    this.#syncCamera();
  }

  #onWheel(e) {
    this.#radius = Math.max(this.MIN_RADIUS,
                   Math.min(this.MAX_RADIUS,
                   this.#radius + e.deltaY * 0.06));
    this.#syncCamera();
  }

  #syncCamera() {
    const x = this.#target.x + this.#radius * Math.sin(this.#phi) * Math.sin(this.#theta);
    const y = this.#target.y + this.#radius * Math.cos(this.#phi);
    const z = this.#target.z + this.#radius * Math.sin(this.#phi) * Math.cos(this.#theta);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.#target);
  }
}

// ── CityScene ─────────────────────────────────────────────────────────────────

class CityScene {
  /** @type {THREE.WebGLRenderer} */ renderer;
  /** @type {THREE.Scene} */         scene;
  /** @type {OrbitCamera} */         orbit;
  /** @type {RainSystem} */          rain;
  /** @type {HudPanel} */            hud;
  /** @type {CityMqttBridge} */      mqtt;
  /** @type {Map<string,Building>} */ buildings = new Map();
  /** @type {Building|null} */        selected  = null;
  #oneshotBursts = [];  // active SootBurst / FireworkBurst
  #nextSlot = 0;
  #clock    = new THREE.Clock();
  #raycaster = new THREE.Raycaster();
  #pointer   = new THREE.Vector2();
  #pointerDownAt = null;

  constructor() {
    const canvas = document.getElementById('city-canvas');

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.7;

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040810);
    this.scene.fog         = new THREE.FogExp2(0x040810, 0.011);

    // Camera
    this.orbit = new OrbitCamera(canvas);

    // Click / pointer detection
    canvas.addEventListener('pointerdown', e => {
      this.#pointerDownAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    canvas.addEventListener('pointerup', e => {
      const d = this.#pointerDownAt;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      const dt   = Date.now() - d.t;
      if (dist < 6 && dt < 350) this.#pick(e);
    });

    this.#buildLights();
    this.#buildGround();
    this.#buildStreetLights();
    this.rain = new RainSystem(this.scene);
    this.hud  = new HudPanel({ onApprove: jobId => this.#publishApprove(jobId) });
  }

  // ── Initialise ─────────────────────────────────────────────────────────────

  async init() {
    // Seed the city grid
    for (const spec of SEED_MANIFEST) {
      this.#addBuilding(spec);
    }

    // Connect MQTT
    this.mqtt = new CityMqttBridge();
    this.mqtt.addEventListener('connected',    () => this.#onMqttConnected());
    this.mqtt.addEventListener('disconnected', () => this.#onMqttDisconnected());
    this.mqtt.addEventListener('stage:status',    e => this.#onStageStatus(e.detail));
    this.mqtt.addEventListener('stage:execution', e => this.#onStageExecution(e.detail));

    await this.mqtt.connect().catch(err =>
      console.warn('[CityScene] MQTT connect failed:', err.message)
    );

    // Hide loader
    setTimeout(() => {
      document.getElementById('loader').classList.add('hidden');
    }, 1600);

    // Start render loop
    this.renderer.setAnimationLoop(() => this.#render());
  }

  // ── Building management ────────────────────────────────────────────────────

  #addBuilding(spec) {
    const slot = this.#nextSlot++;
    const gridX = slot % GRID_COLS;
    const gridZ = Math.floor(slot / GRID_COLS);

    const b = new Building(this.scene, { ...spec, gridX, gridZ });

    // Wire one-shot bursts up to the scene-level list
    b.group.addEventListener('_oneshot', e => {
      this.#oneshotBursts.push(e.burst);
    });

    this.buildings.set(spec.jobId, b);
    return b;
  }

  #getOrCreateBuilding(jobId, extras = {}) {
    if (this.buildings.has(jobId)) return this.buildings.get(jobId);
    return this.#addBuilding({
      jobId,
      filePath:    extras.targetFile ?? jobId,
      loc:         extras.loc ?? 100,
      safetyScore: 0,
    });
  }

  // ── MQTT handlers ──────────────────────────────────────────────────────────

  #onStageStatus(p) {
    const { jobId, targetFile, criticalEdgeCases, totalTests, safetyScore } = p;
    if (!jobId) return;

    const b = this.#getOrCreateBuilding(jobId, { targetFile });
    if (safetyScore != null) b.safetyScore = safetyScore;

    b.setState('AWAITING_QA', {
      criticalEdgeCases: criticalEdgeCases ?? [],
      totalTests:        totalTests        ?? null,
    });

    this.hud.update(jobId, b.hudData);
    this.#setActiveEvent(`Staged: ${jobId} — ${totalTests ?? '?'} tests`);
  }

  #onStageExecution(p) {
    const { jobId, status, attempt, error, score } = p;
    if (!jobId) return;

    const b = this.buildings.get(jobId);
    if (!b) return;

    let cityState;
    switch (status) {
      case 'COMPILING':
        cityState = 'COMPILING';
        this.#setActiveEvent(`Compiling: ${jobId} (attempt ${attempt ?? 1})`);
        break;
      case 'RETRYING':
        cityState = 'RETRYING';
        this.#setActiveEvent(`⚠ Retrying: ${jobId} — ${(error ?? '').slice(0, 60)}`);
        break;
      case 'SUCCESS':
        cityState = 'DONE_IN_REVIEW';
        this.#setActiveEvent(`✓ Done: ${jobId} — score ${score ?? '?'}/10`);
        break;
      default:
        return;
    }

    const log = status === 'RETRYING' ? (error ?? '') :
                status === 'SUCCESS'  ? `Score: ${score ?? '?'}/10` : '';

    b.setState(cityState, { log });
    this.hud.update(jobId, { state: cityState, log });
  }

  // ── Approve lever ──────────────────────────────────────────────────────────

  #publishApprove(jobId) {
    this.mqtt.approve(jobId);
    const b = this.buildings.get(jobId);
    if (b) {
      b.setState('COMPILING', {});
      this.hud.update(jobId, { state: 'COMPILING' });
    }
  }

  // ── Picking (click on building) ────────────────────────────────────────────

  #pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.#pointer.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this.#pointer.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;

    this.#raycaster.setFromCamera(this.#pointer, this.orbit.camera);

    // Collect all building body meshes
    const meshes = [...this.buildings.values()].map(b => b.body);
    const hits   = this.#raycaster.intersectObjects(meshes, false);

    if (!hits.length) {
      this.selected = null;
      this.hud.hide();
      return;
    }

    const building = hits[0].object.userData.building;
    if (!building) return;

    this.selected = building;
    this.hud.show(building.hudData);
    this.orbit.focusOn(building);
  }

  // ── Lights ─────────────────────────────────────────────────────────────────

  #buildLights() {
    // Ambient — very dim, cool
    const ambient = new THREE.AmbientLight(0x101828, 1.5);
    this.scene.add(ambient);

    // Moonlight — low-angle cool directional
    const moon = new THREE.DirectionalLight(0x334466, 0.5);
    moon.position.set(-30, 50, 20);
    moon.castShadow             = true;
    moon.shadow.mapSize.width   = 2048;
    moon.shadow.mapSize.height  = 2048;
    moon.shadow.camera.near     = 0.1;
    moon.shadow.camera.far      = 200;
    moon.shadow.camera.left     = -70;
    moon.shadow.camera.right    = 70;
    moon.shadow.camera.top      = 70;
    moon.shadow.camera.bottom   = -70;
    moon.shadow.bias            = -0.001;
    this.scene.add(moon);
  }

  #buildStreetLights() {
    // Scattered warm amber gaslamp point lights
    const positions = [
      [-20, -20], [20, -20], [-20, 20], [20, 20],
      [0, -30],   [0, 30],   [-35, 0],  [35, 0],
      [-10, 10],  [10, -10], [-28, 14], [22, -18],
    ];
    for (const [x, z] of positions) {
      const pl = new THREE.PointLight(0xcc8833, 0.35, 18);
      pl.position.set(x, 3.5, z);
      this.scene.add(pl);
    }
  }

  #buildGround() {
    // Wet cobblestone ground plane
    const geo = new THREE.PlaneGeometry(200, 200, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color:     0x0a0d14,
      roughness: 0.6,
      metalness: 0.3,
      // slight reflective shimmer from wet stone
      envMapIntensity: 0.3,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x  = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid lines — faint neon channels between buildings
    const gridMat = new THREE.LineBasicMaterial({ color: 0x002222, transparent: true, opacity: 0.4 });
    const pts     = [];
    const half    = GRID_COLS / 2;
    for (let i = 0; i <= GRID_COLS; i++) {
      const x = (i - half) * CELL;
      pts.push(new THREE.Vector3(x, 0.01, -half * CELL),
               new THREE.Vector3(x, 0.01,  half * CELL));
    }
    for (let j = 0; j <= GRID_ROWS; j++) {
      const z = (j - GRID_ROWS / 2) * CELL;
      pts.push(new THREE.Vector3(-half * CELL, 0.01, z),
               new THREE.Vector3( half * CELL, 0.01, z));
    }
    const gridGeo  = new THREE.BufferGeometry().setFromPoints(pts);
    const gridLine = new THREE.LineSegments(gridGeo, gridMat);
    this.scene.add(gridLine);
  }

  // ── Status bar helpers ─────────────────────────────────────────────────────

  #onMqttConnected() {
    document.getElementById('mqtt-dot').className   = 'connected';
    document.getElementById('mqtt-label').textContent = 'Connected';
  }

  #onMqttDisconnected() {
    document.getElementById('mqtt-dot').className   = 'connecting';
    document.getElementById('mqtt-label').textContent = 'Reconnecting…';
  }

  #setActiveEvent(text) {
    const el = document.getElementById('active-event');
    el.textContent = '';
    const b = document.createElement('b');
    b.textContent = '⚙ ';
    el.appendChild(b);
    el.appendChild(document.createTextNode(text));
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  #render() {
    const dt    = Math.min(this.#clock.getDelta(), 0.05);
    const clock = this.#clock.getElapsedTime();

    this.orbit.tick(dt);
    this.rain.tick(dt);

    for (const b of this.buildings.values()) {
      b.tick(dt, clock);
    }

    // Tick + cull dead one-shot effects
    this.#oneshotBursts = this.#oneshotBursts.filter(fx => {
      const alive = fx.tick(dt);
      if (!alive) fx.dispose();
      return alive;
    });

    this.renderer.render(this.scene, this.orbit.camera);
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function lerp(a, b, t)          { return a + (b - a) * t; }
function smoothstep(t)           { return t * t * (3 - 2 * t); }

// ── Boot ──────────────────────────────────────────────────────────────────────

const city = new CityScene();
city.init().catch(err => console.error('[CityScene] init failed:', err));
