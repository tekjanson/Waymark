// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

test.describe('Wayside Orchestrator & AGY Bridge Unit Tests', () => {

  test('classifyMessage identifies conversational greetings and help requests', async () => {
    const { classifyMessage } = await import('../../scripts/wayside-orchestrator.mjs');
    const greeting = classifyMessage('Hello there!');
    expect(greeting.isConversation).toBe(true);
    expect(greeting.templateKey).toBeNull();

    const help = classifyMessage('Can you help me understand what you can do?');
    expect(help.isConversation).toBe(true);
    expect(help.isHelp).toBe(true);
    expect(help.templateKey).toBeNull();
  });

  test('classifyMessage detects explicit @mentions', async () => {
    const { classifyMessage } = await import('../../scripts/wayside-orchestrator.mjs');
    const kanban = classifyMessage('Hey @kanban can you organize this');
    expect(kanban.templateKey).toBe('kanban');

    const travel = classifyMessage('Please @waymark-travel book a flight');
    expect(travel.templateKey).toBe('travel');
  });

  test('classifyMessage matches domain keywords accurately', async () => {
    const { classifyMessage } = await import('../../scripts/wayside-orchestrator.mjs');
    expect(classifyMessage('Plan a 3-day vacation trip to Maui').templateKey).toBe('travel');
    expect(classifyMessage('Log an expense for 75 dollars').templateKey).toBe('budget');
    expect(classifyMessage('Weekly meal plan for 2000 calories').templateKey).toBe('meal');
    expect(classifyMessage('Add a lasagna recipe with ingredients').templateKey).toBe('recipe');
    expect(classifyMessage('Track my sales pipeline and new leads').templateKey).toBe('crm');
    expect(classifyMessage('Update warehouse stock and inventory levels').templateKey).toBe('inventory');
    expect(classifyMessage('Track my daily habits and workout streak').templateKey).toBe('habit');
  });

  test('classifyMessage gracefully handles ambiguous or unknown text', async () => {
    const { classifyMessage } = await import('../../scripts/wayside-orchestrator.mjs');
    const res = classifyMessage('random text that matches nothing at all');
    expect(res.templateKey).toBeNull();
    expect(res.isConversation).toBe(false);
  });

  test('extractSpreadsheetId parses Google Sheet IDs from URLs, hashes, and JSON', async () => {
    const { extractSpreadsheetId } = await import('../../scripts/agy-agent-runner.mjs');
    const id = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';

    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id);
    expect(extractSpreadsheetId(`Link: #/sheet/${id}`)).toBe(id);
    expect(extractSpreadsheetId(`{"spreadsheetId": "${id}", "title": "Test"}`)).toBe(id);
    expect(extractSpreadsheetId('No ID here')).toBeNull();
  });

  test('buildAgyPrompt constructs instructions with skills and MCP references', async () => {
    const { buildAgyPrompt } = await import('../../scripts/agy-agent-runner.mjs');
    const prompt = buildAgyPrompt({
      task: 'Create a packing list for hiking',
      templateKey: 'checklist',
      sheetId: 'sheet-123',
    });

    expect(prompt).toContain('waymark-checklist');
    expect(prompt).toContain('Target Spreadsheet ID: sheet-123');
    expect(prompt).toContain('User Request: Create a packing list for hiking');
    expect(prompt).toContain('waymark_create_sheet');
  });

  test('WaysideOrchestrator initializes with proper defaults and deduplicates message IDs', async () => {
    const { WaysideOrchestrator, AGENT_NAME, AGENT_EMAIL } = await import('../../scripts/wayside-orchestrator.mjs');
    const orch = new WaysideOrchestrator({
      sheetId: 'test-sheet-id',
    });

    expect(orch.sheetId).toBe('test-sheet-id');
    expect(orch.agentName).toBe(AGENT_NAME);
    expect(orch.agentEmail).toBe(AGENT_EMAIL);

    // Seed a message ID
    orch.processedMessageIds.add('msg-123');
    expect(orch.processedMessageIds.has('msg-123')).toBe(true);

    // Queueing the same message ID is a no-op
    orch.queueMessageProcessing({
      text: 'hello',
      sender: 'user@test.com',
      messageId: 'msg-123',
    });
    expect(orch.processedMessageIds.size).toBe(1);
  });

  test('Waymark Agent Catalog was generated and contains templates with schemas', () => {
    const catalogPath = path.join(ROOT, 'generated', 'waymark-agent-catalog.json');
    expect(fs.existsSync(catalogPath)).toBe(true);

    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    expect(catalog.templates.length).toBeGreaterThanOrEqual(35);

    const kanban = catalog.templates.find(t => t.key === 'kanban');
    expect(kanban).toBeDefined();
    expect(kanban.columnRoles).toContain('stage');
    expect(kanban.interactionType).toBe('status-cycle');

    const budget = catalog.templates.find(t => t.key === 'budget');
    expect(budget).toBeDefined();
    expect(budget.columnRoles).toContain('amount');
  });

  test('Antigravity skills were generated for all templates in .agents/skills/', () => {
    const skillsDir = path.join(ROOT, '.agents', 'skills');
    expect(fs.existsSync(skillsDir)).toBe(true);

    // Check specific essential skills
    const requiredSkills = [
      'waymark-orchestrator',
      'waymark-kanban',
      'waymark-budget',
      'waymark-travel',
      'waymark-recipe',
      'waymark-checklist',
    ];

    for (const skill of requiredSkills) {
      const skillPath = path.join(skillsDir, skill, 'SKILL.md');
      expect(fs.existsSync(skillPath)).toBe(true);

      const content = fs.readFileSync(skillPath, 'utf8');
      expect(content).toContain(`name: ${skill}`);
      expect(content).toContain('description:');
    }
  });

});
