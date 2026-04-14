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
import java.io.IOException
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "OrchestratorPeer"

/** Holds a deferred ICE-building task within a single [OrchestratorPeer.poll] cycle. */
private data class BuildJob(
    val remotePeerId: String,
    val type: String,       // "offer" or "answer"
    val offerSdp: String? = null
)

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
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun2.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun3.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun4.l.google.com:19302").createIceServer()
        )

        /** Drop a PeerEntry if DC never opened within this window. */
        private const val HANDSHAKE_TIMEOUT_MS = 90_000L
        /** How often to send a ping on open DataChannels. */
        private const val DC_PING_MS           = 30_000L
        /** Close peer if no pong received for this long. */
        private const val DC_PONG_TIMEOUT_MS   = 90_000L
        /** Delay before forcing close after ICE DISCONNECTED.
         *  30 s gives ICE enough time to self-heal through WiFi blips (2.4 GHz channel
         *  noise, brief NAT rebinds) without tearing down a healthy connection.
         *  Matches the Node.js ICE_DISCONNECT_GRACE_MS on the orchestrator side. */
        private const val ICE_DISCONNECT_GRACE_MS = 30_000L
        /** Consecutive Sheets IO failures before forcing a mesh reconnect (refreshes token). */
        private const val SHEETS_FAILURE_THRESHOLD = 3
        /** Consecutive decrypt-failure polls before deciding the AES key has been cycled. */
        private const val DECRYPT_FAILURE_THRESHOLD = 3
        /** If alone (zero alive peers) for this many ms, invoke [onAloneTimeout] to
         *  trigger a re-bootstrap that re-reads Drive sheet IDs. */
        private const val ALONE_TIMEOUT_MS = 60_000L
    }

    /* ---------- State ---------- */

    /** RTCPeerConnection + data channel per remote peerId. */
    private data class PeerEntry(
        val pc: PeerConnection,
        val dc: DataChannel?,
        var state: String = "connecting",
        val createdAt: Long = System.currentTimeMillis()
    )

    private val peers    = ConcurrentHashMap<String, PeerEntry>()
    /** Tracks epoch-ms of last pong received per peer, for DC keepalive. */
    private val lastPong = ConcurrentHashMap<String, Long>()
    /** Counts consecutive Sheets API failures; resets on a successful read to detect token expiry. */
    private val _sheetsFailures = AtomicInteger(0)
    /** Counts consecutive polls where GCM decryption fails on all encrypted cells.
     *  When this exceeds [DECRYPT_FAILURE_THRESHOLD] the AES key has been cycled remotely
     *  and [onSignalKeyStale] is invoked to trigger a key re-fetch. */
    private val _decryptFailures = AtomicInteger(0)
    /** Epoch-ms when the peer first observed zero alive peers.  Reset when ≥1 peer is found. */
    @Volatile private var _aloneSince = 0L

    /**
     * Called when consecutive GCM decryption failures indicate the signal key was cycled.
     * Default: no-op.  [WebRtcService] overrides this to clear the cached key and reconnect.
     */
    var onSignalKeyStale: (() -> Unit)? = null

    /**
     * Called when a waymark-key-exchange message arrives over the DataChannel.
     * WebRtcService overrides this to store the key and switch to the public sheet.
     */
    var onKeyReceived: ((keyHex: String) -> Unit)? = null

    /** Unique 8-char hex nonce generated each time this peer starts.  Written into the
     *  heartbeat so remote peers can detect a restart and rebuild the DataChannel
     *  immediately rather than waiting for ICE teardown (crash-recovery). */
    private val sessionNonce: String = run {
        val bytes = ByteArray(4).also { SecureRandom().nextBytes(it) }
        bytes.joinToString("") { "%02x".format(it) }
    }
    /** Last observed presence nonce per remote peerId — used to detect peer restarts. */
    private val remoteNonces = ConcurrentHashMap<String, String>()

    /**
     * Invoked on the IO dispatcher whenever the number of open DataChannel
     * peers changes.  The service uses this to update the foreground
     * notification status in real time.
     *
     * @param connected True when at least one DataChannel is OPEN
     * @param peerCount Number of peers with an OPEN DataChannel
     */
    var onConnectionStateChanged: ((connected: Boolean, peerCount: Int) -> Unit)? = null

    /**
     * Invoked when the peer has been polling for [ALONE_TIMEOUT_MS] with zero
     * alive remote peers.  WebRtcService uses this to trigger a full
     * re-bootstrap (re-read Drive sheet IDs) to recover from stale sheets.
     */
    var onAloneTimeout: (() -> Unit)? = null

    /** Assigned signaling block row (0-based index into signaling column). */
    @Volatile private var block = -1

    @Volatile var destroyed = false
        private set

    /** True when this peer has successfully claimed a signaling slot and is active in the mesh. */
    val isInMesh: Boolean get() = block >= 0 && !destroyed

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
        scope.launch {
            delay(DC_PING_MS)
            while (!destroyed) {
                pingAndPrune()
                delay(DC_PING_MS)
            }
        }
    }

    /** Leave the mesh and release all resources. */
    fun stop() {
        destroyed = true
        scope.cancel()
        // Snapshot and clear the peers map *before* disposing PeerConnections.
        // Clearing first prevents ICE-CLOSED callbacks (fired from a native WebRTC
        // thread) from calling dispose() a second time on an already-disposed object,
        // which causes a native use-after-free crash.
        val snapshot = peers.values.toList()
        peers.clear()
        lastPong.clear()
        remoteNonces.clear()
        // clearPresence and dispose run on a background thread so stop() never
        // blocks the calling thread (onStartCommand / onDestroy run on main thread).
        CoroutineScope(Dispatchers.IO).launch {
            if (block >= 0) signalingClient.clearPresence(block)
            snapshot.forEach { entry ->
                try { entry.dc?.dispose() } catch (_: Exception) {}
                try { entry.pc.dispose()  } catch (_: Exception) {}
            }
        }
    }

    /* ---------- Signaling: join ---------- */

    private suspend fun join() = withContext(Dispatchers.IO) {
        val vals = signalingClient.readAll()
        // If this device crashed without calling stop(), its presence row is still live
        // in the sheet.  Reclaim the same slot so remote peers can find us at the
        // expected block — avoids a slot mismatch that delays reconnection by a full
        // ALIVE_TTL window.
        var reclaimedBlock = -1
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            val row = WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE
            val p = parseJson(vals.getOrNull(row)) ?: continue
            if (p.optString("peerId") == peerId) {
                reclaimedBlock = row
                Log.i(TAG, "Reclaiming stale slot $row from previous session (crash recovery)")
                break
            }
        }
        block = if (reclaimedBlock >= 0) reclaimedBlock else findSlot(vals)
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
                put("nonce", sessionNonce)
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
            val vals     = signalingClient.readAll()
            _sheetsFailures.set(0)  // successful Sheets read — reset error count

            // Detect cycled AES key: if encrypted cells consistently fail GCM decryption,
            // the owner has rotated the key and this peer needs to re-fetch it via OAuth.
            if (signalingClient.decryptFailureCount > 0) {
                val failRow = _decryptFailures.incrementAndGet()
                if (failRow >= DECRYPT_FAILURE_THRESHOLD) {
                    Log.w(TAG, "Signal key appears cycled ($failRow consecutive decrypt failures) — notifying service")
                    _decryptFailures.set(0)
                    onSignalKeyStale?.invoke()
                    return@withContext
                }
            } else {
                _decryptFailures.set(0)
            }

            // ── Slot eviction check ──
            // If another peer overwrote our presence cell (collision), our
            // heartbeat is gone.  Detect this and re-join on a different slot
            // immediately rather than silently operating on a clobbered block.
            val myPresence = parseJson(vals.getOrNull(block))
            if (myPresence == null || myPresence.optString("peerId") != peerId) {
                val evictedBy = myPresence?.optString("peerId") ?: "(empty)"
                Log.w(TAG, "Slot $block was taken by $evictedBy — re-joining mesh")
                // Close all connections — they were built with the old block's signal rows
                for ((rId, entry) in peers.entries.toList()) {
                    peers.remove(rId)?.pc?.dispose()
                    lastPong.remove(rId)
                }
                remoteNonces.clear()
                fireConnectionState()
                block = findSlot(vals)
                if (block < 0) {
                    Log.e(TAG, "No free slot after eviction — mesh full")
                    return@withContext
                }
                Log.i(TAG, "Re-joined mesh at block=$block")
                heartbeat()
                return@withContext // skip rest of poll — next cycle discovers peers
            }

            val alive    = scanAlive(vals)
            val aliveIds = alive.map { it.optString("peerId") }.toSet()

            // ── Alone timeout: if zero alive peers for ALONE_TIMEOUT_MS, trigger re-bootstrap ──
            if (aliveIds.isEmpty()) {
                val now = System.currentTimeMillis()
                if (_aloneSince == 0L) _aloneSince = now
                if (now - _aloneSince >= ALONE_TIMEOUT_MS) {
                    Log.w(TAG, "No alive peers for ${(now - _aloneSince) / 1000}s — requesting re-bootstrap")
                    _aloneSince = 0L // reset so it doesn't fire again immediately after re-join
                    onAloneTimeout?.invoke()
                    return@withContext
                }
            } else {
                _aloneSince = 0L
            }

            // Evict stuck handshakes — entries where DC never opened within HANDSHAKE_TIMEOUT_MS
            val now = System.currentTimeMillis()
            for ((rId, entry) in peers.entries.toList()) {
                if (entry.dc?.state() != DataChannel.State.OPEN &&
                        now - entry.createdAt > HANDSHAKE_TIMEOUT_MS) {
                    Log.w(TAG, "Stuck handshake for $rId (${(now - entry.createdAt) / 1000}s) — dropping")
                    peers.remove(rId)?.pc?.dispose()
                    lastPong.remove(rId)
                }
            }

            // Remove dead peers
            val deadIds = peers.keys.filter { it !in aliveIds }
            for (id in deadIds) {
                peers.remove(id)?.pc?.dispose()
                remoteNonces.remove(id)
                Log.d(TAG, "Removed dead peer $id")
            }
            if (deadIds.isNotEmpty()) fireConnectionState()

            var myOffers  = parseJson(vals.getOrNull(block + WaymarkConfig.OFF_OFFERS))  ?: JSONObject()
            var myAnswers = parseJson(vals.getOrNull(block + WaymarkConfig.OFF_ANSWERS)) ?: JSONObject()
            var offDirty  = false
            var ansDirty  = false

            // Clean stale entries
            for (key in myOffers.keys().asSequence().toList()) {
                if (key !in aliveIds) { myOffers.remove(key); offDirty = true }
            }
            for (key in myAnswers.keys().asSequence().toList()) {
                if (key !in aliveIds) { myAnswers.remove(key); ansDirty = true }
            }

            // Collect ICE-building jobs; handle fast (non-ICE) ops inline
            val buildJobs = mutableListOf<BuildJob>()
            for (remote in alive) {
                val remotePeerId = remote.optString("peerId")
                val remoteBlock  = remote.optInt("block", -1)
                if (remotePeerId == peerId || remoteBlock < 0) continue

                // Detect a remote peer restart via nonce change.  A changed nonce means
                // the remote crashed and rejoined — close the stale DataChannel so the
                // rest of the loop rebuilds the connection this cycle.
                val remoteNonce = remote.optString("nonce", "")
                if (remoteNonce.isNotBlank()) {
                    val knownNonce = remoteNonces[remotePeerId]
                    if (knownNonce != null && knownNonce != remoteNonce && peers.containsKey(remotePeerId)) {
                        Log.i(TAG, "Remote $remotePeerId restarted (nonce changed) — closing stale connection for rebuild")
                        peers.remove(remotePeerId)?.pc?.dispose()
                        lastPong.remove(remotePeerId)
                        fireConnectionState()
                        if (myOffers.has(remotePeerId)) { myOffers.remove(remotePeerId); offDirty = true }
                        if (myAnswers.has(remotePeerId)) { myAnswers.remove(remotePeerId); ansDirty = true }
                    }
                    remoteNonces[remotePeerId] = remoteNonce
                }

                val entry = peers[remotePeerId]

                // Skip already-connected peers
                if (entry?.dc?.state() == DataChannel.State.OPEN) {
                    if (myOffers.has(remotePeerId))  { myOffers.remove(remotePeerId);  offDirty = true }
                    if (myAnswers.has(remotePeerId)) { myAnswers.remove(remotePeerId); ansDirty = true }
                    continue
                }

                val weInit = peerId < remotePeerId

                if (weInit) {
                    // Drop stale pending offers — mirrors Node.js OFFER_MAX_AGE check
                    val pendingOffer = myOffers.optJSONObject(remotePeerId)
                    if (pendingOffer != null) {
                        val age = System.currentTimeMillis() - pendingOffer.optLong("ts", 0)
                        if (age > WaymarkConfig.OFFER_MAX_AGE_MS) {
                            Log.w(TAG, "Stale offer for $remotePeerId (${age / 1000}s) — dropping, will rebuild next poll")
                            peers.remove(remotePeerId)?.pc?.dispose()
                            lastPong.remove(remotePeerId)
                            myOffers.remove(remotePeerId)
                            offDirty = true
                            continue  // rebuild on next poll cycle (same as original)
                        }
                    }

                    if (entry == null) {
                        buildJobs.add(BuildJob(remotePeerId, "offer"))
                    } else {
                        // Check for answer — fast op, no ICE gathering needed
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
                            buildJobs.add(BuildJob(remotePeerId, "answer", offer.getString("sdp")))
                        }
                    }
                }
            }

            // Run all ICE-gathering operations concurrently instead of sequentially
            if (buildJobs.isNotEmpty()) {
                coroutineScope {
                    buildJobs.map { job ->
                        async {
                            try {
                                when (job.type) {
                                    "offer" -> {
                                        val sdp = buildOffer(job.remotePeerId)
                                        if (sdp != null) Triple(job.remotePeerId, "offer", sdp) else null
                                    }
                                    else -> {
                                        val sdp = buildAnswer(job.remotePeerId, job.offerSdp!!)
                                        if (sdp != null) Triple(job.remotePeerId, "answer", sdp) else null
                                    }
                                }
                            } catch (e: Exception) {
                                Log.e(TAG, "Build ${job.type} for ${job.remotePeerId} failed", e)
                                peers.remove(job.remotePeerId)?.pc?.dispose()
                                null
                            }
                        }
                    }.awaitAll().filterNotNull().forEach { (rId, type, sdp) ->
                        when (type) {
                            "offer"  -> { myOffers.put(rId, JSONObject().apply { put("sdp", sdp); put("ts", System.currentTimeMillis()) }); offDirty = true }
                            "answer" -> { myAnswers.put(rId, JSONObject().apply { put("sdp", sdp); put("ts", System.currentTimeMillis()) }); ansDirty = true }
                        }
                    }
                }
            }

            if (offDirty) writeOffers(myOffers)
            if (ansDirty) writeAnswers(myAnswers)

        } catch (e: Exception) {
            Log.e(TAG, "Poll error", e)
            // After SHEETS_FAILURE_THRESHOLD consecutive IO failures, propagate to the
            // outer start() retry loop so the peer rejoins the mesh with a fresh token.
            if (e is IOException && _sheetsFailures.incrementAndGet() >= SHEETS_FAILURE_THRESHOLD) {
                _sheetsFailures.set(0)
                Log.w(TAG, "Repeated Sheets IO failures — forcing mesh reconnect to use fresh token")
                throw e
            }
        }
    }

    /* ---------- Offer / Answer builders ---------- */

    /**
     * Create a WebRTC offer and wait for ICE gathering to complete so the
     * returned SDP contains all ICE candidates (vanilla ICE — no trickle).
     * Returns the complete SDP string, or null on failure.
     */
    private suspend fun buildOffer(remotePeerId: String): String? = withContext(Dispatchers.IO) {
        val iceGatheringDone = CompletableDeferred<Unit>()
        val pc = createPeerConnection(remotePeerId, iceGatheringDone) ?: return@withContext null
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

        // Wait for ICE gathering to complete (wakes immediately via onIceGatheringChange callback)
        waitForIceGathering(iceGatheringDone)
        pc.localDescription?.description
    }

    /**
     * Accept a remote offer and create an answer, waiting for ICE gathering.
     * Returns the complete answer SDP string, or null on failure.
     */
    private suspend fun buildAnswer(remotePeerId: String, offerSdp: String): String? = withContext(Dispatchers.IO) {
        val iceGatheringDone = CompletableDeferred<Unit>()
        val pc = createPeerConnection(remotePeerId, iceGatheringDone) ?: return@withContext null
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

        // Wait for ICE gathering to complete (wakes immediately via onIceGatheringChange callback)
        waitForIceGathering(iceGatheringDone)
        pc.localDescription?.description
    }

    /**
     * Waits for ICE gathering to complete using a callback-driven deferred —
     * wakes up immediately when COMPLETE fires rather than polling every 200 ms.
     * Times out after [timeoutMs] ms if gathering never completes.
     */
    private suspend fun waitForIceGathering(done: CompletableDeferred<Unit>, timeoutMs: Long = 12_000) {
        withTimeoutOrNull(timeoutMs) { done.await() }
    }

    /* ---------- PeerConnection factory ---------- */

    private fun createPeerConnection(remotePeerId: String, iceGatheringDone: CompletableDeferred<Unit>): PeerConnection? {
        val config = PeerConnection.RTCConfiguration(STUN_SERVERS).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        // pcRef lets onDataChannel re-insert an entry pruned by the handshake-timeout cleanup
        // while ICE was still gathering. Set synchronously before any async callback can fire.
        var pcRef: PeerConnection? = null
        val pc = factory(context).createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
                if (state == PeerConnection.IceGatheringState.COMPLETE) {
                    iceGatheringDone.complete(Unit)
                }
            }
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                Log.d(TAG, "ICE $remotePeerId → $state")
                when (state) {
                    PeerConnection.IceConnectionState.FAILED,
                    PeerConnection.IceConnectionState.CLOSED -> {
                        peers.remove(remotePeerId)?.pc?.dispose()
                        lastPong.remove(remotePeerId)
                        fireConnectionState()
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED -> {
                        // Give ICE a short window to self-heal before forcing a reconnect
                        scope.launch {
                            delay(ICE_DISCONNECT_GRACE_MS)
                            val entry = peers[remotePeerId] ?: return@launch
                            if (entry.pc.iceConnectionState() ==
                                    PeerConnection.IceConnectionState.DISCONNECTED) {
                                Log.w(TAG, "ICE $remotePeerId still DISCONNECTED after ${ICE_DISCONNECT_GRACE_MS / 1000}s — closing")
                                peers.remove(remotePeerId)?.pc?.dispose()
                                lastPong.remove(remotePeerId)
                                fireConnectionState()
                            }
                        }
                    }
                    else -> {}
                }
            }
            override fun onDataChannel(dc: DataChannel) {
                val existing = peers[remotePeerId]
                if (existing != null) {
                    peers[remotePeerId] = existing.copy(dc = dc)
                } else {
                    // Entry was evicted (e.g., handshake timeout) but the DataChannel arrived
                    // anyway — re-insert so the peer is tracked and notifications are delivered.
                    val captured = pcRef ?: return
                    Log.w(TAG, "onDataChannel for evicted $remotePeerId — re-inserting entry")
                    peers[remotePeerId] = PeerEntry(captured, dc, state = "connecting")
                }
                attachDataChannelObserver(dc, remotePeerId)
            }
            override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
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
        pcRef = pc
        return pc
    }

    /* ---------- DataChannel message processing ---------- */

    /** Counts open DataChannels and fires the connection-state callback. */
    private fun fireConnectionState() {
        val openCount = peers.values.count { it.dc?.state() == DataChannel.State.OPEN }
        onConnectionStateChanged?.invoke(openCount > 0, openCount)
    }

    /**
     * Sends a ping on every open DataChannel and closes any peer that hasn't
     * responded with a pong within DC_PONG_TIMEOUT_MS.
     */
    private fun pingAndPrune() {
        val now = System.currentTimeMillis()
        val ping = JSONObject().apply {
            put("type", "waymark-ping")
            put("ts", now)
        }.toString()
        for ((rId, entry) in peers.entries.toList()) {
            val dc = entry.dc ?: continue
            if (dc.state() != DataChannel.State.OPEN) continue
            try {
                val bytes = ping.toByteArray(Charsets.UTF_8)
                dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
            } catch (e: Exception) {
                Log.w(TAG, "Ping send failed for $rId: ${e.message}")
            }
            val last = lastPong.getOrDefault(rId, entry.createdAt)
            if (now - last > DC_PONG_TIMEOUT_MS) {
                Log.w(TAG, "Peer $rId pong timeout (${(now - last) / 1000}s) — closing")
                peers.remove(rId)?.pc?.dispose()
                lastPong.remove(rId)
                fireConnectionState()
            }
        }
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
                    handleMessage(String(bytes, Charsets.UTF_8), remotePeerId)
                }
            }
        })
    }

    private fun handleMessage(json: String, remotePeerId: String) {
        try {
            val obj  = JSONObject(json)
            val type = obj.optString("type")
            when (type) {
                "waymark-ping" -> {
                    val pong = JSONObject().apply {
                        put("type", "waymark-pong")
                        put("ts", System.currentTimeMillis())
                    }.toString()
                    try {
                        peers[remotePeerId]?.dc?.let { dc ->
                            if (dc.state() == DataChannel.State.OPEN) {
                                val bytes = pong.toByteArray(Charsets.UTF_8)
                                dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Pong send failed: ${e.message}")
                    }
                }
                "waymark-pong" -> {
                    lastPong[remotePeerId] = System.currentTimeMillis()
                }
                "waymark-key-exchange" -> {
                    val keyHex = obj.optString("key", "")
                    if (keyHex.length == 64) {
                        Log.i(TAG, "Key exchange received from $remotePeerId (${keyHex.length / 2} bytes)")
                        onKeyReceived?.invoke(keyHex)
                    } else {
                        Log.w(TAG, "Key exchange from $remotePeerId: invalid key length ${keyHex.length}")
                    }
                }
                "waymark-notification", "orchestrator-alert" -> {
                    val title = obj.optString("title", "Waymark")
                    val body  = obj.optString("body", obj.optString("message", ""))
                    Log.i(TAG, "Notification received — title=\"$title\" body=\"$body\"")
                    if (body.isNotBlank()) onNotification(title, body)
                }
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
