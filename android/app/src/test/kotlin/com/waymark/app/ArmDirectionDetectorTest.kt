/* ============================================================
   ArmDirectionDetectorTest.kt — Reality-rooted detection tests

   The commit gate for pointing detection. Runs the landmark-free arm
   detector against REAL frames captured on-device and hand-labeled
   from the capture evidence.

   Each fixture ships two files under app/src/test/resources/vision-fixtures:
     - {base}.jpg : human-viewable evidence (the frame)
     - {base}.rgb : the exact 48x64 RGB grid the detector consumes
                    (raw bytes, 48*64*3), so the test needs no image
                    decoder on the Android unit-test classpath.

   Categories (labels.csv):
     - "point"  : a real arm/hand is present  -> MUST detect
     - "empty"  : no person (black frame)     -> MUST NOT detect (no FP)
     - "point_hard"    : backlit/dark/fragmented real arm   (non-gating)
     - "ambiguous_neg" : torso/face/gray-deck/thin-wood-strip (non-gating;
                         single-frame pixels cannot separate these — the
                         live pipeline uses temporal motion gating)
   ============================================================ */

package com.waymark.app

import org.junit.Assert.*
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader

class ArmDirectionDetectorTest {

    private data class Fixture(val base: String, val label: Int, val category: String)

    private val gridW = 48
    private val gridH = 64

    private fun loadManifest(): List<Fixture> {
        val stream = javaClass.getResourceAsStream("/vision-fixtures/labels.csv")
            ?: error("vision-fixtures/labels.csv not found on test classpath")
        return BufferedReader(InputStreamReader(stream)).useLines { lines ->
            lines.drop(1)
                .filter { it.isNotBlank() }
                .map {
                    val parts = it.split(",")
                    Fixture(parts[0].trim(), parts[1].trim().toInt(), parts[2].trim())
                }
                .toList()
        }
    }

    private fun pixelsOf(base: String): IntArray {
        val stream = javaClass.getResourceAsStream("/vision-fixtures/$base.rgb")
            ?: error("fixture $base.rgb not found on test classpath")
        val bytes = stream.readBytes()
        require(bytes.size == gridW * gridH * 3) { "$base.rgb unexpected size ${bytes.size}" }
        val px = IntArray(gridW * gridH)
        for (i in 0 until gridW * gridH) {
            val r = bytes[i * 3].toInt() and 0xFF
            val g = bytes[i * 3 + 1].toInt() and 0xFF
            val b = bytes[i * 3 + 2].toInt() and 0xFF
            px[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
        return px
    }

    @Test
    fun `real pointing frames are detected`() {
        val detector = ArmDirectionDetector()
        val fixtures = loadManifest().filter { it.category == "point" }
        assertTrue("expected point fixtures on classpath", fixtures.isNotEmpty())

        val misses = fixtures
            .filter { detector.detectFromPixels(pixelsOf(it.base), gridW, gridH) == null }
            .map { it.base }

        assertTrue("Real pointing frames that were NOT detected: $misses", misses.isEmpty())
    }

    @Test
    fun `empty frames produce no false positive`() {
        val detector = ArmDirectionDetector()
        val fixtures = loadManifest().filter { it.category == "empty" }
        assertTrue("expected empty fixtures on classpath", fixtures.isNotEmpty())

        val falsePositives = fixtures
            .filter { detector.detectFromPixels(pixelsOf(it.base), gridW, gridH) != null }
            .map { it.base }

        assertTrue("Empty frames that falsely detected an arm: $falsePositives", falsePositives.isEmpty())
    }

    @Test
    fun `detected pointing directions stay inside the frame`() {
        val detector = ArmDirectionDetector()
        for (f in loadManifest().filter { it.category == "point" }) {
            val result = detector.detectFromPixels(pixelsOf(f.base), gridW, gridH) ?: continue
            assertTrue("${f.base} entry.x", result.entry.x in 0f..1f)
            assertTrue("${f.base} entry.y", result.entry.y in 0f..1f)
            assertTrue("${f.base} tip.x", result.tip.x in 0f..1f)
            assertTrue("${f.base} tip.y", result.tip.y in 0f..1f)
            assertTrue("${f.base} confidence", result.confidence in 0f..1f)
        }
    }

    @Test
    fun `detector runs on every fixture and meets a detection floor`() {
        val detector = ArmDirectionDetector()
        val all = loadManifest()
        assertTrue("fixtures should exist", all.size >= 40)
        val detected = all.count { detector.detectFromPixels(pixelsOf(it.base), gridW, gridH) != null }
        assertTrue(detected >= all.count { it.category == "point" })
    }
}
