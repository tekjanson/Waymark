/* ============================================================
   node-connect.mjs — Node.js adapter for WaymarkConnect

   Bridges the browser's WaymarkConnect (public/js/webrtc.js) to
   the Node.js runtime used by the MCP orchestrator server.

   Responsibilities:
     1. Polyfill globalThis.RTCPeerConnection from werift so that
        WaymarkConnect can call `new RTCPeerConnection(...)` in Node.js
        without any modification.
     2. Provide a `signal` adapter that implements the same two-method
        interface expected by WaymarkConnect:
          readAll()              → Promise<string[][]>
          writeCell(row,col,val) → Promise<void>
        backed by the user's OAuth token and the Google Sheets REST API,
        reading/writing only the signaling column (column T, index 19).
     3. Export `createNodeConnect(opts)` which returns a ready-to-use
        WaymarkConnect instance configured for Node.js.
   ============================================================ */

import { RTCPeerConnection } from "werift";

// Polyfill RTCPeerConnection into the global scope so webrtc.js can
// call `new RTCPeerConnection(...)` without feature-detecting Node.
if (!globalThis.RTCPeerConnection) {
    globalThis.RTCPeerConnection = RTCPeerConnection;
}

// webrtc.js is an ES module that uses browser globals. The crypto,
// BroadcastChannel, and fetch globals are all available in Node 18+.
// The only remaining browser-only globals (window, navigator) are
// guarded by typeof checks after our edits to webrtc.js.
import { WaymarkConnect } from "../public/js/webrtc.js";

/* ---------- Protocol constants (must match webrtc.js) ---------- */

const SIG_COL     = 19;       // 0-based — column T
const BLOCK_SIZE  = 5;
const BLOCK_START = 1;
const MAX_SLOTS   = 8;
const TOTAL_ROWS  = MAX_SLOTS * BLOCK_SIZE + BLOCK_START;

const SIG_RANGE   = `Sheet1!T1:T${TOTAL_ROWS + 1}`;
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/* ---------- Signal adapter ---------- */

/**
 * Build the `signal` interface that WaymarkConnect uses for sheet I/O.
 *
 * @param {string}   sheetId
 * @param {function} getToken - async () => string OAuth access token
 */
function makeSignal(sheetId, getToken) {
    return {
        /**
         * Read the entire signaling column and return a 2D array where
         * vals[row][SIG_COL] holds the value for each row (1-based).
         * Rows without data have an empty array at that index.
         */
        async readAll() {
            const token = await getToken();
            if (!token) throw new Error("no OAuth token");
            const res = await fetch(
                `${SHEETS_BASE}/${sheetId}/values/${SIG_RANGE}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!res.ok) throw new Error(`Sheets read ${res.status}`);
            const data = await res.json();
            const rows = data.values || [];

            // Build a 2D array that WaymarkConnect indexes as vals[row][SIG_COL].
            // Rows are 1-based (BLOCK_START=1); SIG_COL = 19.
            const result = [];
            for (let i = 0; i <= TOTAL_ROWS + 1; i++) result.push([]);
            for (let i = 0; i < rows.length; i++) {
                const cell = rows[i]?.[0];
                if (cell != null && cell !== "") {
                    const rowIdx = i + BLOCK_START; // sheet API returns 0-based, convert
                    result[rowIdx][SIG_COL] = cell;
                }
            }
            return result;
        },

        /**
         * Write a single cell in the signaling column.
         * @param {number} row - 1-based row index (WaymarkConnect's _block + offset)
         * @param {number} col - always SIG_COL (19) for signaling
         * @param {string} val - value to write (empty string to clear)
         */
        async writeCell(row, _col, val) {
            const token = await getToken();
            if (!token) throw new Error("no OAuth token");
            // col is always SIG_COL (T). row is already 1-based.
            const range = `Sheet1!T${row}`;
            const res = await fetch(
                `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        range,
                        majorDimension: "ROWS",
                        values: [[val ?? ""]],
                    }),
                }
            );
            if (!res.ok) throw new Error(`Sheets write ${res.status}`);
        },
    };
}

/* ---------- Factory ---------- */

/**
 * Create a WaymarkConnect instance wired for Node.js.
 *
 * Returns the same WaymarkConnect object used in the browser — the full
 * signaling protocol, ICE gathering, DataChannel, etc. are all shared code.
 *
 * @param {object}   opts
 * @param {string}   opts.sheetId      - Google Sheets signaling spreadsheet ID
 * @param {function} opts.getToken     - async () => string OAuth access token
 * @param {string}   opts.peerId       - 8-char hex peer ID (stable per MCP instance)
 * @param {string}   opts.displayName  - human-readable name shown in presence row
 * @param {function} [opts.onPeersChanged] - (Map) called when the peer list changes
 * @param {function} [opts.onMessage]  - ({ peerId, text, ... }) called on incoming msg
 * @returns {WaymarkConnect}
 */
export function createNodeConnect(opts) {
    const signal = makeSignal(opts.sheetId, opts.getToken);

    return new WaymarkConnect(opts.sheetId, {
        displayName:    opts.displayName  || "Orchestrator MCP",
        signal,
        onPeersChanged: opts.onPeersChanged || (() => {}),
        onMessage:      opts.onMessage      || (() => {}),
        onStatusChanged: (s) => {
            process.stderr.write(`node-connect [${opts.peerId?.slice(0, 8)}]: status → ${s}\n`);
        },
        // Suppress media callbacks — MCP never makes audio/video calls
        onRemoteStream: () => {},
        onCallEnded:    () => {},
        onCallActive:   () => {},
        // Use a longer ICE timeout in Node.js; werift STUN round-trips can
        // take longer than the browser default (2s). Matches the old value.
        iceWait: 12_000,
    });
}
