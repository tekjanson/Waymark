/* ============================================================
   vault.js — Agent API Key Vault
   AES-GCM-256 encrypted storage for Gemini + Claude API keys.
   Keys never leave the browser in plaintext.
   Neither Waymark nor Google ever sees your API keys.

   Encryption: PBKDF2 (100k iterations, SHA-256) → AES-GCM-256
   Storage   : localStorage key "waymark_agent_vault"
   Session   : decrypted keys held in-memory only (cleared on lock)
   ============================================================ */

/** localStorage key for the encrypted vault blob */
const VAULT_LS_KEY = 'waymark_agent_vault';

/** PBKDF2 iteration count — matches encryption.js */
const PBKDF2_ITERATIONS = 100_000;

/* ---------- In-memory session ---------- */

/**
 * Null when locked. When unlocked:
 * {
 *   geminiKeys: Array,
 *   claudeKeys:  Array,
 *   geminiModel: string,
 *   claudeModel: string,
 *   provider:    string,
 *   _password:   string,   // kept for re-encryption on save
 * }
 * @type {Object|null}
 */
let _session = null;

/* ---------- Public status ---------- */

/** @returns {boolean} true if an encrypted vault blob exists in localStorage */
export function isVaultSetUp() {
  return !!localStorage.getItem(VAULT_LS_KEY);
}

/** @returns {boolean} true if vault has been unlocked this session */
export function isVaultUnlocked() {
  return _session !== null;
}

/* ---------- Lock / Unlock ---------- */

/** Clear in-memory keys. Keys stay encrypted in localStorage. */
export function lockVault() {
  _session = null;
}

/**
 * Decrypt vault with the given password.
 * @param {string} password
 * @returns {Promise<boolean>} — true on success, false on wrong password
 */
export async function unlockVault(password) {
  const raw = localStorage.getItem(VAULT_LS_KEY);
  if (!raw) return false;
  try {
    const stored = JSON.parse(raw);
    const key = await _deriveKey(password, stored.salt);
    const plaintext = await _decrypt(key, stored.iv, stored.data);
    const data = JSON.parse(plaintext);
    _session = { ...data, _password: password };
    return true;
  } catch {
    return false;
  }
}

/* ---------- Setup / Save / Clear ---------- */

/**
 * Create or overwrite the encrypted vault.
 * Also unlocks the vault into memory for the current session.
 * @param {string} password
 * @param {{ geminiKeys: Array, claudeKeys: Array, geminiModel: string, claudeModel: string, provider: string }} data
 */
export async function setupVault(password, data) {
  const salt = _toHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await _deriveKey(password, salt);
  const { iv, data: encrypted } = await _encrypt(key, JSON.stringify(data));
  localStorage.setItem(VAULT_LS_KEY, JSON.stringify({ salt, iv, data: encrypted }));
  _session = { ...data, _password: password };
}

/**
 * Re-encrypt with the current session password after key changes.
 * Call after adding/removing keys while vault is unlocked.
 * @param {{ geminiKeys?: Array, claudeKeys?: Array, geminiModel?: string, claudeModel?: string, provider?: string }} updates
 * @returns {Promise<boolean>} false if vault is locked (no session password)
 */
export async function saveVaultChanges(updates) {
  if (!_session?._password) return false;
  const newData = { ..._session, ...updates };
  const { _password } = newData;
  delete newData._password;
  await setupVault(_password, newData);
  return true;
}

/**
 * Change the vault password. Requires old password for verification.
 * @param {string} oldPassword
 * @param {string} newPassword
 * @returns {Promise<boolean>}
 */
export async function changeVaultPassword(oldPassword, newPassword) {
  const ok = await unlockVault(oldPassword);
  if (!ok) return false;
  const { _password: _old, ...data } = _session; // eslint-disable-line no-unused-vars
  await setupVault(newPassword, data);
  return true;
}

/**
 * Remove the vault from localStorage and clear in-memory keys.
 */
export function clearVault() {
  localStorage.removeItem(VAULT_LS_KEY);
  _session = null;
}

/* ---------- Key accessors (session-only) ---------- */

/** @returns {Array} Gemini key ring (empty if locked) */
export function getGeminiKeys() {
  return _session?.geminiKeys || [];
}

/** @returns {Array} Claude key ring (empty if locked) */
export function getClaudeKeys() {
  return _session?.claudeKeys || [];
}

/** @returns {string} */
export function getGeminiModel() {
  return _session?.geminiModel || '';
}

/** @returns {string} */
export function getClaudeModel() {
  return _session?.claudeModel || '';
}

/** @returns {string} 'gemini' | 'claude' */
export function getProvider() {
  return _session?.provider || 'gemini';
}

/* ---------- Private crypto helpers ---------- */

/**
 * Derive an AES-GCM-256 key using PBKDF2.
 * @param {string} password
 * @param {string} saltHex — 32-char hex string (16 bytes)
 * @returns {Promise<CryptoKey>}
 */
async function _deriveKey(password, saltHex) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: _fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext string.
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<{ iv: string, data: string }>}
 */
async function _encrypt(key, plaintext) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { iv: _toHex(iv), data: _toHex(new Uint8Array(cipher)) };
}

/**
 * Decrypt ciphertext.
 * @param {CryptoKey} key
 * @param {string} ivHex
 * @param {string} dataHex
 * @returns {Promise<string>}
 */
async function _decrypt(key, ivHex, dataHex) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: _fromHex(ivHex) },
    key,
    _fromHex(dataHex)
  );
  return new TextDecoder().decode(plain);
}

/** @param {Uint8Array|ArrayBuffer} buf @returns {string} */
function _toHex(buf) {
  return [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** @param {string} hex @returns {Uint8Array} */
function _fromHex(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}
