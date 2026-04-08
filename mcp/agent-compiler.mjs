#!/usr/bin/env node
/* ============================================================
   agent-compiler.mjs — Agent Compiler MCP server

   Compiles Waymark template agents on demand by combining:
     1. agent-templates/base.md.tmpl       (shared agent brain)
     2. template-registry.json             (template metadata)
     3. agent-templates/domain-knowledge/  (per-template smart ops)

   Exposes three MCP tools:
     agent_compile    — compile (or recompile) one template agent
     agent_list       — inventory: compiled vs registry vs missing
     agent_invalidate — delete a compiled agent to force recompile

   Output: .github/agents/waymark-{key}.agent.md
   ============================================================ */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ---------- Paths ---------- */

const REGISTRY_PATH    = path.join(ROOT, "template-registry.json");
const BASE_TMPL_PATH   = path.join(ROOT, "agent-templates", "base.md.tmpl");
const DOMAIN_KN_DIR    = path.join(ROOT, "agent-templates", "domain-knowledge");
const OUTPUT_DIR       = path.join(ROOT, ".github", "agents");

/* ---------- Default headers (mirrors waymark.mjs) ---------- */

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

/* ---------- Registry ---------- */

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
}

/* ---------- Compiler ---------- */

/**
 * Build the INTERACTION_STATES_BLOCK section from a template entry.
 * @param {object} tmpl
 * @returns {string}
 */
function buildStatesBlock(tmpl) {
  const { interactionType, interactionStates = [] } = tmpl;

  if (!interactionType || interactionType === "none" || interactionStates.length === 0) {
    return "This template has no state machine. The interaction type is `" +
      (interactionType || "none") + "` — cells are edited directly without cycling.";
  }

  if (interactionType === "toggle") {
    const on  = interactionStates[0] ?? "done";
    const off = interactionStates[1] ?? "";
    return `Interaction type: \`toggle\`\n\n` +
      `- **Done value:** \`${on}\`\n` +
      `- **Not-done value:** \`${off || "(empty string)"}\`\n\n` +
      `Only write one of these two values to the status column. Never write anything else.`;
  }

  if (interactionType === "status-cycle") {
    const flow = interactionStates.join(" → ");
    const list = interactionStates.map(s => `- \`${s}\``).join("\n");
    return `Interaction type: \`status-cycle\`\n\nValid states (in order):\n${list}\n\n` +
      `Flow: \`${flow}\`\n\nAfter the last state, cycling wraps back to the first. ` +
      `Only write values from this list to the stage/status column.`;
  }

  const list = interactionStates.map(s => `- \`${s}\``).join("\n");
  return `Interaction type: \`${interactionType}\`\n\nValid values:\n${list}`;
}

/**
 * Compile a single template agent file.
 * @param {string} templateKey
 * @returns {{ agentName: string, filePath: string, wasAlreadyCompiled: boolean, usedGenericKnowledge: boolean }}
 */
function compileAgent(templateKey) {
  const registry = loadRegistry();
  const tmpl = registry.templates.find(t => t.key === templateKey);
  if (!tmpl) {
    throw new Error(`Template key "${templateKey}" not found in registry.`);
  }

  const outputFile = path.join(OUTPUT_DIR, `waymark-${templateKey}.agent.md`);
  const wasAlreadyCompiled = existsSync(outputFile);

  // Load base template
  const base = readFileSync(BASE_TMPL_PATH, "utf8");

  // Load domain knowledge — specific first, generic fallback
  const specificKnPath = path.join(DOMAIN_KN_DIR, `${templateKey}.md`);
  const genericKnPath  = path.join(DOMAIN_KN_DIR, `_generic.md`);
  let usedGenericKnowledge = false;
  let domainKnowledge;

  if (existsSync(specificKnPath)) {
    domainKnowledge = readFileSync(specificKnPath, "utf8");
  } else {
    domainKnowledge = readFileSync(genericKnPath, "utf8")
      .replace(/\{\{TEMPLATE_KEY\}\}/g,  templateKey)
      .replace(/\{\{TEMPLATE_NAME\}\}/g, tmpl.name);
    usedGenericKnowledge = true;
  }

  // Build column roles list
  const columnRoles = tmpl.columnRoles || [];
  const defaultHeaders = DEFAULT_HEADERS[templateKey] || columnRoles;
  const detectSignals  = tmpl.detectSignals || [];

  const columnRolesList = columnRoles.length > 0
    ? columnRoles.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "(No column roles defined — use column indices or header names directly)";

  // Toggle on/off values for §4.2
  const interactionStates = tmpl.interactionStates || [];
  const toggleOn  = interactionStates[0] ?? "done";
  const toggleOff = interactionStates[1] ?? "";

  // Perform all substitutions
  const compiled = base
    .replace(/\{\{TEMPLATE_KEY\}\}/g,          templateKey)
    .replace(/\{\{TEMPLATE_NAME\}\}/g,          tmpl.name)
    .replace(/\{\{TEMPLATE_CATEGORY\}\}/g,      tmpl.category || "General")
    .replace(/\{\{INTERACTION_TYPE\}\}/g,        tmpl.interactionType || "none")
    .replace(/\{\{COLUMN_ROLES_LIST\}\}/g,       columnRolesList)
    .replace(/\{\{DEFAULT_HEADERS\}\}/g,         defaultHeaders.join(", "))
    .replace(/\{\{DETECT_SIGNALS\}\}/g,          detectSignals.join(", "))
    .replace(/\{\{INTERACTION_STATES_BLOCK\}\}/g, buildStatesBlock(tmpl))
    .replace(/\{\{TOGGLE_ON\}\}/g,               toggleOn)
    .replace(/\{\{TOGGLE_OFF\}\}/g,              toggleOff)
    .replace(/\{\{DOMAIN_KNOWLEDGE\}\}/g,        domainKnowledge.trim());

  writeFileSync(outputFile, compiled, "utf8");

  return {
    agentName: `waymark-${templateKey}`,
    filePath: outputFile,
    wasAlreadyCompiled,
    usedGenericKnowledge,
  };
}

