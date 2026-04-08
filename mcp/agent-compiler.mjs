#!/usr/bin/env node
/* ============================================================
   agent-compiler.mjs — Agent Compiler MCP server

   Compiles Waymark template agents on demand by combining:
     1. agent-templates/base.md.tmpl       (shared agent brain)
     2. template-registry.json             (template metadata)
     3. agent-templates/domain-knowledge/  (per-template smart ops)

   Exposes five MCP tools:
     agent_compile    — compile (or recompile) one template agent
     agent_list       — inventory: compiled vs registry vs missing
     agent_invalidate — delete a compiled agent to force recompile
     agent_eval       — LLM-evaluate an agent, improve+loop until threshold
     agent_eval_all   — batch eval across all (or failing) templates

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
  mkdirSync,
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
const EVAL_DIR         = path.join(OUTPUT_DIR, "evals");

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

/* ============================================================
   LLM-EVAL SUBSYSTEM

   Validates compiled agents with an LLM judge then improves
   domain knowledge in a feedback loop until the agent reaches
   a quality threshold.

   Config via env:
     EVAL_LLM_PROVIDER  — "openai" (default) | "anthropic"
     EVAL_LLM_API_KEY   — API key for the provider
     EVAL_LLM_MODEL     — model name (defaults: gpt-4o / claude-3-5-sonnet-20241022)
   ============================================================ */

/* ---------- LLM client ---------- */

async function callLLM(messages, temperature = 0.3) {
  const provider = (process.env.EVAL_LLM_PROVIDER || "openai").toLowerCase();
  const apiKey   = process.env.EVAL_LLM_API_KEY;
  const model    = process.env.EVAL_LLM_MODEL ||
    (provider === "anthropic" ? "claude-3-5-sonnet-20241022" : "gpt-4o");

  if (!apiKey) {
    throw new Error(
      "EVAL_LLM_API_KEY is not set. " +
      "Set it (and optionally EVAL_LLM_PROVIDER / EVAL_LLM_MODEL) before running eval."
    );
  }

  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(`OpenAI API error: ${data.error?.message ?? resp.statusText}`);
    }
    return data.choices[0].message.content;
  }

  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 4096, messages }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(`Anthropic API error: ${data.error?.message ?? resp.statusText}`);
    }
    return data.content[0].text;
  }

  throw new Error(`Unknown EVAL_LLM_PROVIDER: "${provider}". Use "openai" or "anthropic".`);
}

/** Strip optional markdown code fences and parse JSON. */
function safeParseJSON(str) {
  const s = str.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(s);
}

/* ---------- Test-suite generator ---------- */

/**
 * Ask the LLM to generate a fixed set of test scenarios grounded in this
 * template's domain knowledge and registry metadata.
 * Returns an array of { prompt, expectedBehavior, rubric } objects.
 */
