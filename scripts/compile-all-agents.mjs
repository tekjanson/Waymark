#!/usr/bin/env node
/* compile-all-agents.mjs — Compile all 35 Waymark template agents
   Run from the Waymark repo root:
     node scripts/compile-all-agents.mjs [--force]

   --force   Recompile even if inputs are unchanged (clears hash sidecars first)
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

const REGISTRY_PATH  = path.join(ROOT, "template-registry.json");
const BASE_TMPL_PATH = path.join(ROOT, "agent-templates", "base.md.tmpl");
const DOMAIN_KN_DIR  = path.join(ROOT, "agent-templates", "domain-knowledge");
const OUTPUT_DIR     = path.join(ROOT, ".github", "agents");
const EVAL_DIR       = path.join(OUTPUT_DIR, "evals");

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
  arcade:       ["Game", "Player 1", "Player 2", "Score", "Status"],
  worker:       ["Job", "Handler", "Config", "Status", "Schedule"],
  photos:       ["Photo", "Title", "Date", "Album", "Description"],
  blog:         ["Title", "Doc", "Date", "Author", "Category"],
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
  const hashFile   = path.join(EVAL_DIR, `${key}.sha`);
  const currentHash = computeHash(tmpl);

  if (!FORCE && existsSync(outputFile)) {
    const storedHash = existsSync(hashFile) ? readFileSync(hashFile, "utf8").trim() : null;
    if (storedHash === currentHash) return { key, status: "up-to-date" };
  }

  const base = readFileSync(BASE_TMPL_PATH, "utf8");
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

  const compiled = base
    .replace(/\{\{TEMPLATE_KEY\}\}/g,           key)
    .replace(/\{\{TEMPLATE_NAME\}\}/g,           tmpl.name)
    .replace(/\{\{TEMPLATE_CATEGORY\}\}/g,       tmpl.category || "General")
    .replace(/\{\{INTERACTION_TYPE\}\}/g,         tmpl.interactionType || "none")
    .replace(/\{\{COLUMN_ROLES_LIST\}\}/g,        columnRolesList)
    .replace(/\{\{DEFAULT_HEADERS\}\}/g,          defaultHeaders.join(", "))
    .replace(/\{\{DETECT_SIGNALS\}\}/g,           detectSignals.join(", "))
    .replace(/\{\{INTERACTION_STATES_BLOCK\}\}/g, buildStatesBlock(tmpl))
    .replace(/\{\{TOGGLE_ON\}\}/g,                toggleOn)
    .replace(/\{\{TOGGLE_OFF\}\}/g,               toggleOff)
    .replace(/\{\{DOMAIN_KNOWLEDGE\}\}/g,         domain.trim());

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(EVAL_DIR, { recursive: true });
  writeFileSync(outputFile, compiled, "utf8");
  writeFileSync(hashFile, currentHash, "utf8");

  return { key, status: existsSync(outputFile) && !FORCE ? "recompiled" : "compiled", usedGeneric };
}

// ── Main ──────────────────────────────────────────────────────────────

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const keys = registry.templates.map(t => t.key);

console.log(`\nCompiling ${keys.length} agents…  (--force: ${FORCE})\n`);

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

console.log(`\nOutput: .github/agents/waymark-*.agent.md (${compiled + upToDate} total)\n`);
