#!/usr/bin/env node
/* ============================================================
   setup-headless-auth.mjs — Headless OAuth2 & Credential Setup
   for Waymark and Wayside AGY Orchestrator.

   Supports:
   - Automated callback on local browser (port 3000)
   - Headless remote terminal paste (copy-paste redirect URL or code)
   - Direct token import via --import-token or --token-file
   - Status & connectivity check via --check / --status
   - Automatic integration with ~/.config/gcloud/waymark-oauth-token.json
   ============================================================ */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME_DIR = os.homedir();

const DEFAULT_CLIENT_ID = '764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com';
const TOKEN_PATH = process.env.WAYMARK_OAUTH_TOKEN_PATH ||
  path.join(HOME_DIR, '.config', 'gcloud', 'waymark-oauth-token.json');
const SA_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(HOME_DIR, '.config', 'gcloud', 'waymark-service-account-key.json');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
];

/* ---------- Helper: Parse CLI Arguments ---------- */

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    checkOnly: false,
    port: 3000,
    noServer: false,
    clientId: process.env.WAYMARK_CLIENT_ID || null,
    clientSecret: process.env.WAYMARK_CLIENT_SECRET || null,
    importToken: null,
    tokenFile: null,
    tokenPath: TOKEN_PATH,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check' || arg === '--status' || arg === '-c') {
      args.checkOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--no-server') {
      args.noServer = true;
    } else if (arg === '--port' && argv[i + 1]) {
      args.port = parseInt(argv[++i], 10);
    } else if (arg === '--client-id' && argv[i + 1]) {
      args.clientId = argv[++i];
    } else if (arg === '--client-secret' && argv[i + 1]) {
      args.clientSecret = argv[++i];
    } else if (arg === '--import-token' && argv[i + 1]) {
      args.importToken = argv[++i];
    } else if (arg === '--token-file' && argv[i + 1]) {
      args.tokenFile = argv[++i];
    } else if (arg === '--token-path' && argv[i + 1]) {
      args.tokenPath = argv[++i];
    }
  }

  return args;
}

/* ---------- Helper: Extract code from pasted URL or raw string ---------- */

export function parseAuthCode(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // If full URL was pasted (e.g. http://localhost:3000/auth/callback?code=4/0A...)
  if (trimmed.includes('code=')) {
    try {
      const parsedUrl = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
      const code = parsedUrl.searchParams.get('code');
      if (code) return decodeURIComponent(code);
    } catch {
      const match = trimmed.match(/[?&]code=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  }

  // Raw code pasted directly
  return trimmed;
}

/* ---------- Helper: Discover Client Credentials ---------- */

export function resolveClientCredentials(opts = {}) {
  let clientId = opts.clientId || process.env.WAYMARK_CLIENT_ID || null;
  let clientSecret = opts.clientSecret || process.env.WAYMARK_CLIENT_SECRET || null;

  // 1. Check existing token file
  const tokenPath = opts.tokenPath || TOKEN_PATH;
  if ((!clientId || !clientSecret) && fs.existsSync(tokenPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (!clientId && existing.client_id) clientId = existing.client_id;
      if (!clientSecret && existing.client_secret) clientSecret = existing.client_secret;
    } catch {}
  }

  // 2. Check client_secret_*.json in repo root or ~/.config/gcloud/
  if (!clientId || !clientSecret) {
    const searchDirs = [ROOT, path.join(HOME_DIR, '.config', 'gcloud')];
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      const match = files.find(f => f.startsWith('client_secret_') && f.endsWith('.json'));
      if (match) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, match), 'utf8'));
          const web = content.web || content.installed;
          if (web) {
            if (!clientId) clientId = web.client_id;
            if (!clientSecret) clientSecret = web.client_secret;
            break;
          }
        } catch {}
      }
    }
  }

  // Default client ID fallback
  if (!clientId) clientId = DEFAULT_CLIENT_ID;

  return { clientId, clientSecret };
}

/* ---------- Helper: Exchange Code for Tokens ---------- */

