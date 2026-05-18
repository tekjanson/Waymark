/**
 * @module particles
 *
 * Self-contained particle systems for the Waymark Code City 3D scene.
 *
 *   RainSystem    — full-city ambient rain using InstancedMesh for performance
 *   SteamEmitter  — per-building steam cloud (active during COMPILING / RETRYING)
 *   SootBurst     — one-shot particle burst for RETRYING state (crimson soot)
 *   FireworkBurst — one-shot signal-flare firework for SUCCESS / DONE_IN_REVIEW
 */

import * as THREE from 'three';

// ── RainSystem ────────────────────────────────────────────────────────────────

const RAIN_COUNT   = 2400;
const RAIN_SPREAD  = 90;    // horizontal spread across city
const RAIN_HEIGHT  = 40;    // height range for rain droplets
const RAIN_SPEED   = 22;    // units per second (downward)
const RAIN_TILT_X  = 0.06; // subtle wind tilt
const RAIN_TILT_Z  = 0.02;

export class RainSystem {
  /** @type {THREE.Points} */ mesh;
  #positions;
  #velocities;

  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(RAIN_COUNT * 3);
    const vel = new Float32Array(RAIN_COUNT);  // per-drop speed multiplier

    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * RAIN_SPREAD;
      pos[i * 3 + 1] = Math.random() * RAIN_HEIGHT - 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_SPREAD;
      vel[i]         = 0.7 + Math.random() * 0.6;  // speed variance
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.#positions  = pos;
    this.#velocities = vel;

