#!/usr/bin/env node
/* ============================================================
   waymark.mjs — Waymark-focused MCP server

   Abstracts Google Sheets into Waymark template concepts so
   agents can think in "Waymark sheets / templates / entries"
   rather than raw spreadsheet IDs, ranges, and cell indices.

   Auth: Google Service Account via GOOGLE_APPLICATION_CREDENTIALS.
   ============================================================ */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleAuth } from "google-auth-library";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- Template registry ---------- */

const REGISTRY = JSON.parse(
  readFileSync(path.join(__dirname, "../template-registry.json"), "utf8")
);

/** Default column headers per template key (used for sheet creation). */
const DEFAULT_HEADERS = {
  testcases:  ["Test Case", "Result", "Expected", "Actual", "Priority", "Notes"],
  checklist:  ["Item", "Status", "Category", "Due", "Notes"],
  tracker:    ["Goal", "Progress", "Target", "Started", "Notes"],
  schedule:   ["Day", "Time", "Activity", "Location"],
  inventory:  ["Item", "Quantity", "Category", "Notes"],
  contacts:   ["Name", "Phone", "Email", "Role"],
  log:        ["Timestamp", "Activity", "Duration", "Type"],
  budget:     ["Description", "Amount", "Category", "Date", "Budget"],
  kanban:     ["Task", "Description", "Stage", "Project", "Assignee", "Priority", "Due", "Label", "Note", "Reported By"],
  habit:      ["Habit", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Streak"],
  grading:    ["Student", "Assignment 1", "Assignment 2", "Grade"],
  timesheet:  ["Project", "Client", "Hours", "Rate", "Billable", "Date"],
  poll:       ["Option", "Votes", "Percent", "Notes"],
  changelog:  ["Version", "Date", "Type", "What Changed"],
  crm:        ["Company", "Contact", "Deal Stage", "Value", "Notes"],
  meal:       ["Day", "Meal", "Recipe", "Calories", "Protein"],
  travel:     ["Activity", "Date", "Location", "Booking", "Cost"],
  roster:     ["Employee", "Role", "Shift", "Mon", "Tue", "Wed", "Thu", "Fri"],
  recipe:     ["Recipe", "Servings", "Prep Time", "Cook Time", "Category", "Difficulty", "Qty", "Unit", "Ingredient", "Step", "Notes", "Source"],
  flow:       ["Flow", "Step", "Type", "Next", "Condition", "Notes"],
  social:     ["Post", "Author", "Date", "Category", "Mood", "Link", "Comment", "Likes", "Image"],
  automation: ["Workflow", "Step", "Action", "Target", "Value", "Status"],
  guide:      ["Guide", "Slide", "Objective", "Instruction", "Visual", "Duration", "Status"],
  knowledge:  ["Title", "Category", "Content", "Tags", "Author", "Updated", "Status", "Source"],
  notification: ["Title", "Body", "Type", "URL", "Published"],
  iot:        ["Sensor", "Timestamp", "Reading", "Unit", "Min", "Max", "Alert"],
  okr:        ["Objective", "Key Result", "Progress", "Target", "Owner", "Quarter"],
  gantt:      ["Task", "Start Date", "End Date", "Progress", "Dependencies", "Assignee"],
  passwords:  ["Site", "Username", "Password", "URL", "Category", "Notes"],
  marketing:  ["Post", "Platform", "Status", "Topic", "Posted Date", "Likes", "Shares", "Comments", "Views", "Link", "Takeaway"],
  linker:     ["Name", "Description", "Link", "Type", "Tags", "Icon"],
};

/* ---------- Auth ---------- */

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE  = "https://www.googleapis.com/drive/v3";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  process.stderr.write(
    "ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service-account key JSON.\n"
  );
  process.exit(1);
}

