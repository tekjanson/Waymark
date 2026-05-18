/**
 * @module hud
 *
 * HudPanel — right-side telemetry panel driven by building selection.
 * HologramMarker — Three.js sprite displayed above a building in AWAITING_QA state.
 */

import * as THREE from 'three';

// ── HudPanel ─────────────────────────────────────────────────────────────────

export class HudPanel {
  /** @type {HTMLElement} */ #panel;
  /** @type {HTMLElement} */ #title;
  /** @type {HTMLElement} */ #path;
  /** @type {HTMLElement} */ #loc;
  /** @type {HTMLElement} */ #safety;
  /** @type {HTMLElement} */ #gaugeFill;
  /** @type {HTMLElement} */ #status;
  /** @type {HTMLElement} */ #tests;
  /** @type {HTMLElement} */ #edgeCases;
  /** @type {HTMLElement} */ #log;
  /** @type {HTMLButtonElement} */ #engageBtn;

  /** Currently selected jobId */
  #currentJobId = null;
  /** Callback: approve(jobId) */
  #onApprove = null;

  constructor({ onApprove } = {}) {
    this.#panel     = document.getElementById('hud-panel');
    this.#title     = document.getElementById('hud-title');
    this.#path      = document.getElementById('hud-path');
    this.#loc       = document.getElementById('hud-loc');
    this.#safety    = document.getElementById('hud-safety');
    this.#gaugeFill = document.getElementById('hud-gauge-fill');
    this.#status    = document.getElementById('hud-status');
    this.#tests     = document.getElementById('hud-tests');
    this.#edgeCases = document.getElementById('hud-edge-cases');
    this.#log       = document.getElementById('hud-log');
    this.#engageBtn = document.getElementById('engage-btn');
    this.#onApprove = onApprove ?? null;

    document.getElementById('hud-close').addEventListener('click', () => this.hide());

    this.#engageBtn.addEventListener('click', () => {
      if (!this.#currentJobId) return;
      this.#engageBtn.disabled = true;
      this.#engageBtn.textContent = '⚙ Engaging…';
      this.#onApprove?.(this.#currentJobId);
    });
  }

  /** Show panel for a given building data object */
  show(data) {
    this.#currentJobId = data.jobId;

    const shortPath = data.filePath
      ? data.filePath.replace(/^.*\/([^/]+\/[^/]+)$/, '$1')
      : data.jobId;

    this.#title.textContent     = shortPath;
    this.#path.textContent      = data.filePath  ?? data.jobId;
    this.#path.title            = data.filePath  ?? '';
    this.#loc.textContent       = data.loc != null ? `${data.loc} lines` : '—';
    this.#tests.textContent     = data.totalTests != null ? `${data.totalTests}` : '—';

    this.#updateStatus(data.state, data.safetyScore);
    this.#updateEdgeCases(data.criticalEdgeCases);
    this.#updateLog('');

    // Engage button — only when AWAITING_QA
    const isWaiting = data.state === 'AWAITING_QA';
    this.#engageBtn.classList.toggle('open', isWaiting);
    this.#engageBtn.disabled    = false;
    this.#engageBtn.textContent = '⚙ Engage Compilation Lever';

    this.#panel.classList.add('open');
  }

  hide() {
    this.#panel.classList.remove('open');
    this.#currentJobId = null;
  }

  /** Called when a building's state changes so the open panel stays current. */
  update(jobId, patch) {
    if (jobId !== this.#currentJobId) return;

    if (patch.state !== undefined || patch.safetyScore !== undefined) {
      const state  = patch.state       ?? this.#status.dataset.state;
      const score  = patch.safetyScore ?? parseInt(this.#safety.dataset.raw || '0');
      this.#updateStatus(state, score);

      const isWaiting = state === 'AWAITING_QA';
      this.#engageBtn.classList.toggle('open', isWaiting);
      if (isWaiting) {
        this.#engageBtn.disabled    = false;
        this.#engageBtn.textContent = '⚙ Engage Compilation Lever';
      }
    }
    if (patch.log !== undefined)  this.#updateLog(patch.log);
    if (patch.criticalEdgeCases) this.#updateEdgeCases(patch.criticalEdgeCases);
    if (patch.totalTests != null) this.#tests.textContent = `${patch.totalTests}`;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  #updateStatus(state, score) {
    const label = this.#stateLabel(state);
    this.#status.textContent = label;
    this.#status.dataset.state = state;
    this.#status.className = `hud-value ${this.#stateClass(state)}`;

    if (score != null) {
      this.#safety.dataset.raw = score;
      this.#safety.textContent = `${score}/100`;
      this.#safety.className   = `hud-value ${score > 80 ? 'green' : score >= 40 ? 'amber' : 'red'}`;

      const pct = Math.min(100, Math.max(0, score));
      this.#gaugeFill.style.width      = `${pct}%`;
      this.#gaugeFill.style.background =
        score > 80 ? 'var(--neon-green)' :
        score >= 40 ? 'var(--neon-amber)' : 'var(--danger-red)';
    }
  }

  #updateEdgeCases(cases) {
    this.#edgeCases.innerHTML = '';
    if (!cases?.length) return;
    for (const c of cases) {
      const el = document.createElement('div');
      el.className = 'edge-item';
      el.textContent = c;
      this.#edgeCases.appendChild(el);
    }
  }

  #updateLog(text) {
    if (!text) { this.#log.textContent = ''; return; }
    this.#log.textContent = text;
    this.#log.scrollTop = this.#log.scrollHeight;
  }

  #stateLabel(state) {
    return {
      IDLE:           'IDLE',
      AWAITING_QA:    'AWAITING QA ▸ toggle to release',
      COMPILING:      'COMPILING…',
      RETRYING:       'RETRYING',
      DONE_IN_REVIEW: 'DONE — IN REVIEW',
      SUCCESS:        'DONE — IN REVIEW',
    }[state] ?? state ?? 'IDLE';
  }

  #stateClass(state) {
    return {
      IDLE:           '',
      AWAITING_QA:    'amber',
      COMPILING:      'amber',
      RETRYING:       'red',
      DONE_IN_REVIEW: 'green',
      SUCCESS:        'green',
    }[state] ?? '';
  }
}

