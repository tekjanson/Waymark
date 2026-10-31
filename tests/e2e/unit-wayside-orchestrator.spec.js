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

  test('all 41 unique templates have dedicated domain-knowledge files and DEFAULT_HEADERS in mcp/waymark.mjs', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'template-registry.json'), 'utf8'));
    const uniqueKeys = [...new Set(registry.templates.map(t => t.key))];
    expect(uniqueKeys.length).toBe(41);

    const mcpSrc = fs.readFileSync(path.join(ROOT, 'mcp', 'waymark.mjs'), 'utf8');
    const headersBlock = mcpSrc.match(/const DEFAULT_HEADERS = \{([\s\S]*?)\n\};/)?.[1] || '';

    for (const key of uniqueKeys) {
      const dkPath = path.join(ROOT, 'agent-templates', 'domain-knowledge', `${key}.md`);
      expect(fs.existsSync(dkPath), `domain-knowledge/${key}.md should exist`).toBe(true);
      expect(headersBlock, `mcp/waymark.mjs DEFAULT_HEADERS should include ${key}`).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });

  test('extractFileReferences extracts both IDs and titles from markdown links and JSON', async () => {
    const { extractFileReferences } = await import('../../scripts/agy-agent-runner.mjs');
    const sheetId = '1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';
    const docId = '1Doc_fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4';

    const res = extractFileReferences(
      `Created your sheet: [Paris Spring Itinerary](#/sheet/${sheetId}) and notes [Trip Notes](https://docs.google.com/document/d/${docId}/edit)`
    );
    expect(res.sheetId).toBe(sheetId);
    expect(res.sheetTitle).toBe('Paris Spring Itinerary');
    expect(res.docId).toBe(docId);
    expect(res.docTitle).toBe('Trip Notes');
  });

  test('SheetWebRtcPeer supports WebRTC_Signaling tab, blockStart=2, peerId election, and custom broadcast types', async () => {
    const { SheetWebRtcPeer } = await import('../../mcp/sheet-webrtc-peer.mjs');
    const peer = new SheetWebRtcPeer({
      sheetId: 'test-ledger',
      peerId: 'ai-111111',
      displayName: 'Waymark AI',
      tabName: 'WebRTC_Signaling',
      blockStart: 2,
      initiatorRule: 'peerId',
    });

    expect(peer.tabName).toBe('WebRTC_Signaling');
    expect(peer.blockStart).toBe(2);
    expect(peer._shouldInitiateHandshake('zz-999999', 7)).toBe(true);
    expect(peer._shouldInitiateHandshake('aa-000000', 2)).toBe(false);

    const sent = [];
    peer._pcs.set('remote-1', {
      connected: true,
      dc: {
        readyState: 'open',
        send: (msg) => sent.push(JSON.parse(msg)),
      },
      pc: { close: () => {} },
    });

    peer.broadcast({ type: 'typing', name: 'Waymark AI' });
    peer.broadcast({ type: 'message', id: 'm1', text: 'Hello Wayside!' });
    expect(sent[0].type).toBe('typing');
    expect(sent[0].name).toBe('Waymark AI');
    expect(sent[1].type).toBe('message');
    expect(sent[1].text).toBe('Hello Wayside!');

    peer.destroy();
    expect(peer.destroyed).toBe(true);
  });

  test('discoverOrCreateWaysideLedger ignores unrelated human ledgers and creates canonical contact-pair ledger', async () => {
    const http = require('http');
    const { discoverOrCreateWaysideLedger } = await import('../../scripts/wayside-orchestrator.mjs');

    const tmpToken = path.join(ROOT, 'tests', 'fixtures', 'tmp-orch-oauth.json');
    fs.writeFileSync(tmpToken, JSON.stringify({
      access_token: 'mock-access-token',
      expiry_date: Date.now() + 3600_000,
    }));

    const requests = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
        res.setHeader('Content-Type', 'application/json');
        if (req.url.startsWith('/drive/v3/about')) {
          res.end(JSON.stringify({ user: { emailAddress: 'testuser@gmail.com' } }));
        } else if (req.url.startsWith('/drive/v3/files')) {
          // Return an unrelated human contact ledger — orchestrator MUST NOT hijack it!
          res.end(JSON.stringify({
            files: [
              { id: 'human-ledger-999', name: '.waymark-ledger-contact-pair:alice@gmail.com::testuser@gmail.com' },
            ],
          }));
        } else {
          res.writeHead(404);
          res.end('{}');
        }
      });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const origTokenPath = process.env.WAYMARK_OAUTH_TOKEN_PATH;
    const origDriveBase = process.env.DRIVE_BASE;
    const origFetch = globalThis.fetch;

    try {
      process.env.WAYMARK_OAUTH_TOKEN_PATH = tmpToken;
      process.env.DRIVE_BASE = `http://127.0.0.1:${port}/drive/v3/files`;

      let createdTitle = null;
      globalThis.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (u === 'https://sheets.googleapis.com/v4/spreadsheets' && opts.method === 'POST') {
          const parsed = JSON.parse(opts.body);
          createdTitle = parsed.properties?.title;
          return new Response(JSON.stringify({ spreadsheetId: 'ai-pair-ledger-123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.startsWith('https://sheets.googleapis.com/v4/spreadsheets/ai-pair-ledger-123')) {
          return new Response(JSON.stringify({
            sheets: [
              { properties: { title: 'Shared_Docs' } },
              { properties: { title: 'Presence' } },
              { properties: { title: 'Chat' } },
              { properties: { title: 'WebRTC_Signaling' } },
            ],
            values: [['Header']],
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return origFetch(url, opts);
      };

      const ledgerId = await discoverOrCreateWaysideLedger();
      expect(ledgerId).toBe('ai-pair-ledger-123');
      expect(createdTitle).toBe('.waymark-ledger-contact-pair:assistant@waymark.internal::testuser@gmail.com');
    } finally {
      globalThis.fetch = origFetch;
      if (origTokenPath === undefined) delete process.env.WAYMARK_OAUTH_TOKEN_PATH;
      else process.env.WAYMARK_OAUTH_TOKEN_PATH = origTokenPath;
      if (origDriveBase === undefined) delete process.env.DRIVE_BASE;
      else process.env.DRIVE_BASE = origDriveBase;
      if (fs.existsSync(tmpToken)) fs.unlinkSync(tmpToken);
      await new Promise(resolve => server.close(resolve));
    }
  });

});
