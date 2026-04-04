/* ============================================================
   arcade/rollback.js — Rollback / GGPO-style netcode
   ============================================================ */

import { MSG, encodeInput, encodeInputAck, encodeStateSnap, decodeMessage } from './net.js';
import { sampleAll } from './input.js';

/* ---------- Constants ---------- */

const MAX_PREDICTION = 8;       // max frames to run ahead of confirmed input
const HISTORY_SIZE = 256;       // ring buffer size (must be power of 2)
const HISTORY_MASK = HISTORY_SIZE - 1;
const SYNC_INTERVAL = 60;       // send state snapshot every N frames (1s @ 60Hz)
const ACK_INTERVAL = 6;         // send unsolicited ack every N frames (~100ms)
const INPUT_DECAY_FRAMES = 8;   // predict zero-input after this many same-input frames

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

  // Track which frame each ring buffer slot was confirmed for.
  // Prevents stale confirmations from previous cycle (256 frames ago)
  // bleeding into the current frame.
  const remoteConfirmedAt = new Int32Array(HISTORY_SIZE).fill(-1);

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
        // Keep sending input while paused so remote can catch up
        if (net) {
          net.sendFast(encodeInput(currentFrame - 1, localInputs, lastAckedFrame));
        }
        return;
      }
      ctx.paused = false;

      // Sample local input
      const localBits = sampleAll();
      const idx = currentFrame & HISTORY_MASK;
      localInputs[idx] = localBits;

      // Predict remote input if not already confirmed for THIS frame.
      // Check the frame number, not just the slot, to prevent using
      // stale confirmations from 256 frames ago.
      // Decay prediction to zero after INPUT_DECAY_FRAMES of the same input —
      // humans rarely hold the exact same key for more than ~133ms, so
      // predicting zero reduces misprediction magnitude during fast movement.
      if (remoteConfirmedAt[idx] !== currentFrame) {
        const lastInput = lastRemoteFrame >= 0
          ? remoteInputs[lastRemoteFrame & HISTORY_MASK]
          : 0;
        const framesSinceLast = currentFrame - lastRemoteFrame;
        remoteInputs[idx] = framesSinceLast < INPUT_DECAY_FRAMES ? lastInput : 0;
      }

      // Save state snapshot before simulating
      stateHistory[idx] = serialize(ctx);

      // Simulate — both advance() and rollback() use localInputs[f]
      // directly so they always agree on the same input for each frame.
      simulate(ctx, currentFrame, localBits, remoteInputs[idx]);

      // Send our input to remote with generous redundancy
      // Always send at least 16 frames of history even if all acked
      if (net) {
        net.sendFast(encodeInput(currentFrame, localInputs, Math.min(lastAckedFrame, currentFrame - 24)));
      }

      // Periodic unsolicited ack — prevents ack starvation if inbound
      // packets are lost for an extended period
      if (net && currentFrame % ACK_INTERVAL === 0 && lastRemoteFrame >= 0) {
        net.sendFast(encodeInputAck(lastRemoteFrame));
      }

      // Periodic state sync for resync recovery
      if (net && currentFrame > 0 && currentFrame % SYNC_INTERVAL === 0 && confirmedFrame >= currentFrame - 5) {
        const snap = serialize(ctx);
        net.sendReliable(encodeStateSnap(currentFrame, snap));
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

      // Apply all inputs from the packet (redundant history).
      // Track the earliest frame where our prediction was wrong
      // so rollback starts from the correct snapshot.
      let earliestMisprediction = -1;
      for (let i = 0; i < count; i++) {
        const f = frame - count + 1 + i;
        if (f < 0) continue;
        const fi = f & HISTORY_MASK;

        // Only process frames we haven't confirmed yet
        if (f <= confirmedFrame) continue;
        // Skip frames beyond what we've simulated (future)
        if (f >= currentFrame) {
          // Pre-confirm: store for when advance() reaches this frame
          remoteInputs[fi] = inputs[i];
          remoteConfirmedAt[fi] = f;
          if (f > lastRemoteFrame) lastRemoteFrame = f;
          continue;
        }

        const actualInput = inputs[i];

        // Detect misprediction — slot was predicted (not confirmed for
        // this exact frame) and the predicted value was wrong.
        if (remoteConfirmedAt[fi] !== f && remoteInputs[fi] !== actualInput) {
          if (earliestMisprediction < 0 || f < earliestMisprediction) {
            earliestMisprediction = f;
          }
        }

        remoteInputs[fi] = actualInput;
        remoteConfirmedAt[fi] = f;

        if (f > lastRemoteFrame) lastRemoteFrame = f;
      }

      // Advance confirmed frame — walk forward from last confirmed
      // checking that each slot is confirmed for the correct frame
      while (confirmedFrame + 1 < currentFrame) {
        const nextFrame = confirmedFrame + 1;
        if (remoteConfirmedAt[nextFrame & HISTORY_MASK] !== nextFrame) break;
        confirmedFrame++;
      }

      // Send ack
      if (net) {
        net.sendFast(encodeInputAck(lastRemoteFrame));
      }

      // Rollback if misprediction detected
      if (earliestMisprediction >= 0) {
        this.rollback(ctx, earliestMisprediction);
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
     * Handle an incoming state snapshot from remote for resync.
     * Only applies if the snapshot frame is within our history window
     * and both peers have confirmed inputs up to that point.
     * @param {Object} ctx — engine context
     * @param {ArrayBuffer} buffer
     */
    onStateSnap(ctx, buffer) {
      const msg = decodeMessage(buffer);
      if (msg.type !== MSG.STATE_SNAP) return;
      const snapFrame = msg.frame;
      // Only apply if we have confirmed that frame and it's not ancient
      if (snapFrame > confirmedFrame || snapFrame < currentFrame - HISTORY_SIZE / 2) return;
      // Overwrite our saved state at that frame and replay forward
      stateHistory[snapFrame & HISTORY_MASK] = msg.data;
      deserialize(ctx, msg.data);
      // Replay from snapFrame to currentFrame
      for (let f = snapFrame; f < currentFrame; f++) {
        const fi = f & HISTORY_MASK;
        simulate(ctx, f, localInputs[fi], remoteInputs[fi]);
        if (f + 1 < currentFrame) {
          stateHistory[(f + 1) & HISTORY_MASK] = serialize(ctx);
        }
      }
    },

    /**
     * Perform a rollback: restore state and replay from the earliest
     * corrected frame to the present.
     * @param {Object} ctx — engine context
     * @param {number} [fromFrame] — earliest mispredicted frame
     */
    rollback(ctx, fromFrame) {
      rollbackCount++;

      // Start from the mispredicted frame, falling back to confirmedFrame + 1
      let replayFrom = fromFrame != null ? fromFrame : confirmedFrame + 1;
      if (replayFrom < 0) replayFrom = 0;
      if (replayFrom >= currentFrame) return;  // nothing to replay

      // Restore state at replayFrom (snapshot saved BEFORE that frame ran)
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
      remoteConfirmedAt.fill(-1);
      stateHistory.fill(null);
      confirmedFrame = -1;
      currentFrame = 0;
      lastRemoteFrame = -1;
      lastAckedFrame = -1;
      rollbackCount = 0;
    },
  };
}
