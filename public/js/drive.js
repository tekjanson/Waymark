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
    fields: 'nextPageToken,files(id,name,mimeType,owners,shared,modifiedTime,parents)',
    pageSize: '100',
    ...params,
  });
  const res = await fetch(`${BASE}/files?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive API ${res.status}`);
  return res.json();
}

async function listAll(token, params = {}) {
  const files = [];
  let nextPageToken = '';
  let lastBody = { files: [] };

  do {
    const body = await list(token, {
      ...params,
      ...(nextPageToken ? { pageToken: nextPageToken } : {}),
    });
    lastBody = body;
    files.push(...(body.files || []));
    nextPageToken = body.nextPageToken || '';
  } while (nextPageToken);

  return { ...lastBody, files };
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
  return listAll(token, { q, pageSize: '200', orderBy: 'modifiedTime desc' });
}

/**
 * List all importable files (spreadsheets + documents) visible to the user.
 * @param {string} token
 * @returns {Promise<Object>}
 */
export async function listImportableFiles(token) {
  return listAll(token, {
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

/**
 * Find a file by name inside a folder (any MIME type).
 * @param {string} token
 * @param {string} name       file name to search for
 * @param {string} parentId   parent folder ID
 * @returns {Promise<Object|null>}
 */
export async function findFile(token, name, parentId) {
  const q = `'${parentId}' in parents and name='${name.replace(/'/g, "\\'")}'  and trashed=false`;
  const result = await list(token, { q });
  return result.files?.[0] || null;
}

/**
 * Create a file with JSON content (multipart upload).
 * Used for storing app data (settings, pins, etc.) in Drive.
 * @param {string} token
 * @param {string} name       file name (e.g. 'waymark-settings.json')
 * @param {Object} content    JSON-serializable content
 * @param {string[]} parents  parent folder IDs
 * @returns {Promise<Object>}  created file metadata
 */
export async function createJsonFile(token, name, content, parents = []) {
  const metadata = { name, mimeType: 'application/json', parents };
  const body = JSON.stringify(content, null, 2);

  const boundary = '----WayMarkBoundary' + Date.now();
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    body +
    `\r\n--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive createJsonFile ${res.status}`);
  return res.json();
}

/**
 * Read JSON content from a Drive file.
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<Object>}  parsed JSON content
 */
export async function readJsonFile(token, fileId) {
  const res = await fetch(`${BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive readJsonFile ${res.status}`);
  return res.json();
}

/**
 * Read plain text content from a Drive file.
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<string>}  raw text content
 */
export async function readTextFile(token, fileId) {
  const res = await fetch(`${BASE}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive readTextFile ${res.status}`);
  return res.text();
}

/**
 * Update JSON content of an existing Drive file.
 * @param {string} token
 * @param {string} fileId
 * @param {Object} content  JSON-serializable content
 * @returns {Promise<Object>}  updated file metadata
 */
export async function updateJsonFile(token, fileId, content) {
  const body = JSON.stringify(content, null, 2);
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,mimeType`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive updateJsonFile ${res.status}`);
  return res.json();
}

/**
 * Create a plain text file via multipart upload.
 * @param {string} token
 * @param {string} name       file name (e.g. '.waymarkIgnore')
 * @param {string} content    plain text content
 * @param {string[]} parents  parent folder IDs
 * @returns {Promise<Object>}  created file metadata
 */
export async function createTextFile(token, name, content, parents = []) {
  const metadata = { name, mimeType: 'text/plain', parents };

  const boundary = '----WayMarkBoundary' + Date.now();
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive createTextFile ${res.status}`);
  return res.json();
}

/**
 * Update plain text content of an existing Drive file.
 * @param {string} token
 * @param {string} fileId
 * @param {string} content   plain text content
 * @returns {Promise<Object>}  updated file metadata
 */
export async function updateTextFile(token, fileId, content) {
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,mimeType`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: content,
  });
  if (!res.ok) throw new Error(`Drive updateTextFile ${res.status}`);
  return res.json();
}
