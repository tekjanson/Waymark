/* ============================================================
   calendar-api.js — Google Calendar REST API v3 wrapper

   All functions are pure async fetch() calls — no caching,
   no side effects. The caller provides an OAuth access token.

   Note: Requires calendar.readonly scope.
   ============================================================ */

const BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Fetch the list of calendars in the user's calendar list.
 * @param {string} token  OAuth2 access token
 * @returns {Promise<{items: Object[]}>}  calendars with id, summary, primary fields
 */
export async function listCalendars(token) {
  const res = await fetch(`${BASE}/users/me/calendarList?minAccessRole=reader`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Calendar listCalendars failed: ${res.status} ${err.error?.message || ''}`);
  }
  return res.json();
}

/**
 * List events from a calendar within a time window.
 * @param {string} token        OAuth2 access token
 * @param {string} calendarId   Calendar ID — defaults to 'primary'
 * @param {Object} [opts]
 * @param {string} [opts.timeMin]     ISO 8601 lower bound (inclusive)
 * @param {string} [opts.timeMax]     ISO 8601 upper bound (exclusive)
 * @param {number} [opts.maxResults]  Max events to return (default 50)
 * @returns {Promise<{items: Object[]}>}  event objects
 */
export async function listEvents(token, calendarId = 'primary', opts = {}) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(opts.maxResults || 50),
  });
  if (opts.timeMin) params.set('timeMin', opts.timeMin);
  if (opts.timeMax) params.set('timeMax', opts.timeMax);

  const res = await fetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Calendar listEvents failed: ${res.status} ${err.error?.message || ''}`);
  }
  return res.json();
}
