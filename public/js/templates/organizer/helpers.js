/* ============================================================
   organizer/helpers.js — Drive Organizer constants & pure functions

   All functions here are pure (no DOM, no I/O) so they are easy to
   reason about and test. The template (index.js) owns all DOM and
   persistence; this module owns the taxonomy + clustering heuristics
   that power the AI-style proposals in a deterministic, code-based way.
   ============================================================ */

/* ---------- Constants ---------- */

/** Ordered disposition actions the user cycles through per file. */
export const ACTIONS = ['Move', 'Rename', 'Archive', 'Skip'];

/** Actions that participate in a batch run (Skip / empty are excluded). */
export const ACTIONABLE = new Set(['Move', 'Rename', 'Archive']);

/** Audit Log tab name used to support 1-click undo. */
export const AUDIT_TAB = 'Audit Log';

/** Header row written to the Audit Log tab. */
export const AUDIT_HEADER = [
  'File ID', 'Previous Folder', 'Previous Name',
  'New Folder', 'New Name', 'Action', 'Timestamp',
];

/**
 * Keyword → target-folder taxonomy. The first matching rule wins. Each rule
 * maps a detected WayMark template type or filename keyword to a clean
 * destination folder and a human domain label used for triage grouping.
 */
export const TAXONOMY = [
  { test: /(floor ?plan|blueprint|room|house|layout)/i, folder: '/Projects/Home Renovation', domain: 'Home Renovation' },
  { test: /(budget|finance|expense|statement|ledger)/i, folder: '/Finance/2026', domain: 'Finance' },
  { test: /(invoice|receipt|contract|agreement|legal|tax|w-?2|1099)/i, folder: '/Documents/Legal', domain: 'Documents' },
  { test: /(flow|diagram|pipeline|architecture|workflow)/i, folder: '/Engineering/Diagrams', domain: 'Engineering' },
  { test: /(agent|registry|automation|orchestrator|worker|script|cli|devops)/i, folder: '/Engineering/Automation', domain: 'Engineering' },
  { test: /(kanban|board|sprint|backlog|roadmap|task)/i, folder: '/Projects/Active', domain: 'Projects' },
  { test: /(recipe|meal|menu|grocery|taco|kitchen)/i, folder: '/Personal/Kitchen', domain: 'Personal' },
  { test: /(calorie|fitness|workout|health|habit|tracker)/i, folder: '/Personal/Health', domain: 'Personal' },
  { test: /(resume|cv|cover letter|proposal|plan|notes?)/i, folder: '/Documents/General', domain: 'Documents' },
  { test: /(photo|image|img|screenshot|png|jpe?g)/i, folder: '/Media/Images', domain: 'Media' },
  { test: /(video|recording|mp4|mov|webm)/i, folder: '/Media/Videos', domain: 'Media' },
  { test: /(presentation|slides?|deck)/i, folder: '/Documents/Presentations', domain: 'Documents' },
  { test: /(party|event|wedding|birthday|guest)/i, folder: '/Personal/Events', domain: 'Personal' },
];

/** Fallback bucket for anything that doesn't match the taxonomy. */
export const ARCHIVE_FOLDER = '/Archive/Unsorted';
export const REVIEW_FOLDER = '/Inbox/Needs Review';

/** Folder labels that usually mean "generic" and should not anchor taxonomy. */
const GENERIC_FOLDER_PARTS = new Set([
  '', '/', 'my drive', 'drive', 'root', 'archive', 'unsorted', 'downloads', 'desktop',
  'general', 'misc', 'miscellaneous', 'inbox', 'needs review',
]);

/* ---------- Pure helpers ---------- */

