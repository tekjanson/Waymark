// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

test.describe('Headless OAuth & Waymark MCP File Operations Unit Tests', () => {

  test('Waymark MCP exports 12 tools including Drive file and doc operations', async () => {
    const { TOOLS } = await import('../../mcp/waymark.mjs');
    expect(TOOLS.length).toBe(12);

    const names = TOOLS.map(t => t.name);
    expect(names).toContain('waymark_list_files');
    expect(names).toContain('waymark_get_doc');
    expect(names).toContain('waymark_append_doc');
    expect(names).toContain('waymark_create_sheet');
    expect(names).toContain('waymark_create_doc');
    expect(names).toContain('waymark_get_sheet');
    expect(names).toContain('waymark_share_sheet');
    expect(names).toContain('waymark_search_entries');

    const listFilesTool = TOOLS.find(t => t.name === 'waymark_list_files');
    expect(listFilesTool.inputSchema.properties.type.enum).toEqual([
      'all', 'spreadsheet', 'document', 'folder'
    ]);
  });

  test('extractDocId and extractFileReferences parse Google Doc IDs', async () => {
    const { extractDocId, extractSpreadsheetId, extractFileReferences } = await import('../../scripts/agy-agent-runner.mjs');

    const docUrl = 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit';
    expect(extractDocId(docUrl)).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

    const jsonDoc = '{"documentId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"}';
    expect(extractDocId(jsonDoc)).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

    const mixedText = `Created sheet: https://docs.google.com/spreadsheets/d/1ZKp4E7zuP2cJSIufCfqrEulhFwjER-Hni_AqQzzRcl0/edit and doc: https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`;
    const refs = extractFileReferences(mixedText);
    expect(refs.sheetId).toBe('1ZKp4E7zuP2cJSIufCfqrEulhFwjER-Hni_AqQzzRcl0');
    expect(refs.docId).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  });

  test('setup-headless-auth parseArgs parses CLI parameters correctly', async () => {
    const { parseArgs } = await import('../../scripts/setup-headless-auth.mjs');

    const parsedCheck = parseArgs(['--check']);
    expect(parsedCheck.checkOnly).toBe(true);

    const parsedCustom = parseArgs([
      '--port', '8080',
      '--no-server',
      '--client-id', 'test-client-id',
      '--client-secret', 'test-client-secret',
      '--import-token', '{"access_token":"xyz"}',
    ]);
    expect(parsedCustom.port).toBe(8080);
    expect(parsedCustom.noServer).toBe(true);
    expect(parsedCustom.clientId).toBe('test-client-id');
    expect(parsedCustom.clientSecret).toBe('test-client-secret');
    expect(parsedCustom.importToken).toBe('{"access_token":"xyz"}');
  });

  test('setup-headless-auth parseAuthCode extracts code from URLs or raw tokens', async () => {
    const { parseAuthCode } = await import('../../scripts/setup-headless-auth.mjs');

    const rawCode = '4/0AeanS0abC123xyz_';
    expect(parseAuthCode(rawCode)).toBe(rawCode);

    const fullUrl = 'http://localhost:3000/auth/callback?code=4%2F0AeanS0abC123xyz_&scope=email';
    expect(parseAuthCode(fullUrl)).toBe('4/0AeanS0abC123xyz_');

    const relativeUrl = 'localhost:3000/auth/callback?code=testcode123';
    expect(parseAuthCode(relativeUrl)).toBe('testcode123');

    expect(parseAuthCode('')).toBeNull();
  });

  test('setup-headless-auth saveToken saves token with 0600 permissions', async () => {
    const { saveToken } = await import('../../scripts/setup-headless-auth.mjs');
    const tmpTokenPath = path.join(ROOT, 'tests', 'fixtures', 'tmp-test-token.json');

    try {
      saveToken({ access_token: 'test', refresh_token: 'refresh_test' }, tmpTokenPath);
      expect(fs.existsSync(tmpTokenPath)).toBe(true);
      const stat = fs.statSync(tmpTokenPath);
      // Mode 0600 in octal is 33152 (0100600)
      expect(stat.mode & 0o777).toBe(0o600);
      const content = JSON.parse(fs.readFileSync(tmpTokenPath, 'utf8'));
      expect(content.access_token).toBe('test');
    } finally {
      if (fs.existsSync(tmpTokenPath)) fs.unlinkSync(tmpTokenPath);
    }
  });

  test('setup-mcp-config buildMcpConfig creates configuration with both servers', async () => {
    const { buildMcpConfig } = await import('../../scripts/setup-mcp-config.mjs');
    const config = buildMcpConfig({ rootDir: ROOT });

    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers.waymark).toBeDefined();
    expect(config.mcpServers['google-sheets']).toBeDefined();

    expect(config.mcpServers.waymark.command).toBe('node');
    expect(config.mcpServers.waymark.args[0]).toBe(path.join(ROOT, 'mcp', 'waymark.mjs'));
    expect(config.mcpServers['google-sheets'].args[0]).toBe(path.join(ROOT, 'mcp', 'google-sheets.mjs'));
  });

  test('install-headless.sh script exists and has executable permissions', () => {
    const scriptPath = path.join(ROOT, 'scripts', 'install-headless.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const stat = fs.statSync(scriptPath);
    // Should have execute permission (at least user executable 0100)
    expect((stat.mode & 0o111) !== 0).toBe(true);
  });

  test('waymark-files skill is present in .agents/skills/waymark-files/SKILL.md', () => {
    const skillPath = path.join(ROOT, '.agents', 'skills', 'waymark-files', 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toContain('name: waymark-files');
    expect(content).toContain('waymark_list_files');
    expect(content).toContain('waymark_create_doc');
    expect(content).toContain('waymark_get_doc');
  });

});
