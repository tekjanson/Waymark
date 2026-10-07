/**
 * main.js — Application Orchestrator
 *
 * Pipeline (camera mode):
 *   VisionTracker → onFingerTracked → SpatialMapper.mapFingerToGlasses →
 *   G2Bridge.drawToGlasses → BLE → G2 display
 *
 * Pipeline (touch mode — camera-free fallback):
 *   pointer drag on phone → map to 576×288 → G2Bridge.drawToGlasses
 *
 * The touch mode exists because the Even App WebView on Android frequently
 * denies getUserMedia. Touch mode proves the entire glasses rendering + BLE
 * pipeline works independently of the camera.
 */

import { getG2Bridge } from './g2Bridge.js';
import { PhoneSensor, GlassesSensor } from './sensors.js';
import { SpatialMapper } from './mathUtils.js';
import { VisionTracker } from './vision.js';
import {
  identifyPointedObject,
  getStoredApiKey,
  setStoredApiKey,
  getStoredModel,
} from './waymarkIdentify.js';
import { fetchLatestBridgeMessage, PHONE_BRIDGE_BASES } from './phoneBridgeClient.js';
import { renderBridgePayload } from './bridgeRender.js';
import { AcousticRanger } from './acousticRange.js';

// G2 display dimensions (drawing target space)
const G2_WIDTH = 576;
const G2_HEIGHT = 288;

// ─────────────────────────────────────────────────────────────────────────────
// Module instances
// ─────────────────────────────────────────────────────────────────────────────

const g2Bridge      = getG2Bridge();
const phoneSensor   = new PhoneSensor();
const spatialMapper = new SpatialMapper();
let glassesSensor   = null;
let visionTracker   = null;
let acousticRanger  = null;

// ── Acoustic correction weighting (LOW — IMU orientation dominates) ──────────
let acousticZeroBearing = null;        // bearing captured at the fusion origin
const ACOUSTIC_MIN_CONF = 0.5;         // only trust confident chirp detections
const ACOUSTIC_PX_PER_DEG = 4;         // assumes firmware `direction` ~ degrees (tune on HW)
const ACOUSTIC_WEIGHT = 0.4;           // low weight
const ACOUSTIC_MAX_PX = 48;            // hard clamp (~8% of 576) — safety

// ── UI refs ──────────────────────────────────────────────────────────────────
let btnConnect, btnImu, btnCamera, btnCaptureSdk, btnTouch, btnSync, btnHello, btnClear;
let btnIdentify, wmQuestionInput, wmKeyInput, wmResultEl;
let btnPhoneBridge, phoneBridgeStatusEl;
let statusEl, debugInfoEl, debugCanvas;

// ── State ────────────────────────────────────────────────────────────────────
let glassesConnected = false;
let imuActive        = false;
let cameraActive     = false;
let touchMode        = false;
let phoneBridgeRunning = false;
let phoneBridgeTimer = null;
let lastBridgeSeq = -1;
let lastCalEpoch = -1;

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────