/** Title-case a loose string, collapsing separators and extra whitespace. */
export function titleCase(str) {
  return (str || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\.[a-z0-9]{1,5}$/i, '')          // drop a trailing extension
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** File extension (lowercase, no dot) or '' when there is none. */
export function fileExt(name) {
  const m = (name || '').match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Pick the taxonomy rule for a file from its name + type signal.
 * @returns {{folder:string, domain:string}}
 */
export function classify(name, type, currentFolder = '') {
  const hay = `${name || ''} ${type || ''}`;
  for (const rule of TAXONOMY) {
    if (rule.test.test(hay)) return { folder: rule.folder, domain: rule.domain };
  }
  const fromFolder = classifyFromCurrentFolder(currentFolder);
  if (fromFolder) return fromFolder;
  return fallbackByType(type);
}

/** Proposed clean destination folder for a file. */
export function proposeFolder(name, type, currentFolder = '') {
  return classify(name, type, currentFolder).folder;
}

/** Human domain/cluster label used to group the triage board. */
export function proposeDomain(name, type, currentFolder = '') {
  return classify(name, type, currentFolder).domain;
}

/**
 * Standardized file name: Title Case base, original extension preserved,
 * year suffix appended for finance/statement files so they sort cleanly.
 */
export function proposeName(name, type) {
  const base = titleCase(name);
  const ext = fileExt(name);
  const hay = `${name || ''} ${type || ''}`;
  let clean = base || 'Untitled';
  if (/statement|budget|finance/i.test(hay) && !/20\d\d/.test(clean)) {
    clean += ' 2026';
  }
  return ext ? `${clean}.${ext}` : clean;
}

/**
 * Confidence (0–100) that the proposal is correct. Strong keyword matches
 * and a recognised type score higher; archive fallbacks score lower.
 */
export function scoreConfidence(name, type, currentFolder = '') {
  const result = classify(name, type, currentFolder);
  let score = 72;
  if (result.domain === 'Unsorted') score = 35;
  if (result.domain === 'Needs Review') score = 42;
  if (result.domain === 'By Folder') score = 64;
  if (type && /sheet|doc|floorplan|budget|flow|kanban|image/i.test(type)) score += 14;
  if ((name || '').length > 6) score += 8;
  return Math.max(10, Math.min(99, score));
}

/** Suggested disposition for a file (Archive for truly unsorted, else Move). */
export function proposeAction(name, type, currentFolder = '') {
  const domain = classify(name, type, currentFolder).domain;
  return domain === 'Unsorted' ? 'Archive' : 'Move';
}

/**
 * Waymark system/config files that must NEVER be moved, renamed, or archived.
 * The organizer leaves these exactly where they are.
 */
export const PROTECTED_PATTERNS = [
  /^\.waymark/i,                 // .waymark-data.json, .waymarkIgnore, .waymark*
  /^\.waymark-data\.json$/i,
];

/**
 * True when a file is a Waymark system file that must be left in place.
 * Matches `.waymark*` filenames and anything inside the `_waymark_logs`
 * system folder.
 * @param {string} name
 * @param {string} folder
 * @returns {boolean}
 */
export function isProtectedFile(name, folder) {
  const n = (name || '').trim();
  const f = (folder || '').trim();
  if (PROTECTED_PATTERNS.some(re => re.test(n))) return true;
  if (/(^|\/)_waymark_logs(\/|$)/i.test(f)) return true;
  return false;
}

/** Cycle an action to the next value in ACTIONS (empty → first). */
export function nextAction(current) {
  const i = ACTIONS.indexOf(current);
  return ACTIONS[(i + 1) % ACTIONS.length];
}

/** Map a Drive inventory file object to control-plane cell values by role. */
export function inventoryToFields(file) {
  const type = file.type || file.mimeType || 'file';
  return {
    fileId: file.id || '',
    currentName: file.name || '(unnamed)',
    currentFolder: file.folder || file.folderPath || '/',
    fileType: prettyType(type),
    modified: file.modified || file.modifiedTime || '',
    flags: file.flag || '',
  };
}

/** Compact, human label for a Drive MIME type. */
export function prettyType(mime) {
  if (!mime) return 'File';
  if (/spreadsheet/.test(mime)) return 'Sheet';
  if (/document/.test(mime)) return 'Doc';
  if (/presentation/.test(mime)) return 'Slides';
  if (/folder/.test(mime)) return 'Folder';
  if (/image|png|jpe?g/.test(mime)) return 'Image';
  if (/pdf/.test(mime)) return 'PDF';
  return titleCase(mime.split(/[./]/).pop()) || 'File';
}

/**
 * Detect duplicate / stale flags across an inventory set.
 * Duplicate = same normalised name appears more than once.
 * Stale = modified date older than ~1 year from `now`.
 * @returns {Map<number,string>} row-array index → flag label
 */
export function detectFlags(items, now = Date.now()) {
  const flags = new Map();
  const seen = new Map();
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  items.forEach((it, i) => {
    const key = (it.name || '').trim().toLowerCase();
    if (key) {
      if (seen.has(key)) { flags.set(i, 'Duplicate'); flags.set(seen.get(key), 'Duplicate'); }
      else seen.set(key, i);
    }
    const t = Date.parse(it.modified || it.modifiedTime || '');
    if (!Number.isNaN(t) && now - t > yearMs && !flags.has(i)) flags.set(i, 'Stale');
  });
  return flags;
}

/**
 * Build a before → after tree diff for rows whose action is actionable.
 * @returns {Array<{folder:string, moves:Array<{from:string,to:string,name:string}>}>}
 */
export function buildDiffTree(files) {
  const byFolder = new Map();
  for (const f of files) {
    if (!ACTIONABLE.has(f.action)) continue;
    const target = f.action === 'Archive' ? ARCHIVE_FOLDER : (f.proposedFolder || ARCHIVE_FOLDER);
    if (!byFolder.has(target)) byFolder.set(target, []);
    byFolder.get(target).push({
      from: f.currentFolder || '/',
      to: target,
      name: f.proposedName || f.currentName,
    });
  }
  return [...byFolder.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, moves]) => ({ folder, moves }));
}

