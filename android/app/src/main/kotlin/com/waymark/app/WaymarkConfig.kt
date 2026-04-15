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
    const val POLL_MS = 7_000L

    /** Heartbeat write interval in milliseconds. */
    const val HEART_MS = 20_000L

    /** Age threshold (ms) after which a peer is considered gone. */
    const val ALIVE_TTL = 120_000L

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
    /** Epoch-ms when the access token was last stored — used for expiry checks. */
    const val PREF_ACCESS_TOKEN_SET_MS = "access_token_set_ms"
    /** Epoch-ms when the access token expires (absolute), as reported by the OAuth server. */
    const val PREF_TOKEN_EXPIRY_MS = "token_expiry_ms"
    /** OAuth refresh token — enables native background token refresh when the WebView is closed. */
    const val PREF_REFRESH_TOKEN = "refresh_token"
    /** OAuth client_id — needed for native refresh_token exchange. */
    const val PREF_CLIENT_ID = "client_id"
    /** OAuth client_secret — needed for native refresh_token exchange. */
    const val PREF_CLIENT_SECRET = "client_secret"
    const val PREF_ACTIVE_SHEET = "active_sheet"
    const val PREF_DISPLAY_NAME = "display_name"
    /** Cached PRIVATE signaling sheet ID (OAuth-gated). */
    const val PREF_SIGNALING_SHEET_ID = "signaling_sheet_id"
    /**
     * Stable 8-char hex peer ID for this device, generated once on first run
     * and preserved forever.  Never regenerated — a stable ID means remote
     * peers can reconnect without re-doing the full ICE handshake each time
     * the service restarts.
     */
    const val PREF_PEER_ID = "peer_id"
}
