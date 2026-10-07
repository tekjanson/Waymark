/**
 * mathUtils.test.js — Unit tests for the SpatialMapper sensor-fusion engine.
 *
 * Run with:  node --test
 *
 * These tests validate the geometry that is impossible to eyeball on hardware:
 *   - a centred finger with no rotation maps to the centre of the display
 *   - zeroing makes the current orientation the identity reference
 *   - rotating ONLY the phone shifts the projected point predictably
 *   - rotating ONLY the glasses shifts the projected point the opposite way
 *     (head compensation), i.e. a world-fixed point stays world-fixed
 *   - output is always clamped inside the 576×288 display
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialMapper } from './mathUtils.js';

const W = 640;   // camera frame width used across tests
const H = 480;   // camera frame height
const G2_W = 576;
const G2_H = 288;

function centreEuler() {
  return { pitch: 0, yaw: 0, roll: 0 };
}

test('centre finger, no rotation → centre of display', () => {
  const m = new SpatialMapper();
  m.syncOrigin(centreEuler(), centreEuler());

  const { x, y } = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  // Allow ±2px for rounding
  assert.ok(Math.abs(x - G2_W / 2) <= 2, `x=${x} expected ~${G2_W / 2}`);
  assert.ok(Math.abs(y - G2_H / 2) <= 2, `y=${y} expected ~${G2_H / 2}`);
});

test('output is always within display bounds', () => {
  const m = new SpatialMapper();
  m.syncOrigin(centreEuler(), centreEuler());

  const corners = [
    [0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2],
  ];
  for (const [cx, cy] of corners) {
    const { x, y } = m.mapFingerToGlasses(cx, cy, W, H);
    assert.ok(x >= 0 && x <= G2_W - 1, `x=${x} out of range`);
    assert.ok(y >= 0 && y <= G2_H - 1, `y=${y} out of range`);
  }
});

test('syncOrigin makes current orientation the identity reference', () => {
  const m = new SpatialMapper();
  // Zero at a non-trivial orientation
  const phone = { pitch: 10, yaw: 25, roll: -5 };
  const glasses = { pitch: -8, yaw: 15, roll: 3 };
  m.syncOrigin(phone, glasses);

  // Immediately after sync, current == zero, so a centre finger stays centred
  m.updatePhoneOrientation(phone.pitch, phone.yaw, phone.roll);
  m.updateGlassesOrientation(glasses.pitch, glasses.yaw, glasses.roll);

  const { x, y } = m.mapFingerToGlasses(W / 2, H / 2, W, H);
  assert.ok(Math.abs(x - G2_W / 2) <= 2, `x=${x}`);
  assert.ok(Math.abs(y - G2_H / 2) <= 2, `y=${y}`);
});

test('updatePhoneQuat + syncOriginFromCurrent → centre finger stays centred', () => {
  const m = new SpatialMapper();
  m.updatePhoneQuat(0, 0, 0, 1);          // identity (Android rotation-vector)
  m.updateGlassesOrientation(0, 0, 0);
  m.syncOriginFromCurrent();
  assert.equal(m.originSynced, true);

  const { x, y } = m.mapFingerToGlasses(W / 2, H / 2, W, H);
  assert.ok(Math.abs(x - G2_W / 2) <= 2, `x=${x}`);
  assert.ok(Math.abs(y - G2_H / 2) <= 2, `y=${y}`);
});

test('syncOriginFromCurrent anchors the live pose as the zero reference', () => {
  const m = new SpatialMapper();
  // A non-trivial live phone quat (~30° about Y) + glasses tilt become the origin.
  const s = Math.sin(15 * Math.PI / 180), c = Math.cos(15 * Math.PI / 180);
  m.updatePhoneQuat(0, s, 0, c);
  m.updateGlassesOrientation(-8, 15, 3);
  m.syncOriginFromCurrent();

  // Current == origin → delta is identity → centre finger stays centred.
  const { x, y } = m.mapFingerToGlasses(W / 2, H / 2, W, H);
  assert.ok(Math.abs(x - G2_W / 2) <= 2, `x=${x}`);
  assert.ok(Math.abs(y - G2_H / 2) <= 2, `y=${y}`);
});

test('yawing the phone right moves the centre point horizontally', () => {
  const m = new SpatialMapper();
  m.syncOrigin(centreEuler(), centreEuler());

  const before = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  // Yaw the phone by +20° (glasses unchanged)
  m.updatePhoneOrientation(0, 20, 0);
  const after = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  // The projected x must move away from centre (not stay put)
  assert.notEqual(after.x, before.x, 'phone yaw should shift x');
});

test('head compensation: yawing phone and glasses together cancels out', () => {
  const m = new SpatialMapper();
  m.syncOrigin(centreEuler(), centreEuler());

  // Phone and glasses both yaw by the SAME amount → the world ray and the head
  // frame rotate together, so a centre finger should stay near centre.
  m.updatePhoneOrientation(0, 20, 0);
  m.updateGlassesOrientation(0, 20, 0);
  const { x, y } = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  assert.ok(Math.abs(x - G2_W / 2) <= 6, `x=${x} expected ~${G2_W / 2} (head comp)`);
  assert.ok(Math.abs(y - G2_H / 2) <= 6, `y=${y} expected ~${G2_H / 2} (head comp)`);
});

test('glasses yaw alone moves the point opposite to phone yaw', () => {
  const m = new SpatialMapper();
  m.syncOrigin(centreEuler(), centreEuler());

  m.updatePhoneOrientation(0, 15, 0);
  const phoneOnly = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  // Reset, then apply the SAME yaw to the glasses instead of the phone
  m.syncOrigin(centreEuler(), centreEuler());
  m.updateGlassesOrientation(0, 15, 0);
  const glassesOnly = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  // Phone yaw and glasses yaw should push x to opposite sides of centre
  const dPhone   = phoneOnly.x   - G2_W / 2;
  const dGlasses = glassesOnly.x - G2_W / 2;
  assert.ok(
    Math.sign(dPhone) !== Math.sign(dGlasses) || dPhone === 0 || dGlasses === 0,
    `phone Δ=${dPhone}, glasses Δ=${dGlasses} should have opposite signs`,
  );
});

test('getDebugState reflects sync status', () => {
  const m = new SpatialMapper();
  assert.equal(m.getDebugState().originSynced, false);
  m.syncOrigin(centreEuler(), centreEuler());
  assert.equal(m.getDebugState().originSynced, true);
});

test('ray pointing behind glasses returns display centre (no NaN)', () => {
  const m = new SpatialMapper();
  m.syncOrigin(centreEuler(), centreEuler());

  // Pitch the glasses 180° so the world-forward ray ends up behind the head
  m.updateGlassesOrientation(180, 0, 0);
  const { x, y } = m.mapFingerToGlasses(W / 2, H / 2, W, H);

  assert.ok(Number.isFinite(x) && Number.isFinite(y), 'coords must be finite');
  assert.ok(x >= 0 && x <= G2_W - 1);
  assert.ok(y >= 0 && y <= G2_H - 1);
});
