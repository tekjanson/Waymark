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

      /* -------- Browser control commands -------- */

      case 'navigate': {
        const target = args?.target;
        if (!target) { error = 'No target provided'; break; }
        if (target === 'home') window.location.hash = '#/';
        else if (target === 'explorer') window.location.hash = '#/explorer';
        else if (target === 'agent') window.location.hash = '#/agent';
        else if (target.startsWith('#')) window.location.hash = target;
        else window.location.hash = target;
        // Wait a tick for route handler to fire
        await new Promise(r => setTimeout(r, 300));
        result = { navigated: true, hash: location.hash, url: location.href };
        break;
      }

      case 'open_sheet': {
        const sheetId = args?.sheetId;
        if (!sheetId) { error = 'No sheetId provided'; break; }
        window.location.hash = `#/sheet/${sheetId}`;
        await new Promise(r => setTimeout(r, 500));
        result = { opened: true, hash: location.hash, title: document.title };
        break;
      }

      case 'open_folder': {
        const folderId = args?.folderId;
        const folderName = args?.folderName || 'Folder';
        if (!folderId) { error = 'No folderId provided'; break; }
        window.location.hash = `#/folder/${folderId}/${encodeURIComponent(folderName)}`;
        await new Promise(r => setTimeout(r, 500));
        result = { opened: true, hash: location.hash };
        break;
      }

      case 'click': {
        const selector = args?.selector;
        if (!selector) { error = 'No selector provided'; break; }
        const el = document.querySelector(selector);
        if (!el) { error = `No element matching "${selector}"`; break; }
        el.click();
        await new Promise(r => setTimeout(r, 200));
        result = { clicked: true, selector, tagName: el.tagName, text: el.textContent?.trim().slice(0, 100) };
        break;
      }

      case 'type': {
        const selector = args?.selector;
        const text = args?.text;
        if (!selector || text == null) { error = 'selector and text required'; break; }
        const el = document.querySelector(selector);
        if (!el) { error = `No element matching "${selector}"`; break; }
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        result = { typed: true, selector, value: el.value };
        break;
      }

      case 'submit_form': {
        const selector = args?.selector;
        if (!selector) { error = 'No selector provided'; break; }
        const form = document.querySelector(selector);
        if (!form) { error = `No form matching "${selector}"`; break; }
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 300));
        result = { submitted: true, selector };
        break;
      }

      case 'list_visible_items': {
        const items = [];
        // Sheets & folders in main content area
        document.querySelectorAll('[data-sheet-id]').forEach(el => {
          items.push({ type: 'sheet', id: el.dataset.sheetId, text: el.textContent?.trim().slice(0, 100), selector: `[data-sheet-id="${el.dataset.sheetId}"]` });
        });
        document.querySelectorAll('[data-folder-id]').forEach(el => {
          items.push({ type: 'folder', id: el.dataset.folderId, text: el.textContent?.trim().slice(0, 100), selector: `[data-folder-id="${el.dataset.folderId}"]` });
        });
        // Clickable buttons/links in visible area
        const screen = document.querySelector('.screen:not(.hidden)');
        if (screen) {
          screen.querySelectorAll('button:not([disabled]), a[href], [role="button"]').forEach(el => {
            const id = el.id;
            const text = el.textContent?.trim().slice(0, 80);
            if (text || id) {
              items.push({ type: 'button', id: id || null, text, selector: id ? `#${id}` : null, tagName: el.tagName });
            }
          });
        }
        result = { count: items.length, items };
        break;
      }

      case 'wait_for': {
        const selector = args?.selector;
        const timeoutMs = Math.min(args?.timeout || 5000, 10000);
        if (!selector) { error = 'No selector provided'; break; }
        const found = await new Promise(resolve => {
          if (document.querySelector(selector)) { resolve(true); return; }
          const obs = new MutationObserver(() => {
            if (document.querySelector(selector)) { obs.disconnect(); resolve(true); }
          });
          obs.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => { obs.disconnect(); resolve(false); }, timeoutMs);
        });
        const el = document.querySelector(selector);
        result = { found, selector, tagName: el?.tagName || null, text: el?.textContent?.trim().slice(0, 100) || null };
        break;
      }

      case 'scroll_to': {
        const selector = args?.selector;
        if (!selector) { error = 'No selector provided'; break; }
        const el = document.querySelector(selector);
        if (!el) { error = `No element matching "${selector}"`; break; }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        result = { scrolled: true, selector };
        break;
      }

      case 'get_sidebar': {
        const sidebar = document.querySelector('#sidebar');
        const isOpen = sidebar?.classList.contains('sidebar-open') || false;
        const menuItems = [];
        sidebar?.querySelectorAll('.sidebar-nav-item').forEach(el => {
          menuItems.push({
            id: el.querySelector('button')?.id || null,
            text: el.textContent?.trim(),
            active: el.classList.contains('active'),
            dataMenu: el.querySelector('button')?.dataset.menu || null,
          });
        });
        result = { isOpen, menuItems };
        break;
      }

      case 'toggle_sidebar': {
        const sidebar = document.querySelector('#sidebar');
        if (sidebar) {
          const wasOpen = sidebar.classList.contains('sidebar-open');
          if (args?.open === true) sidebar.classList.add('sidebar-open');
          else if (args?.open === false) sidebar.classList.remove('sidebar-open');
          else sidebar.classList.toggle('sidebar-open');
          result = { toggled: true, isOpen: sidebar.classList.contains('sidebar-open'), wasOpen };
        } else {
          error = 'Sidebar not found';
        }
        break;
      }

      case 'search': {
        const query = args?.query;
        if (!query) { error = 'No query provided'; break; }
        window.location.hash = `#/search?q=${encodeURIComponent(query)}`;
        await new Promise(r => setTimeout(r, 500));
        // Gather results
        const resultEls = document.querySelectorAll('.sheet-list-item, [data-sheet-id]');
        const results = [];
        resultEls.forEach(el => {
          results.push({ text: el.textContent?.trim().slice(0, 100), sheetId: el.dataset?.sheetId || null });
        });
        result = { query, hash: location.hash, resultCount: results.length, results: results.slice(0, 30) };
        break;
      }

      case 'go_back': {
        window.history.back();
        await new Promise(r => setTimeout(r, 300));
        result = { hash: location.hash, url: location.href };
        break;
      }

      case 'get_element_info': {
        const selector = args?.selector;
        if (!selector) { error = 'No selector provided'; break; }
        const el = document.querySelector(selector);
        if (!el) { error = `No element matching "${selector}"`; break; }
        const rect = el.getBoundingClientRect();
        result = {
          tagName: el.tagName,
          id: el.id || null,
          className: el.className || null,
          text: el.textContent?.trim().slice(0, 200),
          value: el.value ?? null,
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          disabled: el.disabled ?? false,
          childCount: el.children.length,
          attributes: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value]).slice(0, 20)),
        };
        break;
      }

      case 'capture_screenshot': {
        const selector = args?.selector || null;
        const quality = Math.min(Math.max(args?.quality || 0.8, 0.1), 1);
        const maxWidth = args?.maxWidth || 1280;

        // Lazy-load html2canvas from same-origin vendor file (CSP-safe)
        if (!window.html2canvas) {
          const base = window.__WAYMARK_BASE || '';
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = base + '/js/vendor/html2canvas.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Failed to load html2canvas'));
            document.head.appendChild(s);
          });
        }
        if (!window.html2canvas) {
          error = 'html2canvas not available';
          break;
        }

        const target = selector ? document.querySelector(selector) : document.body;
        if (!target) { error = `No element matching "${selector}"`; break; }

        const canvas = await window.html2canvas(target, {
          useCORS: true,
          scale: 1,
          logging: false,
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight,
        });

        // Resize if wider than maxWidth
        let finalCanvas = canvas;
        if (canvas.width > maxWidth) {
          const ratio = maxWidth / canvas.width;
          finalCanvas = document.createElement('canvas');
          finalCanvas.width = maxWidth;
          finalCanvas.height = Math.round(canvas.height * ratio);
          const ctx = finalCanvas.getContext('2d');
          ctx.drawImage(canvas, 0, 0, finalCanvas.width, finalCanvas.height);
        }

        const dataUrl = finalCanvas.toDataURL('image/jpeg', quality);
        const base64 = dataUrl.split(',')[1];

        result = {
          image: base64,
          mimeType: 'image/jpeg',
          width: finalCanvas.width,
          height: finalCanvas.height,
          originalWidth: canvas.width,
          originalHeight: canvas.height,
          selector: selector || 'body',
        };
        break;
      }

      case 'switch_host': {
        const newUrl = args?.url;
        if (!newUrl) { error = 'No url provided'; break; }
        const preserveHash = args?.preserveHash !== false;
        const currentHash = location.hash;
        let target;
        try {
          target = new URL(newUrl);
        } catch {
          error = `Invalid URL: ${newUrl}`;
          break;
        }
        if (preserveHash && currentHash) {
          target.hash = currentHash;
        }
        // Ensure MQTT bridge activates on the target page
        target.searchParams.set('mqtt', '1');
        // Respond before navigating since the page will unload
        publish('cmd/response', {
          commandId,
          result: {
            navigatingTo: target.href,
            previousUrl: location.href,
            preservedHash: preserveHash ? currentHash : null,
          },
        });
        // Small delay to let the MQTT message flush
        await new Promise(r => setTimeout(r, 200));
        window.location.href = target.href;
        return; // skip the normal response — we already sent it
      }

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
