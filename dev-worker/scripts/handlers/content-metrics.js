/**
 * handlers/content-metrics.js — Fetch engagement metrics from content platforms
 *
 * Reads a "Content Workbench" Google Sheet, finds rows with Status=Posted and
 * a Link URL, fetches metrics from the appropriate platform API, and writes
 * the updated values (likes, shares, comments, views) back to the sheet.
 *
 * Config shape (JSON in the Config column of the Worker Jobs sheet):
 * {
 *   "sheetId": "content-workbench-spreadsheet-id",
 *   "youtubeApiKey": "AIza...",        // YouTube Data API v3 key (optional)
 *   "twitterBearerToken": "AAAA..."    // Twitter API v2 Bearer token (optional)
 * }
 *
 * Supported platforms and their requirements:
 *   youtube   — YouTube Data API v3 key required (youtubeApiKey)
 *   hn        — Hacker News Algolia API, no auth required
 *   reddit    — Reddit public JSON API, no auth required
 *   twitter   — Twitter API v2 Bearer token required (twitterBearerToken)
 *   linkedin  — Not supported (requires user OAuth; use manual entry)
 *   tiktok    — Not supported (Commercial API required)
 *   blog      — Not supported (no public API)
 *   other     — Skipped with a note
 *
 * Returns a result string summarising rows updated.
 */

'use strict';

const https = require('https');
const { GoogleAuth } = require('google-auth-library');

/* ---------- Auth / Sheets helpers ---------- */

let _auth;
async function getSheetsToken() {
  if (!_auth) {
    _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  const client = await _auth.getClient();
  const tok = await client.getAccessToken();
  return tok.token;
}

function httpsGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'GET',
      headers: { 'User-Agent': 'Waymark-Worker/1.0', ...extraHeaders },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function sheetsGet(sheetId, range) {
  const token = await getSheetsToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Waymark-Worker/1.0' },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function sheetsUpdate(sheetId, range, values) {
  const token = await getSheetsToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const body = JSON.stringify({ range, majorDimension: 'ROWS', values });
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Waymark-Worker/1.0',
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------- Column detection ---------- */

/**
 * Detect Content Workbench column indices from header row.
 * Returns object mapping role → column index (-1 if not found).
 */
function detectCols(headers) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  const cols = { post: -1, platform: -1, status: -1, link: -1, likes: -1, shares: -1, comments: -1, views: -1 };
  cols.post     = lower.findIndex(h => /^(post|content|draft|copy|caption|message|tweet|text)/.test(h));
  cols.platform = lower.findIndex((h, i) => i !== cols.post && /^(platform|channel|network|where|site|medium)/.test(h));
  cols.status   = lower.findIndex((h, i) => i !== cols.post && i !== cols.platform && /^(status|stage|state|progress)/.test(h));
  cols.link     = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(link|url|href|address)/.test(h));
  cols.likes    = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(like|heart|upvote|reaction|fav)/.test(h));
  cols.shares   = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(share|repost|retweet|forward|boost)/.test(h));
  cols.comments = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(comment|reply|response|discuss)/.test(h));
  cols.views    = lower.findIndex((h, i) => !Object.values(cols).includes(i) && /^(view|impression|reach|seen|read)/.test(h));
  return cols;
}

/* ---------- Platform detection ---------- */