/**
 * Surface compact "insight" chips over an inventory set:
 * duplicate clusters, stale files, and the dominant domain.
 * @returns {string[]}
 */
export function buildInsights(files) {
  const chips = [];
  const dupes = files.filter(f => /duplicate/i.test(f.flags || '')).length;
  const stale = files.filter(f => /stale/i.test(f.flags || '')).length;
  if (dupes) chips.push(`${dupes} duplicate${dupes > 1 ? 's' : ''} detected`);
  if (stale) chips.push(`${stale} stale file${stale > 1 ? 's' : ''} (1yr+)`);
  const domains = {};
  for (const f of files) {
    const d = proposeDomain(f.currentName, f.fileType, f.currentFolder);
    domains[d] = (domains[d] || 0) + 1;
  }
  const top = Object.entries(domains).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 1) chips.push(`${top[1]} files cluster into ${top[0]}`);
  return chips;
}

/** Infer destination from current folder when filename keywords are weak. */
function classifyFromCurrentFolder(currentFolder) {
  const normalized = normalizeFolder(currentFolder);
  if (!normalized) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (parts.some(part => /^(general|misc|miscellaneous|inbox|needs review)$/i.test(part))) return null;
  if (parts.every(part => GENERIC_FOLDER_PARTS.has(part.toLowerCase()))) return null;
  const meaningful = parts.filter(part => !GENERIC_FOLDER_PARTS.has(part.toLowerCase()));
  if (!meaningful.length) return null;
  return {
    folder: `/${meaningful.join('/')}`,
    domain: 'By Folder',
  };
}

/** Type-driven fallback to avoid dumping everything into one project bucket. */
function fallbackByType(type) {
  const t = (type || '').toLowerCase();
  if (/sheet/.test(t)) return { folder: REVIEW_FOLDER, domain: 'Needs Review' };
  if (/doc|document|txt/.test(t)) return { folder: '/Documents/General', domain: 'Documents' };
  if (/pdf/.test(t)) return { folder: '/Documents/PDFs', domain: 'Documents' };
  if (/image|png|jpe?g|heic|gif/.test(t)) return { folder: '/Media/Images', domain: 'Media' };
  if (/slide|presentation/.test(t)) return { folder: '/Documents/Presentations', domain: 'Documents' };
  return { folder: ARCHIVE_FOLDER, domain: 'Unsorted' };
}

function normalizeFolder(folder) {
  const raw = (folder || '').trim();
  if (!raw) return '';
  if (!/[\\/]/.test(raw) && /^[A-Za-z0-9_-]{15,}$/.test(raw)) return '';
  const cleaned = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (cleaned === '/') return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}
