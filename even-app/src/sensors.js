/**
 * sensors.js — Hardware Abstraction Layer
 *
 * Manages two independent orientation data streams:
 *
 *   1. Phone IMU  — DeviceOrientationEvent (Web API)
 *      • Handles iOS 13+ permission request (requires user gesture)
 *      • Normalises the three Euler angles to a consistent { pitch, yaw, roll }
 *        object in degrees
 *
 *   2. Glasses IMU — Even Realities G2 via EvenAppBridge
 *      • Enables IMU reporting at the highest available rate (P100 = 10 Hz)
 *      • Parses Sys_ItemEvent → IMU_Report_Data → { pitch, yaw, roll }
 *      • Provides a safe fallback if the payload format changes
 *
 * Both sensors publish their last reading via getters so the main render loop
 * can sample them synchronously at any time.
 */

import {
  EvenAppBridge,
  OsEventTypeList,
  ImuReportPace,
  IMU_Report_Data,
} from '@evenrealities/even_hub_sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Phone IMU (DeviceOrientationEvent)
// ─────────────────────────────────────────────────────────────────────────────

export class PhoneSensor {
  constructor() {
    /** @type {{ pitch: number, yaw: number, roll: number } | null} */
    this._euler = null;

    /** @type {boolean} Whether we are currently receiving events */
    this._active = false;

    this._handler = this._onDeviceOrientation.bind(this);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Request permission (iOS) and begin listening.
   *
   * On Android and desktop browsers, the DeviceOrientationEvent fires
   * without any permission gate.  On iOS 13+ we must call
   * DeviceOrientationEvent.requestPermission() inside a user-gesture handler.
   *
   * @returns {Promise<boolean>}  true = started successfully
   */
  async start() {
    if (this._active) return true;

    // iOS 13+ gate
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      let permission;
      try {
        permission = await DeviceOrientationEvent.requestPermission();
      } catch (err) {
        console.error('[PhoneSensor] iOS permission request threw:', err);
        return false;
      }
      if (permission !== 'granted') {
        console.warn('[PhoneSensor] iOS permission denied');
        return false;
      }
    }

    window.addEventListener('deviceorientation', this._handler, { passive: true });
    this._active = true;
    console.log('[PhoneSensor] Started');
    return true;
  }

  /** Stop listening and release resources. */
  stop() {
    if (!this._active) return;
    window.removeEventListener('deviceorientation', this._handler);
    this._active = false;
  }

  /**
   * Latest normalised Euler angles in degrees.
   * Returns null before the first event arrives.
   *
   * Euler convention (matching gl-matrix quat.fromEuler):
   *   pitch = beta  – forward/backward tilt of the phone  (–180..+180)
   *   yaw   = alpha – compass heading, 0 = geographic north (0..360)
   *   roll  = gamma – left/right tilt                       (–90..+90)
   *
   * @returns {{ pitch: number, yaw: number, roll: number } | null}
   */
  get euler() {
    return this._euler;
  }

