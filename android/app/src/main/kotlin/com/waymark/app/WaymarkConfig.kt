/* ============================================================
   WaymarkConfig.kt — Compile-time and preference-key constants
   ============================================================ */

package com.waymark.app

object WaymarkConfig {

    /** Base URL for the Waymark web app loaded in the WebView. */
    const val BASE_URL = "https://swiftirons.com/waymark/"

    /* ---------- Sheets signaling constants (mirrors webrtc.js) ---------- */

    /** Spreadsheet column index used for WebRTC signaling (1-based, col 20 = "T"). */
    const val SIG_COL = 19          // 0-based index; webrtc.js uses 1-based 20

    /** Number of rows per peer block in the signaling sheet. */
    const val BLOCK_SIZE = 5

    /** First block starts at this row index (0-based; row 1 in Sheets). */
    const val BLOCK_START = 1

    /** Maximum number of peer slots in the signaling sheet. */
    const val MAX_SLOTS = 8

    /** Row offset of the PRESENCE cell within a peer block. */
    const val OFF_PRESENCE = 0

    /** Row offset of the OFFERS cell within a peer block. */
    const val OFF_OFFERS = 1

    /** Row offset of the ANSWERS cell within a peer block. */
    const val OFF_ANSWERS = 2

    /** Signaling poll interval in milliseconds. */
    const val POLL_MS = 5_000L

    /** Heartbeat write interval in milliseconds. */
    const val HEART_MS = 15_000L

    /** Age threshold (ms) after which a peer is considered gone. */
    const val ALIVE_TTL = 50_000L

    /** Age threshold after which an unanswered offer is stale and must be rebuilt (mirrors sheet-webrtc-peer.mjs OFFER_MAX_AGE). */
    const val OFFER_MAX_AGE_MS = 3 * 60 * 1000L

    /* ---------- Google Sheets API ---------- */

    /** Sheets API endpoint for reading a spreadsheet range. */
    const val SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

    /** Drive REST v3 API base URL. */
    const val DRIVE_BASE = "https://www.googleapis.com/drive/v3"

    /** Sheet range used for the signaling rows (column T covers col 20). */
    const val SIG_RANGE_TEMPLATE = "Sheet1!T1:T%d"

    /* ---------- SharedPreferences keys ---------- */

    const val PREFS_NAME = "waymark_prefs"
    const val PREF_ACCESS_TOKEN = "access_token"
    const val PREF_ACTIVE_SHEET = "active_sheet"
    const val PREF_DISPLAY_NAME = "display_name"
    /** Cached PRIVATE signaling sheet ID (OAuth-gated, stores the AES key in col A). */
    const val PREF_SIGNALING_SHEET_ID = "signaling_sheet_id"
    /** Cached PUBLIC P2P signaling sheet ID (encrypted with the AES key from private sheet). */
    const val PREF_PUBLIC_SIGNALING_ID = "public_signaling_sheet_id"
    /** Cached AES-256 signal key hex (64 chars) fetched from the private key sheet. */
    const val PREF_SIGNAL_KEY = "signal_key"
    /** Epoch-ms when the cached signal key was last fetched — used to detect key cycling. */
    const val PREF_SIGNAL_KEY_VERSION = "signal_key_version"
    /**
     * Stable 8-char hex peer ID for this device, generated once on first run
     * and preserved forever.  Never regenerated — a stable ID means remote
     * peers can reconnect without re-doing the full ICE handshake each time
     * the service restarts.
     */
    const val PREF_PEER_ID = "peer_id"

    /* ---------- Private key sheet access ---------- */

    /** Sheets range for the AES signal key stored in column A of the private sheet. */
    const val KEY_RANGE = "Sheet1!A1:A2"

    /** Prefix identifying an encrypted signaling cell — must match SignalingEncryption. */
    const val SIG_ENCRYPT_PREFIX = "\uD83D\uDD10SIG:"
}
