/* ============================================================
   encryption.js — Client-side column-level encryption
   
   Uses Web Crypto API (AES-GCM + PBKDF2) to encrypt/decrypt
   individual cell values. The password never leaves the browser.
   Each sheet derives a unique key from (password + sheetId).
   Neither Waymark nor Google ever sees the plaintext of
   encrypted columns.
   ============================================================ */

/** Prefix marker for encrypted cell values */
const ENC_PREFIX = '\u{1F512}ENC:';

/** PBKDF2 iteration count — balance between security and performance */
const PBKDF2_ITERATIONS = 100000;

/* ---------- In-memory key cache (per sheetId) ---------- */

/** @type {Map<string, CryptoKey>} sheetId → derived AES-GCM key */
const _keyCache = new Map();

/* ---------- Per-sheet encrypted columns tracking ---------- */

/**
 * Get the localStorage key for encrypted column indices.
 * @param {string} sheetId
 * @returns {string}
 */
function encColsKey(sheetId) { return `waymark_enc_cols_${sheetId}`; }

/**
 * Get the set of encrypted column indices for a sheet.
 * @param {string} sheetId
 * @returns {Set<number>}
 */
export function getEncryptedColumns(sheetId) {
  try {
    const raw = localStorage.getItem(encColsKey(sheetId));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}

/**
 * Save the set of encrypted column indices for a sheet.
 * @param {string} sheetId
 * @param {Set<number>} cols
 */
export function setEncryptedColumns(sheetId, cols) {
  localStorage.setItem(encColsKey(sheetId), JSON.stringify([...cols]));
}

/* ---------- Key Derivation ---------- */

/**
 * Derive an AES-GCM key from a password and sheet ID.
 * The sheetId acts as a unique salt so the same password
 * produces different keys for different sheets.
 * @param {string} password — user-provided password
 * @param {string} sheetId  — unique sheet identifier (salt)
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, sheetId) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`waymark-sheet-${sheetId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* ---------- Encrypt / Decrypt ---------- */

/**
 * Encrypt a plaintext string value.
 * @param {CryptoKey} key — AES-GCM key from deriveKey()
 * @param {string} plaintext
 * @returns {Promise<string>} — prefixed base64 string
 */
async function encryptValue(key, plaintext) {
  if (!plaintext) return plaintext;
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(plaintext)
  );
  const cipher = new Uint8Array(cipherBuf);
  // Concatenate IV + ciphertext and base64-encode
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv);
  combined.set(cipher, iv.length);
  return ENC_PREFIX + btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt an encrypted cell value.
 * @param {CryptoKey} key — AES-GCM key from deriveKey()
 * @param {string} encoded — prefixed base64 string from encryptValue()
 * @returns {Promise<string>} — original plaintext
 */
async function decryptValue(key, encoded) {
  if (!encoded || !encoded.startsWith(ENC_PREFIX)) return encoded;
  try {
    const b64 = encoded.slice(ENC_PREFIX.length);
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const cipher = raw.slice(12);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, cipher
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null; // wrong password or corrupted data
  }
}

/* ---------- Public API ---------- */

/**
 * Check whether a cell value is encrypted.
 * @param {string} value
 * @returns {boolean}
 */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Unlock a sheet by caching the derived key in memory.
 * Validates the password by attempting to decrypt a sample value.
 * @param {string} password
 * @param {string} sheetId
 * @param {string} [sampleEncrypted] — an encrypted value to verify password against
 * @returns {Promise<boolean>} — true if key was cached (and sample decrypted ok)
 */
export async function unlock(password, sheetId, sampleEncrypted) {
  const key = await deriveKey(password, sheetId);
  if (sampleEncrypted) {
    const test = await decryptValue(key, sampleEncrypted);
    if (test === null) return false; // wrong password
  }
  _keyCache.set(sheetId, key);
  return true;
}

/**
 * Lock a sheet by removing the cached key.
 * @param {string} sheetId
 */
export function lock(sheetId) {
  _keyCache.delete(sheetId);
}

/**
 * Check if a sheet is currently unlocked (key in memory).
 * @param {string} sheetId
 * @returns {boolean}
 */
export function isUnlocked(sheetId) {
  return _keyCache.has(sheetId);
}

/**
 * Encrypt a value for a given sheet. Sheet must be unlocked first.
 * @param {string} sheetId
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
export async function encrypt(sheetId, plaintext) {
  const key = _keyCache.get(sheetId);
  if (!key) throw new Error('Sheet is locked — unlock with password first');
  return encryptValue(key, plaintext);
}

/**
 * Decrypt a value for a given sheet. Sheet must be unlocked first.
 * Returns null if decryption fails (wrong key / corrupted).
 * @param {string} sheetId
 * @param {string} encoded
 * @returns {Promise<string|null>}
 */
export async function decrypt(sheetId, encoded) {
  if (!isEncrypted(encoded)) return encoded;
  const key = _keyCache.get(sheetId);
  if (!key) return null; // locked
  return decryptValue(key, encoded);
}

/**
 * Decrypt all encrypted columns in a 2D values array (in place).
 * Returns the mutated array for convenience.
 * @param {string} sheetId
 * @param {string[][]} values — full sheet data (row 0 = headers)
 * @param {Set<number>} encCols — set of column indices that are encrypted
 * @returns {Promise<string[][]>}
 */
export async function decryptSheet(sheetId, values, encCols) {
  if (!encCols || encCols.size === 0) return values;
  if (!isUnlocked(sheetId)) return values;
  const key = _keyCache.get(sheetId);
  const tasks = [];
  for (let r = 1; r < values.length; r++) {
    for (const c of encCols) {
      if (c < values[r].length && isEncrypted(values[r][c])) {
        const row = r, col = c;
        tasks.push(
          decryptValue(key, values[row][col]).then(plain => {
            if (plain !== null) values[row][col] = plain;
          })
        );
      }
    }
  }
  await Promise.all(tasks);
  return values;
}
