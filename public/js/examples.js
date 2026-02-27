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

/* ---------- Generator ---------- */

let isGenerating = false;

/**
 * Generate all example sheets in the user's Google Drive.
 * Creates a "WayMark Examples" folder with subfolders per category.
 * @param {function} onProgress  callback(message) for status updates
 * @returns {Promise<{folderId: string, count: number}>}
 */
export async function generateExamples(onProgress = () => {}) {
  if (isGenerating) throw new Error('Generation already in progress');
  isGenerating = true;

  try {
    onProgress('Creating WayMark Examples folder…');
    const rootFolder = await api.drive.createFile(
      'WayMark Examples',
      'application/vnd.google-apps.folder',
      []
    );

    // Create subfolders
    const subfolderNames = [...new Set(Object.values(EXAMPLE_SHEETS).map(s => s.folder))];
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
    const entries = Object.entries(EXAMPLE_SHEETS);

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
