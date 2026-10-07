/* ============================================================
   PhoneOrientationTracker.kt — Phone IMU orientation source

   Streams the phone's absolute orientation as a unit quaternion from
   the fused rotation-vector sensor. The glasses app fuses this with the
   G2 IMU to compensate for drift as both devices move on a human.

   Quaternion (not Euler) so orientation composes cleanly downstream —
   no gimbal lock, no axis-convention ambiguity. Thread-safe: the render
   loop samples the latest reading synchronously at any time.
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

class PhoneOrientationTracker(context: Context) : SensorEventListener {

    private val sensorManager =
        context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    // Prefer the magnetometer-fused rotation vector (absolute heading); fall
    // back to the gyro+accel game rotation vector when no compass is present.
    private val rotationSensor: Sensor? =
        sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            ?: sensorManager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)

    // Latest orientation as (x, y, z, w). Identity until the first event.
    @Volatile var x = 0f; private set
    @Volatile var y = 0f; private set
    @Volatile var z = 0f; private set
    @Volatile var w = 1f; private set
    @Volatile var hasReading = false; private set

    val available: Boolean get() = rotationSensor != null

    @Volatile private var registered = false

    fun start() {
        if (registered) return
        val sensor = rotationSensor ?: return
        sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
        registered = true
    }

    fun stop() {
        if (!registered) return
        sensorManager.unregisterListener(this)
        registered = false
    }

    override fun onSensorChanged(event: SensorEvent) {
        // getQuaternionFromVector writes [w, x, y, z].
        val q = FloatArray(4)
        SensorManager.getQuaternionFromVector(q, event.values)
        w = q[0]; x = q[1]; y = q[2]; z = q[3]
        hasReading = true
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }
}
