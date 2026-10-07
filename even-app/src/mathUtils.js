/**
 * mathUtils.js — Sensor Fusion Engine
 *
 * Implements a Dual-IMU spatial mapping pipeline:
 *
 *   Phone Camera (2D pixel)
 *        │
 *        ▼  unproject (FOV → 3D ray in Camera Space)
 *   Camera-Space Ray
 *        │
 *        ▼  rotate by ΔPhone = phoneQuat * inv(phoneZeroQuat)
 *   World-Space Ray
 *        │
 *        ▼  rotate by inv(ΔGlasses) = inv(glassesQuat * inv(glassesZeroQuat))
 *   Head-Space Ray
 *        │
 *        ▼  perspective project onto G2 576×288 display
 *   G2 Screen Coordinate (x, y)
 *
 * Coordinate conventions used throughout:
 *   - Right-handed world space: +X right, +Y up, +Z toward viewer
 *   - Phone camera looks along -Z (into the scene)
 *   - Glasses look along -Z (in head space)
 *   - Euler input order: [pitch, yaw, roll] in degrees, ZYX extrinsic
 */

import { vec3, quat, mat4 } from 'gl-matrix';

// G2 display resolution
const G2_WIDTH  = 576;
const G2_HEIGHT = 288;

// Assumed symmetric horizontal FOV for the phone rear camera (degrees).
// 60° is a safe conservative default; wide-angle lenses are typically 65–70°.
const CAMERA_HFOV_DEG = 65.0;

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;

/**
 * Convert Euler angles (degrees, ZYX extrinsic = Yaw→Pitch→Roll) to a unit
 * quaternion.
 *
 * gl-matrix's quat.fromEuler applies intrinsic XYZ rotations internally, which
 * is equivalent to extrinsic ZYX (standard aviation/DeviceOrientation order).
 *
 * @param {number} pitchDeg  – rotation around X axis
 * @param {number} yawDeg    – rotation around Y axis
 * @param {number} rollDeg   – rotation around Z axis
 * @returns {quat} unit quaternion
 */
function eulerToQuat(pitchDeg, yawDeg, rollDeg) {
  // quat.fromEuler(out, x, y, z) expects degrees and uses ZYX decomposition
  const q = quat.create();
  quat.fromEuler(q, pitchDeg, yawDeg, rollDeg);
  return q;
}

/**
 * Compute the relative (delta) quaternion between a current orientation and a
 * stored zero/reference orientation:
 *
 *   deltaQ = currentQ * inverse(zeroQ)
 *
 * This gives "how much has the device rotated since we zeroed it?"
 *
 * @param {quat} currentQ
 * @param {quat} zeroQ
 * @returns {quat} delta quaternion
 */
function relativeQuat(currentQ, zeroQ) {
  const invZero = quat.create();
  quat.invert(invZero, zeroQ);           // inv(zeroQ)

  const delta = quat.create();
  quat.multiply(delta, currentQ, invZero); // currentQ * inv(zeroQ)
  quat.normalize(delta, delta);
  return delta;
}

/**
 * Apply a quaternion rotation to a vec3.
 *
 * @param {vec3} v   input vector
 * @param {quat} q   rotation quaternion
 * @returns {vec3}   rotated vector (new allocation)
 */
