#!/usr/bin/env node
/* ============================================================
   scripts/fleet-webhook.js — Tiny HTTP sidecar for fleet control

   Accepts a POST /fleet-sync from the browser Waymark UI and
   runs `make fleet-sync` on the host, returning JSON status.

   Not part of server/ — it is a separate process that runs
   alongside the Waymark server, listening on its own port.

   Start:  node scripts/fleet-webhook.js
   Or:     make fleet-webhook   (nohup, background)
   Stop:   make fleet-webhook-stop

   CORS: only accepts requests from FLEET_WEBHOOK_ORIGIN
         (default: http://localhost:3000)
   ============================================================ */

'use strict';

const http     = require('http');
const { execFile } = require('child_process');
const path     = require('path');

const PORT          = parseInt(process.env.FLEET_WEBHOOK_PORT || '3002', 10);
const REPO_ROOT     = path.resolve(__dirname, '..');

/* ---------- CORS: reflect the request origin back ----------
 * This sidecar listens only on 127.0.0.1 — only the local machine can
 * reach it. Reflecting the origin is safe: there is no CSRF risk because
 * the endpoint is inaccessible from the network.  This lets any deployment
 * (localhost:3000, swiftirons.com, etc.) use the button.
 * ----------------------------------------------------------- */
function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin':  req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

/* ---------- Routes ---------- */

const ROUTES = {
  'POST /fleet-sync': (req, res) => {
    console.log(`[fleet-webhook ${new Date().toISOString()}] /fleet-sync triggered`);
    execFile('make', ['fleet-sync'], {
      cwd:     REPO_ROOT,
      timeout: 180_000,        // 3 min max — fleet-sync may pull a Docker image
      env:     { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message || 'unknown error').trim().slice(-400);
        console.error('[fleet-webhook] fleet-sync failed:', msg);
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders(req) });
        res.end(JSON.stringify({ ok: false, error: msg }));
        return;
      }
      const output = stdout.trim().slice(-600);
      console.log('[fleet-webhook] fleet-sync ok:', output.slice(-120));
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders(req) });
      res.end(JSON.stringify({ ok: true, output }));
    });
  },
};

/* ---------- Server ---------- */

const server = http.createServer((req, res) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const key = `${req.method} ${req.url.split('?')[0]}`;
  const handler = ROUTES[key];
  if (handler) {
    handler(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify({ error: `No route for ${key}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fleet-webhook] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[fleet-webhook] CORS: reflecting request origin (localhost-only, safe)`);
  console.log(`[fleet-webhook] Routes: ${Object.keys(ROUTES).join(', ')}`);
});

server.on('error', (err) => {
  console.error('[fleet-webhook] Server error:', err.message);
  process.exit(1);
});
