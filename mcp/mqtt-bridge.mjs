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

function sendCommand(sessionId, command, args = {}) {
  return new Promise((resolve, reject) => {
    const commandId = randomUUID();
    const timer = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(`Command "${command}" timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);

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
