/* ============================================================
   G2GlassesManager.kt — Even Realities G2 BLE manager
   ============================================================ */

package com.waymark.app

import android.annotation.SuppressLint
import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.nio.charset.StandardCharsets
import java.util.UUID

class G2GlassesManager(
    private val context: Context,
    private val scope: CoroutineScope,
    private val protocolSpec: G2ProtocolSpec = G2ProtocolSpec(),
) {
    companion object {
        private const val TAG = "G2GlassesManager"
    }

    data class G2ProtocolSpec(
        val deviceNameHint: String = "Even Realities G2",
        val serviceUuid: UUID? = null,
        val textCharacteristicUuid: UUID? = null,
        val chunkSizeBytes: Int = 20,
        val interChunkDelayMs: Long = 35L,
        val textMaxChars: Int = 200,
        val directBleEnabled: Boolean = false,
    )

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? = bluetoothManager.adapter
    private val scanner: BluetoothLeScanner? = adapter?.bluetoothLeScanner

    private val _state = MutableStateFlow(G2ConnectionState.DISCONNECTED)
    val state: StateFlow<G2ConnectionState> = _state.asStateFlow()

    private var gatt: BluetoothGatt? = null
    private var hudService: BluetoothGattService? = null
    private var textCharacteristic: BluetoothGattCharacteristic? = null

    private var lastSentText: String = ""
    private var lastSentTimeMs: Long = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    private val scanTimeout = Runnable {
        if (_state.value == G2ConnectionState.SCANNING) {
            stopScanSafely()
            Log.e(TAG, "BLE scan timed out without locating G2 device")
            _state.value = G2ConnectionState.ERROR
        }
    }

    @SuppressLint("MissingPermission")
    fun connect() {
        if (!protocolSpec.directBleEnabled) {
            Log.e(TAG, "Direct BLE is disabled in this build; use the public Even Realities app/bridge path instead")
            _state.value = G2ConnectionState.ERROR
            return
        }

        if (adapter == null || scanner == null || !adapter.isEnabled) {
            Log.e(TAG, "Bluetooth adapter unavailable or disabled")
            _state.value = G2ConnectionState.ERROR
            return
        }

        _state.value = G2ConnectionState.SCANNING
        scanner.startScan(scanCallback)
        mainHandler.postDelayed(scanTimeout, 15_000L)
    }

    @SuppressLint("MissingPermission")
    fun disconnect() {
        stopScanSafely()
        mainHandler.removeCallbacks(scanTimeout)
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        hudService = null
        textCharacteristic = null
        _state.value = G2ConnectionState.DISCONNECTED
    }

    @SuppressLint("MissingPermission")
    fun sendTextToHUD(text: String) {
        if (!protocolSpec.directBleEnabled) {
            Log.e(TAG, "Direct BLE is disabled in this build; HUD writes are not available in public-docs-only mode")
            _state.value = G2ConnectionState.ERROR
            return
        }

        if (_state.value != G2ConnectionState.READY) {
            return
        }

        val normalized = text.trim().take(protocolSpec.textMaxChars)
        if (normalized.isEmpty()) return

        val now = System.currentTimeMillis()
        if (normalized == lastSentText || (now - lastSentTimeMs) < 2_000L) {
            Log.d(TAG, "Dropped HUD text due to debounce: $normalized")
            return
        }

        val characteristic = textCharacteristic
        if (characteristic == null) {
            Log.e(TAG, "Text characteristic unavailable")
            _state.value = G2ConnectionState.ERROR
            return
        }

        // The source repository exposes SDK-level text updates and a 200-char cap,
        // but not raw GATT framing/chunk headers. Avoid speculative packet formats.
        if (protocolSpec.serviceUuid == null || protocolSpec.textCharacteristicUuid == null) {
            Log.e(TAG, "Protocol unresolved: missing UUIDs; refusing speculative write. Even public docs expose SDK bridge APIs, not raw GATT constants.")
            _state.value = G2ConnectionState.ERROR
            return
        }

        val payloadChunks = buildTextPayloadChunks(normalized)
        scope.launch(Dispatchers.IO) {
            payloadChunks.forEach { chunk ->
                writeCharacteristic(characteristic, chunk)
                delay(protocolSpec.interChunkDelayMs)
            }
            lastSentText = normalized
            lastSentTimeMs = now
        }
    }

    private fun buildTextPayloadChunks(text: String): List<ByteArray> {
        // Current known-safe behavior from local G2 source: UTF-8 content and content cap.
        // Exact low-level framing/chunk protocol must come from native SDK/protocol docs.
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        val size = protocolSpec.chunkSizeBytes.coerceAtLeast(1)
        if (bytes.size <= size) return listOf(bytes)

        val chunks = mutableListOf<ByteArray>()
        var offset = 0
        while (offset < bytes.size) {
            val end = (offset + size).coerceAtMost(bytes.size)
            chunks += bytes.copyOfRange(offset, end)
            offset = end
        }
        return chunks
    }

    private fun hasBleScanPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    @SuppressLint("MissingPermission")
    private fun stopScanSafely() {
        if (!hasBleScanPermission()) return
        runCatching { scanner?.stopScan(scanCallback) }
            .onFailure { err -> Log.w(TAG, "Ignoring stopScan failure", err) }
    }

    @SuppressLint("MissingPermission")
    private fun writeCharacteristic(characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        val currentGatt = gatt ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            currentGatt.writeCharacteristic(characteristic, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        } else {
            @Suppress("DEPRECATION")
            run {
                characteristic.value = value
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                currentGatt.writeCharacteristic(characteristic)
            }
        }
    }

    private val scanCallback: ScanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            val device = result?.device ?: return
            val name = device.name ?: return
            if (!name.contains(protocolSpec.deviceNameHint, ignoreCase = true)) {
                return
            }

            scanner?.stopScan(this)
            mainHandler.removeCallbacks(scanTimeout)
            _state.value = G2ConnectionState.CONNECTING
            gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed: $errorCode")
            _state.value = G2ConnectionState.ERROR
        }
    }

    private val gattCallback: BluetoothGattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "GATT connection failed status=$status")
                _state.value = G2ConnectionState.ERROR
                return
            }

            when (newState) {
                BluetoothGatt.STATE_CONNECTED -> {
                    _state.value = G2ConnectionState.CONNECTED
                    gatt.discoverServices()
                }
                BluetoothGatt.STATE_DISCONNECTED -> {
                    _state.value = G2ConnectionState.DISCONNECTED
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Service discovery failed status=$status")
                _state.value = G2ConnectionState.ERROR
                return
            }

            val serviceUuid = protocolSpec.serviceUuid
            val charUuid = protocolSpec.textCharacteristicUuid
            if (serviceUuid == null || charUuid == null) {
                Log.e(TAG, "Protocol UUIDs unresolved from local source/public docs")
                _state.value = G2ConnectionState.ERROR
                return
            }

            hudService = gatt.services.firstOrNull { it.uuid == serviceUuid }
            textCharacteristic = hudService?.characteristics?.firstOrNull { it.uuid == charUuid }

            _state.value = if (hudService != null && textCharacteristic != null) {
                G2ConnectionState.READY
            } else {
                Log.e(TAG, "Required G2 HUD service/characteristic not found")
                G2ConnectionState.ERROR
            }
        }
    }
}