function detectPlatform(rawPlatform, link) {
  const v = (rawPlatform || '').toLowerCase().trim();
  if (/youtube|yt/.test(v) || /youtube\.com|youtu\.be/.test(link)) return 'youtube';
  if (/twitter|tweet|x\.com/.test(v) || /twitter\.com|x\.com\/[a-z]/.test(link)) return 'twitter';
  if (/reddit/.test(v) || /reddit\.com\/r\//.test(link)) return 'reddit';
  if (/linkedin/.test(v) || /linkedin\.com/.test(link)) return 'linkedin';
  if (/tiktok|reels|shorts/.test(v) || /tiktok\.com/.test(link)) return 'tiktok';
  if (/hacker.?news|hn/.test(v) || /news\.ycombinator\.com/.test(link)) return 'hn';
  if (/product.?hunt|ph/.test(v) || /producthunt\.com/.test(link)) return 'ph';
  return 'other';
}

function isPosted(statusCell) {
  const v = (statusCell || '').toLowerCase().trim();
  return /^(post|publish|sent|live|shared|up|done|analyz)/.test(v);
}

/* ---------- Platform metric fetchers ---------- */

async function fetchYoutube(link, apiKey) {
  if (!apiKey) return { error: 'youtubeApiKey not configured' };
  // Extract video ID from URL
  const match = link.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!match) return { error: 'Could not extract YouTube video ID from URL' };
  const videoId = match[1];
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${apiKey}`;
  const data = await httpsGet(url);
  if (!data.items || data.items.length === 0) return { error: `Video ${videoId} not found or API key invalid` };
  const stats = data.items[0].statistics || {};
  return {
    likes: parseInt(stats.likeCount || '0', 10),
    shares: 0,   // YouTube removed share count from API
    comments: parseInt(stats.commentCount || '0', 10),
    views: parseInt(stats.viewCount || '0', 10),
  };
}

async function fetchHackerNews(link) {
  // Extract HN item ID from URL: https://news.ycombinator.com/item?id=12345678
  const match = link.match(/item[?&]id=(\d+)/);
  if (!match) return { error: 'Could not extract HN item ID from URL' };
  const itemId = match[1];
  const url = `https://hacker-news.firebaseio.com/v0/item/${itemId}.json`;
  const data = await httpsGet(url);
  if (!data || !data.id) return { error: `HN item ${itemId} not found` };
  const commentCount = Array.isArray(data.kids) ? data.kids.length : 0;
  return {
    likes: parseInt(data.score || 0, 10),
    shares: 0,
    comments: commentCount,
    views: 0,  // HN doesn't expose view counts
  };
}

async function fetchReddit(link) {
  // Append .json to the Reddit post URL
  const cleanLink = link.split('?')[0].replace(/\/$/, '');
  const jsonUrl = `${cleanLink}.json?limit=0`;
  const data = await httpsGet(jsonUrl);
  if (!Array.isArray(data) || !data[0]) return { error: 'Reddit API returned unexpected format' };
  const post = data[0].data && data[0].data.children && data[0].data.children[0];
  if (!post) return { error: 'Reddit post not found in response' };
  const d = post.data || {};
  return {
    likes: parseInt(d.score || 0, 10),
    shares: 0,  // Reddit doesn't expose share counts
    comments: parseInt(d.num_comments || 0, 10),
    views: 0,  // Reddit view counts not in public API
  };
}

