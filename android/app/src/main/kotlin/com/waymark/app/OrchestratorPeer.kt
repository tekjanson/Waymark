/* ============================================================
   OrchestratorPeer.kt — Native WebRTC mesh peer

   Manages one RTCPeerConnection per remote Waymark peer using
   the same signaling protocol as webrtc.js. Data received on
   the 'waymark' DataChannel is delivered to [onMessage].

   Orchestrator notification messages (type == "waymark-notification"
   or "orchestrator-alert") trigger [onNotification].
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import org.json.JSONObject
import org.webrtc.*
import java.util.concurrent.ConcurrentHashMap

private const val TAG = "OrchestratorPeer"

/**
 * Participates in the Waymark peer mesh for a single sheet.
 *
 * @param context          Application context (needed to init PeerConnectionFactory)
 * @param sheetId          The Google Sheet this peer mesh is tied to
 * @param peerId           8-char hex ID for this device in the mesh
 * @param displayName      Human-readable label shown in peer lists
 * @param signalingClient  Sheets signaling client for this sheet
 * @param onNotification   Called when an orchestrator notification arrives
 */
class OrchestratorPeer(
    private val context: Context,
    private val sheetId: String,
    val peerId: String,
    private val displayName: String,
    private val signalingClient: SignalingClient,
    private val onNotification: (title: String, body: String) -> Unit
) {

    /* ---------- WebRTC factory (singleton per process) ---------- */

    companion object {
        @Volatile private var _factory: PeerConnectionFactory? = null

        fun factory(context: Context): PeerConnectionFactory {
            return _factory ?: synchronized(this) {
                _factory ?: run {
                    PeerConnectionFactory.initialize(
                        PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                            .createInitializationOptions()
                    )
                    val opts = PeerConnectionFactory.Options()
                    val factory = PeerConnectionFactory.builder()
                        .setOptions(opts)
                        .createPeerConnectionFactory()
                    _factory = factory
                    factory
                }
            }
        }

        private val STUN_SERVERS = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )
    }

    /* ---------- State ---------- */

    /** RTCPeerConnection + data channel per remote peerId. */
    private data class PeerEntry(
        val pc: PeerConnection,
        val dc: DataChannel?,
        var state: String = "connecting"
    )

    private val peers = ConcurrentHashMap<String, PeerEntry>()

    /**
     * Invoked on the IO dispatcher whenever the number of open DataChannel
     * peers changes.  The service uses this to update the foreground
     * notification status in real time.
     *
     * @param connected True when at least one DataChannel is OPEN
     * @param peerCount Number of peers with an OPEN DataChannel
     */
    var onConnectionStateChanged: ((connected: Boolean, peerCount: Int) -> Unit)? = null

    /** Assigned signaling block row (0-based index into signaling column). */
    @Volatile private var block = -1

    @Volatile var destroyed = false
        private set

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /* ---------- Lifecycle ---------- */

    /** Join the peer mesh and start the poll + heartbeat loops. */
    fun start() {
        scope.launch {
            var retryDelay = 10_000L // 10 s initial, doubles each attempt up to 60 s
            while (!destroyed) {
                try {
                    block = -1 // reset before each join attempt
                    join()
                    if (block < 0) {
                        Log.w(TAG, "No free signaling slot — mesh full")
                        return@launch
                    }
                    Log.i(TAG, "Joined mesh — block=$block peerId=$peerId")
                    retryDelay = 10_000L // reset backoff on success
                    delay(peerIdJitter())
                    while (!destroyed) {
                        poll()
                        delay(WaymarkConfig.POLL_MS)
                    }
                } catch (e: CancellationException) { return@launch }
                catch (e: Exception) {
                    Log.e(TAG, "Mesh loop error — retrying in ${retryDelay / 1000}s", e)
                    if (!destroyed) {
                        delay(retryDelay)
                        retryDelay = minOf(retryDelay * 2, 60_000L)
                    }
                }
            }
        }
        scope.launch {
            delay(500)
            while (!destroyed) {
                heartbeat()
                delay(WaymarkConfig.HEART_MS)
            }
        }
    }

    /** Leave the mesh and release all resources. */
    fun stop() {
        destroyed = true
        scope.cancel()
        if (block >= 0) signalingClient.clearPresence(block)
        peers.values.forEach { it.pc.dispose() }
        peers.clear()
    }

    /* ---------- Signaling: join ---------- */

    private suspend fun join() = withContext(Dispatchers.IO) {
        val vals = signalingClient.readAll()
        block = findSlot(vals)
        if (block < 0) return@withContext
        heartbeat()

        // Collision guard (mirrors webrtc.js ~300+jitter ms wait)
        delay(300 + peerIdJitter())
        if (destroyed) return@withContext

        val verify = signalingClient.readAll()
        val claimed = parseJson(verify.getOrNull(block))
        if (claimed == null || claimed.optString("peerId") != peerId) {
            Log.w(TAG, "Slot $block collision — re-claiming")
            block = findSlot(verify)
            if (block < 0) return@withContext
            heartbeat()
        }
    }

    /* ---------- Heartbeat ---------- */

    private suspend fun heartbeat() = withContext(Dispatchers.IO) {
        if (destroyed || block < 0) return@withContext
        try {
            val presence = JSONObject().apply {
                put("peerId", peerId)
                put("name", displayName)
                put("ts", System.currentTimeMillis())
            }
            signalingClient.writeCell(block + WaymarkConfig.OFF_PRESENCE, presence.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Heartbeat failed: ${e.message}")
        }
    }

    /* ---------- Poll ---------- */

    private suspend fun poll() = withContext(Dispatchers.IO) {
        if (destroyed || block < 0) return@withContext
        try {
            val vals = signalingClient.readAll()
            val alive = scanAlive(vals)
            val aliveIds = alive.map { it.optString("peerId") }.toSet()

            // Remove dead peers
            val deadIds = peers.keys.filter { it !in aliveIds }
            for (id in deadIds) {
                peers.remove(id)?.pc?.dispose()
                Log.d(TAG, "Removed dead peer $id")
            }
            if (deadIds.isNotEmpty()) fireConnectionState()

            var myOffers  = parseJson(vals.getOrNull(block + WaymarkConfig.OFF_OFFERS))  ?: JSONObject()
            var myAnswers = parseJson(vals.getOrNull(block + WaymarkConfig.OFF_ANSWERS)) ?: JSONObject()
            var offDirty = false
            var ansDirty = false

            // Clean stale entries
            for (key in myOffers.keys().asSequence().toList()) {
                if (key !in aliveIds) { myOffers.remove(key); offDirty = true }
            }
            for (key in myAnswers.keys().asSequence().toList()) {
                if (key !in aliveIds) { myAnswers.remove(key); ansDirty = true }
            }

            for (remote in alive) {
                val remotePeerId = remote.optString("peerId")
                val remoteBlock  = remote.optInt("block", -1)
                if (remotePeerId == peerId || remoteBlock < 0) continue

                val entry = peers[remotePeerId]

                // Skip already-connected peers
                if (entry?.dc?.state() == DataChannel.State.OPEN) {
                    if (myOffers.has(remotePeerId))  { myOffers.remove(remotePeerId);  offDirty = true }
                    if (myAnswers.has(remotePeerId)) { myAnswers.remove(remotePeerId); ansDirty = true }
                    continue
                }

                val weInit = peerId < remotePeerId

                if (weInit) {
                    if (entry == null) {
                        // Build offer (suspends until ICE gathering completes)
                        try {
                            val sdp = buildOffer(remotePeerId)
                            if (sdp != null) {
                                myOffers.put(remotePeerId, JSONObject().apply {
                                    put("sdp", sdp); put("ts", System.currentTimeMillis())
                                })
                                writeOffers(myOffers)
                                offDirty = false
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "buildOffer to $remotePeerId failed", e)
                            peers.remove(remotePeerId)?.pc?.dispose()
                        }
                    } else {
                        // Check for answer
                        val remoteAns = parseJson(vals.getOrNull(remoteBlock + WaymarkConfig.OFF_ANSWERS)) ?: JSONObject()
                        val ans = remoteAns.optJSONObject(peerId)
                        if (ans != null) {
                            try {
                                entry.pc.setRemoteDescription(
                                    SimpleSdpObserver(),
                                    SessionDescription(SessionDescription.Type.ANSWER, ans.getString("sdp"))
                                )
                                entry.state = "connected"
                                myOffers.remove(remotePeerId); offDirty = true
                            } catch (e: Exception) {
                                Log.e(TAG, "setRemoteDescription(answer) failed for $remotePeerId", e)
                                peers.remove(remotePeerId)?.pc?.dispose()
                            }
                        }
                    }
                } else {
                    if (entry == null) {
                        // Look for offer from remote
                        val remoteOff = parseJson(vals.getOrNull(remoteBlock + WaymarkConfig.OFF_OFFERS)) ?: JSONObject()
                        val offer = remoteOff.optJSONObject(peerId)
                        if (offer != null) {
                            try {
                                val sdp = buildAnswer(remotePeerId, offer.getString("sdp"))
                                if (sdp != null) {
                                    myAnswers.put(remotePeerId, JSONObject().apply {
                                        put("sdp", sdp); put("ts", System.currentTimeMillis())
                                    })
                                    writeAnswers(myAnswers)
                                    ansDirty = false
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "buildAnswer for $remotePeerId failed", e)
                                peers.remove(remotePeerId)?.pc?.dispose()
                            }
                        }
                    }
                }
            }

            if (offDirty) writeOffers(myOffers)
            if (ansDirty) writeAnswers(myAnswers)

        } catch (e: Exception) {
            Log.e(TAG, "Poll error", e)
        }
    }

    /* ---------- Offer / Answer builders ---------- */

    /**
     * Create a WebRTC offer and wait for ICE gathering to complete so the
     * returned SDP contains all ICE candidates (vanilla ICE — no trickle).
     * Returns the complete SDP string, or null on failure.
     */
    private suspend fun buildOffer(remotePeerId: String): String? = withContext(Dispatchers.IO) {
        val pc = createPeerConnection(remotePeerId) ?: return@withContext null
        val dc = pc.createDataChannel("waymark", DataChannel.Init())
        peers[remotePeerId] = PeerEntry(pc, dc)
        attachDataChannelObserver(dc, remotePeerId)

        // Create offer
        val offerSdp = suspendCancellableCoroutine { cont: CancellableContinuation<SessionDescription?> ->
            pc.createOffer(object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) { cont.resume(sdp) {} }
                override fun onSetSuccess() {}
                override fun onCreateFailure(s: String?) { logSdpError("createOffer", s); cont.resume(null) {} }
                override fun onSetFailure(s: String?) { cont.resume(null) {} }
            }, MediaConstraints())
        } ?: return@withContext null

        // Set local description (starts ICE gathering)
        suspendCancellableCoroutine { cont: CancellableContinuation<Boolean> ->
            pc.setLocalDescription(object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() { cont.resume(true) {} }
                override fun onCreateFailure(s: String?) { cont.resume(false) {} }
                override fun onSetFailure(s: String?) { logSdpError("setLocal offer", s); cont.resume(false) {} }
            }, offerSdp)
        }

        // Wait for ICE gathering to complete (vanilla ICE — full SDP exchange)
        waitForIceGathering(pc)
        pc.localDescription?.description
    }

    /**
     * Accept a remote offer and create an answer, waiting for ICE gathering.
     * Returns the complete answer SDP string, or null on failure.
     */
    private suspend fun buildAnswer(remotePeerId: String, offerSdp: String): String? = withContext(Dispatchers.IO) {
        val pc = createPeerConnection(remotePeerId) ?: return@withContext null
        peers[remotePeerId] = PeerEntry(pc, null)

        // Set remote description (the offer)
        val remoteOk = suspendCancellableCoroutine { cont: CancellableContinuation<Boolean> ->
            pc.setRemoteDescription(object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() { cont.resume(true) {} }
                override fun onCreateFailure(s: String?) { logSdpError("setRemote offer", s); cont.resume(false) {} }
                override fun onSetFailure(s: String?) { logSdpError("setRemote offer", s); cont.resume(false) {} }
            }, SessionDescription(SessionDescription.Type.OFFER, offerSdp))
        }
        if (!remoteOk) return@withContext null

        // Create answer
        val answerSdp = suspendCancellableCoroutine { cont: CancellableContinuation<SessionDescription?> ->
            pc.createAnswer(object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription) { cont.resume(sdp) {} }
                override fun onSetSuccess() {}
                override fun onCreateFailure(s: String?) { logSdpError("createAnswer", s); cont.resume(null) {} }
                override fun onSetFailure(s: String?) { cont.resume(null) {} }
            }, MediaConstraints())
        } ?: return@withContext null

        // Set local description (starts ICE gathering)
        suspendCancellableCoroutine { cont: CancellableContinuation<Boolean> ->
            pc.setLocalDescription(object : SdpObserver {
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onSetSuccess() { cont.resume(true) {} }
                override fun onCreateFailure(s: String?) { cont.resume(false) {} }
                override fun onSetFailure(s: String?) { logSdpError("setLocal answer", s); cont.resume(false) {} }
            }, answerSdp)
        }

        // Wait for ICE gathering to complete (vanilla ICE — full SDP exchange)
        waitForIceGathering(pc)
        pc.localDescription?.description
    }

    /** Poll until ICE gathering completes or 12 s timeout. */
    private suspend fun waitForIceGathering(pc: PeerConnection, timeoutMs: Long = 12_000) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (pc.iceGatheringState() != PeerConnection.IceGatheringState.COMPLETE
               && System.currentTimeMillis() < deadline && !destroyed) {
            delay(200)
        }
    }

    /* ---------- PeerConnection factory ---------- */

    private fun createPeerConnection(remotePeerId: String): PeerConnection? {
        val config = PeerConnection.RTCConfiguration(STUN_SERVERS).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        return factory(context).createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                Log.d(TAG, "ICE $remotePeerId → $state")
                if (state == PeerConnection.IceConnectionState.FAILED ||
                    state == PeerConnection.IceConnectionState.CLOSED) {
                    peers.remove(remotePeerId)?.pc?.dispose()
                    fireConnectionState()
                }
            }
            override fun onDataChannel(dc: DataChannel) {
                // Answerer receives the data channel here
                peers[remotePeerId]?.let {
                    peers[remotePeerId] = it.copy(dc = dc)
                }
                attachDataChannelObserver(dc, remotePeerId)
            }
            override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
            override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(p0: IceCandidate?) {}
            override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
            override fun onAddStream(p0: MediaStream?) {}
            override fun onRemoveStream(p0: MediaStream?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(p0: RtpReceiver?, p1: Array<out MediaStream>?) {}
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {}
            override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) {}
            override fun onTrack(transceiver: RtpTransceiver?) {}
            override fun onIceConnectionReceivingChange(p0: Boolean) {}
        })
    }

    /* ---------- DataChannel message processing ---------- */

    /** Counts open DataChannels and fires the connection-state callback. */
    private fun fireConnectionState() {
        val openCount = peers.values.count { it.dc?.state() == DataChannel.State.OPEN }
        onConnectionStateChanged?.invoke(openCount > 0, openCount)
    }

    private fun attachDataChannelObserver(dc: DataChannel, remotePeerId: String) {
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(amount: Long) {}
            override fun onStateChange() {
                Log.d(TAG, "DC $remotePeerId → ${dc.state()}")
                val s = dc.state()
                if (s == DataChannel.State.OPEN || s == DataChannel.State.CLOSED ||
                    s == DataChannel.State.CLOSING) {
                    fireConnectionState()
                }
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (!buffer.binary) {
                    val bytes = ByteArray(buffer.data.remaining())
                    buffer.data.get(bytes)
                    handleMessage(String(bytes, Charsets.UTF_8))
                }
            }
        })
    }

    private fun handleMessage(json: String) {
        try {
            val obj = JSONObject(json)
            val type = obj.optString("type")
            if (type == "waymark-notification" || type == "orchestrator-alert") {
                val title = obj.optString("title", "Waymark")
                val body  = obj.optString("body", obj.optString("message", ""))
                if (body.isNotBlank()) onNotification(title, body)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Bad DataChannel message: ${e.message}")
        }
    }

    /* ---------- Signaling helpers ---------- */

    private suspend fun writeOffers(offers: JSONObject) = withContext(Dispatchers.IO) {
        try {
            val v = if (offers.length() > 0) offers.toString() else ""
            signalingClient.writeCell(block + WaymarkConfig.OFF_OFFERS, v)
        } catch (e: Exception) { Log.w(TAG, "writeOffers failed: ${e.message}") }
    }

    private suspend fun writeAnswers(answers: JSONObject) = withContext(Dispatchers.IO) {
        try {
            val v = if (answers.length() > 0) answers.toString() else ""
            signalingClient.writeCell(block + WaymarkConfig.OFF_ANSWERS, v)
        } catch (e: Exception) { Log.w(TAG, "writeAnswers failed: ${e.message}") }
    }

    private fun findSlot(vals: List<String?>): Int {
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            val row = WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE
            val p = parseJson(vals.getOrNull(row))
            val ts = p?.optLong("ts", 0L) ?: 0L
            if (p == null || System.currentTimeMillis() - ts > WaymarkConfig.ALIVE_TTL) return row
        }
        return -1
    }

    private fun scanAlive(vals: List<String?>): List<JSONObject> {
        val result = mutableListOf<JSONObject>()
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            val row = WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE
            if (row == block) continue
            val p = parseJson(vals.getOrNull(row)) ?: continue
            val ts = p.optLong("ts", 0L)
            if (System.currentTimeMillis() - ts < WaymarkConfig.ALIVE_TTL) {
                result.add(p.apply { put("block", row) })
            }
        }
        return result
    }

    private fun peerIdJitter(): Long {
        var hash = 0
        for (ch in peerId) hash = (hash * 31 + ch.code) and 0xffff
        return (hash % 200).toLong()
    }

    private fun parseJson(s: String?): JSONObject? {
        if (s.isNullOrBlank()) return null
        return try { JSONObject(s) } catch (e: Exception) { null }
    }

    private fun logSdpError(step: String, err: String?) {
        Log.e(TAG, "SDP error at $step: $err")
    }
}

/** No-op SdpObserver used for setLocalDescription calls that don't need a callback. */
private class SimpleSdpObserver : SdpObserver {
    override fun onCreateSuccess(p0: SessionDescription?) {}
    override fun onSetSuccess() {}
    override fun onCreateFailure(p0: String?) {}
    override fun onSetFailure(p0: String?) {}
}