function buildUI() {
  debugCanvas = document.createElement('canvas');
  debugCanvas.id = 'debug-canvas';
  document.body.appendChild(debugCanvas);

  const panel = document.createElement('div');
  panel.id = 'control-panel';
  document.body.appendChild(panel);

  statusEl = document.createElement('div');
  statusEl.id = 'status';
  statusEl.textContent = 'Ready — connect glasses to begin';
  panel.appendChild(statusEl);

  // Step 1 — Connect Glasses (also renders Hello World)
  btnConnect = makeButton('🕶️ Connect Glasses', async () => {
    setStatus('Connecting to G2 glasses…');
    btnConnect.disabled = true;
    try {
      await g2Bridge.init();
      glassesConnected = true;
      glassesSensor = new GlassesSensor(g2Bridge.bridge);
      acousticRanger = new AcousticRanger(g2Bridge.bridge);

      const pcr = g2Bridge.pageCreateResult;
      setStatus(`✅ Glasses connected (page:${pcr}) — Hello World is on the lenses`);
      markActive(btnConnect, '✅ Glasses Connected');
      btnImu.disabled = false;
      btnCamera.disabled = false;
      btnCaptureSdk.disabled = false;
      btnTouch.disabled = false;
      btnHello.disabled = false;
      btnClear.disabled = false;
      btnIdentify.disabled = false;
      btnPhoneBridge.disabled = false;
      setStatus('✅ Glasses connected — Point Mode is ready (toggle to start streaming)');
      updateDebugInfo();
    } catch (err) {
      console.error('[main] connect failed:', err);
      setStatus(`❌ Connect failed: ${err?.message ?? err}`);
      btnConnect.disabled = false;
    }
  });
  panel.appendChild(btnConnect);

  // Re-render Hello World on demand (quick sanity check)
  btnHello = makeButton('👋 Test Hello World', async () => {
    setStatus('Rendering Hello World to glasses…');
    try {
      await g2Bridge.helloWorld();
      setStatus('✅ Hello World sent — check the lenses');
    } catch (err) {
      setStatus(`❌ Hello World failed: ${err?.message ?? err}`);
    }
  });
  btnHello.disabled = true;
  panel.appendChild(btnHello);

  // Clear the drawing surface
  btnClear = makeButton('🧹 Clear Drawing', async () => {
    try {
      await g2Bridge.clearDrawing();
      setStatus('🧹 Drawing cleared');
    } catch (err) {
      setStatus(`❌ Clear failed: ${err?.message ?? err}`);
    }
  });
  btnClear.disabled = true;
  panel.appendChild(btnClear);

  // Step 2 — Phone IMU
  btnImu = makeButton('📱 Request Phone IMU', async () => {
    setStatus('Requesting phone orientation sensor…');
    btnImu.disabled = true;
    const ok = await phoneSensor.start();
    if (ok) {
      imuActive = true;
      setStatus('✅ Phone IMU active');
      markActive(btnImu, '✅ Phone IMU Active');
      btnSync.disabled = false;
    } else {
      setStatus('❌ Phone IMU unavailable/denied');
      btnImu.disabled = false;
    }
  });
  btnImu.disabled = true;
  panel.appendChild(btnImu);

  // Step 3a — Camera (best-effort; may be denied in Even WebView)
  btnCamera = makeButton('📷 Start Camera (finger tracking)', async () => {
    setStatus('Starting camera and hand tracking…');
    btnCamera.disabled = true;
    try {
      visionTracker = new VisionTracker(debugCanvas);
      visionTracker.onFingerTracked(onFingerTracked);
      await visionTracker.start();
      cameraActive = true;
      setStatus('📷 Camera active — point your index finger');
      markActive(btnCamera, '📷 Camera Active');
      await g2Bridge.setStatus('Camera tracking active');
    } catch (err) {
      console.error('[main] camera failed:', err);
      const diag = await VisionTracker.diagnose().catch(() => ({}));
      const isPerm = /NotAllowed|Permission|denied/i.test(String(err?.name || err?.message || err));

      // Show the exact failure on-screen (glasses app has no dev console)
      showCameraDiagnostics(err, diag, isPerm);

      if (isPerm) {
        setStatus('⚠️ Live camera (getUserMedia) is not supported inside the Even ' +
          'app WebView — this is a platform limit, not a permission. Use ' +
          '📸 Capture & Draw (Even camera) on the glasses, or open this page in ' +
          'the phone browser for live tracking. See diagnostics below.');
        await g2Bridge.setStatus('Use Capture & Draw or Touch Draw');
      } else {
        setStatus(`❌ Camera failed: ${err?.message ?? err}. Use 📸 Capture & Draw or ✍️ Touch Draw instead.`);
      }
      btnCamera.disabled = false;
    }
  });
  btnCamera.disabled = true;
  panel.appendChild(btnCamera);

  // Step 3a-alt — Even native camera capture (the ONLY camera path that works
  // INSIDE the Even app WebView, because that WebView has no getUserMedia).
  // Each tap opens the native camera, captures one photo, runs MediaPipe on it,
  // and draws the detected fingertip to the glasses.
  btnCaptureSdk = makeButton('📸 Capture & Draw (Even camera)', captureAndDraw);
  btnCaptureSdk.disabled = true;
  panel.appendChild(btnCaptureSdk);

  // ── Waymark Identify — point at something, ask Gemini, show it on the glasses ──
  const wmHeading = document.createElement('div');
  wmHeading.className = 'wm-heading';
  wmHeading.textContent = '🔎 Waymark Identify';
  panel.appendChild(wmHeading);

  wmQuestionInput = document.createElement('input');
  wmQuestionInput.type = 'text';
  wmQuestionInput.id = 'wm-question';
  wmQuestionInput.className = 'wm-input';
  wmQuestionInput.placeholder = 'Ask about what you point at…';
  wmQuestionInput.value = 'What am I pointing at?';
  panel.appendChild(wmQuestionInput);

  wmKeyInput = document.createElement('input');
  wmKeyInput.type = 'password';
  wmKeyInput.id = 'wm-key';
  wmKeyInput.className = 'wm-input';
  wmKeyInput.placeholder = 'Gemini API key (stored on this device)';
  wmKeyInput.autocomplete = 'off';
  wmKeyInput.value = getStoredApiKey();
  const saveKey = () => setStoredApiKey(wmKeyInput.value);
  wmKeyInput.addEventListener('change', saveKey);
  wmKeyInput.addEventListener('blur', saveKey);
  panel.appendChild(wmKeyInput);

  btnIdentify = makeButton('🔎 Identify (point + ask)', captureAndIdentify);
  btnIdentify.disabled = true;
  panel.appendChild(btnIdentify);

  wmResultEl = document.createElement('div');
  wmResultEl.id = 'wm-result';
  panel.appendChild(wmResultEl);

  // Step 3b — Touch Draw fallback (camera-free)
  btnTouch = makeButton('✍️ Touch Draw Mode', () => {
    touchMode = !touchMode;
    if (touchMode) {
      enableTouchDraw();
      setStatus('✍️ Touch Draw ON — drag on the screen to draw on the glasses');
      markActive(btnTouch, '✍️ Touch Draw ON');
    } else {
      disableTouchDraw();
      setStatus('Touch Draw off');
      btnTouch.removeAttribute('data-active');
      btnTouch.textContent = '✍️ Touch Draw Mode';
    }
  });
    btnPhoneBridge = makeButton('🎯 Point Mode: OFF', async () => {
      if (!phoneBridgeRunning) {
        await startPhoneBridgeMode();
      } else {
        stopPhoneBridgeMode();
      }
    });
    btnPhoneBridge.disabled = true;
    panel.appendChild(btnPhoneBridge);

    phoneBridgeStatusEl = document.createElement('div');
    phoneBridgeStatusEl.id = 'phone-bridge-status';
    phoneBridgeStatusEl.textContent = `Bridge endpoints: ${PHONE_BRIDGE_BASES.join(', ')}`;
    panel.appendChild(phoneBridgeStatusEl);

    const bridgeHeading = document.createElement('div');
    bridgeHeading.className = 'wm-heading';
    bridgeHeading.textContent = '📡 Phone-Local Bridge';
    panel.appendChild(bridgeHeading);

  btnTouch.disabled = true;
  panel.appendChild(btnTouch);

  // Step 4 — Sync Origin
  btnSync = makeButton('🎯 Sync Origin\n(Look + Point Forward)', async () => {
    const phoneEuler = phoneSensor.euler;
    if (!phoneEuler) { setStatus('⚠️ Phone IMU not ready yet'); return; }

    if (glassesSensor && !glassesSensor.active) {
      try { await glassesSensor.start(); }
      catch (err) { console.warn('[main] glasses IMU start failed:', err); }
    }
    const glassesEuler = glassesSensor?.euler ?? { pitch: 0, yaw: 0, roll: 0 };

    spatialMapper.syncOrigin(phoneEuler, glassesEuler);
    setStatus('🎯 Origin synced — AR drawing live');
    markActive(btnSync, '🔄 Re-Sync Origin');
    btnSync.disabled = false;
    updateDebugInfo();
  });
  btnSync.disabled = true;
  panel.appendChild(btnSync);

  debugInfoEl = document.createElement('pre');
  debugInfoEl.id = 'debug-info';
  panel.appendChild(debugInfoEl);

  // Size the canvas so touch mapping is correct even before the camera starts
  resizeDebugCanvas();
  window.addEventListener('resize', resizeDebugCanvas);

  setInterval(updateDebugInfo, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera pipeline
// ─────────────────────────────────────────────────────────────────────────────

function onFingerTracked(x, y, width, height) {
  const phoneEuler = phoneSensor.euler;
  if (phoneEuler) {
    spatialMapper.updatePhoneOrientation(phoneEuler.pitch, phoneEuler.yaw, phoneEuler.roll);
  }
  const glassesEuler = glassesSensor?.euler;
  if (glassesEuler) {
    spatialMapper.updateGlassesOrientation(glassesEuler.pitch, glassesEuler.yaw, glassesEuler.roll);
  }

  const { x: gx, y: gy } = spatialMapper.mapFingerToGlasses(x, y, width, height);
  // strokeTo draws a connected, persistent line. The STROKE_GAP_MS logic in
  // g2Bridge auto-breaks the stroke if the finger is lost for a moment.
  if (glassesConnected) g2Bridge.strokeTo(gx, gy);
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK single-shot capture pipeline (works INSIDE the Even app WebView)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture ONE photo via the Even app's native camera, run MediaPipe on it, map
 * the detected fingertip through the SpatialMapper, and draw it to the glasses.
 *
 * This is the on-device camera path. Unlike getUserMedia (unsupported in the
 * Even WebView), `captureImageFromCamera()` is a first-class SDK capability, so
 * this actually works on the glasses once the app is installed.
 */
async function captureAndDraw() {
  if (!glassesConnected) { setStatus('⚠️ Connect glasses first'); return; }
  btnCaptureSdk.disabled = true;
  setStatus('📸 Opening Even camera…');
  try {
    const dataUrl = await g2Bridge.captureCameraImage();
    if (!dataUrl) { setStatus('📸 Capture cancelled'); return; }

    // Decode the captured photo into an <img> for MediaPipe.
    const img = await loadImage(dataUrl);

    if (!visionTracker) visionTracker = new VisionTracker(debugCanvas);
    const finger = await visionTracker.trackStillImage(img);
    if (!finger) {
      setStatus('📸 Captured, but no hand/finger detected — try again pointing clearly');
      return;
    }

    // Feed current orientations so the projection compensates for both devices.
    const phoneEuler = phoneSensor.euler;
    if (phoneEuler) spatialMapper.updatePhoneOrientation(phoneEuler.pitch, phoneEuler.yaw, phoneEuler.roll);
    const glassesEuler = glassesSensor?.euler;
    if (glassesEuler) spatialMapper.updateGlassesOrientation(glassesEuler.pitch, glassesEuler.yaw, glassesEuler.roll);

    const { x: gx, y: gy } = spatialMapper.mapFingerToGlasses(
      finger.x, finger.y, finger.width, finger.height,
    );
    // Each capture is an independent point; break the stroke so dots don't
    // connect across separate captures.
    g2Bridge.endStroke();
    g2Bridge.strokeTo(gx, gy);
    g2Bridge.endStroke();
    setStatus(`📸 Drew finger @ (${gx}, ${gy}) on glasses — tap again to add more`);
  } catch (err) {
    console.error('[main] SDK capture failed:', err);
    setStatus(`❌ Capture failed: ${err?.message ?? err}`);
  } finally {
    btnCaptureSdk.disabled = false;
  }
}

/** Load a data URL / URL into an HTMLImageElement, resolving when decoded. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to decode captured image'));
    img.src = src;
  });
}

// ──────────────────────────────────────────────────────────────────────
// Waymark Identify pipeline (capture → Gemini → glasses HUD + phone)
// ──────────────────────────────────────────────────────────────────────

/**
 * Capture ONE photo via the Even SDK camera, ask Gemini what the wearer is
 * pointing at, and show the concise answer on the glasses HUD + the phone.
 *
 * This is the on-device path that works INSIDE the Even app (getUserMedia is
 * unavailable there). The Gemini call needs the network whitelist in app.json
 * (generativelanguage.googleapis.com) and a key entered in the key field.
 */
async function captureAndIdentify() {
  if (!glassesConnected) { setStatus('⚠️ Connect glasses first'); return; }

  const apiKey = getStoredApiKey();
  if (!apiKey) {
    setStatus('🔑 Enter your Gemini API key in the field above first');
    wmKeyInput?.focus();
    return;
  }

  btnIdentify.disabled = true;
  setStatus('📸 Opening Even camera…');
  try {
    const dataUrl = await g2Bridge.captureCameraImage();
    if (!dataUrl) { setStatus('📸 Capture cancelled'); return; }

    setStatus('🤖 Asking Gemini what you\'re pointing at…');
    await g2Bridge.setStatus('Thinking…').catch(() => {});

    const { base64, mimeType } = await downscaleToBase64(dataUrl);
    const question = (wmQuestionInput?.value || '').trim() || 'What am I pointing at?';
    const answer = await identifyPointedObject({
      imageBase64: base64,
      mimeType,
      question,
      apiKey,
      model: getStoredModel(),
    });

    setStatus(`🔎 ${answer}`);
    if (wmResultEl) wmResultEl.textContent = answer;
    await g2Bridge.setStatus(answer);
  } catch (err) {
    console.error('[main] identify failed:', err);
    setStatus(`❌ Identify failed: ${err?.message ?? err}`);
    await g2Bridge.setStatus('Identify failed').catch(() => {});
  } finally {
    btnIdentify.disabled = false;
  }
}

/**
 * Downscale a captured data URL and return raw base64 JPEG bytes for Gemini.
 * Large camera stills are slow to upload and unnecessary for identification.
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
async function downscaleToBase64(dataUrl, maxDim = 1024, quality = 0.82) {
  const img = await loadImage(dataUrl);
  const longest = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, maxDim / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', quality);
  return { base64: out.split(',')[1] || '', mimeType: 'image/jpeg' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Touch pipeline (camera-free)
// ─────────────────────────────────────────────────────────────────────────────

let _touchDrawing = false;

function enableTouchDraw() {
  debugCanvas.addEventListener('pointerdown', onTouchDown);
  debugCanvas.addEventListener('pointermove', onTouchMove);
  window.addEventListener('pointerup', onTouchUp);
  drawTouchHint();
}

function disableTouchDraw() {
  debugCanvas.removeEventListener('pointerdown', onTouchDown);
  debugCanvas.removeEventListener('pointermove', onTouchMove);
  window.removeEventListener('pointerup', onTouchUp);
}

function onTouchDown(e) {
  _touchDrawing = true;
  if (glassesConnected) g2Bridge.endStroke(); // ensure a fresh stroke starts
  paintFromPointer(e);
}
function onTouchMove(e) { if (_touchDrawing) paintFromPointer(e); }
function onTouchUp() {
  _touchDrawing = false;
  if (glassesConnected) g2Bridge.endStroke();
}

function paintFromPointer(e) {
  const rect = debugCanvas.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;   // 0..1
  const ny = (e.clientY - rect.top)  / rect.height;  // 0..1
  const gx = Math.round(nx * G2_WIDTH);
  const gy = Math.round(ny * G2_HEIGHT);

  if (glassesConnected) g2Bridge.strokeTo(gx, gy);

  // Mirror the stroke on the phone screen for feedback (accumulates too)
  const ctx = debugCanvas.getContext('2d');
  ctx.fillStyle = '#00e5ff';
  ctx.beginPath();
  ctx.arc(e.clientX - rect.left, e.clientY - rect.top, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawTouchHint() {
  const ctx = debugCanvas.getContext('2d');
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, debugCanvas.width, debugCanvas.height);
  ctx.fillStyle = 'rgba(0,229,255,0.8)';
  ctx.font = '18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Drag anywhere to draw on the glasses', debugCanvas.width / 2, debugCanvas.height / 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resizeDebugCanvas() {
  debugCanvas.width  = debugCanvas.offsetWidth  || window.innerWidth;
  debugCanvas.height = debugCanvas.offsetHeight || window.innerHeight;
  if (touchMode && !cameraActive) drawTouchHint();
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
  console.log('[Status]', msg);
}

function markActive(btn, label) {
  btn.setAttribute('data-active', 'true');
  btn.textContent = label;
}

function updateDebugInfo() {
  if (!debugInfoEl) return;
  const phone   = phoneSensor.euler;
  const glasses = glassesSensor?.euler ?? null;
  const mapper  = spatialMapper.getDebugState();

  debugInfoEl.textContent = [
    `Glasses    : ${glassesConnected ? '✅ connected' : '❌'} (page:${g2Bridge.pageCreateResult})`,
    `Phone IMU  : ${phone ? `P${phone.pitch.toFixed(0)} Y${phone.yaw.toFixed(0)} R${phone.roll.toFixed(0)}` : 'not ready'}`,
    `Glasses IMU: ${glasses ? `P${glasses.pitch.toFixed(0)} Y${glasses.yaw.toFixed(0)} R${glasses.roll.toFixed(0)}` : 'not ready'} (${glassesSensor?.eventCount ?? 0})`,
    `Origin sync: ${mapper.originSynced ? '✅' : '❌'}`,
    `Acoustic   : ${acousticDebugLine()}`,
    `Camera     : ${cameraActive ? '✅' : '❌'}   Touch: ${touchMode ? '✅' : '❌'}`,
  ].join('\n');
}

function acousticDebugLine() {
  if (!acousticRanger?.active) return 'off';
  const a = acousticRanger.getLatest();
  if (a.bearing == null) return 'listening…';
  return `bearing ${a.bearing.toFixed(0)} · conf ${(a.confidence * 100).toFixed(0)}%`;
}

/**
 * Apply dual-IMU drift compensation to a bridge payload. Streams the phone
 * (bridge quaternion, preferred) and glasses (G2 IMU) orientations into the
 * SpatialMapper, re-anchors the fusion origin whenever Android completes a
 * calibration (calEpoch increment), and reprojects an identified target's raw
 * camera hit through the dual-IMU pipeline. Returns the payload with x/y
 * replaced by the compensated glasses position, or unchanged (static affine
 * fallback) when sensors or the origin aren't ready.
 *
 * @param {object} payload  bridge payload
 * @returns {object} payload to render
 */
function fuseBridgePayload(payload) {
  // Open the glasses mic for acoustic ranging during calibration; close when parked.
  if (acousticRanger) {
    if (payload.state === 'calibrate' && !acousticRanger.active) acousticRanger.start();
    else if (payload.state === 'off' && acousticRanger.active) acousticRanger.stop();
  }

  // 1. Feed live orientations into the fusion engine.
  const qx = Number(payload.qx), qy = Number(payload.qy);
  const qz = Number(payload.qz), qw = Number(payload.qw);
  const hasQuat = Number.isFinite(qx) && Number.isFinite(qy) &&
                  Number.isFinite(qz) && Number.isFinite(qw);
  if (hasQuat) {
    spatialMapper.updatePhoneQuat(qx, qy, qz, qw);
  } else if (phoneSensor.euler) {
    const e = phoneSensor.euler;
    spatialMapper.updatePhoneOrientation(e.pitch, e.yaw, e.roll);
  }
  const ge = glassesSensor?.euler;
  if (ge) spatialMapper.updateGlassesOrientation(ge.pitch, ge.yaw, ge.roll);

  const haveOrientations = (hasQuat || !!phoneSensor.euler) && !!ge;

  // 2. Re-anchor the fusion origin when Android completes a calibration
  //    (deferred until both orientations have a real reading).
  const calEpoch = Number(payload.calEpoch);
  if (Number.isFinite(calEpoch) && calEpoch !== lastCalEpoch && haveOrientations) {
    lastCalEpoch = calEpoch;
    spatialMapper.syncOriginFromCurrent();
    acousticZeroBearing = acousticRanger?.getLatest().bearing ?? null;
  }

  // 3. Reproject an identified target's raw camera hit through the dual-IMU
  //    pipeline; otherwise keep the static affine x/y.
  const rx = Number(payload.rx), ry = Number(payload.ry);
  const canFuse = payload.state === 'identified' &&
    Number.isFinite(rx) && Number.isFinite(ry) &&
    spatialMapper.originSynced && haveOrientations;
  if (!canFuse) return payload;

  const camW = Number(payload.cw) || 960;
  const camH = Number(payload.ch) || 1280;
  const mapped = spatialMapper.mapFingerToGlasses(rx * camW, ry * camH, camW, camH);
  let gx = mapped.x;

  // Low-weight acoustic yaw correction: nudge the marker toward the acoustic
  // bearing drift. Clamped + confidence-gated so a noisy/uncalibrated reading
  // can never destabilize the dominant IMU solution.
  const a = acousticRanger?.getLatest();
  if (a && a.bearing != null && acousticZeroBearing != null && a.confidence >= ACOUSTIC_MIN_CONF) {
    const driftDeg = a.bearing - acousticZeroBearing;
    const nudge = Math.max(-ACOUSTIC_MAX_PX, Math.min(ACOUSTIC_MAX_PX,
      driftDeg * ACOUSTIC_PX_PER_DEG * ACOUSTIC_WEIGHT));
    gx += nudge;
  }
  return { ...payload, x: gx / G2_WIDTH, y: mapped.y / G2_HEIGHT, fused: true };
}

async function startPhoneBridgeMode() {
  if (!glassesConnected) {
    setStatus('⚠️ Connect glasses first');
    return;
  }
  if (phoneBridgeRunning) {
    return;
  }

  phoneBridgeRunning = true;
  lastBridgeSeq = -1;
  lastCalEpoch = -1;
  // Glasses IMU drives drift compensation; start it if not already streaming.
  if (glassesSensor && !glassesSensor.active) {
    try { await glassesSensor.start(); }
    catch (e) { console.warn('[bridge] glasses IMU start failed:', e); }
  }
  g2Bridge.resetHud();
  markActive(btnPhoneBridge, '🎯 Point Mode: ON');
  setStatus('🎯 Point Mode ON — streaming live identifications from Waymark');

  const tick = async () => {
    if (!phoneBridgeRunning) return;

    const result = await fetchLatestBridgeMessage({ bases: PHONE_BRIDGE_BASES, timeoutMs: 1200 });
    if (!result.ok) {
      phoneBridgeStatusEl.textContent = `Bridge offline: ${result.error}`;
      await g2Bridge.renderHud({ text: 'Bridge offline' }).catch(() => {});
      phoneBridgeTimer = setTimeout(tick, 900);
      return;
    }

    phoneBridgeStatusEl.textContent = `Bridge live: ${result.base}`;

    const payload = result.payload || {};
    const text = String(payload.text || '').trim();
    const state = String(payload.state || '').trim();

    if (text) {
      wmResultEl.textContent = text;
      setStatus(`📡 ${text}`);
    }
    if (state === 'calibrate') {
      phoneBridgeStatusEl.textContent =
        `Calibrating ${Number(payload.step || 0)}/${Number(payload.steps || 0)}`;
    }

    // Dual-IMU drift compensation (falls back to the static affine when the
    // sensors or fusion origin aren't ready yet).
    const rendered = fuseBridgePayload(payload);

    // One shared render path — the SAME function the visual-QC simulator drives,
    // so what we verify off-device is exactly what paints on the lenses.
    await renderBridgePayload(g2Bridge, rendered).catch(() => {});

    phoneBridgeTimer = setTimeout(tick, 130);
  };

  await tick();
}

function stopPhoneBridgeMode() {
  phoneBridgeRunning = false;
  if (phoneBridgeTimer) {
    clearTimeout(phoneBridgeTimer);
    phoneBridgeTimer = null;
  }
  btnPhoneBridge.removeAttribute('data-active');
  btnPhoneBridge.textContent = '🎯 Point Mode: OFF';
  phoneBridgeStatusEl.textContent = `Bridge endpoints: ${PHONE_BRIDGE_BASES.join(', ')}`;
  if (acousticRanger?.active) acousticRanger.stop();
  acousticZeroBearing = null;
  setStatus('Point Mode OFF');
}

function makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ctrl-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Render camera diagnostics ON the phone screen. The glasses WebView has no
 * dev console, so surfacing the exact failure here is the only way to see it.
 */
function showCameraDiagnostics(err, diag, isPerm) {
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent);
  let box = document.getElementById('cam-diag');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'cam-diag';
    box.style.cssText =
      'position:fixed;left:8px;bottom:8px;max-width:94vw;z-index:30;margin:0;' +
      'padding:10px;border-radius:8px;background:rgba(30,0,0,0.9);color:#ff9a9a;' +
      'font:11px/1.5 monospace;white-space:pre-wrap;border:1px solid #ff4444;';
    document.body.appendChild(box);
  }
  box.textContent = [
    '📷 LIVE CAMERA (getUserMedia) DIAGNOSTICS',
    `error         : ${err?.name || ''} ${err?.message || err}`,
    `secureContext : ${diag.secureContext}`,
    `getUserMedia  : ${diag.hasMediaDevices}`,
    `permission    : ${diag.permissionState}`,
    `videoInputs   : ${diag.videoInputs}`,
    '',
    isIOS
      ? 'iPhone: live camera works in SAFARI (open the tunnel URL directly),\n' +
        'but NOT inside the Even app WebView.'
      : 'ROOT CAUSE: The Even app runs your page in a Flutter WebView that does\n' +
        'NOT implement getUserMedia (live video). This is a platform limitation,\n' +
        'not a permission you can grant — packing the app does NOT change it.\n' +
        'The app.json "camera" permission applies to the SDK photo API, not\n' +
        'to web getUserMedia.',
    '',
    'WHAT WORKS ON THE GLASSES:',
    '  • 📸 Capture & Draw (Even camera) — uses the SDK\'s native photo capture\n' +
    '    (captureImageFromCamera), runs hand-tracking on the shot, draws it.',
    '  • ✍️ Touch Draw — camera-free, exercises the full glasses pipeline.',
    '  • Live continuous tracking: run this page in the phone browser',
    '    (Safari/Chrome) where getUserMedia is available.',
    '',
    '(tap to dismiss)',
  ].join('\n');
  box.onclick = () => box.remove();
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildUI();
  console.log('[main] AR Drawing System ready');

  window.addEventListener('beforeunload', () => {
    stopPhoneBridgeMode();
  });

  // Automated test hook (used by the EvenHub simulator / CI). When the page is
  // loaded with ?autotest=1, run the glasses connect flow and a few draw calls
  // so the pipeline can be validated without manual button taps. No-op in
  // normal use.
  if (new URLSearchParams(location.search).get('autotest') === '1') {
    runAutotest();
  }
});

async function runAutotest() {
  console.log('[autotest] starting');
  try {
    await g2Bridge.init();
    console.log('[autotest] connected, page result =', g2Bridge.pageCreateResult);

    // Sweep a dot diagonally across the full 576×288 field to exercise all
    // four tiles and the tile-crossing send logic.
    for (let i = 0; i <= 10; i++) {
      const x = Math.round((i / 10) * (G2_WIDTH - 1));
      const y = Math.round((i / 10) * (G2_HEIGHT - 1));
      g2Bridge.drawToGlasses(x, y);
      await new Promise(r => setTimeout(r, 90)); // respect the 15fps throttle
    }
    console.log('[autotest] draw sweep complete');
    await g2Bridge.setStatus('Autotest complete');
    console.log('[autotest] DONE');
  } catch (err) {
    console.error('[autotest] FAILED:', err?.message ?? err);
  }
}
