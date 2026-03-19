/* ============================================================
   slash-commands.js — Agent slash command handling
   Lightweight command actions for the chat input palette.
   ============================================================ */

/* ---------- Slash Commands ---------- */

export const SLASH_COMMANDS = [
  { name: 'new', syntax: '/new [template] [title]', label: 'Create a blank sheet' },
  { name: 'list', syntax: '/list', label: 'List all your Drive sheets' },
  { name: 'open', syntax: '/open [name]', label: 'Navigate to a sheet by name' },
  { name: 'clear', syntax: '/clear', label: 'Clear this conversation' },
  { name: 'keys', syntax: '/keys', label: 'Open Settings to manage API keys' },
  { name: 'help', syntax: '/help', label: 'Show all slash commands' },
];

/**
 * Execute a slash command and return feedback text or null.
 * @param {string} name
 * @param {string[]} args
 * @param {Object} handlers
 * @returns {Promise<string | null>}
 */
export async function runSlashCommand(name, args, handlers) {
  if (name === 'clear') {
    handlers.clearConversation();
    return null;
  }

  if (name === 'keys') {
    handlers.showSettings();
    return null;
  }

  if (name === 'help') {
    return [
      '**Slash commands** — instant actions, no API call needed:',
      '/new [template] [title] — Create a blank sheet (template optional)',
      '/list — List all your Google Drive sheets',
      '/open [name] — Navigate to the first sheet matching the name',
      '/clear — Clear this conversation',
      '/keys — Open Settings to manage your API keys',
      '/help — Show this help',
    ].join('\n');
  }

  if (name === 'list') {
    try {
      const sheets = await handlers.listSheets();
      if (!sheets.length) return 'You have no sheets in Drive yet.';
      const lines = sheets.slice(0, 30).map(sheet => `[${sheet.name}](#/sheet/${sheet.id})`);
      return `**Your sheets** (${sheets.length} total):\n${lines.join('\n')}`;
    } catch {
      return '⚠️ Could not load sheets. Check your connection and try again.';
    }
  }

  if (name === 'open') {
    const query = args.join(' ').toLowerCase().trim();
    if (!query) return '⚠️ Usage: /open [sheet name]';
    try {
      const sheets = await handlers.listSheets();
      const match = sheets.find(sheet => sheet.name.toLowerCase().includes(query));
      if (!match) return `⚠️ No sheet found matching "${args.join(' ')}".`;
      window.location.hash = `#/sheet/${match.id}`;
      return null;
    } catch {
      return '⚠️ Could not search sheets. Check your connection and try again.';
    }
  }

  if (name === 'new') {
    const template = args[0] || 'checklist';
    const title = args.slice(1).join(' ') || `New ${template}`;
    try {
      const result = await handlers.createBlankSheet({ template, title });
      handlers.appendSheetPreviewCard(result);
      return null;
    } catch (err) {
      return `⚠️ Could not create sheet: ${err.message}`;
    }
  }

  return null;
}