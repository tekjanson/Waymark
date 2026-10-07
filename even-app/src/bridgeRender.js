/**
 * bridgeRender.js — Phone-bridge payload → glasses render decision
 *
 * The single place that decides WHAT to draw on the glasses for a given bridge
 * payload (the JSON the Waymark Android app publishes on localhost:8787). Both
 * the live polling loop (main.js) and the visual-QC simulator drive this exact
 * function, so what the simulator verifies is what ships on the lenses.
 *
 * Payload shape (produced by PhoneBridgeStore on Android):
 *   { state, text, x, y, cx, cy, step, steps, confidence, ... }
 *     state: 'identified' | 'idle' | 'no-hand' | 'tracking' | 'calibrate' | 'off'
 *     x, y : normalized object position (0..1) when identified
 *     cx,cy: normalized calibration target (0..1) when calibrating
 */

/**
 * Render one bridge payload to the glasses via the G2Bridge.
 * @param {import('./g2Bridge.js').G2Bridge} g2
 * @param {object} payload
 * @returns {Promise<{mode:string, text:string}>} what was drawn (for tests/telemetry)
 */
export async function renderBridgePayload(g2, payload = {}) {
  const text  = String(payload.text || '').trim();
  const state = String(payload.state || '').trim();
  const nx = Number(payload.x);
  const ny = Number(payload.y);
  const hasPos = Number.isFinite(nx) && Number.isFinite(ny);
  const identified = state === 'identified';

  // Guided calibration: draw the target reticle the user must point at.
  if (state === 'calibrate') {
    const cx = Number(payload.cx);
    const cy = Number(payload.cy);
    if (Number.isFinite(cx) && Number.isFinite(cy)) {
      const step  = Number(payload.step || 0);
      const steps = Number(payload.steps || 0);
      await g2.showCalibrationTarget(cx, cy, text, step, steps);
      return { mode: 'calibrate', text };
    }
  }

  // Point mode off / parked — clear the lenses cleanly.
  if (state === 'off') {
    await g2.clearGlasses();
    return { mode: 'off', text };
  }

  // Identified object with a position → label + tracking bracket.
  // Otherwise → a centered status/label line (idle, no-hand, offline…).
  const mode = identified && hasPos ? 'marker' : 'text';
  await g2.renderHud({
    text: text || 'Point at something',
    nx: hasPos ? nx : null,
    ny: hasPos ? ny : null,
    marker: identified && hasPos,
  });
  return { mode, text };
}
