#!/usr/bin/env node
/* ============================================================
   mqtt-bridge.mjs — MCP server for Waymark MQTT debug bridge
   Connects to an MQTT broker and exposes tools that let the
   AI agent inspect and interact with a live Waymark browser
   session (console logs, errors, DOM, JS execution, etc.).

   Transport: StdioServerTransport (for VS Code / CLI).
   Auth: MQTT username/password via env vars.
   ============================================================ */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import mqtt from "mqtt";
import { randomUUID } from "node:crypto";

/* ---------- Config ---------- */

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const MQTT_USERNAME = process.env.MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "";
const COMMAND_TIMEOUT_MS = 15_000;

/* ---------- MQTT client ---------- */

const mqttClient = mqtt.connect(BROKER_URL, {
  clientId: `waymark_mcp_${randomUUID().slice(0, 8)}`,
  username: MQTT_USERNAME || undefined,
  password: MQTT_PASSWORD || undefined,
  clean: true,
  reconnectPeriod: 3000,
});

mqttClient.on("error", (err) => {
  process.stderr.write(`MQTT error: ${err.message}\n`);
});

mqttClient.on("connect", () => {
  process.stderr.write(`MQTT connected to ${BROKER_URL}\n`);
  // Subscribe to all waymark topics
  mqttClient.subscribe("waymark/+/logs");
  mqttClient.subscribe("waymark/+/errors");
  mqttClient.subscribe("waymark/+/network");
  mqttClient.subscribe("waymark/+/heartbeat");
  mqttClient.subscribe("waymark/+/session/start");
  mqttClient.subscribe("waymark/+/session/end");
  mqttClient.subscribe("waymark/+/cmd/response");
});

/* ---------- Session & buffer management ---------- */

const MAX_BUFFER = 500;

/** @type {Map<string, { url: string, userAgent: string, lastSeen: number, logs: object[], errors: object[], network: object[] }>} */
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      url: "",
      userAgent: "",
      lastSeen: Date.now(),
      logs: [],
      errors: [],
      network: [],
    });
  }
  const s = sessions.get(sessionId);
  s.lastSeen = Date.now();
  return s;
}

function pushBuffer(arr, item) {
  arr.push(item);
  if (arr.length > MAX_BUFFER) arr.shift();
}

/* ---------- Command request/response ---------- */

/** @type {Map<string, { resolve: Function, timer: ReturnType<typeof setTimeout> }>} */
const pendingCommands = new Map();

function sendCommand(sessionId, command, args = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const commandId = randomUUID();
    const timer = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingCommands.set(commandId, { resolve, timer });
    mqttClient.publish(
      `waymark/${sessionId}/cmd/request`,
      JSON.stringify({ commandId, command, args })
    );
  });
}

/* ---------- MQTT message routing ---------- */

mqttClient.on("message", (topic, message) => {
  // Parse topic: waymark/{sessionId}/{...rest}
  const parts = topic.split("/");
  if (parts[0] !== "waymark" || parts.length < 3) return;

  const sessionId = parts[1];
  const rest = parts.slice(2).join("/");
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch {
    return;
  }

  const session = getSession(sessionId);

  switch (rest) {
    case "session/start":
      session.url = data.url || "";
      session.userAgent = data.userAgent || "";
      process.stderr.write(`Session started: ${sessionId} — ${data.url}\n`);
      break;

    case "session/end":
      sessions.delete(sessionId);
      process.stderr.write(`Session ended: ${sessionId}\n`);
      break;

    case "logs":
      pushBuffer(session.logs, data);
      break;

    case "errors":
      pushBuffer(session.errors, data);
      break;

    case "network":
      pushBuffer(session.network, data);
      break;

    case "heartbeat":
      session.url = data.url || session.url;
      break;

    case "cmd/response":
      if (data.commandId && pendingCommands.has(data.commandId)) {
        const { resolve, timer } = pendingCommands.get(data.commandId);
        clearTimeout(timer);
        pendingCommands.delete(data.commandId);
        resolve(data);
      }
      break;
  }
});

