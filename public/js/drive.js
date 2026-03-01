/* ============================================================
   drive.js — Google Drive REST API wrapper (production mode)
   All functions take an access token and return parsed JSON.
   ============================================================ */

const BASE = 'https://www.googleapis.com/drive/v3';

/**
 * Generic Drive list request.
 */
async function list(token, params = {}) {
  const qs = new URLSearchParams({
    fields: 'files(id,name,mimeType,owners,shared,modifiedTime,parents)',
    pageSize: '100',
    ...params,
  });
  const res = await fetch(`${BASE}/files?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}`);
  return res.json();
}

/**
 * List folders at the root of the user's Drive.
 */
export async function listRootFolders(token) {
  return list(token, {
    q: "'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
    orderBy: 'name',
  });
}

/**
 * List children (folders + sheets + docs) inside a folder.
 */
export async function listChildren(token, folderId) {
  return list(token, {
    q: `'${folderId}' in parents and trashed=false and (mimeType='application/vnd.google-apps.folder' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')`,
    orderBy: 'folder,name',
  });
}

/**
 * List items shared with the current user (folders + sheets + docs).
 */
export async function getSharedWithMe(token) {
  return list(token, {
    q: "sharedWithMe=true and trashed=false and (mimeType='application/vnd.google-apps.folder' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')",
    orderBy: 'name',
  });
}

/**
 * Create a new file in the user's Drive.
 * Uses the drive.file scope (only accesses files created by this app).
 * @param {string} token
 * @param {string} name           file name
 * @param {string} mimeType       e.g. 'application/vnd.google-apps.spreadsheet'
 * @param {string[]} parents      parent folder IDs
 * @returns {Promise<Object>}     created file metadata
 */
export async function createFile(token, name, mimeType, parents = []) {
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType, parents }),
  });
  if (!res.ok) throw new Error(`Drive create ${res.status}`);
  return res.json();
}

/**
 * Find an existing folder by name, optionally within a parent.
 * Returns the first match or null.
 * @param {string} token
 * @param {string} name        folder name to search for
 * @param {string} [parentId]  optional parent folder ID (defaults to root)
 * @returns {Promise<Object|null>}
 */
export async function findFolder(token, name, parentId) {
  const parentClause = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const q = `${parentClause} and name='${name.replace(/'/g, "\\'")}'  and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const result = await list(token, { q });
  return result.files?.[0] || null;
}

/**
 * List all spreadsheets visible to the user (across Drive).
 * @param {string} token
 * @param {string} [query]  optional extra query clause
 * @returns {Promise<Object>}
 */
export async function listSpreadsheets(token, query) {
  const q = query
    ? `${query} and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`
    : "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  return list(token, { q, pageSize: '200', orderBy: 'modifiedTime desc' });
}

/**
 * List all importable files (spreadsheets + documents) visible to the user.
 * @param {string} token
 * @returns {Promise<Object>}
 */
export async function listImportableFiles(token) {
  return list(token, {
    q: "trashed=false and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')",
    pageSize: '200',
    orderBy: 'modifiedTime desc',
  });
}

/**
 * Export a Google Doc as plain text.
 * @param {string} token
 * @param {string} fileId  the Google Doc file ID
 * @returns {Promise<string>}  the document content as plain text
 */
export async function exportDoc(token, fileId) {
  const res = await fetch(
    `${BASE}/files/${fileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive export ${res.status}`);
  return res.text();
}

/**
 * Get file metadata by ID.
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<Object>}
 */
export async function getFile(token, fileId) {
  const res = await fetch(
    `${BASE}/files/${fileId}?fields=id,name,mimeType,parents,modifiedTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive getFile ${res.status}`);
  return res.json();
}
