#!/usr/bin/env node
/* ============================================================
   save-board-url.js — Persist a board URL into workboard-config.json

   Usage:
     node scripts/save-board-url.js <url-or-spreadsheet-id>

   Accepts:
     - Google Sheets URL:  https://docs.google.com/spreadsheets/d/{id}/...
     - Waymark app URL:    https://example.com/waymark/#/sheet/{id}
     - Bare spreadsheet ID

   Updates generated/workboard-config.json in place, writing the
   extracted spreadsheet ID into the active project entry.
   Called by `make run` / `make start` when BOARD_URL is set.
   ============================================================ */

const { parseSpreadsheetId } = require("./workboard-config");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/save-board-url.js <url-or-id>");
  process.exit(1);
}

const id = parseSpreadsheetId(url);
if (!id || id.includes("/")) {
  console.error(`Could not extract a spreadsheet ID from: ${url}`);
  process.exit(1);
}

const configPath = path.resolve(__dirname, "../generated/workboard-config.json");
let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  cfg = { activeProject: "waymark", projects: {} };
}

const proj = cfg.activeProject || "waymark";
cfg.projects = cfg.projects || {};
cfg.projects[proj] = { ...(cfg.projects[proj] || {}), spreadsheetId: id };

writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
console.log(`  ✓ Board saved  project=${proj}  id=${id}`);
