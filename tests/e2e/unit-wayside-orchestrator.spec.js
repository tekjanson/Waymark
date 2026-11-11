// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');


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

  test('classifyMessage detects code and PR requests even with greeting prefixes', async () => {
    const { classifyMessage } = await import('../../scripts/wayside-orchestrator.mjs');
    const prTask = classifyMessage('hey can you put up new waymark branch that lets me pop out the wayside chat session so i can have it anywhere on the screen in the wayboard and to be able to truncat it down to a chat bubble, that would be sweet if you could do that and put it up for PR in the waymark repo, not merge it just put it up for PR');
    expect(prTask.isCodeTask).toBe(true);
    expect(prTask.isConversation).toBe(false);

    const branchTask = classifyMessage('create a branch to fix the wayboard bug and open a pull request');
    expect(branchTask.isCodeTask).toBe(true);
    expect(branchTask.isConversation).toBe(false);
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

  test('buildAgyPrompt constructs engineering and PR instructions for code tasks', async () => {
    const { buildAgyPrompt } = await import('../../scripts/agy-agent-runner.mjs');
    const prompt = buildAgyPrompt({
      task: 'Put up a new branch for the wayboard popout and create a PR in the repo',
      isCodeTask: true,
    });

    expect(prompt).toContain('autonomous software engineer');
    expect(prompt).toContain('gh pr create');
    expect(prompt).toContain('git checkout -b');
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

  test('runOnce performs a single catch-up pass: seeds, drains the queue, goes offline, and never starts timers', async () => {
    const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');
    const orch = new WaysideOrchestrator({ sheetId: 'once-ledger' });

    const calls = [];
    orch._seedLedgerState = async () => { orch.running = true; calls.push('seed'); };
    // Simulate one pending user message queued during the catch-up poll.
    orch.pollChatTab = async () => {
      calls.push('poll');
      orch.queueMessageProcessing({ text: 'hello', sender: 'u@x.com', displayName: 'u', messageId: 'm-once', fromWebRtc: false });
    };
    orch.processMessage = async () => {
      await new Promise(r => setTimeout(r, 10));
      calls.push('processed');
    };
    let presenceStatus = null;
    orch.publishPresence = async (status) => { presenceStatus = status; calls.push('offline'); };

    await orch.runOnce();

    // Queue must be fully drained before runOnce resolves, and offline must come last.
    expect(calls).toEqual(['seed', 'poll', 'processed', 'offline']);
    expect(presenceStatus).toBe('offline');
    expect(orch.running).toBe(false);
    // No persistent peer or timers may be left behind by a single pass.
    expect(orch.peer).toBeNull();
    expect(orch.pollTimer).toBeNull();
    expect(orch.presenceTimer).toBeNull();
  });

  test('shouldRespondToMessage responds to all 1-on-1 messages and only @mentions in group ledgers', async () => {
    const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');

    // 1-on-1 ledger: always responds
    expect(WaysideOrchestrator.shouldRespondToMessage('Can you add milk to the list?', { isGroupLedger: false })).toBe(true);
    expect(WaysideOrchestrator.shouldRespondToMessage('Hey honey I am on my way home', { isGroupLedger: false })).toBe(true);

    // Group ledger: ignores human-to-human chatter without mention
    expect(WaysideOrchestrator.shouldRespondToMessage('Hey honey I am on my way home', { isGroupLedger: true })).toBe(false);
    expect(WaysideOrchestrator.shouldRespondToMessage('Did you pick up the kids?', { isGroupLedger: true })).toBe(false);

    // Group ledger: responds to @waymark, @agent, @assistant, Waymark AI, or @<template>
    expect(WaysideOrchestrator.shouldRespondToMessage('@waymark add milk to the grocery list', { isGroupLedger: true })).toBe(true);
    expect(WaysideOrchestrator.shouldRespondToMessage('Hey Waymark can you plan dinners for this week?', { isGroupLedger: true })).toBe(true);
    expect(WaysideOrchestrator.shouldRespondToMessage('Waymark AI please create a budget sheet', { isGroupLedger: true })).toBe(true);
    expect(WaysideOrchestrator.shouldRespondToMessage('Please ask @recipe for a pasta dish', { isGroupLedger: true })).toBe(true);
  });

  test('buildAgyPrompt includes shareWith collaborator emails for automatic sharing', async () => {
    const { buildAgyPrompt } = await import('../../scripts/agy-agent-runner.mjs');
    const prompt = buildAgyPrompt({
      task: 'Create a shared family meal planner',
      templateKey: 'meal',
      shareWith: ['spouse@gmail.com', 'host@gmail.com'],
    });

    expect(prompt).toContain('Household / Collaborator Share List');
    expect(prompt).toContain('spouse@gmail.com, host@gmail.com');
  });

  test('discoverAllLedgers provisions host, guest, and group ledgers and grants writer permissions', async () => {
    const http = require('http');
    const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');

    const tmpToken = path.join(ROOT, 'tests', 'fixtures', 'tmp-orch-multi-oauth.json');
    fs.writeFileSync(tmpToken, JSON.stringify({
      access_token: 'mock-access-token',
      expiry_date: Date.now() + 3600_000,
    }));

    const permissionGrants = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url.startsWith('/drive/v3/about')) {
          res.end(JSON.stringify({ user: { emailAddress: 'host@gmail.com' } }));
        } else if (req.url.includes('/permissions')) {
          const match = req.url.match(/\/drive\/v3\/files\/([^/?]+)\/permissions/);
          permissionGrants.push({
            fileId: match ? decodeURIComponent(match[1]) : '',
            body: body ? JSON.parse(body) : null,
          });
          res.end(JSON.stringify({ id: 'perm-1' }));
        } else if (req.url.startsWith('/drive/v3/files')) {
          res.end(JSON.stringify({ files: [] }));
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

      let counter = 0;
      globalThis.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (u === 'https://sheets.googleapis.com/v4/spreadsheets' && opts.method === 'POST') {
          counter += 1;
          return new Response(JSON.stringify({ spreadsheetId: `multi-ledger-${counter}` }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.startsWith('https://sheets.googleapis.com/v4/spreadsheets/multi-ledger-')) {
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

      const ledgers = await WaysideOrchestrator.discoverAllLedgers({
        allowedUsers: ['spouse@gmail.com'],
        groups: ['Family'],
      });

      expect(ledgers.length).toBe(3);
      expect(ledgers[0]).toMatchObject({ sheetId: 'multi-ledger-1', userEmail: 'host@gmail.com', isGroupLedger: false });
      expect(ledgers[1]).toMatchObject({ sheetId: 'multi-ledger-2', userEmail: 'spouse@gmail.com', isGroupLedger: false });
      expect(ledgers[2]).toMatchObject({ sheetId: 'multi-ledger-3', group: 'Family', isGroupLedger: true });

      const grantedEmails = permissionGrants.map(g => `${g.fileId}:${g.body?.emailAddress}:${g.body?.role}`);
      expect(grantedEmails).toContain('multi-ledger-1:spouse@gmail.com:writer');
      expect(grantedEmails).toContain('multi-ledger-2:spouse@gmail.com:writer');
      expect(grantedEmails).toContain('multi-ledger-3:spouse@gmail.com:writer');
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

  test('WaysideOrchestrator parses thread metadata, isolates per-thread context, and handles /clear commands', async () => {
    const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');

    expect(WaysideOrchestrator.parseThreadMeta('assistant@waymark.internal')).toEqual({
      threadId: 'default',
      threadTitle: '',
    });
    expect(WaysideOrchestrator.parseThreadMeta('thread:t-123|Trip to Maui')).toEqual({
      threadId: 't-123',
      threadTitle: 'Trip to Maui',
    });
    expect(WaysideOrchestrator.formatThreadTarget('assistant@waymark.internal', 'default', '')).toBe('assistant@waymark.internal');
    expect(WaysideOrchestrator.formatThreadTarget('assistant@waymark.internal', 't-123', 'Trip to Maui')).toBe('thread:t-123|Trip to Maui');

    const orch = new WaysideOrchestrator({ sheetId: 'thread-test-ledger', userEmail: 'host@gmail.com' });
    const delivered = [];
    orch.deliverReply = async (payload) => {
      delivered.push(payload);
    };

    // Seed thread-A memory
    orch.conversations.set('host@gmail.com::thread-a', {
      history: [{ role: 'host@gmail.com', text: 'Plan a trip' }],
      lastSheetId: 'sheet-trip-1',
      lastDocId: null,
      lastTemplateKey: 'travel',
      threadId: 'thread-a',
      threadTitle: 'Trip',
    });

    // Sending a conversational message in thread-b does NOT inherit thread-a's lastSheetId or history
    await orch.processMessage({
      text: 'Hello there!',
      sender: 'host@gmail.com',
      displayName: 'Host',
      messageId: 'm-b1',
      threadId: 'thread-b',
      threadTitle: 'Budget Chat',
    });

    const convB = orch.conversations.get('host@gmail.com::thread-b');
    expect(convB).toBeDefined();
    expect(convB.lastSheetId).toBeNull();
    expect(convB.history.length).toBe(2);
    expect(delivered[0].threadId).toBe('thread-b');
    expect(delivered[0].threadTitle).toBe('Budget Chat');

    // Sending /clear in thread-a resets thread-a's history and lastSheetId without touching thread-b
    await orch.processMessage({
      text: '/clear',
      sender: 'host@gmail.com',
      displayName: 'Host',
      messageId: 'm-a-clear',
      threadId: 'thread-a',
      threadTitle: 'Trip',
    });

    const convA = orch.conversations.get('host@gmail.com::thread-a');
    expect(convA.history).toEqual([]);
    expect(convA.lastSheetId).toBeNull();
    expect(delivered[1].replyText).toContain('Conversation context cleared');
    expect(orch.conversations.get('host@gmail.com::thread-b').history.length).toBe(2);
  });

  test('WaysideOrchestrator handles P2P agent-oauth-setup messages, persists token bundle, and broadcasts agent-oauth-ack', async () => {
    const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');
    const tmpToken = path.join(ROOT, 'tests', 'fixtures', 'tmp-p2p-oauth.json');
    if (fs.existsSync(tmpToken)) fs.unlinkSync(tmpToken);

    try {
      const orch = new WaysideOrchestrator({
        sheetId: 'p2p-oauth-ledger',
        userEmail: 'host@gmail.com',
      });
      const broadcasts = [];
      orch.webrtcPeer = {
        broadcast: (msg) => broadcasts.push(msg),
      };

      // 1. Direct applyOAuthTokenBundle persists token file and returns metadata
      const applied = WaysideOrchestrator.applyOAuthTokenBundle({
        access_token: 'ya29.p2p-test-token',
        refresh_token: '1//0g-p2p-refresh-token',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        expiry_date: Date.now() + 3600_000,
      }, { tokenPath: tmpToken });

      expect(applied.ok).toBe(true);
      expect(applied.hasRefreshToken).toBe(true);
      const written = JSON.parse(fs.readFileSync(tmpToken, 'utf8'));
      expect(written.access_token).toBe('ya29.p2p-test-token');
      expect(written.refresh_token).toBe('1//0g-p2p-refresh-token');

      // 2. Unauthorized sender via P2P is rejected with ok: false
      await orch.handleWebRtcMessage('peer-stranger', {
        type: 'agent-oauth-setup',
        requestId: 'req-unauth',
        sender: 'stranger@gmail.com',
        tokenBundle: { access_token: 'ya29.hijack' },
      });
      expect(broadcasts.length).toBe(1);
      expect(broadcasts[0].type).toBe('agent-oauth-ack');
      expect(broadcasts[0].ok).toBe(false);
      expect(broadcasts[0].requestId).toBe('req-unauth');

      // 3. Authorized host sender via P2P succeeds and broadcasts ok: true
      const origPath = process.env.WAYMARK_OAUTH_TOKEN_PATH;
      process.env.WAYMARK_OAUTH_TOKEN_PATH = tmpToken;
      try {
        await orch.handleWebRtcMessage('peer-host', {
          type: 'agent-oauth-setup',
          requestId: 'req-auth',
          sender: 'host@gmail.com',
          tokenBundle: {
            access_token: 'ya29.host-updated-token',
            refresh_token: '1//0g-host-refresh',
          },
        });
      } finally {
        if (origPath === undefined) delete process.env.WAYMARK_OAUTH_TOKEN_PATH;
        else process.env.WAYMARK_OAUTH_TOKEN_PATH = origPath;
      }

      expect(broadcasts.length).toBe(2);
      expect(broadcasts[1].type).toBe('agent-oauth-ack');
      expect(broadcasts[1].ok).toBe(true);
      expect(broadcasts[1].hasRefreshToken).toBe(true);
      expect(broadcasts[1].requestId).toBe('req-auth');
      const updated = JSON.parse(fs.readFileSync(tmpToken, 'utf8'));
      expect(updated.access_token).toBe('ya29.host-updated-token');
    } finally {
      if (fs.existsSync(tmpToken)) fs.unlinkSync(tmpToken);
    }
  });





test('resolveOAuthTokenPath runs a shared agent as the active requester, not the owner', async () => {
  const { resolveOAuthTokenPath } = await import('../../scripts/agy-agent-runner.mjs');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'waymark-oauth-'));
  const gcloudDir = path.join(tmp, '.config', 'gcloud');
  fs.mkdirSync(gcloudDir, { recursive: true });

  const ownerToken = path.join(gcloudDir, 'waymark-oauth-token.json');
  const guestToken = path.join(gcloudDir, 'waymark-oauth-token-wife_example.com.json');
  fs.writeFileSync(ownerToken, JSON.stringify({ access_token: 'owner' }));
  fs.writeFileSync(guestToken, JSON.stringify({ access_token: 'guest' }));
  const activePath = path.join(gcloudDir, 'waymark-active-requester.json');
  const writeActive = (tokenPath, updatedAt) =>
    fs.writeFileSync(activePath, JSON.stringify({ sender: 'wife@example.com', tokenPath, updatedAt }));

  try {
    // Fresh active-requester pointer → the guest's token wins over the owner default.
    writeActive(guestToken, Date.now());
    expect(resolveOAuthTokenPath({ homeDir: tmp, env: {} })).toBe(guestToken);

    // Explicit caller override always wins.
    expect(resolveOAuthTokenPath({ tokenPath: guestToken, homeDir: tmp, env: {} })).toBe(guestToken);

    // A stale pointer (older than 10 min) falls back to the owner default.
    writeActive(guestToken, Date.now() - 11 * 60 * 1000);
    expect(resolveOAuthTokenPath({ homeDir: tmp, env: {} })).toBe(ownerToken);

    // An exported env var still takes precedence over the active-requester file.
    writeActive(guestToken, Date.now());
    expect(resolveOAuthTokenPath({ homeDir: tmp, env: { WAYMARK_OAUTH_TOKEN_PATH: ownerToken } })).toBe(ownerToken);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('applyOAuthTokenBundle persists durable refresh credentials per collaborator', async () => {
  const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');
  const os = require('os');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-home-'));
  fs.mkdirSync(path.join(tmpHome, '.config', 'gcloud'), { recursive: true });

  const origHome = process.env.HOME;
  const origTokenPath = process.env.WAYMARK_OAUTH_TOKEN_PATH;
  process.env.HOME = tmpHome;
  delete process.env.WAYMARK_OAUTH_TOKEN_PATH;
  try {
    // A collaborator (Kailey) connects her account to the shared agent. The
    // bundle now carries a refresh_token + client_id so her token is durable.
    const result = WaysideOrchestrator.applyOAuthTokenBundle(
      {
        access_token: 'ya29.kailey-access',
        refresh_token: '1//0g-kailey-refresh',
        client_id: 'shared-app.apps.googleusercontent.com',
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/drive.file',
      },
      { sender: 'kailey.levine@gmail.com' }
    );
    expect(result.ok).toBe(true);

    const perAccount = path.join(tmpHome, '.config', 'gcloud', 'waymark-oauth-token-kailey.levine@gmail.com.json');
    expect(fs.existsSync(perAccount)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(perAccount, 'utf8'));
    // The durable pieces must survive — without these the agent can only act as
    // Kailey for ~1 hour before falling back to the owner's Drive.
    expect(saved.refresh_token).toBe('1//0g-kailey-refresh');
    expect(saved.client_id).toBe('shared-app.apps.googleusercontent.com');
    expect(saved.account_email).toBe('kailey.levine@gmail.com');

    // A later refresh-only push (no client_id) must not drop the stored creds.
    WaysideOrchestrator.applyOAuthTokenBundle(
      { access_token: 'ya29.kailey-access-2', refresh_token: '1//0g-kailey-refresh' },
      { sender: 'kailey.levine@gmail.com' }
    );
    const saved2 = JSON.parse(fs.readFileSync(perAccount, 'utf8'));
    expect(saved2.client_id).toBe('shared-app.apps.googleusercontent.com');
    expect(saved2.refresh_token).toBe('1//0g-kailey-refresh');
    expect(saved2.access_token).toBe('ya29.kailey-access-2');
  } finally {
    process.env.HOME = origHome;
    if (origTokenPath === undefined) delete process.env.WAYMARK_OAUTH_TOKEN_PATH;
    else process.env.WAYMARK_OAUTH_TOKEN_PATH = origTokenPath;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('buildMcpConfig never pins the MCP servers to a single OAuth token', async () => {
  const { buildMcpConfig } = await import('../../scripts/setup-mcp-config.mjs');
  const cfg = buildMcpConfig({
    rootDir: '/opt/waymark',
    saKeyPath: '/creds/sa.json',
    oauthTokenPath: '/creds/owner-token.json', // even if passed, must NOT be baked in
    parentFolderId: 'folder-1',
  });
  for (const name of ['waymark', 'google-sheets']) {
    const env = cfg.mcpServers[name].env || {};
    // Hardcoding this would make the MCP ignore active-requester.json and pin
    // every request to one account — the bug that broke shared-agent auth.
    expect(env.WAYMARK_OAUTH_TOKEN_PATH).toBeUndefined();
  }
  // Non-identity config (SA creds, parent folder) is still wired through.
  expect(cfg.mcpServers.waymark.env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/creds/sa.json');
  expect(cfg.mcpServers.waymark.args[0]).toBe('/opt/waymark/mcp/waymark.mjs');
});

test('perAccountTokenPath is stable across writers and readers (no + mismatch)', async () => {
  const { perAccountTokenPath } = await import('../../scripts/agy-agent-runner.mjs');
  const dir = '/creds';
  // Ordinary emails keep '@' and '.', matching legacy files.
  expect(perAccountTokenPath('kailey.levine@gmail.com', dir))
    .toBe(path.join(dir, 'waymark-oauth-token-kailey.levine@gmail.com.json'));
  // '+' and other separators map deterministically — the SAME result whether a
  // writer or a reader computes it, so a token is never "lost" to a host fallback.
  const plus = perAccountTokenPath('john+tag@gmail.com', dir);
  expect(plus).toBe(path.join(dir, 'waymark-oauth-token-john_tag@gmail.com.json'));
  expect(perAccountTokenPath('John+Tag@Gmail.com', dir)).toBe(plus); // case-insensitive
  // Non-addresses produce no path (caller must not create files for them).
  expect(perAccountTokenPath('peer-abc123', dir)).toBe('');
  expect(perAccountTokenPath('', dir)).toBe('');
});

test('resolveRequesterIdentity never silently falls back to the host for a shared agent', async () => {
  const { WaysideOrchestrator } = await import('../../scripts/wayside-orchestrator.mjs');
  const os = require('os');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-ident-'));
  const gcloudDir = path.join(tmpHome, '.config', 'gcloud');
  fs.mkdirSync(gcloudDir, { recursive: true });

  const origHome = process.env.HOME;
  const origTokenPath = process.env.WAYMARK_OAUTH_TOKEN_PATH;
  process.env.HOME = tmpHome;
  delete process.env.WAYMARK_OAUTH_TOKEN_PATH;
  try {
    // Host owner's default token identifies the owner.
    fs.writeFileSync(path.join(gcloudDir, 'waymark-oauth-token.json'),
      JSON.stringify({ access_token: 'owner', account_email: 'owner@waymark.app' }));

    // --- Shared / group agent with a collaborator allow-list ---
    const shared = new WaysideOrchestrator({ sheetId: 's', userEmail: 'owner@waymark.app', allowedUsers: ['wife@example.com'] });

    // Owner messaging their own shared agent → host token (correct, not "wrong user").
    const owner = shared.resolveRequesterIdentity('owner@waymark.app');
    expect(owner.canActAsRequester).toBe(true);
    expect(owner.actingAs).toBe('owner@waymark.app');

    // Collaborator with NO connected token → refuse, do NOT use the host token.
    const noToken = shared.resolveRequesterIdentity('wife@example.com');
    expect(noToken.canActAsRequester).toBe(false);
    expect(noToken.tokenPath).toBeNull();
    expect(noToken.reason).toBe('no-collaborator-token');

    // Collaborator WITH a matching per-account token → act as them.
    const wifePath = path.join(gcloudDir, 'waymark-oauth-token-wife@example.com.json');
    fs.writeFileSync(wifePath, JSON.stringify({ access_token: 'wife', account_email: 'wife@example.com' }));
    const withToken = shared.resolveRequesterIdentity('wife@example.com');
    expect(withToken.canActAsRequester).toBe(true);
    expect(withToken.tokenPath).toBe(wifePath);
    expect(withToken.actingAs).toBe('wife@example.com');

    // A token whose identity does NOT match the requester → refuse (never act as the wrong account).
    fs.writeFileSync(path.join(gcloudDir, 'waymark-oauth-token-mixed@example.com.json'),
      JSON.stringify({ access_token: 'x', account_email: 'someone-else@example.com' }));
    const mismatch = shared.resolveRequesterIdentity('mixed@example.com');
    expect(mismatch.canActAsRequester).toBe(false);
    expect(mismatch.reason).toBe('token-identity-mismatch');

    // Message with no sender email on a shared agent → refuse.
    const anon = shared.resolveRequesterIdentity('peer-xyz');
    expect(anon.canActAsRequester).toBe(false);
    expect(anon.reason).toBe('no-sender-email');

    // --- Personal agent (no collaborators): host token is always correct ---
    const personal = new WaysideOrchestrator({ sheetId: 'p', userEmail: 'owner@waymark.app' });
    const solo = personal.resolveRequesterIdentity('owner@waymark.app');
    expect(solo.canActAsRequester).toBe(true);
    expect(solo.reason).toBe('personal-agent');
  } finally {
    process.env.HOME = origHome;
    if (origTokenPath === undefined) delete process.env.WAYMARK_OAUTH_TOKEN_PATH;
    else process.env.WAYMARK_OAUTH_TOKEN_PATH = origTokenPath;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('runAgyTask refuses to run when the resolved token is not the requester', async () => {
  const { runAgyTask } = await import('../../scripts/agy-agent-runner.mjs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-guard-'));
  const wrongToken = path.join(tmp, 'waymark-oauth-token-owner.json');
  fs.writeFileSync(wrongToken, JSON.stringify({ access_token: 'owner', account_email: 'owner@waymark.app' }));
  try {
    // The resolved token acts as the owner, but we expect the collaborator.
    const res = await runAgyTask({
      task: 'Create a budget',
      tokenPath: wrongToken,
      expectedEmail: 'wife@example.com',
    });
    expect(res.ok).toBe(false);
    expect(res.identityMismatch).toBe(true);
    expect(res.error).toMatch(/Identity mismatch/i);
    // It must refuse BEFORE doing any work (no sheet created in the wrong Drive).
    expect(res.sheetId).toBeUndefined();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
