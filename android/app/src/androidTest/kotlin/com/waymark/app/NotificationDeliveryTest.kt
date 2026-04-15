/* ============================================================
   NotificationDeliveryTest.kt — E2E test that verifies
   Android notifications are actually posted to the system.

   Runs on a real device. Uses NotificationManager to check
   that notifications appear in the status bar after being
   triggered through the same code path as production.
   ============================================================ */

package com.waymark.app

import android.app.NotificationManager
import android.content.Context
import android.service.notification.StatusBarNotification
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotificationDeliveryTest {

    private lateinit var ctx: Context
    private lateinit var nm: NotificationManager

    @Before
    fun setUp() {
        ctx = InstrumentationRegistry.getInstrumentation().targetContext
        NotificationHelper.createChannels(ctx)
        nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Clear any existing notifications from previous test runs
        nm.cancelAll()
    }

    @Test
    fun showMessage_postsNotificationToSystem() {
        val title = "Test Title ${System.currentTimeMillis()}"
        val body = "Test body for notification delivery validation"

        NotificationHelper.showMessage(ctx, title, body)

        // Give the system a moment to process
        Thread.sleep(1000)

        val active: Array<StatusBarNotification> = nm.activeNotifications
        val found = active.any { sbn ->
            val extras = sbn.notification.extras
            val notifTitle = extras.getCharSequence("android.title")?.toString() ?: ""
            val notifText = extras.getCharSequence("android.text")?.toString() ?: ""
            notifTitle == title && notifText == body
        }

        assertTrue(
            "Notification should be visible in the status bar. " +
                "Active: ${active.map { it.notification.extras.getCharSequence("android.title") }}",
            found
        )
    }

    @Test
    fun showMessage_multipleNotifications_eachGetUniqueId() {
        val notifications = (1..3).map { i ->
            val title = "Multi-Test #$i (${System.currentTimeMillis()})"
            val body = "Body $i"
            NotificationHelper.showMessage(ctx, title, body)
            Pair(title, body)
        }

        Thread.sleep(1500)

        val active = nm.activeNotifications
        for ((title, _) in notifications) {
            val found = active.any { sbn ->
                sbn.notification.extras.getCharSequence("android.title")?.toString() == title
            }
            assertTrue("Notification '$title' should be in the status bar", found)
        }
    }

    @Test
    fun buildServiceNotification_connected() {
        val notif = NotificationHelper.buildServiceNotification(ctx, connected = true, peerCount = 2)
        assertNotNull("Service notification should not be null", notif)
        // Service notification uses CHANNEL_SERVICE
        assertEquals(NotificationHelper.CHANNEL_SERVICE, notif.channelId)
    }

    @Test
    fun buildServiceNotification_disconnected() {
        val notif = NotificationHelper.buildServiceNotification(ctx, connected = false, peerCount = 0)
        assertNotNull(notif)
        assertEquals(NotificationHelper.CHANNEL_SERVICE, notif.channelId)
    }

    @Test
    fun showMessage_blankTitle_usesDefault() {
        NotificationHelper.showMessage(ctx, "", "Body with default title")

        Thread.sleep(1000)

        val active = nm.activeNotifications
        val found = active.any { sbn ->
            val notifTitle = sbn.notification.extras.getCharSequence("android.title")?.toString() ?: ""
            notifTitle == "Waymark" // default fallback title
        }
        assertTrue("Blank title should fall back to 'Waymark'", found)
    }
}