export async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Token exchange error: ${data.error_description || data.error}`);
  }
  return data;
}

/* ---------- Helper: Test Access Token Connectivity ---------- */

export async function verifyTokenConnectivity(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Drive API HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();
    return {
      ok: true,
      user: data.user ? {
        displayName: data.user.displayName,
        emailAddress: data.user.emailAddress,
      } : null,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ---------- Check Credentials Status ---------- */

export async function checkStatus(tokenPath = TOKEN_PATH, saKeyPath = SA_KEY_PATH) {
  console.log('\n===============================================================');
  console.log('  Waymark Headless Authentication Diagnostic');
  console.log('===============================================================\n');

  let hasValidAuth = false;

  // 1. User OAuth Token
  console.log(`[User OAuth Token] Path: ${tokenPath}`);
  if (fs.existsSync(tokenPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      const hasRefresh = !!data.refresh_token;
      console.log(`  ✓ Token file exists (refresh token: ${hasRefresh ? 'present' : 'missing'})`);

      if (data.client_id) console.log(`  ✓ Client ID: ${data.client_id.slice(0, 15)}...`);

      // Attempt token refresh
      if (data.refresh_token && data.client_id && data.client_secret) {
        process.stdout.write('  → Refreshing token with Google endpoint... ');
        const refreshRes = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: data.refresh_token,
            client_id: data.client_id,
            client_secret: data.client_secret,
          }),
        });
        const refreshed = await refreshRes.json();
        if (refreshed.access_token) {
          console.log('OK');
          const conn = await verifyTokenConnectivity(refreshed.access_token);
          if (conn.ok) {
            console.log(`  ✓ Google Drive API Connected! User: ${conn.user?.emailAddress || 'authenticated'}`);
            hasValidAuth = true;
          } else {
            console.log(`  ⚠️ API ping failed: ${conn.error}`);
          }
        } else {
          console.log(`FAILED (${refreshed.error || 'unknown error'})`);
        }
      }
    } catch (err) {
      console.log(`  ⚠️ Error parsing token file: ${err.message}`);
    }
  } else {
    console.log('  ❌ Missing: No user OAuth token file found.');
  }

  console.log('');

  // 2. Service Account Key
  console.log(`[Service Account Key] Path: ${saKeyPath}`);
  if (fs.existsSync(saKeyPath)) {
    try {
      const saData = JSON.parse(fs.readFileSync(saKeyPath, 'utf8'));
      console.log(`  ✓ Key file exists. Email: ${saData.client_email}`);
      hasValidAuth = true;
    } catch (err) {
      console.log(`  ⚠️ Error parsing service account key: ${err.message}`);
    }
  } else {
    console.log('  ℹ️ Notice: No service account key found (optional if user OAuth is configured).');
  }

  console.log('\n---------------------------------------------------------------');
  if (hasValidAuth) {
    console.log('  STATUS: ✅ Authentication is ready for Waymark & Wayside AGY.\n');
  } else {
    console.log('  STATUS: ❌ Authentication NOT configured. Run setup-headless-auth.mjs to authorize.\n');
  }

  return hasValidAuth;
}

/* ---------- Save Token Helper ---------- */

export function saveToken(tokenData, targetPath = TOKEN_PATH) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(tokenData, null, 2));
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(targetPath, 0o600);
    } catch { /* ignore on filesystems without POSIX permissions */ }
  }
}

/* ---------- Interactive / Headless OAuth Flow ---------- */

async function runInteractiveSetup(opts) {
  const { clientId, clientSecret: resolvedSecret } = resolveClientCredentials(opts);
  let clientSecret = resolvedSecret;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = (query) => new Promise(resolve => rl.question(query, resolve));

  if (!clientSecret) {
    console.log('\nClient secret is required to exchange the OAuth authorization code.');
    console.log('If you have the Google Cloud Console Web Application secret, paste it here.');
    clientSecret = (await promptUser('Enter Google OAuth Client Secret: ')).trim();
    if (!clientSecret) {
      console.error('Error: Client secret cannot be empty.');
      rl.close();
      process.exit(1);
    }
  }

  const redirectUri = `http://localhost:${opts.port}/auth/callback`;
  const authParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams}`;

  console.log('\n===============================================================');
  console.log('  Waymark Headless OAuth2 Authorization Flow');
  console.log('===============================================================\n');
  console.log('  1. Open this URL in your web browser (on any computer or phone):\n');
  console.log(`  ${authUrl}\n`);
  console.log('  2. Sign in with your Google account and grant permissions.');
  console.log('  3. Next:');
  console.log('     • If your browser is running locally, it will redirect automatically.');
  console.log('     • If you are running headlessly over SSH, copy the URL from your browser');
  console.log('       address bar after approval (or just the code= parameter) and paste it below.\n');

  // Attempt to open browser automatically if GUI is available (Windows, macOS, Linux)
  try {
    if (process.platform === 'win32') {
      execFile('rundll32', ['url.dll,FileProtocolHandler', authUrl], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('open', [authUrl], () => {});
    } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      execFile('xdg-open', [authUrl], () => {});
    }
  } catch {}

  let codeResolved = false;
  let codeResolveFunc;
  const codePromise = new Promise(resolve => { codeResolveFunc = resolve; });

  let server = null;
  if (!opts.noServer) {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${opts.port}`);
      if (!url.pathname.startsWith('/auth/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      if (code && !codeResolved) {
        codeResolved = true;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px"><h1>&#10003; Waymark Authorized</h1><p>You can close this tab and return to your terminal.</p></body></html>');
        codeResolveFunc(code);
      }
    });

    server.listen(opts.port, () => {
      // Server listening
    }).on('error', (err) => {
      console.log(`  (Local callback server could not bind to port ${opts.port}: ${err.message}. Using terminal paste mode.)`);
    });
  }

  // Terminal input prompt
  promptUser('Paste callback URL or auth code: ').then(answer => {
    if (!codeResolved) {
      const code = parseAuthCode(answer);
      if (code) {
        codeResolved = true;
        codeResolveFunc(code);
      }
    }
  });

  const code = await codePromise;
  rl.close();
  if (server) server.close();

  console.log('\n  → Exchanging code for tokens with Google...');
  try {
    const tokens = await exchangeCode({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });

    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || 'Bearer',
      expiry_date: Date.now() + ((tokens.expires_in || 3600) * 1000),
      scope: tokens.scope || SCOPES.join(' '),
      client_id: clientId,
      client_secret: clientSecret,
    };

    saveToken(tokenData, opts.tokenPath);
    console.log(`  ✓ Token successfully saved to: ${opts.tokenPath}`);
    console.log(`  ✓ Refresh token: ${tokens.refresh_token ? 'SAVED' : 'Warning: Not returned (already granted)'}`);

    // Verify token with API
    const conn = await verifyTokenConnectivity(tokens.access_token);
    if (conn.ok) {
      console.log(`  ✓ Verified Google Drive access! User: ${conn.user?.emailAddress || 'authenticated'}`);
    }

    console.log('\n===============================================================');
    console.log('  Authentication complete! You are ready to run Waymark & Wayside.');
    console.log('===============================================================\n');
  } catch (err) {
    console.error(`\n❌ Error exchanging tokens: ${err.message}\n`);
    process.exit(1);
  }
}

