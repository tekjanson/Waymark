/* ============================================================
   picker.js — Google Picker API wrapper

   Loads the Google Picker library on demand and provides a
   promise-based API that resolves with the user's file
   selection.  Files selected via Picker are automatically
   granted drive.file scope access.

   Requires:
     - gapi loaded (via <script src="https://apis.google.com/js/api.js">)
     - An OAuth access token (from auth.js)
     - GCP project number injected as window.__WAYMARK_GCP_PROJECT
   ============================================================ */

let _pickerLoaded = false;

/** GCP project number — required for Shared-with-me to populate. */
function getAppId() {
  return window.__WAYMARK_GCP_PROJECT || '';
}

/**
 * Ensure the Picker library is loaded from gapi.
 * Returns a promise that resolves once google.picker is available.
 */
function ensurePickerLoaded() {
  if (_pickerLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (typeof gapi === 'undefined') {
      reject(new Error('Google API client (gapi) not loaded'));
      return;
    }
    gapi.load('picker', {
      callback: () => { _pickerLoaded = true; resolve(); },
      onerror: () => reject(new Error('Failed to load Google Picker')),
    });
  });
}

/** Standard result mapper for Picker docs. */
function mapDocs(docs) {
  return docs.map(d => ({ id: d.id, name: d.name, mimeType: d.mimeType }));
}

/**
 * Open a Google Picker to browse Drive (spreadsheets + folders).
 * Users can select a spreadsheet to open OR a folder to navigate into.
 * @param {string} token   OAuth access token
 * @param {Object} [opts]
 * @param {boolean} [opts.multiSelect=false]  allow multiple file selection
 * @param {boolean} [opts.includeDocs=false]  also show Google Docs
 * @param {boolean} [opts.includeSharedDrives=false]  show shared drives
 * @returns {Promise<Object[]|null>}  array of { id, name, mimeType } or null if cancelled
 */
export async function pickSpreadsheets(token, opts = {}) {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);

    const builder = new google.picker.PickerBuilder()
      .addView(sheetsView)
      .setOAuthToken(token)
      .setAppId(getAppId())
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(mapDocs(data.docs));
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .setTitle('Open from Google Drive');

    if (opts.multiSelect) {
      builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    }

    if (opts.includeSharedDrives) {
      builder.enableFeature(google.picker.Feature.SUPPORT_DRIVES);
      sheetsView.setEnableDrives(true);
    }

    // Pre-navigate to a specific folder so users don't have to hunt
    if (opts.parentFolderId) {
      sheetsView.setParent(opts.parentFolderId);
    }

    if (opts.includeDocs) {
      const docsView = new google.picker.DocsView(google.picker.ViewId.DOCUMENTS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);
      builder.addView(docsView);
    }

    // "Shared with me" view — needs setAppId to populate
    const sharedView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setOwnedByMe(false)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);
    builder.addView(sharedView);

    // Recent view
    builder.addView(google.picker.ViewId.RECENTLY_PICKED);

    builder.build().setVisible(true);
  });
}

/**
 * Open a Google Picker to select folders.
 * @param {string} token   OAuth access token
 * @returns {Promise<Object|null>}  { id, name } or null if cancelled
 */
export async function pickFolder(token) {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const folderView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    // Shared folders view
    const sharedFolderView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(false)
      .setEnableDrives(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    const builder = new google.picker.PickerBuilder()
      .addView(folderView)
      .addView(sharedFolderView)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(token)
      .setAppId(getAppId())
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const folder = data.docs[0];
          resolve({ id: folder.id, name: folder.name });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .setTitle('Select a folder');

    builder.build().setVisible(true);
  });
}

/**
 * Open a Google Picker to select files for import (spreadsheets + docs).
 * @param {string} token   OAuth access token
 * @returns {Promise<Object[]|null>}  array of { id, name, mimeType } or null if cancelled
 */
export async function pickFilesForImport(token) {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const docsView = new google.picker.DocsView(google.picker.ViewId.DOCUMENTS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const sharedView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setOwnedByMe(false);

    const builder = new google.picker.PickerBuilder()
      .addView(sheetsView)
      .addView(docsView)
      .addView(sharedView)
      .addView(google.picker.ViewId.RECENTLY_PICKED)
      .setOAuthToken(token)
      .setAppId(getAppId())
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(mapDocs(data.docs));
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .setTitle('Select files to import');

    builder.build().setVisible(true);
  });
}