const auth = new GoogleAuth({
  keyFile: credPath,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

async function getToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- REST helpers ---------- */

async function apiRequest(baseUrl, path, { method = "GET", body } = {}) {
  const token = await getToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

const sheets = (path, opts) => apiRequest(SHEETS_BASE, path, opts);
const drive  = (path, opts) => apiRequest(DRIVE_BASE, path, opts);

/* ---------- Template detection (Node.js, pure) ---------- */

/**
 * Detect the best Waymark template for a set of column headers.
 * Scores each template by how many detectSignals appear in the headers.
 * @param {string[]} headers
 * @returns {{ templateKey: string, templateName: string, score: number }}
 */
function detectTemplate(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const joined = lower.join(" ");

  let best = { templateKey: "checklist", templateName: "Checklist", score: 0 };

  for (const tmpl of REGISTRY.templates) {
    const signals = tmpl.detectSignals || [];
    let score = 0;
    for (const sig of signals) {
      const pattern = new RegExp(sig, "i");
      if (lower.some(h => pattern.test(h)) || pattern.test(joined)) {
        score++;
      }
    }
    // Bonus for priority (more specific templates win ties)
    const priorityBonus = (tmpl.priority || 10) / 1000;
    const total = score + priorityBonus;
    if (total > best.score) {
      best = { templateKey: tmpl.key, templateName: tmpl.name, score: total };
    }
  }

  return best;
}

/**
 * Map column headers to role names using the registry's columnRoles list.
 * Returns an object: { roleName: colIndex, ... }
 * @param {string[]} headers
 * @param {string} templateKey
 * @returns {Record<string, number>}
 */
function mapColumnRoles(headers, templateKey) {
  const tmpl = REGISTRY.templates.find(t => t.key === templateKey);
  if (!tmpl || !tmpl.columnRoles) return {};

  const lower = headers.map(h => h.toLowerCase().trim());
  const roles = {};
  const used = new Set();

  for (const role of tmpl.columnRoles) {
    const idx = lower.findIndex((h, i) => !used.has(i) && (
      h === role ||
      h.includes(role) ||
      role.includes(h) ||
      h.replace(/[^a-z]/g, "") === role.replace(/[^a-z]/g, "")
    ));
    if (idx >= 0) {
      roles[role] = idx;
      used.add(idx);
    }
  }

  // Always include raw column indices as fallback (col_0, col_1, ...)
  for (let i = 0; i < headers.length; i++) {
    if (!used.has(i)) roles[`col_${i}`] = i;
  }

  return roles;
}

/* ---------- Sheet data helpers ---------- */

async function getSheetValues(spreadsheetId, sheetTitle) {
  const range = sheetTitle ? `${sheetTitle}!A1:ZZ` : "A1:ZZ";
  const data = await sheets(`/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

async function getFirstSheetTitle(spreadsheetId) {
  const meta = await sheets(`/${spreadsheetId}?fields=sheets.properties`);
  return meta.sheets?.[0]?.properties?.title || "Sheet1";
}

/* ---------- Tool definitions ---------- */

const TOOLS = [
  {
    name: "waymark_list_templates",
    description: "List all available Waymark template types with their name, key, icon, category, and default column headers.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by category (e.g. 'Project Management', 'Engineering'). Omit to list all.",
        },
      },
    },
  },
  {
    name: "waymark_detect_template",
    description: "Detect which Waymark template a sheet uses based on its column headers. Pass the header row from the sheet.",
    inputSchema: {
      type: "object",
      required: ["headers"],
      properties: {
        headers: {
          type: "array",
          items: { type: "string" },
          description: "The column header row from the sheet (first row of data).",
        },
      },
    },
  },
  {
    name: "waymark_get_sheet",
    description: "Get a Waymark sheet with template-detected structure. Returns the template type, column role mapping, and all rows as objects with named keys. This is the primary way to read a Waymark sheet.",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId"],
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The Google Sheets spreadsheet ID (from the URL).",
        },
        sheetTitle: {
          type: "string",
          description: "The sheet tab name (defaults to first sheet).",
        },
        maxRows: {
          type: "number",
          description: "Maximum data rows to return (default: 200). Use to avoid huge responses.",
        },
      },
    },
  },
  {
    name: "waymark_add_entry",
    description: "Add a new entry (row) to a Waymark sheet using column role names instead of cell indices. The template is auto-detected from headers. Pass entry data as { roleName: value } — e.g. { title: 'My Task', stage: 'To Do' }.",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId", "entry"],
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID.",
        },
        sheetTitle: {
          type: "string",
          description: "Sheet tab name (defaults to first sheet).",
        },
        entry: {
          type: "object",
          description: "Key-value pairs of column role names to values. Use waymark_get_sheet first to learn the available column roles.",
        },
      },
    },
  },
  {
    name: "waymark_update_entry",
    description: "Update specific columns of an existing row in a Waymark sheet using column role names. Pass the 1-based row index and a { roleName: newValue } map.",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId", "rowIndex", "updates"],
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID.",
        },
        sheetTitle: {
          type: "string",
          description: "Sheet tab name (defaults to first sheet).",
        },
        rowIndex: {
          type: "number",
          description: "The 1-based data row to update (1 = first data row, after headers). Use waymark_get_sheet to find row indices.",
        },
        updates: {
          type: "object",
          description: "Column role names mapped to new values. Only the specified columns are changed.",
        },
      },
    },
  },
  {
    name: "waymark_create_sheet",
    description: "Create a new Google Sheet pre-configured with the correct column headers for a Waymark template. Returns the new spreadsheetId and a Waymark viewer URL.",
    inputSchema: {
      type: "object",
      required: ["templateKey", "title"],
      properties: {
        templateKey: {
          type: "string",
          description: "The template key (e.g. 'kanban', 'checklist', 'budget'). Use waymark_list_templates to see all keys.",
        },
        title: {
          type: "string",
          description: "Title for the new spreadsheet.",
        },
        parentFolderId: {
          type: "string",
          description: "Google Drive folder ID to place the file in (optional).",
        },
        seedRows: {
          type: "array",
          items: {
            type: "object",
            description: "Initial data rows as { roleName: value } entries.",
          },
          description: "Optional initial data rows to pre-populate the sheet.",
        },
      },
    },
  },
  {
    name: "waymark_search_entries",
    description: "Search entries in a Waymark sheet by text across all columns. Returns matching rows with their row indices and role-mapped data.",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId", "query"],
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID.",
        },
        sheetTitle: {
          type: "string",
          description: "Sheet tab name (defaults to first sheet).",
        },
        query: {
          type: "string",
          description: "Text to search for (case-insensitive, matches any column).",
        },
        column: {
          type: "string",
          description: "Restrict search to a specific column role name (optional).",
        },
      },
    },
  },
  {
    name: "waymark_push_notification",
    description: "Push a notification to a phone or desktop via ntfy.sh. Requires WAYMARK_NTFY_TOPIC env var (a unique topic name like a UUID — keep it secret to avoid public visibility). Optionally override with the 'topic' argument. To receive notifications: install the ntfy app (Android/iOS/desktop) and subscribe to the same topic.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: {
          type: "string",
          description: "The notification body text.",
        },
        title: {
          type: "string",
          description: "Notification title/heading (optional, defaults to 'Waymark').",
        },
        topic: {
          type: "string",
          description: "ntfy.sh topic name. Overrides the WAYMARK_NTFY_TOPIC env var. Use a unique hard-to-guess value for privacy.",
        },
        priority: {
          type: "string",
          enum: ["min", "low", "default", "high", "urgent"],
          description: "Notification priority (optional, defaults to 'default').",
        },
        url: {
          type: "string",
          description: "A URL to open when the notification is clicked (optional).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Emoji shortcodes or tag names for the notification, e.g. ['white_check_mark', 'waymark'] (optional).",
        },
      },
    },
  },
];

/* ---------- Tool implementations ---------- */

async function handleWaymarkListTemplates({ category } = {}) {
  let templates = REGISTRY.templates.map(t => ({
    key: t.key,
    name: t.name,
    icon: t.icon,
    category: t.category || "General",
    columnRoles: t.columnRoles || [],
    defaultHeaders: DEFAULT_HEADERS[t.key] || [],
    interactionType: t.interactionType || null,
    interactionStates: t.interactionStates || null,
  }));

  if (category) {
    templates = templates.filter(t =>
      t.category.toLowerCase().includes(category.toLowerCase())
    );
  }

  return { templates, total: templates.length };
}

async function handleWaymarkDetectTemplate({ headers }) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error("headers must be a non-empty array");
  }
  const result = detectTemplate(headers);
  const tmpl = REGISTRY.templates.find(t => t.key === result.templateKey);
  return {
    templateKey: result.templateKey,
    templateName: result.templateName,
    confidence: result.score > 2 ? "high" : result.score > 0 ? "medium" : "low",
    columnRoles: tmpl?.columnRoles || [],
    defaultHeaders: DEFAULT_HEADERS[result.templateKey] || [],
  };
}

async function handleWaymarkGetSheet({ spreadsheetId, sheetTitle, maxRows = 200 }) {
  const title = sheetTitle || await getFirstSheetTitle(spreadsheetId);
  const values = await getSheetValues(spreadsheetId, title);
  if (values.length === 0) {
    return { templateKey: null, headers: [], rows: [], totalRows: 0, sheetTitle: title };
  }

  const headers = values[0];
  const detection = detectTemplate(headers);
  const columnRoles = mapColumnRoles(headers, detection.templateKey);

  // Build reverse map: colIndex → roleName
  const indexToRole = {};
  for (const [role, idx] of Object.entries(columnRoles)) {
    if (!indexToRole[idx]) indexToRole[idx] = role; // first role wins
  }

  const dataRows = values.slice(1, 1 + maxRows);
  const rows = dataRows.map((row, i) => {
    const entry = { _rowIndex: i + 1 };
    for (let c = 0; c < headers.length; c++) {
      const role = indexToRole[c] || `col_${c}`;
      entry[role] = row[c] || "";
    }
    return entry;
  });

  return {
    spreadsheetId,
    sheetTitle: title,
    templateKey: detection.templateKey,
    templateName: detection.templateName,
    headers,
    columnRoles,
    rows,
    totalRows: dataRows.length,
    truncated: values.length - 1 > maxRows,
  };
}

async function handleWaymarkAddEntry({ spreadsheetId, sheetTitle, entry }) {
  const title = sheetTitle || await getFirstSheetTitle(spreadsheetId);
  const values = await getSheetValues(spreadsheetId, title);
  if (values.length === 0) throw new Error("Sheet has no header row");

  const headers = values[0];
  const detection = detectTemplate(headers);
  const columnRoles = mapColumnRoles(headers, detection.templateKey);

  // Build a row array aligned to headers
  const row = new Array(headers.length).fill("");
  for (const [role, val] of Object.entries(entry)) {
    const colIdx = columnRoles[role];
    if (colIdx !== undefined && colIdx >= 0) {
      row[colIdx] = String(val);
    }
  }

  const range = `${title}!A1`;
  await sheets(`/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: { values: [row] },
  });

  return {
    success: true,
    appendedRow: row,
    columnRoles,
    templateKey: detection.templateKey,
  };
}

async function handleWaymarkUpdateEntry({ spreadsheetId, sheetTitle, rowIndex, updates }) {
  const title = sheetTitle || await getFirstSheetTitle(spreadsheetId);
  const values = await getSheetValues(spreadsheetId, title);
  if (values.length === 0) throw new Error("Sheet has no header row");

  const headers = values[0];
  const detection = detectTemplate(headers);
  const columnRoles = mapColumnRoles(headers, detection.templateKey);

  // Rows in the sheet are 1-indexed, header is row 1, first data row is row 2
  // rowIndex is 1-based data row, so sheet row = rowIndex + 1
  const sheetRow = rowIndex + 1;

  const results = [];
  for (const [role, val] of Object.entries(updates)) {
    const colIdx = columnRoles[role];
    if (colIdx === undefined || colIdx < 0) continue;

    // Convert col index to A1 column letter
    const colLetter = colIndexToLetter(colIdx);
    const cellRange = `${title}!${colLetter}${sheetRow}`;

    await sheets(`/${spreadsheetId}/values/${encodeURIComponent(cellRange)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: { range: cellRange, majorDimension: "ROWS", values: [[String(val)]] },
    });
    results.push({ role, colIdx, cellRange, value: val });
  }

  return { success: true, updated: results, rowIndex };
}

async function handleWaymarkCreateSheet({ templateKey, title, parentFolderId, seedRows = [] }) {
  const headers = DEFAULT_HEADERS[templateKey];
  if (!headers) throw new Error(`Unknown template key: ${templateKey}. Use waymark_list_templates to see valid keys.`);

  const detection = detectTemplate(headers); // Verify we'd detect the right template
  const columnRoles = mapColumnRoles(headers, templateKey);

  // Build initial rows: header + any seed rows
  const rows = [headers];
  for (const entry of seedRows) {
    const row = new Array(headers.length).fill("");
    for (const [role, val] of Object.entries(entry)) {
      const colIdx = columnRoles[role];
      if (colIdx !== undefined && colIdx >= 0) row[colIdx] = String(val);
    }
    rows.push(row);
  }

  // Create the spreadsheet
  const body = {
    properties: { title },
    sheets: [{
      properties: { title: "Sheet1" },
      data: [{
        startRow: 0,
        startColumn: 0,
        rowData: rows.map(row => ({
          values: row.map(cell => ({ userEnteredValue: { stringValue: cell } })),
        })),
      }],
    }],
  };

  const created = await sheets("", { method: "POST", body });
  const spreadsheetId = created.spreadsheetId;

  // Move to folder if requested
  if (parentFolderId && spreadsheetId) {
    try {
      await drive(`/files/${spreadsheetId}?addParents=${parentFolderId}&fields=id`, { method: "PATCH", body: {} });
    } catch { /* non-fatal */ }
  }

  return {
    spreadsheetId,
    title,
    templateKey,
    templateName: REGISTRY.templates.find(t => t.key === templateKey)?.name || templateKey,
    waymarkUrl: `https://swiftirons.com/waymark/#/sheet/${spreadsheetId}`,
    sheetsUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    headers,
    columnRoles,
    rowsCreated: rows.length,
  };
}

async function handleWaymarkSearchEntries({ spreadsheetId, sheetTitle, query, column }) {
  const title = sheetTitle || await getFirstSheetTitle(spreadsheetId);
  const values = await getSheetValues(spreadsheetId, title);
  if (values.length === 0) return { matches: [], totalRows: 0 };

  const headers = values[0];
  const detection = detectTemplate(headers);
  const columnRoles = mapColumnRoles(headers, detection.templateKey);
  const indexToRole = {};
  for (const [role, idx] of Object.entries(columnRoles)) {
    if (!indexToRole[idx]) indexToRole[idx] = role;
  }

  // If column role specified, find its index
  let searchColIdx = -1;
  if (column) {
    searchColIdx = columnRoles[column] ?? -1;
    if (searchColIdx < 0) throw new Error(`Column role '${column}' not found. Available roles: ${Object.keys(columnRoles).join(", ")}`);
  }

  const lQuery = query.toLowerCase();
  const matches = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const searchIn = searchColIdx >= 0
      ? [(row[searchColIdx] || "")]
      : row;

    if (searchIn.some(v => (v || "").toLowerCase().includes(lQuery))) {
      const entry = { _rowIndex: r };
      for (let c = 0; c < headers.length; c++) {
        const role = indexToRole[c] || `col_${c}`;
        entry[role] = row[c] || "";
      }
      matches.push(entry);
    }
  }

  return {
    spreadsheetId,
    sheetTitle: title,
    templateKey: detection.templateKey,
    query,
    matches,
    totalMatches: matches.length,
    totalRows: values.length - 1,
  };
}

/* ---------- Push notification ---------- */

async function handleWaymarkPushNotification({ message, title, topic, priority, url, tags } = {}) {
  const ntfyTopic = topic || process.env.WAYMARK_NTFY_TOPIC;
  if (!ntfyTopic) {
    throw new Error(
      "No ntfy.sh topic configured. Set WAYMARK_NTFY_TOPIC env var to a unique topic name, " +
      "or pass 'topic' in the tool arguments. Install the ntfy app and subscribe to that topic to receive notifications."
    );
  }

  const ntfyBase = (process.env.WAYMARK_NTFY_URL || "https://ntfy.sh").replace(/\/$/, "");
  const endpoint = `${ntfyBase}/${encodeURIComponent(ntfyTopic)}`;

  const headers = { "Content-Type": "text/plain; charset=utf-8" };
  if (title)                          headers["X-Title"]    = title;
  if (priority && priority !== "default") headers["X-Priority"] = priority;
  if (url)                            headers["X-Click"]    = url;
  if (tags && tags.length > 0)        headers["X-Tags"]     = tags.join(",");

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: message,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`ntfy.sh responded with ${response.status}: ${text}`);
  }

  const data = await response.json().catch(() => ({}));
  return {
    ok: true,
    messageId: data.id || null,
    topic: `${ntfyBase}/${ntfyTopic}`,
    title: title || "Waymark",
    message,
  };
}

/* ---------- Utility ---------- */

function colIndexToLetter(idx) {
  let letter = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/* ---------- MCP server setup ---------- */

const server = new Server(
  { name: "waymark", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case "waymark_list_templates":    result = await handleWaymarkListTemplates(args); break;
      case "waymark_detect_template":   result = await handleWaymarkDetectTemplate(args); break;
      case "waymark_get_sheet":         result = await handleWaymarkGetSheet(args); break;
      case "waymark_add_entry":         result = await handleWaymarkAddEntry(args); break;
      case "waymark_update_entry":      result = await handleWaymarkUpdateEntry(args); break;
      case "waymark_create_sheet":      result = await handleWaymarkCreateSheet(args); break;
      case "waymark_search_entries":    result = await handleWaymarkSearchEntries(args); break;
      case "waymark_push_notification": result = await handleWaymarkPushNotification(args); break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("Waymark MCP server ready (8 tools)\n");
