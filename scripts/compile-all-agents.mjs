#!/usr/bin/env node
/* compile-all-agents.mjs — Compile all 35 Waymark template agents and AGY skills
   Run from the Waymark repo root:
     node scripts/compile-all-agents.mjs [--force]

   Outputs:
     1. .github/agents/waymark-{key}.agent.md (Copilot agents)
     2. .agents/skills/waymark-{key}/SKILL.md (Antigravity workspace skills)
     3. .agents/skills/waymark-orchestrator/SKILL.md
     4. generated/waymark-agent-catalog.json (deterministic routing & schema catalog)
*/

import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const FORCE      = process.argv.includes("--force");

const REGISTRY_PATH    = path.join(ROOT, "template-registry.json");
const BASE_TMPL_PATH   = path.join(ROOT, "agent-templates", "base.md.tmpl");
const AGY_TMPL_PATH    = path.join(ROOT, "agent-templates", "agy-skill.md.tmpl");
const DOMAIN_KN_DIR    = path.join(ROOT, "agent-templates", "domain-knowledge");
const OUTPUT_DIR       = path.join(ROOT, ".github", "agents");
const SKILLS_DIR       = path.join(ROOT, ".agents", "skills");
const GENERATED_DIR    = path.join(ROOT, "generated");
const CATALOG_PATH     = path.join(GENERATED_DIR, "waymark-agent-catalog.json");
const EVAL_DIR         = path.join(OUTPUT_DIR, "evals");
const AGENTS_CFG_PATH  = path.join(ROOT, "mcp", "orchestrator-agents.json");

/** Extra tools injected into the tools list for specific templates (after waymark_create_sheet). */
const EXTRA_TOOLS = {
  blog: ["waymark/waymark_create_doc"],
};