async function fetchTwitter(link, bearerToken) {
  if (!bearerToken) return { error: 'twitterBearerToken not configured' };
  // Extract tweet ID from URL: https://twitter.com/user/status/1234567890
  const match = link.match(/status\/(\d+)/);
  if (!match) return { error: 'Could not extract tweet ID from URL' };
  const tweetId = match[1];
  const url = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`;
  const data = await httpsGet(url, { Authorization: `Bearer ${bearerToken}` });
  if (!data.data) return { error: data.title || 'Twitter API error' };
  const m = data.data.public_metrics || {};
  return {
    likes: parseInt(m.like_count || 0, 10),
    shares: parseInt(m.retweet_count || 0, 10),
    comments: parseInt(m.reply_count || 0, 10),
    views: parseInt(m.impression_count || 0, 10),
  };
}

/* ---------- Main run function ---------- */

async function run(config) {
  const { sheetId, youtubeApiKey, twitterBearerToken } = config;
  if (!sheetId) throw new Error('sheetId is required in config');

  // Read the full sheet
  const data = await sheetsGet(sheetId, 'Sheet1!A1:Z1000');
  const allRows = (data && data.values) || [];
  if (allRows.length < 2) return 'No data rows found';

  const headers = allRows[0];
  const cols = detectCols(headers);

  if (cols.link < 0) return 'No "Link" column found in sheet — cannot fetch metrics without URLs';

  const updated = [];
  const skipped = [];
  const errors = [];

  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i];
    const statusVal = cols.status >= 0 ? (row[cols.status] || '') : '';
    const link = cols.link >= 0 ? (row[cols.link] || '').trim() : '';
    const platform = cols.platform >= 0 ? (row[cols.platform] || '') : '';

    if (!link) continue;
    if (!isPosted(statusVal)) {
      skipped.push(`Row ${i + 1}: not posted (${statusVal || 'no status'})`);
      continue;
    }

    const plat = detectPlatform(platform, link);
    let metrics;

    try {
      if (plat === 'youtube') {
        metrics = await fetchYoutube(link, youtubeApiKey);
      } else if (plat === 'hn') {
        metrics = await fetchHackerNews(link);
      } else if (plat === 'reddit') {
        metrics = await fetchReddit(link);
      } else if (plat === 'twitter') {
        metrics = await fetchTwitter(link, twitterBearerToken);
      } else if (plat === 'linkedin' || plat === 'tiktok') {
        skipped.push(`Row ${i + 1}: ${plat} metrics require manual entry (API not supported)`);
        continue;
      } else {
        skipped.push(`Row ${i + 1}: unsupported platform (${platform || 'unknown'})`);
        continue;
      }
    } catch (err) {
      errors.push(`Row ${i + 1} (${plat}): ${err.message}`);
      continue;
    }

    if (metrics.error) {
      errors.push(`Row ${i + 1} (${plat}): ${metrics.error}`);
      continue;
    }

    // Write metrics back to row using column letter notation
    // Row number is 1-based (header = row 1, first data = row 2)
    const sheetRow = i + 1;
    const writes = [];
    const colLetter = n => {
      let r = '';
      let c = n;
      do { r = String.fromCharCode(65 + (c % 26)) + r; c = Math.floor(c / 26) - 1; } while (c >= 0);
      return r;
    };

    if (cols.likes >= 0 && metrics.likes !== undefined) {
      writes.push(sheetsUpdate(sheetId, `Sheet1!${colLetter(cols.likes)}${sheetRow}`, [[String(metrics.likes)]]));
    }
    if (cols.shares >= 0 && metrics.shares !== undefined && metrics.shares > 0) {
      writes.push(sheetsUpdate(sheetId, `Sheet1!${colLetter(cols.shares)}${sheetRow}`, [[String(metrics.shares)]]));
    }
    if (cols.comments >= 0 && metrics.comments !== undefined) {
      writes.push(sheetsUpdate(sheetId, `Sheet1!${colLetter(cols.comments)}${sheetRow}`, [[String(metrics.comments)]]));
    }
    if (cols.views >= 0 && metrics.views !== undefined && metrics.views > 0) {
      writes.push(sheetsUpdate(sheetId, `Sheet1!${colLetter(cols.views)}${sheetRow}`, [[String(metrics.views)]]));
    }

    await Promise.all(writes);
    updated.push(`Row ${sheetRow} (${plat}): likes=${metrics.likes} comments=${metrics.comments}${metrics.views > 0 ? ` views=${metrics.views}` : ''}`);
  }

  const parts = [];
  if (updated.length > 0) parts.push(`Updated ${updated.length}: ${updated.slice(0, 3).join(', ')}${updated.length > 3 ? '…' : ''}`);
  if (skipped.length > 0) parts.push(`Skipped ${skipped.length}`);
  if (errors.length > 0) parts.push(`Errors ${errors.length}: ${errors[0]}`);
  if (parts.length === 0) return 'No eligible rows found (no posted rows with links)';
  return parts.join(' | ');
}

module.exports = { run };