  get active() {
    return this._active;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** @param {DeviceOrientationEvent} event */
  _onDeviceOrientation(event) {
    // DeviceOrientationEvent fields:
    //   alpha – yaw   (0–360, clockwise from north or arbitrary heading)
    //   beta  – pitch (–180..+180, front-up = positive)
    //   gamma – roll  (–90..+90,  right-up = positive)
    //
    // All three can be null when the browser lacks sensor access.
    const alpha = event.alpha ?? 0;
    const beta  = event.beta  ?? 0;
    const gamma = event.gamma ?? 0;

    this._euler = {
      pitch: beta,    // X-axis rotation
      yaw:   alpha,   // Y-axis rotation
      roll:  gamma,   // Z-axis rotation
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Glasses IMU (G2 via EvenAppBridge)
// ─────────────────────────────────────────────────────────────────────────────

export class GlassesSensor {
  /**
   * @param {import('@evenrealities/even_hub_sdk').EvenAppBridge} bridge
   *   Pre-initialised bridge instance from g2Bridge.js.  We accept it as a
   *   dependency rather than calling getInstance() here so that modules do not
   *   race to create the singleton.
   */
  constructor(bridge) {
    this._bridge = bridge;

    /** @type {{ pitch: number, yaw: number, roll: number } | null} */
    this._euler = null;

    /** @type {boolean} */
    this._active = false;

    /** @type {(() => void) | null}  SDK unsubscribe function */
    this._unsubscribe = null;

    /** Running count of received IMU events (for diagnostics) */
    this._eventCount = 0;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Enable G2 IMU reporting and subscribe to the event stream.
   *
   * The SDK call `imuControl(true, ImuReportPace.P100)` tells the firmware to
   * emit IMU_DATA_REPORT events at ~100 ms intervals (10 Hz).  The event
   * arrives on the EvenHubEvent stream as:
   *
   *   event.sysEvent.eventType === OsEventTypeList.IMU_DATA_REPORT
   *   event.sysEvent.imuData   → IMU_Report_Data { x, y, z }
   *
   * @returns {Promise<boolean>}
   */
  async start() {
    if (this._active) return true;

    // Ask the firmware to start IMU streaming at 100 ms cadence
    let ok = false;
    try {
      ok = await this._bridge.imuControl(true, ImuReportPace.P100);
    } catch (err) {
      console.error('[GlassesSensor] imuControl failed:', err);
      return false;
    }

    if (!ok) {
      console.warn('[GlassesSensor] imuControl returned false — IMU may still arrive');
    }

    // Subscribe to the EvenHub event stream
    this._unsubscribe = this._bridge.onEvenHubEvent((event) => {
      this._handleEvent(event);
    });

    this._active = true;
    console.log('[GlassesSensor] IMU streaming started');
    return true;
  }

  /** Disable IMU reporting and unsubscribe. */
  async stop() {
    if (!this._active) return;

    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    try {
      await this._bridge.imuControl(false);
    } catch (_) { /* best-effort */ }

    this._active = false;
  }

  /**
   * Latest Euler angles from the glasses IMU (degrees).
   * Returns null before the first event arrives.
   *
   * G2 IMU_Report_Data fields:
   *   x → pitch  (head nodding forward/backward)
   *   y → yaw    (head turning left/right)
   *   z → roll   (head tilting sideways)
   *
   * @returns {{ pitch: number, yaw: number, roll: number } | null}
   */
  get euler() {
    return this._euler;
  }

  get active() {
    return this._active;
  }

  get eventCount() {
    return this._eventCount;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * @param {import('@evenrealities/even_hub_sdk').EvenHubEvent} event
   */
  _handleEvent(event) {
    // The IMU payload lives inside a sysEvent
    const sys = event?.sysEvent;
    if (!sys) return;

    // Gate on the specific event type
    if (sys.eventType !== OsEventTypeList.IMU_DATA_REPORT) return;

    // Parse the IMU data — SDK provides a typed class but the raw JSON may
    // arrive in different key casings, so we use the safe fromJson helper as
    // a belt-and-braces measure.
    let imuData = sys.imuData;
    if (!imuData) {
      // Fallback: try re-parsing if the SDK's auto-parse missed it
      try {
        imuData = IMU_Report_Data.fromJson(sys);
      } catch (_) {
        console.warn('[GlassesSensor] Could not parse IMU_Report_Data:', sys);
        return;
      }
    }

    // Safely extract numeric fields with fallback to 0
    const pitch = this._safeNum(imuData.x);   // x = pitch
    const yaw   = this._safeNum(imuData.y);   // y = yaw
    const roll  = this._safeNum(imuData.z);   // z = roll

    this._euler = { pitch, yaw, roll };
    this._eventCount++;
  }

  /**
   * Coerce a value to a finite number, returning 0 as fallback.
   * @param {unknown} v
   * @returns {number}
   */
  _safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
}
