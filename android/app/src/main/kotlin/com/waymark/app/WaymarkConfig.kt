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

    /* ---------- Google Sheets API ---------- */

    /** Sheets API endpoint for reading a spreadsheet range. */
    const val SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

    /** Sheet range used for the signaling rows (column T covers col 20). */
    const val SIG_RANGE_TEMPLATE = "Sheet1!T1:T%d"

    /* ---------- SharedPreferences keys ---------- */

    const val PREFS_NAME = "waymark_prefs"
    const val PREF_ACCESS_TOKEN = "access_token"
    const val PREF_ACTIVE_SHEET = "active_sheet"
    const val PREF_DISPLAY_NAME = "display_name"

    /**
     * The Google Sheet used for WebRTC signaling between this app and the
     * orchestrator MCP server.  Name the sheet ".waymark-signaling" by convention.
     * Set at build time via local.properties: WAYMARK_SIGNALING_SHEET_ID=<spreadsheet-id>
     *
     * The same sheet ID must be set as WAYMARK_SIGNALING_SHEET_ID in the
     * orchestrator environment.
     */
    val WAYMARK_SIGNALING_SHEET_ID: String get() = BuildConfig.WAYMARK_SIGNALING_SHEET_ID
}
