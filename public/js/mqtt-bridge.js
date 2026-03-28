/* ============================================================
   mqtt-bridge.js — Waymark MQTT Debug Bridge (browser side)
   Captures console logs, JS errors, network failures, and
   responds to commands from the MCP agent via MQTT.

   Activation: Settings panel → Developer → MQTT debug bridge
   Persisted to Google Drive via user-data.js.
   ============================================================ */

import { MqttClient } from './mqtt-client.js';

/* ---------- Session & Config ---------- */

const SESSION_ID = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36);
const MAX_BUFFER = 500;

let _customBrokerUrl = null;

function brokerUrl() {
  if (_customBrokerUrl) return _customBrokerUrl;
  return 'ws://localhost:9001';
}

function topic(suffix) {
  return `waymark/${SESSION_ID}/${suffix}`;
}

/* ---------- State ---------- */

let client = null;
const logs = [];
const errors = [];
const networkErrors = [];
const originalConsole = {};

/* ---------- Console capture ---------- */

function patchConsole() {
  for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
    originalConsole[level] = console[level];
    console[level] = (...args) => {
      // Call original
      originalConsole[level].apply(console, args);
      // Capture
      const entry = {
        level,
        message: args.map(stringify).join(' '),
        timestamp: Date.now(),
      };
      logs.push(entry);
      if (logs.length > MAX_BUFFER) logs.shift();
      // Publish
      publish('logs', entry);
    };
  }
}

function restoreConsole() {
  for (const [level, fn] of Object.entries(originalConsole)) {
    console[level] = fn;
  }
}

/* ---------- Error capture ---------- */

function captureErrors() {
  window.addEventListener('error', (e) => {
    const entry = {
      type: 'error',
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack || '',
      timestamp: Date.now(),
    };
    errors.push(entry);
    if (errors.length > MAX_BUFFER) errors.shift();
    publish('errors', entry);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const entry = {
      type: 'unhandledrejection',
      message: String(e.reason),
      stack: e.reason?.stack || '',
      timestamp: Date.now(),
    };
    errors.push(entry);
    if (errors.length > MAX_BUFFER) errors.shift();
    publish('errors', entry);
  });
}

/* ---------- Network capture ---------- */

function captureNetwork() {
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const method = args[1]?.method || 'GET';
    try {
      const res = await origFetch.apply(this, args);
      if (!res.ok) {
        const entry = {
          type: 'fetch',
          method,
          url: url.slice(0, 500),
          status: res.status,
          statusText: res.statusText,
          timestamp: Date.now(),
        };
        networkErrors.push(entry);
        if (networkErrors.length > MAX_BUFFER) networkErrors.shift();
        publish('network', entry);
      }
      return res;
    } catch (err) {
      const entry = {
        type: 'fetch',
        method,
        url: url.slice(0, 500),
        error: err.message,
        timestamp: Date.now(),
      };
      networkErrors.push(entry);
      if (networkErrors.length > MAX_BUFFER) networkErrors.shift();
      publish('network', entry);
      throw err;
    }
  };
}

/* ---------- Inline script execution (CSP-safe, no eval) ---------- */

function execInlineScript(code) {
  return new Promise((resolve) => {
    const cbName = '_mqttExec_' + Math.random().toString(36).slice(2, 10);
    const timeout = setTimeout(() => {
      delete window[cbName];
      resolve({ error: 'Script timed out (5 s)' });
    }, 5000);

    window[cbName] = (val) => {
      clearTimeout(timeout);
      delete window[cbName];
      resolve({ value: stringify(val) });
    };

    const script = document.createElement('script');
    // 'unsafe-inline' is allowed by CSP, so inline script text works
    script.textContent = `try { window['${cbName}']((() => { ${code} })()); } catch(e) { window['${cbName}']('ERROR: ' + e.message); }`;
    document.head.appendChild(script);
    document.head.removeChild(script);
  });
}

/* ---------- Command handler ---------- */

