/* ============================================================
   PhoneBridgeServer.kt — Local-only HTTP bridge for Even app
   ============================================================ */

package com.waymark.app

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject

/**
 * Tiny localhost server exposing the latest Waymark vision text.
 *
 * Endpoints:
 *   GET /health  -> { ok, service, port }
 *   GET /latest  -> latest bridge payload JSON
 */
class PhoneBridgeServer(
    private val store: PhoneBridgeStore,
    port: Int = DEFAULT_PORT,
) : NanoHTTPD("0.0.0.0", port) {

    companion object {
        const val DEFAULT_PORT = 8787
    }

    override fun serve(session: IHTTPSession): Response {
        val path = session.uri ?: "/"
        return when {
            session.method == Method.OPTIONS -> cors(newFixedLengthResponse(Response.Status.OK, "text/plain", "ok"))
            session.method == Method.GET && path == "/health" -> {
                val body = JSONObject()
                    .put("ok", true)
                    .put("service", "waymark-phone-bridge")
                    .put("port", listeningPort)
                    .toString()
                cors(newFixedLengthResponse(Response.Status.OK, "application/json", body))
            }
            session.method == Method.GET && path == "/latest" -> {
                val body = store.readLatest().toString()
                cors(newFixedLengthResponse(Response.Status.OK, "application/json", body))
            }
            else -> {
                val body = JSONObject().put("ok", false).put("error", "not-found").toString()
                cors(newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", body))
            }
        }
    }

    private fun cors(response: Response): Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "Content-Type")
        response.addHeader("Cache-Control", "no-store")
        return response
    }
}