function rotateVec3(v, q) {
  const out = vec3.create();
  vec3.transformQuat(out, v, q);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SpatialMapper class
// ─────────────────────────────────────────────────────────────────────────────

export class SpatialMapper {
  constructor() {
    // ── Reference frames (set when user presses "Sync Origin") ──────────────
    /** @type {quat} Phone orientation when the user zeroed (identity = not set) */
    this.phoneZeroQuat   = quat.create(); // identity

    /** @type {quat} Glasses orientation when the user zeroed */
    this.glassesZeroQuat = quat.create(); // identity

    // ── Live readings (updated every frame from sensor callbacks) ────────────
    /** @type {quat} Most recent phone orientation */
    this.currentPhoneQuat   = quat.create();

    /** @type {quat} Most recent glasses orientation */
    this.currentGlassesQuat = quat.create();

    /** @type {boolean} Whether syncOrigin has been called at least once */
    this.originSynced = false;

    // Pre-computed HFOV tan value cached on first use
    this._tanHalfHFov = Math.tan((CAMERA_HFOV_DEG / 2) * DEG_TO_RAD);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: update live sensor readings
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Update the phone's current orientation from raw Euler angles (degrees).
   *
   * DeviceOrientationEvent uses:
   *   alpha = yaw (compass heading, 0–360)
   *   beta  = pitch (front-to-back tilt, –180..180)
   *   gamma = roll (left-to-right tilt, –90..90)
   *
   * @param {number} pitchDeg
   * @param {number} yawDeg
   * @param {number} rollDeg
   */
  updatePhoneOrientation(pitchDeg, yawDeg, rollDeg) {
    this.currentPhoneQuat = eulerToQuat(pitchDeg, yawDeg, rollDeg);
  }

  /**
   * Update the glasses' current orientation from the G2 IMU_Report_Data.
   * The G2 reports raw accelerometer/gyro as x/y/z.  The firmware docs treat
   * them as Euler rates integrated into pitch/yaw/roll angles in degrees.
   *
   * @param {number} pitchDeg  – IMU_Report_Data.x  (forward tilt)
   * @param {number} yawDeg    – IMU_Report_Data.y  (horizontal sweep)
   * @param {number} rollDeg   – IMU_Report_Data.z  (lateral tilt)
   */
  updateGlassesOrientation(pitchDeg, yawDeg, rollDeg) {
    this.currentGlassesQuat = eulerToQuat(pitchDeg, yawDeg, rollDeg);
  }

  /**
   * Update the phone orientation directly from a unit quaternion (x, y, z, w).
   * Preferred over Euler when the source is Android's rotation-vector sensor
   * (published on the phone bridge) — no gimbal lock, no convention ambiguity.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} w
   */
  updatePhoneQuat(x, y, z, w) {
    quat.set(this.currentPhoneQuat, x, y, z, w);
    quat.normalize(this.currentPhoneQuat, this.currentPhoneQuat);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: set the reference frame
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Capture the current phone AND glasses orientations as the "zero" reference
   * frames.  After this call, all subsequent projections are relative to these
   * captured frames.
   *
   * Call this when the user presses "Sync Origin" while:
   *   – looking straight ahead (glasses)
   *   – pointing the phone camera straight at the scene forward vector
   *
   * @param {{ pitch, yaw, roll }} phoneEuler   current phone Euler (degrees)
   * @param {{ pitch, yaw, roll }} glassesEuler  current glasses Euler (degrees)
   */
  syncOrigin(phoneEuler, glassesEuler) {
    this.phoneZeroQuat = eulerToQuat(
      phoneEuler.pitch,
      phoneEuler.yaw,
      phoneEuler.roll,
    );
    this.glassesZeroQuat = eulerToQuat(
      glassesEuler.pitch,
      glassesEuler.yaw,
      glassesEuler.roll,
    );

    // Also freeze the "current" readings to the same values so delta = identity
    quat.copy(this.currentPhoneQuat,   this.phoneZeroQuat);
    quat.copy(this.currentGlassesQuat, this.glassesZeroQuat);

    this.originSynced = true;
    console.log('[SpatialMapper] Origin synced', {
      phone:   Array.from(this.phoneZeroQuat).map(v => v.toFixed(4)),
      glasses: Array.from(this.glassesZeroQuat).map(v => v.toFixed(4)),
    });
  }

  /**
   * Freeze the CURRENT phone + glasses orientations as the zero reference.
   * Used by the bridge flow: orientations stream in live (updatePhoneQuat +
   * updateGlassesOrientation), then this captures them as the anchor the
   * moment Android bumps calEpoch (calibration complete).
   */
  syncOriginFromCurrent() {
    quat.copy(this.phoneZeroQuat,   this.currentPhoneQuat);
    quat.copy(this.glassesZeroQuat, this.currentGlassesQuat);
    this.originSynced = true;
    console.log('[SpatialMapper] Origin synced from current', this.getDebugState());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: the core projection
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Map a 2D finger position from the phone camera into the G2 glasses display
   * coordinate space, compensating for both devices' rotations relative to their
   * zeroed reference frames.
   *
   * Pipeline:
   *   1. Unproject (cameraX, cameraY) → 3D ray in Camera Space
   *   2. Rotate ray by ΔPhone → World Space
   *   3. Rotate ray by inv(ΔGlasses) → Head Space
   *   4. Perspective-project Head Space ray → G2 pixel (x, y)
   *
   * @param {number} cameraX  – finger X pixel (0 = left edge)
   * @param {number} cameraY  – finger Y pixel (0 = top edge)
   * @param {number} camWidth – camera feed pixel width
   * @param {number} camHeight – camera feed pixel height
   * @returns {{ x: number, y: number }} clamped G2 display coordinates
   */
  mapFingerToGlasses(cameraX, cameraY, camWidth, camHeight) {
    // ── Step 1: Unproject 2D pixel → 3D Camera-Space ray ──────────────────
    //
    // We model a pinhole camera with a symmetric FOV.  The image plane is at
    // z = –1 (camera looks along –Z in right-handed space).
    //
    // Normalized Device Coordinates: NDC ∈ [–1, +1]
    //   ndcX = (pixel_x / width  – 0.5) * 2
    //   ndcY = (0.5 – pixel_y / height) * 2   ← flip Y so +Y is up
    //
    // Camera-space X and Y are scaled by the half-FOV tangent.
    // The vertical FOV is derived from HFOV assuming square pixels:
    //   tanHalfVFov = tanHalfHFov * (height / width)

    const ndcX = (cameraX / camWidth  - 0.5) * 2.0;
    const ndcY = (0.5 - cameraY / camHeight) * 2.0;   // flip Y

    const aspectRatio = camWidth / camHeight;
    const tanHalfHFov = this._tanHalfHFov;
    const tanHalfVFov = tanHalfHFov / aspectRatio;

    // Camera-space ray direction (unnormalized; z = –1 forward)
    const rayCamera = vec3.fromValues(
      ndcX * tanHalfHFov,   // camera X
      ndcY * tanHalfVFov,   // camera Y
      -1.0,                 // looking into the scene
    );
    vec3.normalize(rayCamera, rayCamera);

    // ── Step 2: Phone delta rotation → World Space ─────────────────────────
    //
    // ΔPhone = currentPhoneQuat * inv(phoneZeroQuat)
    //
    // Rotating the camera ray by ΔPhone transforms it from Camera Space into
    // World Space as if we're accounting for how much the phone has moved
    // since the zero moment.

    const deltaPhone = relativeQuat(this.currentPhoneQuat, this.phoneZeroQuat);
    const rayWorld   = rotateVec3(rayCamera, deltaPhone);

    // ── Step 3: Glasses delta rotation → Head Space ────────────────────────
    //
    // ΔGlasses = currentGlassesQuat * inv(glassesZeroQuat)
    //
    // To express the World ray *in the glasses' current frame*, we rotate by
    // the INVERSE of ΔGlasses.  Think of it as: "un-rotate the world ray by
    // the amount the head has turned."
    //
    //   inv(ΔGlasses) = inv(currentGlassesQuat * inv(glassesZeroQuat))
    //                 = glassesZeroQuat * inv(currentGlassesQuat)

    const deltaGlasses    = relativeQuat(this.currentGlassesQuat, this.glassesZeroQuat);
    const invDeltaGlasses = quat.create();
    quat.invert(invDeltaGlasses, deltaGlasses);
    quat.normalize(invDeltaGlasses, invDeltaGlasses);

    const rayHead = rotateVec3(rayWorld, invDeltaGlasses);

    // ── Step 4: Perspective projection → G2 screen pixels ─────────────────
    //
    // The G2 display shows the world as seen from the head along –Z.
    // We use a simple pinhole projection:
    //
    //   screenX_ndc = ray.x / –ray.z     (perspective divide)
    //   screenY_ndc = ray.y / –ray.z
    //
    // Then map NDC [–1..+1] → pixel [0..G2_WIDTH] / [0..G2_HEIGHT].
    // We keep the same HFOV for the glasses as we used for the camera, which
    // means "what you pointed at stays where you look."

    if (rayHead[2] >= 0) {
      // Ray points behind the glasses — clamp to screen edge rather than
      // returning a wild coordinate.
      return { x: G2_WIDTH / 2, y: G2_HEIGHT / 2 };
    }

    const invZ = 1.0 / (-rayHead[2]); // –Z is forward; depth must be > 0

    // Projected NDC using the same FOV tangents
    const projNdcX = rayHead[0] * invZ / tanHalfHFov;
    const projNdcY = rayHead[1] * invZ / tanHalfVFov;

    // Map NDC [–1..+1] → G2 pixel coordinates
    // +Y in NDC = up on screen = small pixel Y (top of display)
    const glassesX = ( projNdcX + 1.0) * 0.5 * G2_WIDTH;
    const glassesY = (1.0 - projNdcY) * 0.5 * G2_HEIGHT;

    // Clamp to display bounds
    return {
      x: Math.max(0, Math.min(G2_WIDTH  - 1, Math.round(glassesX))),
      y: Math.max(0, Math.min(G2_HEIGHT - 1, Math.round(glassesY))),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Debug helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Return a plain-object snapshot of all internal state for display in the UI.
   */
  getDebugState() {
    const fmtQ = q => Array.from(q).map(v => v.toFixed(3)).join(', ');
    return {
      originSynced:       this.originSynced,
      phoneZeroQuat:      fmtQ(this.phoneZeroQuat),
      glassesZeroQuat:    fmtQ(this.glassesZeroQuat),
      currentPhoneQuat:   fmtQ(this.currentPhoneQuat),
      currentGlassesQuat: fmtQ(this.currentGlassesQuat),
    };
  }
}