/* ---------- Tool: agent_compile ---------- */

function toolAgentCompile(args) {
  const { templateKey, force = false } = args;
  if (!templateKey || typeof templateKey !== "string") {
    return { error: "templateKey is required and must be a string." };
  }

  const outputFile = path.join(OUTPUT_DIR, `waymark-${templateKey}.agent.md`);
  if (!force && existsSync(outputFile)) {
    return {
      agentName: `waymark-${templateKey}`,
      filePath: outputFile,
      wasAlreadyCompiled: true,
      skipped: true,
      message: `Agent already compiled. Pass force:true to recompile.`,
    };
  }

  try {
    const result = compileAgent(templateKey);
    return {
      ...result,
      message: result.wasAlreadyCompiled
        ? `Recompiled waymark-${templateKey}.`
        : `Compiled new agent waymark-${templateKey}.`,
      warning: result.usedGenericKnowledge
        ? `No domain-knowledge/${templateKey}.md found — used generic fallback. ` +
          `Create that file and run agent_invalidate + agent_compile for richer behavior.`
        : undefined,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/* ---------- Tool: agent_list ---------- */

function toolAgentList() {
  const registry = loadRegistry();
  const allKeys = registry.templates.map(t => t.key);

  // Find compiled agent files
  const compiledFiles = existsSync(OUTPUT_DIR)
    ? readdirSync(OUTPUT_DIR)
        .filter(f => f.startsWith("waymark-") && f.endsWith(".agent.md"))
        .map(f => f.replace(/^waymark-/, "").replace(/\.agent\.md$/, ""))
    : [];

  // Find which keys have authored domain knowledge
  const hasKnowledge = existsSync(DOMAIN_KN_DIR)
    ? readdirSync(DOMAIN_KN_DIR)
        .filter(f => !f.startsWith("_") && f.endsWith(".md"))
        .map(f => f.replace(/\.md$/, ""))
    : [];

  const missing = allKeys.filter(k => !compiledFiles.includes(k));

  return {
    registry: allKeys,
    compiled: compiledFiles,
    missing,
    hasAuthoredKnowledge: hasKnowledge,
    missingKnowledge: allKeys.filter(k => !hasKnowledge.includes(k)),
    summary: `${compiledFiles.length}/${allKeys.length} compiled. ` +
             `${missing.length} missing. ` +
             `${hasKnowledge.length} with authored domain knowledge.`,
  };
}

/* ---------- Tool: agent_invalidate ---------- */

function toolAgentInvalidate(args) {
  const { templateKey } = args;
  if (!templateKey || typeof templateKey !== "string") {
    return { error: "templateKey is required." };
  }

  const outputFile = path.join(OUTPUT_DIR, `waymark-${templateKey}.agent.md`);
  if (!existsSync(outputFile)) {
    return { deleted: false, message: `No compiled agent found for "${templateKey}".` };
  }

  unlinkSync(outputFile);
  return { deleted: true, filePath: outputFile, message: `Deleted waymark-${templateKey}.agent.md. Run agent_compile to rebuild.` };
}

/* ---------- MCP Server ---------- */

const server = new Server(
  { name: "waymark-agent-compiler", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "agent_compile",
      description:
        "Compile (or recompile) a Waymark template agent. " +
        "Reads the registry entry for the given templateKey, loads the base agent template " +
        "and domain knowledge, substitutes all placeholders, and writes the compiled " +
        ".agent.md file to .github/agents/waymark-{key}.agent.md. " +
        "If the agent already exists, it is skipped unless force:true is passed.",
      inputSchema: {
        type: "object",
        properties: {
          templateKey: {
            type: "string",
            description: "The template key from template-registry.json (e.g. 'kanban', 'budget', 'testcases')",
          },
          force: {
            type: "boolean",
            description: "If true, recompile even if the agent already exists. Default: false.",
          },
        },
        required: ["templateKey"],
      },
    },
    {
      name: "agent_list",
      description:
        "List the inventory of compiled agents vs. the registry. " +
        "Returns: registry keys, compiled agent names, missing (not yet compiled), " +
        "and which templates have authored domain knowledge vs. the generic fallback.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "agent_invalidate",
      description:
        "Delete a compiled agent file to force a fresh recompile on next use. " +
        "Call this after updating base.md.tmpl or a domain-knowledge file for a template.",
      inputSchema: {
        type: "object",
        properties: {
          templateKey: {
            type: "string",
            description: "The template key whose compiled agent should be deleted.",
          },
        },
        required: ["templateKey"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  if (name === "agent_compile") {
    result = toolAgentCompile(args ?? {});
  } else if (name === "agent_list") {
    result = toolAgentList();
  } else if (name === "agent_invalidate") {
    result = toolAgentInvalidate(args ?? {});
  } else {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
