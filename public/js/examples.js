/* ============================================================
   examples.js — Generate example sheets in the user's Drive
   
   Creates a "WayMark Examples" folder with subfolders for
   each template type, each containing sample spreadsheets.
   Uses the existing API layer (works in both local + live mode).
   
   Data lives in example-data.js; this file is just the generator.
   ============================================================ */

import { api } from './api-client.js';
import { showToast } from './ui.js';
import { EXAMPLE_SHEETS } from './example-data.js';

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
 * Generate example sheets in the user's Google Drive.
 * @param {function} onProgress  callback(message) for status updates
 * @param {string[]} [selectedCategories]  optional list of category names to generate (all if omitted)
 * @returns {Promise<{folderId: string, count: number}>}
 */
export async function generateExamples(onProgress = () => {}, selectedCategories = null) {
  if (isGenerating) throw new Error('Generation already in progress');
  isGenerating = true;

  try {
    onProgress('Creating WayMark Examples folder…');
    const rootFolder = await api.drive.createFile(
      'WayMark Examples',
      'application/vnd.google-apps.folder',
      []
    );

    // Filter entries by selected categories
    const entries = Object.entries(EXAMPLE_SHEETS).filter(([, def]) => {
      if (!selectedCategories) return true;
      return selectedCategories.includes(def.folder);
    });

    // Create subfolders (only for selected categories)
    const subfolderNames = [...new Set(entries.map(([, s]) => s.folder))];
    const subfolders = {};

    for (const name of subfolderNames) {
      onProgress(`Creating folder: ${name}`);
      const folder = await api.drive.createFile(
        name,
        'application/vnd.google-apps.folder',
        [rootFolder.id]
      );
      subfolders[name] = folder.id;
    }

    // Create sheets
    let count = 0;

    for (const [title, def] of entries) {
      count++;
      onProgress(`Creating sheet ${count}/${entries.length}: ${title}`);
      const rows = [def.headers, ...def.rows];
      await api.sheets.createSpreadsheet(title, rows, subfolders[def.folder]);
    }

    onProgress(`Done! Created ${count} example sheets in "WayMark Examples" folder.`);
    showToast(`Generated ${count} example sheets`, 'success');
    return { folderId: rootFolder.id, count };

  } finally {
    isGenerating = false;
  }
}
