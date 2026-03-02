/* ============================================================
   examples.js — Generate example sheets in the user's Drive
   
   Creates example sheets under the organized Waymark directory:
     Waymark/Examples/<template-type>/
   
   Uses the existing API layer (works in both local + live mode).
   
   REUSES existing folders — clicking generate multiple times
   will NOT create duplicate directories.
   
   Data lives in example-data.js; this file is just the generator.
   ============================================================ */

import { api } from './api-client.js';
import { showToast } from './ui.js';
import { EXAMPLE_SHEETS } from './example-data.js';
import * as userData from './user-data.js';

// Re-export so existing consumers don't break
export { EXAMPLE_SHEETS };

/* ---------- Category helpers ---------- */

/**
 * Get all unique categories (folders) and their sheet counts.
 * @returns {{ name: string, sheets: string[] }[]}
 */
export function getExampleCategories() {
  const map = {};
  for (const [title, def] of Object.entries(EXAMPLE_SHEETS)) {
    if (!map[def.folder]) map[def.folder] = [];
    map[def.folder].push(title);
  }
  return Object.entries(map).map(([name, sheets]) => ({ name, sheets }));
}

/* ---------- Generator ---------- */

let isGenerating = false;

/**
 * Find or create a folder, reusing existing ones to avoid duplicates.
 * @param {string} name       folder name
 * @param {string} [parentId] parent folder ID (omit for root)
 * @returns {Promise<Object>}  folder metadata { id, name }
 */
async function findOrCreateFolder(name, parentId) {
  const existing = await api.drive.findFolder(name, parentId);
  if (existing) return existing;
  return api.drive.createFile(
    name,
    'application/vnd.google-apps.folder',
    parentId ? [parentId] : []
  );
}

/**
 * Check if a sheet already exists in a folder by name.
 * @param {string} folderId
 * @param {string} sheetName
 * @returns {Promise<boolean>}
 */
async function sheetExistsInFolder(folderId, sheetName) {
  try {
    const res = await api.drive.listChildren(folderId);
    const files = res.files || [];
    return files.some(f =>
      f.name === sheetName &&
      f.mimeType === 'application/vnd.google-apps.spreadsheet'
    );
  } catch {
    return false;
  }
}

/**
 * Generate example sheets in the user's Google Drive.
 * Places sheets under Waymark/Examples/<template-type>/.
 * Reuses existing folders; skips sheets that already exist.
 * @param {function} onProgress  callback(message) for status updates
 * @param {string[]} [selectedCategories]  optional list of category names to generate (all if omitted)
 * @returns {Promise<{folderId: string, count: number, skipped: number}>}
 */
export async function generateExamples(onProgress = () => {}, selectedCategories = null) {
  if (isGenerating) throw new Error('Generation already in progress');
  isGenerating = true;

  try {
    onProgress('Setting up Waymark/Examples folder…');
    const examplesFolderId = await userData.getExamplesFolderId();

    // Filter entries by selected categories
    const entries = Object.entries(EXAMPLE_SHEETS).filter(([, def]) => {
      if (!selectedCategories) return true;
      return selectedCategories.includes(def.folder);
    });

    // Create subfolders (only for selected categories), reusing existing ones
    const subfolderNames = [...new Set(entries.map(([, s]) => s.folder))];
    const subfolders = {};

    for (const name of subfolderNames) {
      onProgress(`Setting up folder: ${name}`);
      const folder = await findOrCreateFolder(name, examplesFolderId);
      subfolders[name] = folder.id;
    }

    // Create sheets, skipping duplicates
    let count = 0;
    let skipped = 0;

    for (const [title, def] of entries) {
      onProgress(`Checking ${count + skipped + 1}/${entries.length}: ${title}`);

      // Check if sheet already exists
      const exists = await sheetExistsInFolder(subfolders[def.folder], title);
      if (exists) {
        skipped++;
        onProgress(`Skipped (already exists): ${title}`);
        continue;
      }

      count++;
      onProgress(`Creating sheet ${count}/${entries.length - skipped}: ${title}`);
      const rows = [def.headers, ...def.rows];
      await api.sheets.createSpreadsheet(title, rows, subfolders[def.folder]);
    }

    const msg = skipped > 0
      ? `Done! Created ${count} new sheets, skipped ${skipped} existing.`
      : `Done! Created ${count} example sheets in "Waymark/Examples" folder.`;
    onProgress(msg);
    showToast(msg, 'success');

    // Record which categories were generated
    userData.addGeneratedCategories(subfolderNames);

    return { folderId: examplesFolderId, count, skipped };

  } finally {
    isGenerating = false;
  }
}
