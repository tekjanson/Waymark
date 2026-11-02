#!/usr/bin/env node
/* ============================================================
   setup-mcp-config.mjs — Configure AGY Model Context Protocol (MCP)
   servers for Waymark and Google Sheets.

   Configures:
   1. Global AGY config: ~/.gemini/config/mcp_config.json
   2. Workspace AGY config: .agents/mcp_config.json and .mcp.json
   ============================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HOME_DIR = os.homedir();
const GLOBAL_CONFIG_DIR = path.join(HOME_DIR, '.gemini', 'config');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'mcp_config.json');
const WORKSPACE_AGENTS_CONFIG = path.join(ROOT, '.agents', 'mcp_config.json');
const WORKSPACE_ROOT_CONFIG = path.join(ROOT, '.mcp.json');

const SA_KEY_DEFAULT = path.join(HOME_DIR, '.config', 'gcloud', 'waymark-service-account-key.json');
const OAUTH_TOKEN_DEFAULT = path.join(HOME_DIR, '.config', 'gcloud', 'waymark-oauth-token.json');

export function buildMcpConfig(opts = {}) {
  const rootDir = opts.rootDir || ROOT;
  const saKeyPath = opts.saKeyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || (fs.existsSync(SA_KEY_DEFAULT) ? SA_KEY_DEFAULT : '');
  const oauthTokenPath = opts.oauthTokenPath || process.env.WAYMARK_OAUTH_TOKEN_PATH || (fs.existsSync(OAUTH_TOKEN_DEFAULT) ? OAUTH_TOKEN_DEFAULT : '');
  const parentFolderId = opts.parentFolderId ?? process.env.WAYMARK_PARENT_FOLDER_ID ?? '';
  const workboardSheetId = opts.workboardSheetId ?? process.env.WAYMARK_WORKBOARD_SHEET_ID ?? '';

  const waymarkEnv = {};
  if (parentFolderId) waymarkEnv.WAYMARK_PARENT_FOLDER_ID = parentFolderId;
  if (saKeyPath) waymarkEnv.GOOGLE_APPLICATION_CREDENTIALS = saKeyPath;
  if (oauthTokenPath) waymarkEnv.WAYMARK_OAUTH_TOKEN_PATH = oauthTokenPath;
  if (workboardSheetId) waymarkEnv.WAYMARK_WORKBOARD_SHEET_ID = workboardSheetId;

  const sheetsEnv = {};
  if (saKeyPath) sheetsEnv.GOOGLE_APPLICATION_CREDENTIALS = saKeyPath;
  if (oauthTokenPath) sheetsEnv.WAYMARK_OAUTH_TOKEN_PATH = oauthTokenPath;
  if (workboardSheetId) sheetsEnv.WAYMARK_WORKBOARD_SHEET_ID = workboardSheetId;

  return {
    mcpServers: {
      waymark: {
        command: 'node',
        args: [path.join(rootDir, 'mcp', 'waymark.mjs')],
        env: waymarkEnv,
      },
      'google-sheets': {
        command: 'node',
        args: [path.join(rootDir, 'mcp', 'google-sheets.mjs')],
        env: sheetsEnv,
      },
    },
  };
}

export function writeConfigs(opts = {}) {
  const config = buildMcpConfig(opts);
  const jsonStr = JSON.stringify(config, null, 2) + '\n';

  // 1. Global ~/.gemini/config/mcp_config.json
  try {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    let merged = config;
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
        const existing = JSON.parse(raw);
        merged = {
          ...existing,
          mcpServers: {
            ...(existing.mcpServers || {}),
            ...config.mcpServers,
          },
        };
      } catch {}
    }
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n');
    console.log(`  ✓ Updated global MCP config: ${GLOBAL_CONFIG_PATH}`);
  } catch (err) {
    console.warn(`  ⚠️ Could not write global config: ${err.message}`);
  }

  // 2. Workspace root .mcp.json (only when explicitly requested via --root-mcp)
  if (opts.writeRootMcp) {
    try {
      let mergedRoot = config;
      if (fs.existsSync(WORKSPACE_ROOT_CONFIG)) {
        try {
          const raw = fs.readFileSync(WORKSPACE_ROOT_CONFIG, 'utf8').replace(/^\uFEFF/, '');
          const existing = JSON.parse(raw);
          mergedRoot = {
            ...existing,
            mcpServers: {
              ...(existing.mcpServers || {}),
              ...config.mcpServers,
            },
          };
        } catch {}
      }
      fs.writeFileSync(WORKSPACE_ROOT_CONFIG, JSON.stringify(mergedRoot, null, 2) + '\n');
      console.log(`  ✓ Updated root MCP config: ${WORKSPACE_ROOT_CONFIG}`);
    } catch (err) {
      console.warn(`  ⚠️ Could not write root .mcp.json: ${err.message}`);
    }
  }

  return config;
}

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const a = fs.realpathSync(fileURLToPath(metaUrl));
    const b = fs.realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = path.resolve(fileURLToPath(metaUrl));
    const b = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isMainModule(import.meta.url)) {
  console.log('\n===============================================================');
  console.log('  Waymark AGY MCP Server Configuration');
  console.log('===============================================================\n');
  writeConfigs();
  console.log('\n  Registered servers:');
  console.log('    • waymark (12 tools: templates, sheets, entries, files, docs)');
  console.log('    • google-sheets (11 tools: raw sheets API manipulation)');
  console.log('\n===============================================================\n');
}