/* ---------- Main CLI Entrypoint ---------- */

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    console.log(`
Usage:
  node scripts/setup-headless-auth.mjs [options]

Options:
  --check, --status, -c   Verify current credentials status and test Google API connection
  --import-token <json>   Directly import token JSON or base64 token string
  --token-file <path>     Import token from an existing JSON file
  --client-id <id>        Override Google OAuth client ID
  --client-secret <sec>   Override Google OAuth client secret
  --port <port>           Port for callback listener (default: 3000)
  --no-server             Disable local HTTP callback listener (terminal paste only)
  --token-path <path>     Destination token path (default: ~/.config/gcloud/waymark-oauth-token.json)
  --help, -h              Show this help message
`);
    process.exit(0);
  }

  if (opts.checkOnly) {
    const ok = await checkStatus(opts.tokenPath, SA_KEY_PATH);
    process.exit(ok ? 0 : 1);
  }

  // Direct token import
  if (opts.importToken || opts.tokenFile) {
    try {
      let rawJson = opts.importToken;
      if (opts.tokenFile) {
        rawJson = fs.readFileSync(opts.tokenFile, 'utf8');
      }
      if (rawJson && !rawJson.trim().startsWith('{')) {
        // Try decoding base64
        try {
          rawJson = Buffer.from(rawJson.trim(), 'base64').toString('utf8');
        } catch {}
      }
      const data = JSON.parse(rawJson);
      saveToken(data, opts.tokenPath);
      console.log(`✓ Imported token saved to: ${opts.tokenPath}`);
      const ok = await checkStatus(opts.tokenPath, SA_KEY_PATH);
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error(`Error importing token: ${err.message}`);
      process.exit(1);
    }
  }

  await runInteractiveSetup(opts);
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(fileURLToPath(metaUrl));
    const b = fs.realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = path.resolve(fileURLToPath(metaUrl));
    const b = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