// ── HologramMarker ────────────────────────────────────────────────────────────
// A billboard (Sprite) rendered above a building in AWAITING_QA state.

const HOLOGRAM_W = 256;
const HOLOGRAM_H = 128;

export class HologramMarker {
  /** @type {THREE.Sprite} */ sprite;
  #canvas;
  #ctx;
  #texture;

  constructor() {
    this.#canvas  = document.createElement('canvas');
    this.#canvas.width  = HOLOGRAM_W;
    this.#canvas.height = HOLOGRAM_H;
    this.#ctx     = this.#canvas.getContext('2d');
    this.#texture = new THREE.CanvasTexture(this.#canvas);

    const mat = new THREE.SpriteMaterial({
      map: this.#texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(4, 2, 1);
    this.sprite.renderOrder = 1;
  }

  /**
   * Render label text onto the canvas texture.
   * @param {{ jobId: string, totalTests: number, criticalEdgeCases: string[] }} data
   */
  draw({ jobId, totalTests, criticalEdgeCases = [] }) {
    const ctx = this.#ctx;
    const w = HOLOGRAM_W, h = HOLOGRAM_H;

    ctx.clearRect(0, 0, w, h);

    // Background panel
    ctx.fillStyle = 'rgba(0, 40, 30, 0.6)';
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    this.#roundRect(ctx, 2, 2, w - 4, h - 4, 6);
    ctx.fill();
    ctx.stroke();

    // Corner accents
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1;
    const cs = 8;
    [[4, 4], [w - 4, 4], [4, h - 4], [w - 4, h - 4]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy + (cy < h / 2 ? cs : -cs));
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + (cx < w / 2 ? cs : -cs), cy);
      ctx.stroke();
    });

    // Job name
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText(jobId.slice(0, 26), 12, 20);

    // Test count
    if (totalTests != null) {
      ctx.fillStyle = '#b8ffcc';
      ctx.font = '9px "Courier New", monospace';
      ctx.fillText(`${totalTests} tests`, 12, 34);
    }

    // Edge cases
    ctx.fillStyle = '#88ccaa';
    ctx.font = '8px "Courier New", monospace';
    const cases = criticalEdgeCases.slice(0, 3);
    cases.forEach((c, i) => {
      ctx.fillText(`▸ ${c.slice(0, 28)}`, 12, 50 + i * 14);
    });

    // AWAITING_QA badge
    ctx.fillStyle = '#ff9900';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillText('AWAITING_QA', w - 80, h - 8);

    this.#texture.needsUpdate = true;
  }

  /** Oscillate the marker vertically for a hover effect. */
  tick(t) {
    this.sprite.position.y += Math.sin(t * 2.5) * 0.003;
  }

  dispose() {
    this.#texture.dispose();
    this.sprite.material.dispose();
  }

  // ── Util ───────────────────────────────────────────────────────────────────

  #roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