async function onMessage({ topic: t, payload }) {
  if (!t.endsWith('/cmd/request')) return;

  let cmd;
  try { cmd = JSON.parse(payload); } catch { return; }

  const { commandId, command, args } = cmd;
  if (!commandId || !command) return;

  let result, error;
  try {
    switch (command) {
      case 'ping':
        result = { pong: true, sessionId: SESSION_ID, url: location.href, timestamp: Date.now() };
        break;

      case 'get_console_logs':
        result = logs.slice(-(args?.count || 100));
        break;

      case 'get_errors':
        result = errors.slice(-(args?.count || 100));
        break;

      case 'get_network_errors':
        result = networkErrors.slice(-(args?.count || 100));
        break;

      case 'get_dom_snapshot': {
        const selector = args?.selector || 'body';
        const el = document.querySelector(selector);
        if (!el) {
          result = { error: `No element matching "${selector}"` };
        } else {
          const html = el.outerHTML;
          // Truncate to avoid huge payloads
          const maxLen = args?.maxLength || 50000;
          result = {
            selector,
            tagName: el.tagName,
            childCount: el.children.length,
            html: html.length > maxLen ? html.slice(0, maxLen) + '…[truncated]' : html,
          };
        }
        break;
      }

      case 'get_app_state':
        result = {
          url: location.href,
          hash: location.hash,
          title: document.title,
          theme: document.documentElement.getAttribute('data-theme'),
          screenVisible: document.querySelector('.screen:not(.hidden)')?.id || null,
          timestamp: Date.now(),
        };
        break;

      case 'execute_js': {
        if (!args?.code) {
          result = { error: 'No code provided' };
        } else {
          // Use inline script element (runs under 'unsafe-inline' CSP, no eval needed)
          result = await execInlineScript(args.code);
        }
        break;
      }

      case 'get_performance':
        result = {
          timing: performance.timing ? {
            domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
            load: performance.timing.loadEventEnd - performance.timing.navigationStart,
          } : null,
          memory: performance.memory ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
          } : null,
          entries: performance.getEntriesByType('resource').slice(-20).map(e => ({
            name: e.name.slice(0, 200),
            duration: Math.round(e.duration),
            type: e.initiatorType,
          })),
        };
        break;

      default:
        error = `Unknown command: ${command}`;
    }
  } catch (err) {
    error = err.message;
  }

  publish('cmd/response', {
    commandId,
    result: error ? undefined : result,
    error: error || undefined,
  });
}

/* ---------- Helpers ---------- */

function publish(suffix, data) {
  if (!client?.connected) return;
  try {
    client.publish(topic(suffix), JSON.stringify(data));
  } catch { /* swallow publish errors */ }
}

function stringify(val) {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (val instanceof Error) return `${val.name}: ${val.message}`;
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return String(val); }
  }
  return String(val);
}

/* ---------- Heartbeat ---------- */

let heartbeatTimer = null;

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    publish('heartbeat', {
      sessionId: SESSION_ID,
      url: location.href,
      timestamp: Date.now(),
    });
  }, 10_000);
}

/* ---------- Lifecycle ---------- */

export async function startBridge(customUrl) {
  if (client?.connected) return SESSION_ID;
  _customBrokerUrl = customUrl || null;

  client = new MqttClient(brokerUrl(), {
    clientId: `wm_browser_${SESSION_ID.slice(0, 8)}`,
  });

  await client.connect();

  // Subscribe to command channel
  client.subscribe(topic('cmd/request'));
  client.addEventListener('message', (e) => onMessage(e.detail));

  // Install captures
  patchConsole();
  captureErrors();
  captureNetwork();
  startHeartbeat();

  // Announce session
  publish('session/start', {
    sessionId: SESSION_ID,
    url: location.href,
    userAgent: navigator.userAgent,
    timestamp: Date.now(),
  });

  originalConsole.log?.(`[MQTT Bridge] Connected — session ${SESSION_ID}`);
  return SESSION_ID;
}

export function stopBridge() {
  clearInterval(heartbeatTimer);
  restoreConsole();
  if (client?.connected) {
    publish('session/end', { sessionId: SESSION_ID, timestamp: Date.now() });
    client.disconnect();
  }
  client = null;
}

export function getSessionId() { return SESSION_ID; }