async function generateTestSuite(templateKey, registry) {
  const tmpl = registry.templates.find(t => t.key === templateKey);
  const domainPath = path.join(DOMAIN_KN_DIR, `${templateKey}.md`);
  const domainKn   = existsSync(domainPath)
    ? readFileSync(domainPath, "utf8").slice(0, 3000)
    : "(no domain knowledge file)";

  const interactionDesc = tmpl.interactionType === "none"
    ? "Cells are edited directly — no state cycling."
    : `Interaction type: ${tmpl.interactionType}. ` +
      `Valid states: ${(tmpl.interactionStates || []).join(" → ")}.`;

  const systemPrompt = [
    "You are a quality-assurance engineer writing test scenarios for an AI agent.",
    "The agent manages Google Sheets rendered as a specific Waymark template type.",
    "Generate exactly 8 test prompts that cover a variety of realistic user requests.",
    "Cover: (1) listing/filtering data, (2) adding a new entry, (3) updating an entry,",
    "(4) a state transition (if applicable), (5) a domain-specific smart operation,",
    "(6) an edge case, (7) searching for something, (8) generating a summary/report.",
    "Each test must be grounded in the actual column roles and domain knowledge given.",
    "Return ONLY a JSON array of 8 objects — no markdown fences, no explanation:",
    "[{ \"prompt\": \"<user request>\", \"expectedBehavior\": \"<1–2 sentence description of correct agent response>\", \"rubric\": \"<one of: roleClarity|columnMapping|stateMachine|domainOps|instructionClarity>\" }]",
  ].join(" ");

  const userMsg = [
    `Template: ${tmpl.name} (category: ${tmpl.category})`,
    `Column roles: ${(tmpl.columnRoles || []).join(", ") || "(none)"}`,
    `Default headers: ${(DEFAULT_HEADERS[templateKey] || []).join(", ")}`,
    `Detection signals: ${(tmpl.detectSignals || []).join(", ") || "(none)"}`,
    interactionDesc,
    "",
    "Domain knowledge summary:",
    domainKn,
  ].join("\n");

  const raw = await callLLM(
    [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
    0.5,
  );

  return safeParseJSON(raw);
}

/* ---------- Evaluator ---------- */

/**
 * Score the compiled agent against all test cases.
 * Returns { results: Array, overallScore: number }.
 */
async function runEvalPass(compiledAgentText, testCases) {
  // Trim to avoid huge contexts in the judge call
  const agentSnippet = compiledAgentText.slice(0, 7000);

  const judgeSystem = [
    "You are an expert AI agent evaluator.",
    "Given an agent specification and a user request, judge whether the agent has",
    "sufficient instructions and domain knowledge to handle the request correctly.",
    "Be strict but fair. A pass means the agent could plausibly succeed without",
    "additional guidance. A fail means there is a meaningful gap.",
    "Respond with ONLY valid JSON (no fences):",
    "{ \"pass\": true|false, \"score\": 0.0–1.0, \"reasoning\": \"one sentence\" }",
  ].join(" ");

  const results = [];
  for (const tc of testCases) {
    const userMsg = [
      "AGENT SPEC (truncated to 7000 chars):",
      agentSnippet,
      "",
      `USER REQUEST: "${tc.prompt}"`,
      `EXPECTED BEHAVIOR: "${tc.expectedBehavior}"`,
      `RUBRIC DIMENSION: ${tc.rubric}`,
    ].join("\n");

    try {
      const raw = await callLLM(
        [{ role: "system", content: judgeSystem }, { role: "user", content: userMsg }],
        0.1,
      );
      const parsed = safeParseJSON(raw);
      results.push({
        prompt:           tc.prompt,
        expectedBehavior: tc.expectedBehavior,
        rubric:           tc.rubric,
        pass:             Boolean(parsed.pass),
        score:            Number(parsed.score ?? (parsed.pass ? 1 : 0)),
        reasoning:        String(parsed.reasoning ?? ""),
      });
    } catch (err) {
      // Judge call failed — count as fail, record the error
      results.push({
        prompt:           tc.prompt,
        expectedBehavior: tc.expectedBehavior,
        rubric:           tc.rubric,
        pass:             false,
        score:            0,
        reasoning:        `Eval error: ${err.message}`,
      });
    }
  }

  const overallScore = results.reduce((s, r) => s + r.score, 0) / results.length;
  return { results, overallScore };
}

/* ---------- Domain knowledge improver ---------- */

/**
 * Ask the LLM to rewrite the domain knowledge file to address eval failures,
 * then persist the improved version. Returns the path written, or null if
 * there were no failures to address.
 */
async function improveDomainKnowledge(templateKey, failedCases, registry) {
  if (failedCases.length === 0) return null;

  const tmpl = registry.templates.find(t => t.key === templateKey);
  const domainPath = path.join(DOMAIN_KN_DIR, `${templateKey}.md`);
  const current    = existsSync(domainPath)
    ? readFileSync(domainPath, "utf8")
    : "(no existing domain knowledge)";

  const systemPrompt = [
    "You are improving a domain knowledge file for an AI agent that manages a",
    "specific type of Google Sheet. Domain knowledge files are Markdown documents",
    "that describe the template's purpose, smart operations, and interpretation rules.",
    "Your task: rewrite the file to address the failing test cases listed below.",
    "Keep everything that is already strong. Add, expand, or clarify sections that",
    "caused failures. Do NOT invent column names or states that don't match the",
    "template's registered metadata. Return ONLY the improved Markdown content —",
    "no JSON wrapper, no explanation, no fences.",
  ].join(" ");

  const failureBlock = failedCases
    .map((f, i) =>
      `Failure ${i + 1}:\n` +
      `  Request:  "${f.prompt}"\n` +
      `  Expected: "${f.expectedBehavior}"\n` +
      `  Reason:   "${f.reasoning}"`
    )
    .join("\n\n");

  const userMsg = [
    `Template: ${tmpl.name} (${tmpl.category})`,
    `Interaction type: ${tmpl.interactionType}`,
    `Column roles: ${(tmpl.columnRoles || []).join(", ")}`,
    `Default headers: ${(DEFAULT_HEADERS[templateKey] || []).join(", ")}`,
    "",
    "CURRENT DOMAIN KNOWLEDGE:",
    current,
    "",
    "FAILING TEST CASES:",
    failureBlock,
  ].join("\n");

  const improved = await callLLM(
    [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
    0.3,
  );

  writeFileSync(domainPath, improved.trim() + "\n", "utf8");
  return domainPath;
}

/* ---------- Tool: agent_eval ---------- */

async function toolAgentEval(args) {
  const {
    templateKey,
    threshold     = 0.85,
    maxIterations = 3,
    force         = false,
  } = args;

  if (!templateKey || typeof templateKey !== "string") {
    return { error: "templateKey is required." };
  }

  // Ensure compiled (force-recompile only when caller asks)
  const compileResult = toolAgentCompile({ templateKey, force });
  if (compileResult.error) return compileResult;

  mkdirSync(EVAL_DIR, { recursive: true });
  const evalPath   = path.join(EVAL_DIR, `${templateKey}.eval.json`);
  const registry   = loadRegistry();
  const outputFile = path.join(OUTPUT_DIR, `waymark-${templateKey}.agent.md`);

  // Generate the test suite once — reused across improvement iterations
  let testCases;
  try {
    testCases = await generateTestSuite(templateKey, registry);
  } catch (err) {
    return { error: `Test-suite generation failed: ${err.message}` };
  }

  let iteration    = 0;
  let lastScore    = 0;
  let lastResults  = [];
  let improvements = [];

  while (iteration < maxIterations) {
    iteration++;

    const compiledAgent = readFileSync(outputFile, "utf8");
    let evalResult;
    try {
      evalResult = await runEvalPass(compiledAgent, testCases);
    } catch (err) {
      return { error: `Eval pass ${iteration} failed: ${err.message}` };
    }

    lastScore   = evalResult.overallScore;
    lastResults = evalResult.results;

    const approved = lastScore >= threshold;

    // Persist latest eval snapshot
    const evalData = {
      templateKey,
      evaluatedAt:  new Date().toISOString(),
      iteration,
      score:        lastScore,
      threshold,
      approved,
      improvements,
      testCases:    lastResults,
    };
    writeFileSync(evalPath, JSON.stringify(evalData, null, 2), "utf8");

    if (approved || iteration >= maxIterations) break;

    // --- Improvement round ---
    const failedCases = lastResults.filter(r => !r.pass || r.score < 0.75);
    if (failedCases.length === 0) break; // score < threshold but no clear fails — stop

    let improvedPath;
    try {
      improvedPath = await improveDomainKnowledge(templateKey, failedCases, registry);
    } catch (err) {
      return { error: `Improvement step ${iteration} failed: ${err.message}` };
    }

    if (improvedPath) {
      // Force-recompile with improved domain knowledge
      compileAgent(templateKey);
      improvements.push({
        iteration,
        failedCount: failedCases.length,
        scoreBefore: lastScore,
      });
    } else {
      break; // Nothing to improve
    }
  }

  const approved = lastScore >= threshold;
  return {
    templateKey,
    evalPath,
    score:        lastScore,
    threshold,
    approved,
    iterations:   iteration,
    improvements,
    passCount:    lastResults.filter(r => r.pass).length,
    failCount:    lastResults.filter(r => !r.pass).length,
    testCount:    lastResults.length,
    message: approved
      ? `Agent approved. Score: ${(lastScore * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}% after ${iteration} iteration(s).`
      : `Agent did not reach threshold. Score: ${(lastScore * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% after ${iteration} iteration(s). ` +
        `Review ${evalPath} for details.`,
  };
}

/* ---------- Tool: agent_eval_all ---------- */

async function toolAgentEvalAll(args) {
  const {
    threshold     = 0.85,
    maxIterations = 3,
    onlyMissing   = false,
    onlyFailing   = false,
  } = args;

  const registry = loadRegistry();
  const allKeys  = registry.templates.map(t => t.key);

  // Determine which keys to eval
  let targets = allKeys;
  if (onlyMissing) {
    targets = allKeys.filter(k => !existsSync(path.join(EVAL_DIR, `${k}.eval.json`)));
  } else if (onlyFailing) {
    targets = allKeys.filter(k => {
      const ep = path.join(EVAL_DIR, `${k}.eval.json`);
      if (!existsSync(ep)) return true;
      try {
        const ev = JSON.parse(readFileSync(ep, "utf8"));
        return !ev.approved;
      } catch { return true; }
    });
  }

  const results = [];
  for (const templateKey of targets) {
    const r = await toolAgentEval({ templateKey, threshold, maxIterations });
    results.push(r);
  }

  const approved  = results.filter(r => r.approved).length;
  const failed    = results.filter(r => !r.approved && !r.error).length;
  const errored   = results.filter(r => r.error).length;

  return {
    total:    results.length,
    approved,
    failed,
    errored,
    threshold,
    results,
    summary: `${approved}/${results.length} approved at ${(threshold * 100).toFixed(0)}% threshold. ` +
             `${failed} below threshold, ${errored} errored.`,
  };
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
    {
      name: "agent_eval",
      description:
        "Evaluate a compiled agent with an LLM judge. " +
        "Generates a test suite of 8 scenarios from the template's domain knowledge, " +
        "scores the agent on each, and — if the score falls below the threshold — " +
        "asks the LLM to improve the domain knowledge file and recompiles, repeating " +
        "until the threshold is met or maxIterations is exhausted. " +
        "Requires EVAL_LLM_API_KEY (and optionally EVAL_LLM_PROVIDER, EVAL_LLM_MODEL) env vars. " +
        "Saves results to .github/agents/evals/{key}.eval.json.",
      inputSchema: {
        type: "object",
        properties: {
          templateKey: {
            type: "string",
            description: "The template key to evaluate (e.g. 'kanban', 'budget').",
          },
          threshold: {
            type: "number",
            description: "Minimum score (0.0–1.0) to consider the agent approved. Default: 0.85.",
          },
          maxIterations: {
            type: "integer",
            description: "Maximum improvement iterations before giving up. Default: 3.",
          },
          force: {
            type: "boolean",
            description: "Force recompile before evaluating. Default: false.",
          },
        },
        required: ["templateKey"],
      },
    },
    {
      name: "agent_eval_all",
      description:
        "Run agent_eval across all (or a filtered subset of) templates. " +
        "Use onlyMissing:true to skip already-evaluated templates, or " +
        "onlyFailing:true to re-evaluate only templates that are not yet approved. " +
        "Requires EVAL_LLM_API_KEY env var.",
      inputSchema: {
        type: "object",
        properties: {
          threshold: {
            type: "number",
            description: "Approval threshold (0.0–1.0). Default: 0.85.",
          },
          maxIterations: {
            type: "integer",
            description: "Max improvement iterations per template. Default: 3.",
          },
          onlyMissing: {
            type: "boolean",
            description: "Only eval templates that have no existing eval result. Default: false.",
          },
          onlyFailing: {
            type: "boolean",
            description: "Only eval templates whose last result is not approved. Default: false.",
          },
        },
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
  } else if (name === "agent_eval") {
    result = await toolAgentEval(args ?? {});
  } else if (name === "agent_eval_all") {
    result = await toolAgentEvalAll(args ?? {});
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
