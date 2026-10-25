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
let _gapiScriptPromise = null;
const GAPI_SRC = 'https://apis.google.com/js/api.js';

/** GCP project number — required for Shared-with-me to populate. */
function getAppId() {
  return window.__WAYMARK_GCP_PROJECT || '';
}

/**
 * Ensure the Picker library is loaded from gapi.
 * Returns a promise that resolves once google.picker is available.
 */
function ensureGapiScriptLoaded() {
  if (typeof gapi !== 'undefined') return Promise.resolve();
  if (_gapiScriptPromise) return _gapiScriptPromise;

  _gapiScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GAPI_SRC}"]`);
    if (existing) {
      const waitForGapi = () => {
        if (typeof gapi !== 'undefined') {
          resolve();
          return;
        }
        window.setTimeout(waitForGapi, 30);
      };
      waitForGapi();
      return;
    }

    const script = document.createElement('script');
    script.src = GAPI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google API client script'));
    document.head.append(script);
  });

  return _gapiScriptPromise;
}

async function ensurePickerLoaded() {
  if (_pickerLoaded) return Promise.resolve();
  await ensureGapiScriptLoaded();
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

    // Pre-navigate to a specific folder so the user sees its contents
    if (opts.parentFolderId) {
      sheetsView.setParent(opts.parentFolderId);
    }

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
      .setTitle(opts.title || 'Open from Google Drive');

    if (opts.multiSelect) {
      builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    }

    if (opts.includeSharedDrives) {
      builder.enableFeature(google.picker.Feature.SUPPORT_DRIVES);
      sheetsView.setEnableDrives(true);
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
      .setMimeTypes('application/vnd.google-apps.folder');

    // Shared folders view
    const sharedFolderView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(false)
      .setMimeTypes('application/vnd.google-apps.folder');

    const builder = new google.picker.PickerBuilder()
      .addView(folderView)
      .addView(sharedFolderView)
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

/**
 * Open a pre-filtered Google Picker for a single shared spreadsheet invite.
 * @param {string} token
 * @param {Object} opts
 * @param {string} opts.fileId
 * @param {string} [opts.fileName]
 * @param {string} [opts.parentFolderId]
 * @returns {Promise<{id:string,name:string,mimeType:string}|null>}
 */
export async function pickSpreadsheetForInvite(token, opts = {}) {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const sheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);

    if (opts.parentFolderId) {
      sheetsView.setParent(opts.parentFolderId);
    }
    if (opts.fileName) {
      sheetsView.setQuery(opts.fileName);
    } else if (opts.fileId) {
      sheetsView.setQuery(opts.fileId);
    }

    const builder = new google.picker.PickerBuilder()
      .addView(sheetsView)
      .setOAuthToken(token)
      .setAppId(getAppId())
      .setTitle(opts.fileName ? `Authorize "${opts.fileName}"` : 'Authorize shared spreadsheet')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          const docs = mapDocs(data.docs || []);
          resolve(docs[0] || null);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });

    if (opts.parentFolderId) {
      builder.enableFeature(google.picker.Feature.NAV_HIDDEN);
    }

    builder.build().setVisible(true);
  });
}

/**
 * Open a Google Picker focused on spreadsheets shared with the user ("Shared with me").
 * Selecting files in Picker grants Waymark `drive.file` access to them.
 * @param {string} token
 * @param {{ query?: string, title?: string, multiSelect?: boolean }} [opts]
 * @returns {Promise<Array<{id:string,name:string,mimeType:string}>|null>}
 */
export async function pickSharedFiles(token, opts = {}) {
  await ensurePickerLoaded();

  return new Promise((resolve) => {
    const sharedView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setOwnedByMe(false)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    if (opts.query) {
      sharedView.setQuery(opts.query);
    }

    const allSheetsView = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);
    if (opts.query) {
      allSheetsView.setQuery(opts.query);
    }

    const builder = new google.picker.PickerBuilder()
      .addView(sharedView)
      .addView(allSheetsView)
      .setOAuthToken(token)
      .setAppId(getAppId())
      .setTitle(opts.title || 'Connect Shared Waymark / Ledger')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(mapDocs(data.docs || []));
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      });

    if (opts.multiSelect !== false) {
      builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    }

    builder.build().setVisible(true);
  });
}
