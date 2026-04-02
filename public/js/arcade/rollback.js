/* ============================================================
   arcade/rollback.js — Rollback / GGPO-style netcode
   ============================================================ */

import { MSG, encodeInput, encodeInputAck, decodeMessage } from './net.js';
import { sampleAll } from './input.js';

/* ---------- Constants ---------- */

const MAX_PREDICTION = 8;       // max frames to run ahead of confirmed input
const HISTORY_SIZE = 256;       // ring buffer size (must be power of 2)
const HISTORY_MASK = HISTORY_SIZE - 1;

/* ---------- Rollback State ---------- */

/**
 * Create a rollback state manager for one game session.
 * @param {Object} opts
 * @param {function} opts.serialize — (ctx) => Uint8Array
 * @param {function} opts.deserialize — (ctx, Uint8Array) => void
 * @param {function} opts.simulate — (ctx, frame, localInput, remoteInput) => void
 * @param {Object} opts.net — ArcadeNet instance
 * @param {number} opts.localPlayer — 0 or 1
 * @returns {Object} — rollback controller
 */
export function createRollback(opts) {
  const { serialize, deserialize, simulate, net, localPlayer } = opts;

  // Input history ring buffers (indexed by frame & HISTORY_MASK)
  const localInputs = new Uint8Array(HISTORY_SIZE);
  const remoteInputs = new Uint8Array(HISTORY_SIZE);
  const remotePredicted = new Uint8Array(HISTORY_SIZE);
  const remoteConfirmed = new Uint8Array(HISTORY_SIZE);  // 1 = confirmed, 0 = predicted

  // State snapshot ring buffer
  const stateHistory = new Array(HISTORY_SIZE).fill(null);

  let confirmedFrame = -1;    // last frame where remote input is confirmed
  let currentFrame = 0;       // current simulation frame
  let lastRemoteFrame = -1;   // last frame we received remote input for
  let lastAckedFrame = -1;    // last frame remote has acked our input
  let rollbackCount = 0;      // stats: total rollbacks

  return {
    /** Current simulation frame. */
    get frame() { return currentFrame; },
    /** Last confirmed frame. */
    get confirmed() { return confirmedFrame; },
    /** Total rollback events. */
    get rollbacks() { return rollbackCount; },

    /**
     * Advance one simulation frame.
     * Called from the engine loop each fixed timestep.
     * @param {Object} ctx — engine context
     */
    advance(ctx) {
      // Check if we're too far ahead — pause if so
      if (currentFrame - confirmedFrame > MAX_PREDICTION) {
        ctx.paused = true;
        return;
      }
      ctx.paused = false;

      // Sample local input
      const localBits = sampleAll();
      const idx = currentFrame & HISTORY_MASK;
      localInputs[idx] = localBits;

      // Predict remote input (repeat last known)
      if (!remoteConfirmed[idx]) {
        remotePredicted[idx] = 1;
        remoteInputs[idx] = lastRemoteFrame >= 0
          ? remoteInputs[lastRemoteFrame & HISTORY_MASK]
          : 0;
      }

      // Save state snapshot before simulating
      stateHistory[idx] = serialize(ctx);

      // Simulate
      simulate(ctx, currentFrame, localBits, remoteInputs[idx]);

      // Send our input to remote (with redundancy)
      if (net) {
        net.sendFast(encodeInput(currentFrame, localInputs, lastAckedFrame));
      }

      currentFrame++;
    },

    /**
     * Handle an incoming remote input packet.
     * @param {Object} ctx — engine context
     * @param {ArrayBuffer} buffer — raw binary message
     */
    onRemoteInput(ctx, buffer) {
      const msg = decodeMessage(buffer);
      if (msg.type !== MSG.INPUT) return;

      const { frame, count, inputs } = msg;

      // Apply all inputs from the packet (redundant history)
      let misprediction = false;
      for (let i = 0; i < count; i++) {
        const f = frame - count + 1 + i;
        if (f < 0) continue;
        const fi = f & HISTORY_MASK;

        // Only process frames we haven't confirmed yet
        if (f <= confirmedFrame) continue;

        const actualInput = inputs[i];

        if (remotePredicted[fi] && remoteInputs[fi] !== actualInput) {
          misprediction = true;
        }

        remoteInputs[fi] = actualInput;
        remoteConfirmed[fi] = 1;
        remotePredicted[fi] = 0;

        if (f > lastRemoteFrame) lastRemoteFrame = f;
      }

      // Advance confirmed frame
      while (confirmedFrame + 1 < currentFrame &&
             remoteConfirmed[(confirmedFrame + 1) & HISTORY_MASK]) {
        confirmedFrame++;
      }

      // Send ack
      if (net) {
        net.sendFast(encodeInputAck(lastRemoteFrame));
      }

      // Rollback if misprediction detected
      if (misprediction) {
        this.rollback(ctx);
      }
    },

    /**
     * Handle an input acknowledgement from remote.
     * @param {ArrayBuffer} buffer
     */
    onInputAck(buffer) {
      const msg = decodeMessage(buffer);
      if (msg.type !== MSG.INPUT_ACK) return;
      if (msg.frame > lastAckedFrame) {
        lastAckedFrame = msg.frame;
      }
    },

    /**
     * Perform a rollback: restore state and replay from the earliest
     * corrected frame to the present.
     * @param {Object} ctx — engine context
     */
    rollback(ctx) {
      rollbackCount++;

      // Find the earliest frame that needs correction
      let replayFrom = confirmedFrame + 1;
      if (replayFrom < 0) replayFrom = 0;
      if (replayFrom >= currentFrame) return;  // nothing to replay

      // Restore state at replayFrom
      const snap = stateHistory[replayFrom & HISTORY_MASK];
      if (!snap) return;
      deserialize(ctx, snap);

      // Replay from replayFrom to currentFrame - 1
      for (let f = replayFrom; f < currentFrame; f++) {
        const fi = f & HISTORY_MASK;
        const local = localInputs[fi];
        const remote = remoteInputs[fi];

        simulate(ctx, f, local, remote);

        // Re-save state after replay
        if (f + 1 < currentFrame) {
          stateHistory[(f + 1) & HISTORY_MASK] = serialize(ctx);
        }
      }
    },

    /**
     * Reset the rollback state for a new game.
     */
    reset() {
      localInputs.fill(0);
      remoteInputs.fill(0);
      remotePredicted.fill(0);
      remoteConfirmed.fill(0);
      stateHistory.fill(null);
      confirmedFrame = -1;
      currentFrame = 0;
      lastRemoteFrame = -1;
      lastAckedFrame = -1;
      rollbackCount = 0;
    },
  };
}
