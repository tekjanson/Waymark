/* ============================================================
   TokenRefresherTest.kt — Unit tests for TokenRefresher helpers

   Tests the pure helper logic inside TokenRefresher:
   cookie parsing, URL construction, response parsing, and
   the token-staleness detection constants.

   All tests are pure JVM — no Android context or CookieManager
   required.  The pure helpers live in TokenRefresher.Companion so
   they are callable without an instance.
   ============================================================ */

package com.waymark.app

import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for the two-tier token management logic in TokenRefresher.
 * Pure JVM tests — no Android runtime needed.
 */
class TokenRefresherTest {

    /* ---------- parseCookieValue ---------- */

    @Test
    fun `parseCookieValue extracts waymark_refresh from single-cookie string`() {
        val result = TokenRefresher.parseCookieValue("waymark_refresh=abc123def456", "waymark_refresh")
        assertEquals("abc123def456", result)
    }

    @Test
    fun `parseCookieValue extracts named cookie from multi-cookie string`() {
        val cookieStr = "other=xyz; waymark_refresh=mytoken789; session=foo"
        val result = TokenRefresher.parseCookieValue(cookieStr, "waymark_refresh")
        assertEquals("mytoken789", result)
    }

    @Test
    fun `parseCookieValue returns null when cookie not present`() {
        val result = TokenRefresher.parseCookieValue("other=xyz; session=foo", "waymark_refresh")
        assertNull(result)
    }

    @Test
    fun `parseCookieValue returns null for blank cookie string`() {
        assertNull(TokenRefresher.parseCookieValue("", "waymark_refresh"))
    }

    @Test
    fun `parseCookieValue handles cookie with leading whitespace in name`() {
        // CookieManager may return "name=value; name2=value2" with spaces after semicolons
        val result = TokenRefresher.parseCookieValue("other=xyz;  waymark_refresh=trimmedval", "waymark_refresh")
        assertEquals("trimmedval", result)
    }

    @Test
    fun `parseCookieValue returns null when value is blank`() {
        val result = TokenRefresher.parseCookieValue("waymark_refresh=", "waymark_refresh")
        assertNull(result)
    }

    @Test
    fun `parseCookieValue does not match partial cookie names`() {
        // "waymark_refresh_other" should not match "waymark_refresh"
        val result = TokenRefresher.parseCookieValue("waymark_refresh_other=secret", "waymark_refresh")
        assertNull(result)
    }

    /* ---------- buildAuthCookieUrl ---------- */

    @Test
    fun `buildAuthCookieUrl appends auth-refresh to production base URL`() {
        assertEquals(
            "https://swiftirons.com/waymark/auth/refresh",
            TokenRefresher.buildAuthCookieUrl("https://swiftirons.com/waymark/")
        )
    }

    @Test
    fun `buildAuthCookieUrl trims trailing slash before appending`() {
        assertEquals(
            "https://example.com/waymark/auth/refresh",
            TokenRefresher.buildAuthCookieUrl("https://example.com/waymark/")
        )
    }

    @Test
    fun `buildAuthCookieUrl works for emulator localhost URL`() {
        assertEquals(
            "http://10.0.2.2:3000/auth/refresh",
            TokenRefresher.buildAuthCookieUrl("http://10.0.2.2:3000/")
        )
    }

    @Test
    fun `buildAuthCookieUrl works when base URL has no trailing slash`() {
        assertEquals(
            "https://example.com/waymark/auth/refresh",
            TokenRefresher.buildAuthCookieUrl("https://example.com/waymark")
        )
    }

    /* ---------- buildRefreshUrl ---------- */

    @Test
    fun `buildRefreshUrl returns same URL as buildAuthCookieUrl`() {
        val base = "https://swiftirons.com/waymark/"
        assertEquals(
            TokenRefresher.buildAuthCookieUrl(base),
            TokenRefresher.buildRefreshUrl(base)
        )
    }

    /* ---------- parseAccessToken ---------- */

    @Test
    fun `parseAccessToken extracts access_token from server response`() {
        val json = """{"access_token":"ya29.abc123","expires_in":3600,"token_type":"Bearer"}"""
        assertEquals("ya29.abc123", TokenRefresher.parseAccessToken(json))
    }

    @Test
    fun `parseAccessToken returns null when access_token absent`() {
        val json = """{"error":"invalid_grant","error_description":"Token has been expired"}"""
        assertNull(TokenRefresher.parseAccessToken(json))
    }

    @Test
    fun `parseAccessToken returns null for empty response`() {
        assertNull(TokenRefresher.parseAccessToken(""))
    }

    @Test
    fun `parseAccessToken returns null for malformed JSON`() {
        assertNull(TokenRefresher.parseAccessToken("not-json"))
    }

    @Test
    fun `parseAccessToken returns null when access_token is blank string`() {
        val json = """{"access_token":"","expires_in":3600}"""
        assertNull(TokenRefresher.parseAccessToken(json))
    }

    /* ---------- Token lifecycle constants ---------- */

    @Test
    fun `ACCESS_TOKEN_PREEMPT_MS is less than ACCESS_TOKEN_TTL_MS`() {
        // Sanity-check: the preempt window must be shorter than the full TTL
        assertTrue(
            "Preempt window must be smaller than TTL",
            WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS < WaymarkConfig.ACCESS_TOKEN_TTL_MS
        )
    }

    @Test
    fun `Tier 1 active window is at least 50 minutes`() {
        // The useful lifetime of Tier 1 (before Tier 2 kicks in) should be ≥50 min
        val tier1Window = WaymarkConfig.ACCESS_TOKEN_TTL_MS - WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS
        assertTrue(
            "Tier 1 window should be at least 50 minutes",
            tier1Window >= 50 * 60 * 1000L
        )
    }

    @Test
    fun `Tier 2 preempt window is positive and at most 10 minutes`() {
        // The preempt window should be a reasonable buffer (1–10 min)
        val preemptMs = WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS
        assertTrue("Preempt window must be positive", preemptMs > 0)
        assertTrue("Preempt window should not exceed 10 min", preemptMs <= 10 * 60 * 1000L)
    }
}

