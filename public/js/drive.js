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
 * List children (folders + sheets) inside a folder.
 */
export async function listChildren(token, folderId) {
  return list(token, {
    q: `'${folderId}' in parents and trashed=false and (mimeType='application/vnd.google-apps.folder' or mimeType='application/vnd.google-apps.spreadsheet')`,
    orderBy: 'folder,name',
  });
}

/**
 * List items shared with the current user (folders + sheets).
 */
export async function getSharedWithMe(token) {
  return list(token, {
    q: "sharedWithMe=true and trashed=false and (mimeType='application/vnd.google-apps.folder' or mimeType='application/vnd.google-apps.spreadsheet')",
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