const DEFAULT_HEADERS = {
  testcases:    ["Test Case", "Result", "Expected", "Actual", "Priority", "Notes"],
  checklist:    ["Item", "Status", "Category", "Due", "Notes"],
  tracker:      ["Goal", "Progress", "Target", "Started", "Notes"],
  schedule:     ["Day", "Time", "Activity", "Location"],
  inventory:    ["Item", "Quantity", "Category", "Notes"],
  contacts:     ["Name", "Phone", "Email", "Role"],
  log:          ["Timestamp", "Activity", "Duration", "Type"],
  budget:       ["Description", "Amount", "Category", "Date", "Budget"],
  kanban:       ["Task", "Description", "Stage", "Project", "Assignee", "Priority", "Due", "Label", "Note", "Reported By"],
  habit:        ["Habit", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Streak"],
  grading:      ["Student", "Assignment 1", "Assignment 2", "Grade"],
  timesheet:    ["Project", "Client", "Hours", "Rate", "Billable", "Date"],
  poll:         ["Option", "Votes", "Percent", "Notes"],
  changelog:    ["Version", "Date", "Type", "What Changed"],
  crm:          ["Company", "Contact", "Deal Stage", "Value", "Notes"],
  meal:         ["Day", "Meal", "Recipe", "Calories", "Protein"],
  travel:       ["Activity", "Date", "Location", "Booking", "Cost"],
  roster:       ["Employee", "Role", "Shift", "Mon", "Tue", "Wed", "Thu", "Fri"],
  recipe:       ["Recipe", "Servings", "Prep Time", "Cook Time", "Category", "Difficulty", "Qty", "Unit", "Ingredient", "Step", "Notes", "Source"],
  flow:         ["Flow", "Step", "Type", "Next", "Condition", "Notes"],
  social:       ["Post", "Author", "Date", "Category", "Mood", "Link", "Comment", "Likes", "Image"],
  automation:   ["Workflow", "Step", "Action", "Target", "Value", "Status"],
  guide:        ["Guide", "Slide", "Objective", "Instruction", "Visual", "Duration", "Status"],
  knowledge:    ["Title", "Category", "Content", "Tags", "Author", "Updated", "Status", "Source"],
  notification: ["Title", "Body", "Type", "URL", "Published"],
  iot:          ["Sensor", "Timestamp", "Reading", "Unit", "Min", "Max", "Alert"],
  okr:          ["Objective", "Key Result", "Progress", "Target", "Owner", "Quarter"],
  gantt:        ["Task", "Start Date", "End Date", "Progress", "Dependencies", "Assignee"],
  passwords:    ["Site", "Username", "Password", "URL", "Category", "Notes"],
  linker:       ["Name", "Description", "Link", "Type", "Tags", "Icon"],
  marketing:    ["Post", "Platform", "Status", "Topic", "Posted Date", "Likes", "Shares", "Comments", "Views", "Link", "Takeaway"],
  arcade:       ["Game", "Player 1", "Player 2", "Result", "Mode", "Date"],
  worker:       ["Job", "Handler", "Status", "Schedule", "Input", "Output", "LastRun", "Logs"],
  photos:       ["Photo", "Title", "Date", "Album", "Description"],
  blog:         ["Title", "Doc", "Date", "Author", "Category", "Status"],
  agents:       ["Name", "Model", "Provider", "Status", "Tuning", "Task", "Project", "Heartbeat", "Workboard", "Command"],
  ledger:       ["Entry", "Type", "Category", "Date", "Amount", "Counterparty", "Reference", "Status", "TaxCategory", "Notes"],
  invoice:      ["Invoice #", "Client", "Client Email", "Client Address", "Issue Date", "Due Date", "Status", "Item", "Category", "Qty", "Unit Price", "Tax %", "Discount", "Notes"],
  calorie:      ["Food", "Meal", "Calories", "Protein", "Carbs", "Fat", "Date", "Servings", "Notes"],
  party:        ["Party Details", "Value", "Notes"],
  floorplan:    ["Room Name", "Type", "Points", "Doors", "Windows", "Color", "Notes"],
};

function buildStatesBlock(tmpl) {
  const { interactionType, interactionStates = [] } = tmpl;
  if (!interactionType || interactionType === "none" || interactionStates.length === 0) {
    return `This template has no state machine. The interaction type is \`${interactionType || "none"}\` — cells are edited directly without cycling.`;
  }
  if (interactionType === "toggle") {
    const on = interactionStates[0] ?? "done";
    const off = interactionStates[1] ?? "";
    return `Interaction type: \`toggle\`\n\n- **Done value:** \`${on}\`\n- **Not-done value:** \`${off || "(empty string)"}\`\n\nOnly write one of these two values to the status column. Never write anything else.`;
  }
  if (interactionType === "status-cycle") {
    const flow = interactionStates.join(" → ");
    const list = interactionStates.map(s => `- \`${s}\``).join("\n");
    return `Interaction type: \`status-cycle\`\n\nValid states (in order):\n${list}\n\nFlow: \`${flow}\`\n\nAfter the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.`;
  }
  const list = interactionStates.map(s => `- \`${s}\``).join("\n");
  return `Interaction type: \`${interactionType}\`\n\nValid values:\n${list}`;
}

function computeHash(tmpl) {
  const base   = readFileSync(BASE_TMPL_PATH, "utf8");
  const domainPath = path.join(DOMAIN_KN_DIR, `${tmpl.key}.md`);
  const domain = existsSync(domainPath) ? readFileSync(domainPath, "utf8") : "";
  return createHash("sha256").update(base).update(domain).update(JSON.stringify(tmpl)).digest("hex");
}

function compileOne(tmpl) {
  const key = tmpl.key;
  const outputFile = path.join(OUTPUT_DIR, `waymark-${key}.agent.md`);
  const skillDir   = path.join(SKILLS_DIR, `waymark-${key}`);
  const skillFile  = path.join(skillDir, "SKILL.md");
  const hashFile   = path.join(EVAL_DIR, `${key}.sha`);
  const currentHash = computeHash(tmpl);

  const base = readFileSync(BASE_TMPL_PATH, "utf8");
  const agyBase = existsSync(AGY_TMPL_PATH) ? readFileSync(AGY_TMPL_PATH, "utf8") : base;
  const domainPath    = path.join(DOMAIN_KN_DIR, `${key}.md`);
  const genericPath   = path.join(DOMAIN_KN_DIR, `_generic.md`);
  let usedGeneric = false;
  let domain;
  if (existsSync(domainPath)) {
    domain = readFileSync(domainPath, "utf8");
  } else {
    domain = readFileSync(genericPath, "utf8")
      .replace(/\{\{TEMPLATE_KEY\}\}/g, key)
      .replace(/\{\{TEMPLATE_NAME\}\}/g, tmpl.name);
    usedGeneric = true;
  }

  const columnRoles = tmpl.columnRoles || [];
  const defaultHeaders = DEFAULT_HEADERS[key] || columnRoles;
  const detectSignals  = tmpl.detectSignals || [];
  const columnRolesList = columnRoles.length > 0
    ? columnRoles.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "(No column roles defined — use column indices or header names directly)";
  const interactionStates = tmpl.interactionStates || [];
  const toggleOn  = interactionStates[0] ?? "done";
  const toggleOff = interactionStates[1] ?? "";
  const extraToolsList = (EXTRA_TOOLS[key] || []).map(t => `, ${t}`).join("");
  const statesBlock = buildStatesBlock(tmpl);

  const compiledCopilot = base
    .replace(/\{\{TEMPLATE_KEY\}\}/g,           key)
    .replace(/\{\{TEMPLATE_NAME\}\}/g,           tmpl.name)
    .replace(/\{\{TEMPLATE_CATEGORY\}\}/g,       tmpl.category || "General")
    .replace(/\{\{INTERACTION_TYPE\}\}/g,         tmpl.interactionType || "none")
    .replace(/\{\{COLUMN_ROLES_LIST\}\}/g,        columnRolesList)
    .replace(/\{\{DEFAULT_HEADERS\}\}/g,          defaultHeaders.join(", "))
    .replace(/\{\{DETECT_SIGNALS\}\}/g,           detectSignals.join(", "))
    .replace(/\{\{INTERACTION_STATES_BLOCK\}\}/g, statesBlock)
    .replace(/\{\{TOGGLE_ON\}\}/g,                toggleOn)
    .replace(/\{\{TOGGLE_OFF\}\}/g,               toggleOff)
    .replace(/\{\{EXTRA_TOOLS\}\}/g,              extraToolsList)
    .replace(/\{\{DOMAIN_KNOWLEDGE\}\}/g,         domain.trim());

  const compiledSkill = agyBase
    .replace(/\{\{TEMPLATE_KEY\}\}/g,           key)
    .replace(/\{\{TEMPLATE_NAME\}\}/g,           tmpl.name)
    .replace(/\{\{TEMPLATE_CATEGORY\}\}/g,       tmpl.category || "General")
    .replace(/\{\{INTERACTION_TYPE\}\}/g,         tmpl.interactionType || "none")
    .replace(/\{\{COLUMN_ROLES_LIST\}\}/g,        columnRolesList)
    .replace(/\{\{DEFAULT_HEADERS\}\}/g,          defaultHeaders.join(", "))
    .replace(/\{\{DETECT_SIGNALS\}\}/g,           detectSignals.join(", "))
    .replace(/\{\{INTERACTION_STATES_BLOCK\}\}/g, statesBlock)
    .replace(/\{\{TOGGLE_ON\}\}/g,                toggleOn)
    .replace(/\{\{TOGGLE_OFF\}\}/g,               toggleOff)
    .replace(/\{\{EXTRA_TOOLS\}\}/g,              extraToolsList)
    .replace(/\{\{DOMAIN_KNOWLEDGE\}\}/g,         domain.trim());

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(outputFile, compiledCopilot, "utf8");
  writeFileSync(skillFile, compiledSkill, "utf8");
  writeFileSync(hashFile, `${currentHash}\n`, "utf8");

  return { key, status: existsSync(outputFile) && !FORCE ? "recompiled" : "compiled", usedGeneric };
}

// ── Main ──────────────────────────────────────────────────────────────

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const keys = registry.templates.map(t => t.key);

console.log(`\nCompiling ${keys.length} agents and skills…  (--force: ${FORCE})\n`);

let compiled = 0, upToDate = 0, errors = 0;
const results = [];

for (const tmpl of registry.templates) {
  try {
    const r = compileOne(tmpl);
    results.push(r);
    if (r.status === "up-to-date") { upToDate++; process.stdout.write("·"); }
    else { compiled++; process.stdout.write("✓"); }
  } catch (err) {
    errors++;
    results.push({ key: tmpl.key, status: "error", error: err.message });
    process.stdout.write("✗");
  }
}

console.log(`\n\n  Compiled:   ${compiled}`);
console.log(`  Up-to-date: ${upToDate}`);
console.log(`  Errors:     ${errors}`);

if (errors > 0) {
  console.log("\nErrors:");
  results.filter(r => r.status === "error").forEach(r =>
    console.log(`  ${r.key}: ${r.error}`)
  );
}

const generic = results.filter(r => r.usedGeneric);
if (generic.length > 0) {
  console.log("\nUsed generic fallback (no domain knowledge file):");
  generic.forEach(r => console.log(`  ${r.key}`));
}

// ── Master AGY Orchestrator & Files Skills ────────────────────────────

const orchSkillDir = path.join(SKILLS_DIR, "waymark-orchestrator");
mkdirSync(orchSkillDir, { recursive: true });
const orchSkillContent = `---
name: waymark-orchestrator
description: >-
  Use this skill to orchestrate, route, and execute tasks across all 41 Waymark template types using Gemini Flash and Waymark MCP tools.
---

# Waymark Orchestrator Skill

You are the Waymark Orchestrator. You help users create, view, search, organize, and update sheets and documents across all 41 Waymark template types.

## Available Waymark MCP Tools
1. \`waymark_list_templates({})\` — List all Waymark templates and their column roles.
2. \`waymark_detect_template({ headers })\` — Detect the best Waymark template for a row of headers.
3. \`waymark_list_files({ query?, type?, pageSize?, parentFolderId? })\` — Discover existing spreadsheets and Google Docs across Drive (\`type\`: \`"all" | "spreadsheet" | "document" | "folder"\`).
4. \`waymark_create_sheet({ templateKey, title, seedRows?, shareWith?, parentFolderId? })\` — Create a new Waymark spreadsheet with proper headers and optional initial rows.
5. \`waymark_get_sheet({ spreadsheetId, sheetTitle?, maxRows? })\` — Read a spreadsheet with automatic template detection and column role mapping (each row carries a 1-based \`_rowIndex\`).
6. \`waymark_search_entries({ spreadsheetId, query, column?, sheetTitle? })\` — Search rows in a sheet by keyword or column role without loading the entire sheet.
7. \`waymark_add_entry({ spreadsheetId, entry, sheetTitle? })\` — Append a new row mapped by column role names.
8. \`waymark_update_entry({ spreadsheetId, rowIndex, updates, sheetTitle? })\` — Update specific column roles using the **1-based** data \`rowIndex\` (\`_rowIndex >= 1\` from \`waymark_get_sheet\` or \`waymark_search_entries\`).
9. \`waymark_share_sheet({ spreadsheetId, shareWith?, shareWithAnyone?, role? })\` — Share a spreadsheet with collaborators.
10. \`waymark_create_doc({ title, body?, parentFolderId?, shareWith? })\` — Create a Google Doc.
11. \`waymark_get_doc({ documentId })\` — Read a Google Doc's title and plain text body.
12. \`waymark_append_doc({ documentId, text })\` — Append text to the end of a Google Doc.

## Routing & Progressive Disclosure
Always identify the relevant template skill (e.g. \`waymark-budget\`, \`waymark-kanban\`, \`waymark-travel\`, \`waymark-party\`) and follow its domain rules, column roles, and state cycles.
`;
writeFileSync(path.join(orchSkillDir, "SKILL.md"), orchSkillContent, "utf8");
console.log(`  ✓ compiled .agents/skills/waymark-orchestrator/SKILL.md`);

const filesSkillDir = path.join(SKILLS_DIR, "waymark-files");
mkdirSync(filesSkillDir, { recursive: true });
const filesSkillContent = `---
name: waymark-files
description: >-
  Use this skill to discover, search, read, create, and manage Google Drive spreadsheets and Google Docs in Waymark.
---

# Waymark Files & Documents Skill

You are the Waymark File & Document specialist. Use this skill when the user wants to find existing spreadsheets or documents, search across entries, or read/write Google Docs.

## Available File & Document MCP Tools
- **\`waymark_list_files({ query?, type?, pageSize?, parentFolderId? })\`**: List or search spreadsheets and docs across Google Drive. \`type\` can be \`"all"\`, \`"spreadsheet"\`, \`"document"\`, or \`"folder"\`.
- **\`waymark_search_entries({ spreadsheetId, query, column?, sheetTitle? })\`**: Search rows in a spreadsheet by keyword (optionally restricted to a specific \`column\` role). Returns 1-based \`_rowIndex\` for each match.
- **\`waymark_get_doc({ documentId })\`**: Read the full plain-text content of a Google Doc.
- **\`waymark_create_doc({ title, body?, parentFolderId?, shareWith? })\`**: Create a new Google Doc and optionally link it in a \`blog\` or \`knowledge\` sheet.
- **\`waymark_append_doc({ documentId, text })\`**: Append new paragraphs or notes to an existing Google Doc.
`;
writeFileSync(path.join(filesSkillDir, "SKILL.md"), filesSkillContent, "utf8");
console.log(`  ✓ compiled .agents/skills/waymark-files/SKILL.md`);

// ── Worker skills: builder + qa ───────────────────────────────────────

const WORKER_TEMPLATES = [
  {
    tmpl: path.join(ROOT, "agent-templates", "builder.md.tmpl"),
    copilotOut: path.join(OUTPUT_DIR, "waymark-builder.agent.md"),
    skillDir: path.join(SKILLS_DIR, "waymark-builder"),
    name: "builder",
  },
  {
    tmpl: path.join(ROOT, "agent-templates", "qa.md.tmpl"),
    copilotOut: path.join(OUTPUT_DIR, "waymark-qa.agent.md"),
    skillDir: path.join(SKILLS_DIR, "waymark-qa"),
    name: "qa",
  },
];

for (const { tmpl, copilotOut, skillDir, name } of WORKER_TEMPLATES) {
  if (!existsSync(tmpl)) continue;
  try {
    const src = readFileSync(tmpl, "utf8");
    mkdirSync(path.dirname(copilotOut), { recursive: true });
    writeFileSync(copilotOut, src, "utf8");

    mkdirSync(skillDir, { recursive: true });
    const skillContent = `---
name: waymark-${name}
description: >-
  Waymark ${name} skill for codebase modifications, debugging, and verification.
---

${src.replace(/^---[\s\S]*?---\n/, '')}
`;
    writeFileSync(path.join(skillDir, "SKILL.md"), skillContent, "utf8");
    console.log(`  ✓ compiled .agents/skills/waymark-${name}/SKILL.md`);
  } catch (err) {
    console.log(`  ✗ error compiling worker ${name}: ${err.message}`);
  }
}

// ── Build Waymark Agent Catalog JSON ──────────────────────────────────

let agentsConfig = {};
try {
  if (existsSync(AGENTS_CFG_PATH)) {
    agentsConfig = JSON.parse(readFileSync(AGENTS_CFG_PATH, "utf8"));
  }
} catch { /* use defaults */ }

const uniqueTemplates = [];
const seenKeys = new Set();
for (const t of registry.templates) {
  if (seenKeys.has(t.key)) continue;
  seenKeys.add(t.key);
  uniqueTemplates.push({
    key: t.key,
    name: t.name,
    category: t.category || "General",
    interactionType: t.interactionType || "none",
    interactionStates: t.interactionStates || [],
    columnRoles: t.columnRoles || [],
    defaultHeaders: DEFAULT_HEADERS[t.key] || t.columnRoles || [],
    detectSignals: t.detectSignals || [],
  });
}

let previousCatalog = null;
try {
  if (existsSync(CATALOG_PATH)) {
    previousCatalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  }
} catch { /* ignore */ }

const catalogPayload = {
  version: "1.0.0",
  fallbackAgent: agentsConfig.fallbackAgent || "waymark-builder",
  keywordRoutes: agentsConfig.keywordRoutes || [],
  codeKeywords: agentsConfig.codeKeywords || [],
  builderLabels: agentsConfig.builderLabels || [],
  templates: uniqueTemplates,
};

let generatedAt = new Date().toISOString();
if (previousCatalog && previousCatalog.generatedAt) {
  const { generatedAt: _oldTs, ...prevPayload } = previousCatalog;
  if (JSON.stringify(prevPayload) === JSON.stringify(catalogPayload)) {
    generatedAt = previousCatalog.generatedAt;
  }
}

const catalog = {
  version: catalogPayload.version,
  generatedAt,
  fallbackAgent: catalogPayload.fallbackAgent,
  keywordRoutes: catalogPayload.keywordRoutes,
  codeKeywords: catalogPayload.codeKeywords,
  builderLabels: catalogPayload.builderLabels,
  templates: catalogPayload.templates,
};

mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`  ✓ generated ${path.relative(ROOT, CATALOG_PATH)}\n`);
