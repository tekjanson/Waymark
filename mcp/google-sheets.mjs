#!/usr/bin/env node
/* ============================================================
   google-sheets.mjs — Local MCP server for Google Sheets
   Uses raw JSON Schema (no Zod) to avoid serialization bugs.
   Auth: Google Service Account via GOOGLE_APPLICATION_CREDENTIALS.
   ============================================================ */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleAuth } from "google-auth-library";

/* ---------- Config ---------- */

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  process.stderr.write(
    "ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service-account key JSON.\n"
  );
  process.exit(1);
}

/* ---------- Auth ---------- */

const auth = new GoogleAuth({
  keyFile: credPath,
  scopes: SCOPES,
});

async function getToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/* ---------- Sheets REST helpers ---------- */

async function sheetsRequest(path, { method = "GET", body } = {}) {
  const token = await getToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${SHEETS_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API ${res.status}: ${text}`);
  }
  return res.json();
}

/* ---------- Tool definitions (raw JSON Schema) ---------- */

const TOOLS = [
  {
    name: "sheets_spreadsheet_get",
    description:
      "Get spreadsheet metadata: title, sheet/tab list with IDs, row/column counts. Optionally include cell data by setting includeGridData to true.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID (from the URL between /d/ and /edit)",
        },
        includeGridData: {
          type: "boolean",
          description: "If true, include cell data for every sheet (default: false)",
        },
      },
      required: ["spreadsheetId"],
    },
  },
  {
    name: "sheets_values_get",
    description:
      "Read cell values from a single range using A1 notation (e.g. Sheet1!A1:D10).",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        range: {
          type: "string",
          description: "A1 notation range, e.g. Sheet1!A1:D10",
        },
      },
      required: ["spreadsheetId", "range"],
    },
  },
  {
    name: "sheets_values_batch_get",
    description: "Read cell values from multiple ranges at once.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        ranges: {
          type: "array",
          items: { type: "string" },
          description: "Array of A1 notation ranges",
        },
      },
      required: ["spreadsheetId", "ranges"],
    },
  },
  {
    name: "sheets_values_update",
    description:
      "Write (overwrite) cell values to a range. Values is a 2D array of rows.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        range: {
          type: "string",
          description: "A1 notation range to write to",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description: "2D array of values (rows × columns)",
        },
      },
      required: ["spreadsheetId", "range", "values"],
    },
  },
  {
    name: "sheets_values_batch_update",
    description: "Write cell values to multiple ranges at once.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              range: { type: "string", description: "A1 notation range" },
              values: {
                type: "array",
                items: {
                  type: "array",
                  items: { type: "string" },
                },
                description: "2D array of values",
              },
            },
            required: ["range", "values"],
          },
          description: "Array of {range, values} objects",
        },
      },
      required: ["spreadsheetId", "data"],
    },
  },
  {
    name: "sheets_values_append",
    description:
      "Append rows after the last row of data in a range. Values is a 2D array.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        range: {
          type: "string",
          description: "A1 notation range to append to (e.g. Sheet1!A:D)",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description: "2D array of values to append",
        },
      },
      required: ["spreadsheetId", "range", "values"],
    },
  },
  {
    name: "sheets_values_clear",
    description: "Clear cell values from a range (keeps formatting).",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        range: {
          type: "string",
          description: "A1 notation range to clear",
        },
      },
      required: ["spreadsheetId", "range"],
    },
  },
  {
    name: "sheets_sheets_list",
    description: "List all sheets (tabs) in a spreadsheet with their IDs and properties.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
      },
      required: ["spreadsheetId"],
    },
  },
  {
    name: "sheets_sheet_add",
    description: "Add a new sheet (tab) to a spreadsheet.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        title: {
          type: "string",
          description: "Title for the new sheet",
        },
      },
      required: ["spreadsheetId", "title"],
    },
  },
  {
    name: "sheets_sheet_delete",
    description: "Delete a sheet (tab) from a spreadsheet by its sheet ID.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The spreadsheet ID",
        },
        sheetId: {
          type: "number",
          description: "The numeric sheet/tab ID (use sheets_sheets_list to find it)",
        },
      },
      required: ["spreadsheetId", "sheetId"],
    },
  },
  {
    name: "sheets_spreadsheet_create",
    description: "Create a new empty spreadsheet with the given title.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the new spreadsheet",
        },
      },
      required: ["title"],
    },
  },
];

/* ---------- Tool handlers ---------- */

async function handleTool(name, args) {
  switch (name) {
    /* --- Spreadsheet metadata --- */
    case "sheets_spreadsheet_get": {
      const qs = args.includeGridData ? "?includeGridData=true" : "";
      const data = await sheetsRequest(`/${args.spreadsheetId}${qs}`);
      const sheets = (data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId,
        title: s.properties?.title,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      }));
      return JSON.stringify(
        { title: data.properties?.title, spreadsheetId: data.spreadsheetId, sheets },
        null,
        2
      );
    }

    /* --- Read values --- */
    case "sheets_values_get": {
      const range = encodeURIComponent(args.range);
      const data = await sheetsRequest(`/${args.spreadsheetId}/values/${range}`);
      return JSON.stringify(
        { range: data.range, values: data.values ?? [] },
        null,
        2
      );
    }

    case "sheets_values_batch_get": {
      const qs = args.ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
      const data = await sheetsRequest(
        `/${args.spreadsheetId}/values:batchGet?${qs}`
      );
      const result = (data.valueRanges ?? []).map((vr) => ({
        range: vr.range,
        values: vr.values ?? [],
      }));
      return JSON.stringify(result, null, 2);
    }

    /* --- Write values --- */
    case "sheets_values_update": {
      const range = encodeURIComponent(args.range);
      const data = await sheetsRequest(
        `/${args.spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
        { method: "PUT", body: { values: args.values } }
      );
      return `Updated ${data.updatedCells ?? 0} cells in ${data.updatedRange ?? args.range}.`;
    }

    case "sheets_values_batch_update": {
      const data = await sheetsRequest(
        `/${args.spreadsheetId}/values:batchUpdate`,
        {
          method: "POST",
          body: {
            valueInputOption: "USER_ENTERED",
            data: args.data,
          },
        }
      );
      return `Batch update: ${data.totalUpdatedCells ?? 0} cells updated across ${data.totalUpdatedSheets ?? 0} sheets.`;
    }

    case "sheets_values_append": {
      const range = encodeURIComponent(args.range);
      const data = await sheetsRequest(
        `/${args.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: { values: args.values } }
      );
      return `Appended ${data.updates?.updatedRows ?? 0} rows to ${data.updates?.updatedRange ?? args.range}.`;
    }

    case "sheets_values_clear": {
      const range = encodeURIComponent(args.range);
      const data = await sheetsRequest(
        `/${args.spreadsheetId}/values/${range}:clear`,
        { method: "POST", body: {} }
      );
      return `Cleared range: ${data.clearedRange ?? args.range}.`;
    }

    /* --- Sheet/tab management --- */
    case "sheets_sheets_list": {
      const data = await sheetsRequest(`/${args.spreadsheetId}?fields=sheets.properties`);
      const sheets = (data.sheets ?? []).map((s) => s.properties);
      return JSON.stringify(sheets, null, 2);
    }

    case "sheets_sheet_add": {
      const data = await sheetsRequest(`/${args.spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: {
          requests: [{ addSheet: { properties: { title: args.title } } }],
        },
      });
      const reply = data.replies?.[0]?.addSheet?.properties;
      return JSON.stringify(
        { message: `Created sheet "${reply?.title}"`, sheetId: reply?.sheetId },
        null,
        2
      );
    }

    case "sheets_sheet_delete": {
      await sheetsRequest(`/${args.spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: {
          requests: [{ deleteSheet: { sheetId: args.sheetId } }],
        },
      });
      return `Deleted sheet with ID ${args.sheetId}.`;
    }

    case "sheets_spreadsheet_create": {
      const data = await sheetsRequest("", {
        method: "POST",
        body: { properties: { title: args.title } },
      });
      return JSON.stringify(
        {
          message: `Created spreadsheet "${data.properties?.title}"`,
          spreadsheetId: data.spreadsheetId,
          url: data.spreadsheetUrl,
        },
        null,
        2
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ---------- MCP Server ---------- */

const server = new Server(
  { name: "waymark-google-sheets", version: "1.0.0" },
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
