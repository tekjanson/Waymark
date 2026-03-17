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

const CLIENT_SECRET_FILE = path.resolve(
  __dirname, '..',
  'client_secret_764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com_waymarkauth.json'
);

const TOKEN_PATH = path.join(
  process.env.HOME || '/home/tekjanson',
  '.config', 'gcloud', 'waymark-oauth-token.json'
);

const creds = JSON.parse(fs.readFileSync(CLIENT_SECRET_FILE, 'utf8'));
const { client_id, client_secret } = creds.web;
const REDIRECT_URI = 'http://localhost:3000/auth/callback';
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
  const url = new URL(req.url, 'http://localhost:3000');

  if (!url.pathname.startsWith('/auth/callback')) {
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

server.listen(3000, () => {
  console.log('\n  OAuth token setup for Waymark test report upload');
  console.log('  ────────────────────────────────────────────────');
  console.log(`\n  Open this URL in your browser:\n`);
  console.log(`  ${authUrl}\n`);
  console.log('  Waiting for callback on http://localhost:3000/auth/callback ...');

  // Try to open browser automatically
  try {
    execSync(`xdg-open "${authUrl}" 2>/dev/null || open "${authUrl}" 2>/dev/null`, { stdio: 'ignore' });
  } catch { /* ignore — user can open manually */ }
});
