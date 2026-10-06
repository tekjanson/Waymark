#!/usr/bin/env node
/* ============================================================
   get-oauth-token.js — One-time OAuth2 flow to obtain a refresh
   token for Google Drive/Sheets file creation.

   The service account has zero file-storage quota, so creating
   new spreadsheets requires user OAuth credentials. This script
   runs a minimal HTTP server, opens the browser for consent, and
   saves the refresh token to ~/.config/gcloud/waymark-oauth-token.json

   Usage:
     node scripts/get-oauth-token.js

   Only needs to run once. The refresh token persists until revoked.
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/* ---------- Load OAuth client credentials ---------- */

const REPO_ROOT = path.resolve(__dirname, '..');

function loadDotEnv() {
  try {
    const envPath = path.join(REPO_ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Ignore .env parsing failures and continue with other credential sources.
  }
}

function readClientSecretFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const source = raw.web || raw.installed;
  if (!source?.client_id || !source?.client_secret) {
    throw new Error(`Invalid OAuth client secret file format: ${filePath}`);
  }
  return {
    clientId: source.client_id,
    clientSecret: source.client_secret,
    redirectUri: source.redirect_uris?.[0],
    source: filePath,
  };
}

function findClientSecretFile() {
  const preferred = path.join(
    REPO_ROOT,
    'client_secret_764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com_waymarkauth.json'
  );
  if (fs.existsSync(preferred)) return preferred;

  const candidates = fs
    .readdirSync(REPO_ROOT)
    .filter((name) => /^client_secret_.*\.json$/i.test(name))
    .map((name) => path.join(REPO_ROOT, name));

  return candidates[0] || null;
}

function loadClientCredentials() {
  loadDotEnv();

  const envClientId = process.env.GOOGLE_CLIENT_ID;
  const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      source: '.env',
    };
  }

  const secretFile = findClientSecretFile();
  if (secretFile) {
    return readClientSecretFile(secretFile);
  }

  throw new Error(
    [
      'Missing Google OAuth client credentials.',
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env,',
      'or place a Google OAuth client secret JSON file in the repo root',
      '(for example client_secret_*.json).',
    ].join(' ')
  );
}

const oauth = loadClientCredentials();

function resolveRedirectUri() {
  const defaultRedirect = 'http://localhost:3000/auth/callback';
  const configured = process.env.WAYMARK_OAUTH_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  if (!configured) return defaultRedirect;

  try {
    const parsed = new URL(configured);
    const localHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'http:' && localHost) {
      return configured;
    }

    console.warn(
      `\n  ! Ignoring non-local redirect URI from environment: ${configured}`
    );
    console.warn(`    Using local callback instead: ${defaultRedirect}`);
    return defaultRedirect;
  } catch {
    return defaultRedirect;
  }
}

const TOKEN_PATH = path.join(
  process.env.HOME || '/home/tekjanson',
  '.config', 'gcloud', 'waymark-oauth-token.json'
);

const client_id = oauth.clientId;
const client_secret = oauth.clientSecret;
const REDIRECT_URI = resolveRedirectUri();
const REDIRECT_URL = new URL(REDIRECT_URI);
const CALLBACK_HOST = REDIRECT_URL.hostname;
const CALLBACK_PORT = Number(REDIRECT_URL.port || 80);
const CALLBACK_PATH = REDIRECT_URL.pathname;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

/* ---------- Build auth URL ---------- */

const authParams = new URLSearchParams({
  client_id,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',
  prompt: 'consent',
});
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams}`;

/* ---------- Exchange code for tokens ---------- */

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  return res.json();
}

/* ---------- Start server and wait for callback ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `${REDIRECT_URL.protocol}//${REDIRECT_URL.host}`);

  if (!url.pathname.startsWith(CALLBACK_PATH)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('No code in callback');
    return;
  }

  try {
    const tokens = await exchangeCode(code);

    if (tokens.error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Token exchange failed: ${tokens.error_description || tokens.error}`);
      server.close();
      process.exit(1);
      return;
    }

    // Save tokens
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expiry_date: Date.now() + (tokens.expires_in * 1000),
      scope: tokens.scope,
      client_id,
      client_secret,
    };

    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
    fs.chmodSync(TOKEN_PATH, 0o600);

    console.log(`\n  ✓ Token saved to ${TOKEN_PATH}`);
    console.log(`  Refresh token: ${tokens.refresh_token ? 'present' : 'MISSING'}`);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>&#10003; Authenticated</h1><p>You can close this tab. The token has been saved.</p></body></html>');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err.message}`);
  }

  setTimeout(() => { server.close(); process.exit(0); }, 500);
});

server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
  console.log('\n  OAuth token setup for Waymark test report upload');
  console.log('  ────────────────────────────────────────────────');
  console.log(`  Using OAuth credentials source: ${oauth.source}`);
  console.log(`  Redirect URI: ${REDIRECT_URI}`);
  console.log(`\n  Open this URL in your browser:\n`);
  console.log(`  ${authUrl}\n`);
  console.log(`  Waiting for callback on ${REDIRECT_URI} ...`);

  // Try to open browser automatically
  try {
    execSync(`xdg-open "${authUrl}" 2>/dev/null || open "${authUrl}" 2>/dev/null`, { stdio: 'ignore' });
  } catch { /* ignore — user can open manually */ }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n  Error: callback port already in use (${CALLBACK_HOST}:${CALLBACK_PORT}).`);
    console.error('  Stop the conflicting process, then run make oauth-token again.');
    process.exit(1);
  }
  throw err;
});
