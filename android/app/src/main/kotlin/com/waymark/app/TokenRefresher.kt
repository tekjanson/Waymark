/* ============================================================
   TokenRefresher.kt — Two-tier OAuth token management

   Addresses the critical issue where the cached OAuth access token
   goes stale (~55 min) and the background service can no longer
   reach the Google Sheets signaling server.

   Two-tier strategy
   -----------------
   Tier 1 (primary): Cached access token in SharedPreferences — valid
     for ACCESS_TOKEN_TTL_MS (55 min).  Used directly for all Sheets API
     calls as long as it is fresh.

   Tier 2 (silent refresh): When Tier 1 is stale (or approaching expiry),
     reads the `waymark_refresh` httpOnly cookie from the WebView's
     CookieManager and POSTs it to the server's /auth/refresh endpoint.
     Returns a fresh access token without waking the WebView or
     requiring user interaction.

   The WebView's CookieManager stores the refresh cookie for up to 30 days,
   so the background service can remain connected indefinitely without
   requiring the user to reopen the app.

   Thread safety: getCookie() is safe to call from any thread on API 26+
   (this project's minSdk).  The refresh HTTP call is always performed on
   Dispatchers.IO.
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.util.Log
import android.webkit.CookieManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val TAG = "TokenRefresher"

/**
 * Performs silent OAuth token refresh using the `waymark_refresh` cookie
 * stored in the WebView's cookie jar.
 *
 * @param context  Application context
 * @param baseUrl  Waymark web app base URL (e.g. "https://swiftirons.com/waymark/")
 */
class TokenRefresher(
    private val context: Context,
    private val baseUrl: String = WaymarkConfig.BASE_URL
) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    /* ---------- Public API ---------- */

    /**
     * Attempts a silent token refresh using the WebView's refresh cookie.
     *
     * Reads the `waymark_refresh` cookie from the Android WebView's
     * CookieManager (which stores cookies set by the server, including
     * httpOnly cookies), then POSTs it to the server's /auth/refresh
     * endpoint to obtain a fresh access token.
     *
     * On success, updates SharedPreferences so the rest of the service
     * picks up the new token automatically via [WaymarkConfig.PREF_ACCESS_TOKEN].
     *
     * @return fresh access token on success, or null if the refresh failed
     */
    suspend fun refresh(): String? = withContext(Dispatchers.IO) {
        try {
            // Read the waymark_refresh cookie from the WebView's cookie store.
            // The cookie path is <basePath>/auth, so we request it from the full auth URL.
            val authCookieUrl = buildAuthCookieUrl(baseUrl)
            val cookieString = CookieManager.getInstance().getCookie(authCookieUrl)
            if (cookieString.isNullOrBlank()) {
                Log.d(TAG, "No cookies at $authCookieUrl — user may not have authenticated yet")
                return@withContext null
            }

            val refreshToken = parseCookieValue(cookieString, "waymark_refresh")
            if (refreshToken.isNullOrBlank()) {
                Log.d(TAG, "waymark_refresh cookie not found — user needs to log in")
                return@withContext null
            }

            // POST to /auth/refresh with the refresh token as a cookie header.
            // The server reads it from req.cookies.waymark_refresh, so we pass
            // it as a Cookie request header (same as the WebView does natively).
            val refreshUrl = buildRefreshUrl(baseUrl)
            val request = Request.Builder()
                .url(refreshUrl)
                .addHeader("Cookie", "waymark_refresh=$refreshToken")
                .post(FormBody.Builder().build())  // empty body; token is in cookie
                .build()

            val responseBody = http.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "Token refresh HTTP ${resp.code} from $refreshUrl")
                    return@withContext null
                }
                resp.body?.string() ?: return@withContext null
            }

            val accessToken = parseAccessToken(responseBody)
            if (accessToken.isNullOrBlank()) {
                Log.w(TAG, "Token refresh response missing access_token")
                return@withContext null
            }

            // Persist the new token so the signaling client picks it up
            context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(WaymarkConfig.PREF_ACCESS_TOKEN, accessToken)
                .putLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, System.currentTimeMillis())
                .apply()

            Log.i(TAG, "Silent token refresh succeeded — token length=${accessToken.length}")
            accessToken

        } catch (e: IOException) {
            Log.w(TAG, "Silent token refresh IO error: ${e.message}")
            null
        } catch (e: Exception) {
            Log.w(TAG, "Silent token refresh failed: ${e.message}")
            null
        }
    }

    /**
     * Returns true if the cached access token is stale or approaching expiry,
     * meaning Tier 2 refresh should be attempted.
     *
     * Triggers at [WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS] before the TTL
     * expires so there is a window to obtain a fresh token without
     * interrupting an active signaling session.
     */
    fun isRefreshNeeded(): Boolean {
        val prefs = context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
        val setAt  = prefs.getLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, 0L)
        val age    = System.currentTimeMillis() - setAt
        return age >= WaymarkConfig.ACCESS_TOKEN_TTL_MS - WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS
    }

    /* ---------- Companion: pure helpers (accessible for unit tests) ---------- */

    companion object {

        /**
         * Constructs the URL used to look up the waymark_refresh cookie.
         * The server sets the cookie with `path: <basePath>/auth`, so the
         * CookieManager returns it for any URL under that path.
         *
         * Examples:
         *   "https://swiftirons.com/waymark/" → "https://swiftirons.com/waymark/auth/refresh"
         *   "http://10.0.2.2:3000/"           → "http://10.0.2.2:3000/auth/refresh"
         */
        fun buildAuthCookieUrl(base: String): String {
            val trimmed = base.trimEnd('/')
            return "$trimmed/auth/refresh"
        }

        /**
         * Constructs the POST URL for the server's token refresh endpoint.
         * Identical to [buildAuthCookieUrl] — the same path is both where the
         * cookie lives and where refresh requests are sent.
         */
        fun buildRefreshUrl(base: String): String = buildAuthCookieUrl(base)

        /**
         * Parses a single named cookie value from a browser-format cookie string.
         *
         * @param cookieString  Raw value from CookieManager.getCookie() —
         *                      e.g. "waymark_refresh=abc123; other_cookie=xyz"
         * @param name          Cookie name to extract
         * @return cookie value, or null if not found or blank
         */
        fun parseCookieValue(cookieString: String, name: String): String? {
            return cookieString.split(';')
                .map { it.trim() }
                .firstOrNull { part ->
                    val eq = part.indexOf('=')
                    eq > 0 && part.substring(0, eq).trim() == name
                }
                ?.let { part ->
                    val eq = part.indexOf('=')
                    part.substring(eq + 1).trim().ifBlank { null }
                }
        }

        /**
         * Parses the access_token field from a successful /auth/refresh JSON response.
         *
         * @param json  Response body string from the refresh endpoint
         * @return access token string, or null if the field is absent or blank
         */
        fun parseAccessToken(json: String): String? {
            return try {
                JSONObject(json).optString("access_token", "").ifBlank { null }
            } catch (e: Exception) {
                null
            }
        }
    }
}