/* ---------- Prune stale sessions (no heartbeat in 60s) ---------- */

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id);
  }
}, 30_000);

/* ---------- Tool definitions ---------- */

const TOOLS = [
  {
    name: "mqtt_list_sessions",
    description:
      "List all active Waymark browser sessions connected via MQTT. Returns session IDs, URLs, and last-seen timestamps.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mqtt_get_console_logs",
    description:
      "Get captured console logs (log/warn/error/info/debug) from a browser session. Returns the most recent entries.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        count: {
          type: "number",
          description: "Max entries to return (default 50)",
        },
        level: {
          type: "string",
          description: "Filter by log level: log, warn, error, info, debug (optional)",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_get_errors",
    description:
      "Get captured JavaScript errors and unhandled promise rejections from a browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        count: {
          type: "number",
          description: "Max entries to return (default 50)",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_get_network_errors",
    description:
      "Get captured network errors (failed fetch requests) from a browser session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        count: {
          type: "number",
          description: "Max entries to return (default 50)",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_get_dom_snapshot",
    description:
      "Request a DOM snapshot from the browser. Returns outerHTML of an element matching a CSS selector (default: body). Large results are truncated.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: {
          type: "string",
          description: 'CSS selector to snapshot (default: "body")',
        },
        maxLength: {
          type: "number",
          description: "Max HTML characters to return (default 50000)",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_execute_js",
    description:
      "Execute JavaScript code in the browser session and return the result. The code runs in the page context. Use for inspecting state, querying DOM, or running diagnostics.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        code: {
          type: "string",
          description: "JavaScript code to execute in the browser",
        },
      },
      required: ["sessionId", "code"],
    },
  },
  {
    name: "mqtt_get_app_state",
    description:
      "Get the current application state from the browser: URL, hash route, visible screen, theme, etc.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_get_performance",
    description:
      "Get performance metrics from the browser: page load timing, memory usage, and recent resource entries.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_ping",
    description:
      "Ping a browser session to check if it is alive and responsive.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
      },
      required: ["sessionId"],
    },
  },
  /* ---------- Browser control tools ---------- */
  {
    name: "mqtt_navigate",
    description:
      "Navigate the browser to a route. Use 'home' for the home screen, 'explorer' for Drive explorer, 'agent' for AI agent, or any hash route like '#/sheet/{id}' or '#/folder/{id}/Name'.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        target: { type: "string", description: "Route target: 'home', 'explorer', 'agent', or a hash route like '#/sheet/abc123'" },
      },
      required: ["sessionId", "target"],
    },
  },
  {
    name: "mqtt_open_sheet",
    description:
      "Open a Google Sheet in Waymark by its sheet ID. Navigates to the sheet view and waits for it to load.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        sheetId: { type: "string", description: "The Google Sheets spreadsheet ID" },
      },
      required: ["sessionId", "sheetId"],
    },
  },
  {
    name: "mqtt_open_folder",
    description:
      "Open a Google Drive folder in Waymark by its folder ID.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        folderId: { type: "string", description: "The Google Drive folder ID" },
        folderName: { type: "string", description: "Display name for the folder (optional, defaults to 'Folder')" },
      },
      required: ["sessionId", "folderId"],
    },
  },
  {
    name: "mqtt_click",
    description:
      "Click an element in the browser by CSS selector. Returns the element's tag and text content.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: { type: "string", description: "CSS selector of the element to click" },
      },
      required: ["sessionId", "selector"],
    },
  },
  {
    name: "mqtt_type",
    description:
      "Type text into an input field in the browser. Sets the value and dispatches input/change events.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: { type: "string", description: "CSS selector of the input element" },
        text: { type: "string", description: "Text to type into the field" },
      },
      required: ["sessionId", "selector", "text"],
    },
  },
  {
    name: "mqtt_submit_form",
    description:
      "Submit a form in the browser by dispatching a submit event.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: { type: "string", description: "CSS selector of the form element" },
      },
      required: ["sessionId", "selector"],
    },
  },
  {
    name: "mqtt_list_visible_items",
    description:
      "List all visible interactive items on the current screen: sheets, folders, and clickable buttons/links with their selectors.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_wait_for",
    description:
      "Wait for an element matching a CSS selector to appear in the DOM (up to 10 seconds). Useful after navigation or actions that load content asynchronously.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: { type: "string", description: "CSS selector to wait for" },
        timeout: { type: "number", description: "Max wait time in ms (default 5000, max 10000)" },
      },
      required: ["sessionId", "selector"],
    },
  },
  {
    name: "mqtt_scroll_to",
    description:
      "Scroll an element into view in the browser.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: { type: "string", description: "CSS selector of the element to scroll to" },
      },
      required: ["sessionId", "selector"],
    },
  },
  {
    name: "mqtt_get_sidebar",
    description:
      "Get the sidebar state and menu items (open/closed, which item is active).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_toggle_sidebar",
    description:
      "Open, close, or toggle the sidebar.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        open: { type: "boolean", description: "true to open, false to close, omit to toggle" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_search",
    description:
      "Search for sheets by keyword in Waymark. Navigates to search results and returns matching sheets.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        query: { type: "string", description: "Search query text" },
      },
      required: ["sessionId", "query"],
    },
  },
  {
    name: "mqtt_go_back",
    description:
      "Navigate back in browser history (like pressing the back button).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "mqtt_get_element_info",
    description:
      "Get detailed info about a DOM element: tag, text, value, visibility, bounding rect, attributes, child count.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: { type: "string", description: "CSS selector of the element" },
      },
      required: ["sessionId", "selector"],
    },
  },
  {
    name: "mqtt_capture_screenshot",
    description:
      "Capture a visual screenshot of the current browser view or a specific element. Returns an inline image. Use this to SEE what the page actually looks like — layout, colors, spacing, hierarchy. Essential for visual QA testing.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The browser session ID" },
        selector: {
          type: "string",
          description: "CSS selector of the element to capture (default: full page body)",
        },
        quality: {
          type: "number",
          description: "JPEG quality 0.1-1.0 (default: 0.8). Lower = smaller image, less detail.",
        },
        maxWidth: {
          type: "number",
          description: "Maximum image width in pixels (default: 1280). Images wider than this are scaled down.",
        },
      },
      required: ["sessionId"],
    },
  },
];