    const mat = new THREE.PointsMaterial({
      color:       0x99ccee,
      size:        0.08,
      transparent: true,
      opacity:     0.35,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  tick(dt) {
    const pos = this.#positions;
    const vel = this.#velocities;
    const dY  = RAIN_SPEED * dt;

    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3 + 0] += RAIN_TILT_X * dY * vel[i];
      pos[i * 3 + 1] -= dY * vel[i];
      pos[i * 3 + 2] += RAIN_TILT_Z * dY * vel[i];

      // Wrap to top when below ground
      if (pos[i * 3 + 1] < -5) {
        pos[i * 3 + 0] = (Math.random() - 0.5) * RAIN_SPREAD;
        pos[i * 3 + 1] = RAIN_HEIGHT;
        pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_SPREAD;
      }
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

// ── SteamEmitter ──────────────────────────────────────────────────────────────
// Attaches to a building group and emits steam upward from chimneys.

const STEAM_COUNT  = 60;
const STEAM_SPEED  = 3.2;
const STEAM_LIFE   = 1.8;   // seconds before particle resets

export class SteamEmitter {
  /** @type {THREE.Points} */ mesh;
  #positions;
  #lifetimes;
  #velocities;
  /** Origin in parent-local space */
  #originY;

  /**
   * @param {THREE.Object3D} parent   Building group to attach to.
   * @param {number} originY          Y level (top of chimney).
   * @param {'steam'|'soot'} kind
   */
  constructor(parent, originY, kind = 'steam') {
    this.#originY = originY;
    const geo     = new THREE.BufferGeometry();
    const pos     = new Float32Array(STEAM_COUNT * 3);
    const life    = new Float32Array(STEAM_COUNT);
    const vx      = new Float32Array(STEAM_COUNT);
    const vz      = new Float32Array(STEAM_COUNT);

    for (let i = 0; i < STEAM_COUNT; i++) {
      this.#reset(pos, life, vx, vz, i, true);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const color   = kind === 'soot' ? 0x111111 : 0xaaaacc;
    const opacity = kind === 'soot' ? 0.6 : 0.25;
    const mat     = new THREE.PointsMaterial({
      color,
      size:        kind === 'soot' ? 0.35 : 0.55,
      transparent: true,
      opacity,
      depthWrite:  false,
      blending:    kind === 'soot' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    this.#positions  = pos;
    this.#lifetimes  = life;
    this.#velocities = { vx, vz };
  }

  tick(dt) {
    const pos  = this.#positions;
    const life = this.#lifetimes;
    const { vx, vz } = this.#velocities;

    for (let i = 0; i < STEAM_COUNT; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        this.#reset(pos, life, vx, vz, i, false);
        continue;
      }
      pos[i * 3 + 0] += vx[i] * dt;
      pos[i * 3 + 1] += STEAM_SPEED * dt;
      pos[i * 3 + 2] += vz[i] * dt;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }

  #reset(pos, life, vx, vz, i, scatter) {
    pos[i * 3 + 0] = (Math.random() - 0.5) * 1.4;
    pos[i * 3 + 1] = scatter ? Math.random() * STEAM_LIFE * STEAM_SPEED : this.#originY;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    life[i]        = Math.random() * STEAM_LIFE;
    vx[i]          = (Math.random() - 0.5) * 0.8;
    vz[i]          = (Math.random() - 0.5) * 0.8;
  }
}

// ── SootBurst ─────────────────────────────────────────────────────────────────
// One-shot crimson burst of soot particles for RETRYING.

const SOOT_COUNT = 120;

export class SootBurst {
  /** @type {THREE.Points} */ mesh;
  #positions;
  #velocities;
  #elapsed = 0;
  static DURATION = 0.9;   // seconds

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} worldPos  World position of the building top.
   */
  constructor(scene, worldPos) {
    const geo  = new THREE.BufferGeometry();
    const pos  = new Float32Array(SOOT_COUNT * 3);
    const vel  = new Float32Array(SOOT_COUNT * 3);

    for (let i = 0; i < SOOT_COUNT; i++) {
      pos[i * 3]     = worldPos.x;
      pos[i * 3 + 1] = worldPos.y;
      pos[i * 3 + 2] = worldPos.z;

      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI;
      const speed = 2 + Math.random() * 5;
      vel[i * 3]     = Math.sin(phi) * Math.cos(theta) * speed;
      vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * speed * 1.5 + 1;
      vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color:       0xff1122,
      size:        0.28,
      transparent: true,
      opacity:     0.9,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    this.mesh       = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.#positions = pos;
    this.#velocities = vel;
  }

  /** @returns {boolean} true while still alive */
  tick(dt) {
    this.#elapsed += dt;
    const t    = this.#elapsed / SootBurst.DURATION;
    const pos  = this.#positions;
    const vel  = this.#velocities;
    const GRAV = -6;

    for (let i = 0; i < SOOT_COUNT; i++) {
      pos[i * 3]     += vel[i * 3]     * dt;
      pos[i * 3 + 1] += (vel[i * 3 + 1] + GRAV * this.#elapsed) * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
    return this.#elapsed < SootBurst.DURATION;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}

// ── FireworkBurst ─────────────────────────────────────────────────────────────
// Ascending signal-flare arc + starburst shell for SUCCESS state.

const FIREWORK_COUNT  = 280;
const FIREWORK_RISE   = 0.35;  // fraction of duration spent rising
const FIREWORK_DUR    = 2.2;   // total seconds

export class FireworkBurst {
  /** @type {THREE.Points} */ mesh;
  #positions;
  #velocities;
  #elapsed     = 0;
  #exploded    = false;
  #riseOrigin;
  #peakPos;

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} origin   Launch position (top of building).
   */
  constructor(scene, origin) {
    this.#riseOrigin = origin.clone();
    this.#peakPos    = origin.clone().add(new THREE.Vector3(0, 16 + Math.random() * 8, 0));

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(FIREWORK_COUNT * 3);
    const vel = new Float32Array(FIREWORK_COUNT * 3);

    // Start all particles at origin (they spread on explosion)
    for (let i = 0; i < FIREWORK_COUNT; i++) {
      pos[i * 3]     = origin.x;
      pos[i * 3 + 1] = origin.y;
      pos[i * 3 + 2] = origin.z;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color:       0x00ff88,
      size:        0.25,
      transparent: true,
      opacity:     1,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      vertexColors: false,
    });

    this.mesh      = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.#positions  = pos;
    this.#velocities = vel;
  }

  /** @returns {boolean} true while still alive */
  tick(dt) {
    this.#elapsed += dt;
    const t    = this.#elapsed / FIREWORK_DUR;
    const pos  = this.#positions;
    const vel  = this.#velocities;

    if (!this.#exploded && this.#elapsed >= FIREWORK_DUR * FIREWORK_RISE) {
      // Explosion — assign random outward velocities
      const peak = this.#peakPos;
      for (let i = 0; i < FIREWORK_COUNT; i++) {
        pos[i * 3]     = peak.x;
        pos[i * 3 + 1] = peak.y;
        pos[i * 3 + 2] = peak.z;

        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        const speed = 2 + Math.random() * 7;
        vel[i * 3]     = Math.sin(phi) * Math.cos(theta) * speed;
        vel[i * 3 + 1] = Math.cos(phi) * speed;
        vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
      }
      this.#exploded = true;
      // Cycle colour through green → white
      this.mesh.material.color.set(0xffffff);
    }

    if (!this.#exploded) {
      // Rising phase — all particles move together as a single flare
      const riseT = this.#elapsed / (FIREWORK_DUR * FIREWORK_RISE);
      const cur   = this.#riseOrigin.clone().lerp(this.#peakPos, riseT);
      for (let i = 0; i < FIREWORK_COUNT; i++) {
        pos[i * 3]     = cur.x + (Math.random() - 0.5) * 0.15;
        pos[i * 3 + 1] = cur.y;
        pos[i * 3 + 2] = cur.z + (Math.random() - 0.5) * 0.15;
      }
    } else {
      // Explosion phase — gravity + drift
      const GRAV = -5;
      const tExp = this.#elapsed - FIREWORK_DUR * FIREWORK_RISE;
      for (let i = 0; i < FIREWORK_COUNT; i++) {
        pos[i * 3]     += vel[i * 3]     * dt;
        pos[i * 3 + 1] += (vel[i * 3 + 1] + GRAV * tExp) * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
    }

    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.material.opacity = Math.max(0, 1 - Math.pow(t, 1.5));
    return this.#elapsed < FIREWORK_DUR;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