/* ---------- Tool handlers ---------- */

async function handleTool(name, args) {
  switch (name) {
    case "mqtt_list_sessions": {
      const list = [];
      for (const [id, s] of sessions) {
        list.push({
          sessionId: id,
          url: s.url,
          userAgent: s.userAgent,
          lastSeen: new Date(s.lastSeen).toISOString(),
          logCount: s.logs.length,
          errorCount: s.errors.length,
          networkErrorCount: s.network.length,
        });
      }
      if (list.length === 0) {
        return "No active browser sessions. Make sure the Waymark MQTT bridge is enabled in the browser (?mqtt=1 or localStorage.__WAYMARK_MQTT = 'true').";
      }
      return JSON.stringify(list, null, 2);
    }

    case "mqtt_get_console_logs": {
      const session = sessions.get(args.sessionId);
      if (!session) return `Session "${args.sessionId}" not found. Use mqtt_list_sessions to see active sessions.`;
      let entries = session.logs;
      if (args.level) entries = entries.filter((e) => e.level === args.level);
      return JSON.stringify(entries.slice(-(args.count || 50)), null, 2);
    }

    case "mqtt_get_errors": {
      const session = sessions.get(args.sessionId);
      if (!session) return `Session "${args.sessionId}" not found.`;
      return JSON.stringify(session.errors.slice(-(args.count || 50)), null, 2);
    }

    case "mqtt_get_network_errors": {
      const session = sessions.get(args.sessionId);
      if (!session) return `Session "${args.sessionId}" not found.`;
      return JSON.stringify(session.network.slice(-(args.count || 50)), null, 2);
    }

    case "mqtt_get_dom_snapshot": {
      const resp = await sendCommand(args.sessionId, "get_dom_snapshot", {
        selector: args.selector,
        maxLength: args.maxLength,
      });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_execute_js": {
      const resp = await sendCommand(args.sessionId, "execute_js", {
        code: args.code,
      });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_get_app_state": {
      const resp = await sendCommand(args.sessionId, "get_app_state");
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_get_performance": {
      const resp = await sendCommand(args.sessionId, "get_performance");
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_ping": {
      try {
        const resp = await sendCommand(args.sessionId, "ping");
        if (resp.error) return `Ping failed: ${resp.error}`;
        return JSON.stringify(resp.result, null, 2);
      } catch (err) {
        return `Ping failed: ${err.message}`;
      }
    }

    /* ---------- Browser control handlers ---------- */

    case "mqtt_navigate": {
      const resp = await sendCommand(args.sessionId, "navigate", { target: args.target });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_open_sheet": {
      const resp = await sendCommand(args.sessionId, "open_sheet", { sheetId: args.sheetId });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_open_folder": {
      const resp = await sendCommand(args.sessionId, "open_folder", { folderId: args.folderId, folderName: args.folderName });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_click": {
      const resp = await sendCommand(args.sessionId, "click", { selector: args.selector });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_type": {
      const resp = await sendCommand(args.sessionId, "type", { selector: args.selector, text: args.text });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_submit_form": {
      const resp = await sendCommand(args.sessionId, "submit_form", { selector: args.selector });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_list_visible_items": {
      const resp = await sendCommand(args.sessionId, "list_visible_items");
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_wait_for": {
      const resp = await sendCommand(args.sessionId, "wait_for", { selector: args.selector, timeout: args.timeout });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_scroll_to": {
      const resp = await sendCommand(args.sessionId, "scroll_to", { selector: args.selector });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_get_sidebar": {
      const resp = await sendCommand(args.sessionId, "get_sidebar");
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_toggle_sidebar": {
      const resp = await sendCommand(args.sessionId, "toggle_sidebar", { open: args.open });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_search": {
      const resp = await sendCommand(args.sessionId, "search", { query: args.query });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_go_back": {
      const resp = await sendCommand(args.sessionId, "go_back");
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_get_element_info": {
      const resp = await sendCommand(args.sessionId, "get_element_info", { selector: args.selector });
      if (resp.error) return `Error: ${resp.error}`;
      return JSON.stringify(resp.result, null, 2);
    }

    case "mqtt_capture_screenshot": {
      const resp = await sendCommand(
        args.sessionId,
        "capture_screenshot",
        {
          selector: args.selector,
          quality: args.quality,
          maxWidth: args.maxWidth,
        },
        30_000, // longer timeout — html2canvas rendering can take a few seconds
      );
      if (resp.error) return `Error: ${resp.error}`;
      const r = resp.result;
      if (!r?.image) return "Error: No image data received from browser";
      // Return structured content with image
      return {
        _imageContent: true,
        data: r.image,
        mimeType: r.mimeType || "image/jpeg",
        text: `Screenshot captured: ${r.width}×${r.height}px${r.selector !== "body" ? ` (selector: ${r.selector})` : " (full page)"}${r.originalWidth !== r.width ? ` — scaled from ${r.originalWidth}×${r.originalHeight}` : ""}`,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ---------- MCP Server ---------- */

const server = new Server(
  { name: "waymark-mqtt-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args);
    // Support image content responses (e.g. screenshots)
    if (result && typeof result === "object" && result._imageContent) {
      return {
        content: [
          { type: "image", data: result.data, mimeType: result.mimeType },
          { type: "text", text: result.text },
        ],
      };
    }
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
