import * as storage from '../storage.js';
/* ============================================================
   vault.js — Agent Keys Sheet integration
   Reads AI API keys from a Waymark Passwords sheet.

   The keys live in your own Google Sheet (passwords template).
   The Password column can be encrypted with encryption.js —
   neither Waymark nor Google ever sees your plaintext keys.

   Flow:
     1. User links their passwords sheet in Agent Settings
     2. Agent reads the sheet; finds rows for Gemini / Claude
     3. If Password column is encrypted → user enters sheet password
     4. encryption.unlock() decrypts in-memory; keys are used
     5. lock() clears decryption key from memory (or on page close)
   ============================================================ */

import { api } from '../api-client.js';
import * as encryption from '../encryption.js';
import * as userData from '../user-data.js';

/* ---------- localStorage keys ---------- */

const LS_SHEET_ID        = 'waymark_agent_keys_sheet_id';
const LS_SHEET_NAME      = 'waymark_agent_keys_sheet_name';
const LS_BIOMETRIC_VAULT = 'waymark_agent_biometric_vault';

/* ---------- In-memory session ---------- */

/** @type {{ geminiKeys: Array, claudeKeys: Array, openaiKeys: Array } | null} */
let _session = null;
/** @type {string | null} */
let _lastUnlockedPassword = null;
/** @type {Promise<boolean> | null} */
let _biometricUnlockPromise = null;

/* ---------- Base64 helpers ---------- */

function _toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function _fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ---------- Mobile & Biometric Unlock (WebAuthn) ---------- */

/**
 * Detect whether the user is on a mobile web device (or mobile viewport / touch device).
 * @returns {boolean}
 */
function isMobileWeb() {
  if (typeof window === 'undefined') return false;
  if (window.__WAYMARK_BIOMETRIC_MOBILE === true) return true;
  if (window.__WAYMARK_BIOMETRIC_MOBILE === false) return false;
  if (navigator.userAgentData?.mobile === true) return true;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile|Touch/i.test(ua)) return true;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (coarse && (navigator.maxTouchPoints || 0) > 0) return true;
  if (window.innerWidth <= 768 && (navigator.maxTouchPoints || 0) > 0) return true;
  return false;
}

/**
 * Check if WebAuthn platform biometrics (Face ID / Touch ID / Fingerprint) are available.
 * Supports `window.__WAYMARK_MOCK_BIOMETRICS` for deterministic testing.
 * @returns {Promise<boolean>}
 */
async function isBiometricSupported() {
  if (typeof window === 'undefined') return false;
  if (window.__WAYMARK_MOCK_BIOMETRICS) {
    return window.__WAYMARK_MOCK_BIOMETRICS.supported !== false;
  }
  try {
    if (
      window.PublicKeyCredential &&
      navigator.credentials &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Check whether the current session knows the verified vault password in memory.
 * @param {string|null} [sheetId]
 * @returns {boolean}
 */
function hasKnownVaultPassword(sheetId = getLinkedSheetId()) {
  if (_lastUnlockedPassword && _lastUnlockedPassword.length > 0) return true;
  if (sheetId) {
    const cached = encryption.getUnlockedPassword(sheetId);
    if (cached && cached.length > 0) return true;
    if (encryption.getEncryptedColumns(sheetId).size === 0 && _lastUnlockedPassword === '') {
      return true;
    }
  }
  return false;
}

/**
 * Check if a biometric unlock credential is enrolled for the current linked keys sheet.
 * @param {string|null} [sheetId]
 * @returns {boolean}
 */
function hasBiometricVault(sheetId = getLinkedSheetId()) {
  try {
    const raw = JSON.parse(storage.getRaw(LS_BIOMETRIC_VAULT) || 'null');
    if (!raw || !raw.credentialId || !raw.ciphertext || !raw.iv || (!raw.wrapMask && !raw.keyB64)) {
      return false;
    }
    if (sheetId && raw.sheetId && raw.sheetId !== sheetId) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear stored biometric vault credentials on this device.
 */
function clearBiometricVault() {
  try { storage.removeRaw(LS_BIOMETRIC_VAULT); } catch { /* noop */ }
}

/**
 * Enroll biometric unlock for the linked keys sheet (or specified sheetId) using
 * WebAuthn platform authenticator and AES-GCM encryption of the vault password.
 * Refuses to enroll an empty password so an unverified/empty session never
 * overwrites the biometric vault with a blank key.
 * @param {string} [password] — defaults to the verified password in memory
 * @param {string|null} [targetSheetId]
 * @returns {Promise<boolean>}
 */
async function enrollBiometricVault(password, targetSheetId = getLinkedSheetId()) {
  const sheetId = targetSheetId || getLinkedSheetId();
  const resolvedPw = (typeof password === 'string' && password.length > 0)
    ? password
    : (_lastUnlockedPassword !== null && _lastUnlockedPassword !== undefined
      ? _lastUnlockedPassword
      : (sheetId ? encryption.getUnlockedPassword(sheetId) : null));
  if (!sheetId || resolvedPw === null || resolvedPw === undefined) return false;
  if (resolvedPw === '' && encryption.getEncryptedColumns(sheetId).size > 0) {
    return false;
  }

  try {
    let rawIdBytes;
    let transports = [];
    if (window.__WAYMARK_MOCK_BIOMETRICS) {
      if (window.__WAYMARK_MOCK_BIOMETRICS.failEnroll) return false;
      if (typeof window.__WAYMARK_MOCK_BIOMETRICS.onEnroll === 'function') {
        window.__WAYMARK_MOCK_BIOMETRICS.onEnroll(sheetId);
      }
      rawIdBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) rawIdBytes[i] = (i * 7 + 13) & 0xff;
    } else {
      if (!window.PublicKeyCredential || !navigator.credentials?.create) return false;
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const rpId = window.location.hostname || 'localhost';
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: 'Waymark AI',
            id: rpId,
          },
          user: {
            id: userId,
            name: 'waymark-ai-vault',
            displayName: 'Waymark AI Vault',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'preferred',
            residentKey: 'preferred',
          },
          timeout: 60000,
        },
      });
      if (!cred || !cred.rawId) return false;
      rawIdBytes = new Uint8Array(cred.rawId);
      if (typeof cred.response?.getTransports === 'function') {
        try { transports = cred.response.getTransports(); } catch { /* optional browser hint */ }
      }
    }

    if (!rawIdBytes || rawIdBytes.length === 0) return false;

    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapMask = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      wrapMask[i] = rawKey[i] ^ rawIdBytes[i % rawIdBytes.length];
    }

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedPw = new TextEncoder().encode(String(resolvedPw));
    const cipherBuf = await encryption.encryptAesGcmWithRawKey(rawKey, iv, encodedPw);

    _lastUnlockedPassword = String(resolvedPw);
    storage.setRaw(LS_BIOMETRIC_VAULT, JSON.stringify({
      sheetId,
      credentialId: _toBase64(rawIdBytes),
      iv: _toBase64(iv),
      ciphertext: _toBase64(new Uint8Array(cipherBuf)),
      wrapMask: _toBase64(wrapMask),
      keyB64: _toBase64(rawKey),
      transports,
      createdAt: new Date().toISOString(),
    }));
    return true;
  } catch (err) {
    console.warn('[keys-sheet] biometric enrollment failed:', err);
    return false;
  }
}

/**
 * Verify platform biometrics via WebAuthn and decrypt the stored password.
 * @param {string|null} [targetSheetId]
 * @returns {Promise<string|null>}
 */
async function unlockPasswordWithBiometrics(targetSheetId = getLinkedSheetId()) {
  const sheetId = targetSheetId || getLinkedSheetId();
  if (!hasBiometricVault(sheetId)) return null;

  try {
    const record = JSON.parse(storage.getRaw(LS_BIOMETRIC_VAULT) || 'null');
    if (!record || (sheetId && record.sheetId && record.sheetId !== sheetId)) return null;

    const credIdBytes = _fromBase64(record.credentialId);
    let assertionRawId;

    if (window.__WAYMARK_MOCK_BIOMETRICS) {
      if (window.__WAYMARK_MOCK_BIOMETRICS.failUnlock) return null;
      if (typeof window.__WAYMARK_MOCK_BIOMETRICS.onUnlock === 'function') {
        window.__WAYMARK_MOCK_BIOMETRICS.onUnlock(sheetId || record.sheetId);
      }
      assertionRawId = credIdBytes;
    } else {
      if (!window.PublicKeyCredential || !navigator.credentials?.get) return null;
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const rpId = window.location.hostname || 'localhost';
      const allowCredential = {
        type: 'public-key',
        id: credIdBytes,
      };
      if (Array.isArray(record.transports) && record.transports.length > 0) {
        allowCredential.transports = record.transports;
      }
      // Keep this request scoped to the credential enrolled by Waymark. A broad
      // discoverable-credential retry can open a second browser/provider chooser
      // after cancellation or when this device does not have the enrolled key.
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId,
          allowCredentials: [allowCredential],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      if (!assertion || !assertion.rawId) return null;
      assertionRawId = new Uint8Array(assertion.rawId);
    }

    const iv = _fromBase64(record.iv);
    const ciphertext = _fromBase64(record.ciphertext);

    let password = null;

    // 1. Try XOR-unmasked key using assertion.rawId
    if (record.wrapMask && assertionRawId && assertionRawId.length > 0) {
      try {
        const wrapMask = _fromBase64(record.wrapMask);
        const rawKey = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          rawKey[i] = wrapMask[i] ^ assertionRawId[i % assertionRawId.length];
        }
        const plainBuf = await encryption.decryptAesGcmWithRawKey(rawKey, iv, ciphertext);
        password = new TextDecoder().decode(plainBuf);
      } catch {
        password = null;
      }
    }

    // 2. Fallback to the locally stored key for older biometric records.
    if (password === null && record.keyB64) {
      try {
        const rawKey = _fromBase64(record.keyB64);
        const plainBuf = await encryption.decryptAesGcmWithRawKey(rawKey, iv, ciphertext);
        password = new TextDecoder().decode(plainBuf);
      } catch {
        password = null;
      }
    }

    if (password === null || password === undefined) {
      return null;
    }
    if (password === '' && sheetId && encryption.getEncryptedColumns(sheetId).size > 0) {
      clearBiometricVault();
      return null;
    }

    return password;
  } catch (err) {
    console.warn('[keys-sheet] biometric unlock failed:', err);
    return null;
  }
}

/**
 * Unlock the linked keys sheet using the enrolled platform biometric credential.
 * Prompts the user for Face ID / Touch ID / Fingerprint via WebAuthn.
 * @returns {Promise<boolean>}
 */
function unlockVaultWithBiometrics() {
  if (_biometricUnlockPromise) return _biometricUnlockPromise;
  _biometricUnlockPromise = _unlockVaultWithBiometrics().finally(() => {
    _biometricUnlockPromise = null;
  });
  return _biometricUnlockPromise;
}

async function _unlockVaultWithBiometrics() {
  const sheetId = getLinkedSheetId();
  if (!sheetId || !hasBiometricVault(sheetId)) return false;

  const password = await unlockPasswordWithBiometrics(sheetId);
  if (password === null || password === undefined) return false;

  const ok = await unlockVault(password);
  if (!ok) {
    clearBiometricVault();
    return false;
  }
  return true;
}

/**
 * Ensure the linked AI keys sheet is ready for an operation. When it is locked,
 * use this device's enrolled biometric credential automatically if available.
 * @returns {Promise<boolean>} true when AI keys can be read, false otherwise
 */
async function ensureVaultUnlocked() {
  if (!isVaultSetUp() || isVaultUnlocked()) return true;
  if (hasBiometricVault() && await unlockVaultWithBiometrics()) return true;
  // A locked but unencrypted keys sheet can still be opened automatically.
  // unlockVault() detects encrypted columns and rejects the empty password.
  return unlockVault('');
}

/* ---------- Link / Unlink ---------- */

/** @returns {string|null} */
function getLinkedSheetId() {
  try { return JSON.parse(storage.getRaw(LS_SHEET_ID) || 'null'); } catch { return null; }
}

/** @returns {string} friendly sheet name */
function getLinkedSheetName() {
  try { return JSON.parse(storage.getRaw(LS_SHEET_NAME) || 'null') || 'Passwords sheet'; } catch { return 'Passwords sheet'; }
}

/**
 * Link a passwords sheet as the AI keys source.
 * @param {string} id   — spreadsheet ID
 * @param {string} name — friendly title
 */
function linkSheet(id, name) {
  storage.setRaw(LS_SHEET_ID, JSON.stringify(id));
  storage.setRaw(LS_SHEET_NAME, JSON.stringify(name || id));
  _session = null; // force re-unlock after linking
  // Mirror the link to Drive so it follows the user across devices.
  userData.saveAgentKeysSheet?.({ id, name: name || id }).catch(() => {});
}

/** Remove the link and lock. */
function unlinkSheet() {
  const id = getLinkedSheetId();
  if (id) encryption.lock(id);
  clearBiometricVault();
  storage.removeRaw(LS_SHEET_ID);
  storage.removeRaw(LS_SHEET_NAME);
  _session = null;
  _lastUnlockedPassword = null;
  userData.saveAgentKeysSheet?.(null).catch(() => {});
}

/**
 * Restore the vault link from Drive-synced user data when this device has no
 * local link yet (e.g. first login on a new phone). Pull-only, synchronous.
 * @returns {boolean} true if a link was restored into localStorage
 */
function hydrateFromDrive() {
  try {
    if (getLinkedSheetId()) return false; // already linked on this device
    const link = userData.getAgentKeysSheet?.();
    if (!link || !link.id) return false;
    storage.setRaw(LS_SHEET_ID, JSON.stringify(link.id));
    storage.setRaw(LS_SHEET_NAME, JSON.stringify(link.name || link.id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Two-way, non-destructive sync of the vault link between this device
 * (localStorage) and the user's Google Drive account. Never clears a link —
 * only an explicit Unlink does that.
 *
 *  - localStorage link, no Drive link → push up (migrate existing users so
 *    their configured sheet becomes account-wide and reaches other devices).
 *  - no localStorage link, Drive link → pull down (new device auto-links).
 *  - both present → prefer the Drive value if they differ (account is source
 *    of truth for a linked account), otherwise no-op.
 *
 * Safe to call once after userData.init().
 * @returns {Promise<{action:'pushed'|'pulled'|'noop', id:(string|null)}>}
 */
async function syncVaultLink() {
  let localId = null, localName = null;
  try { localId = getLinkedSheetId(); localName = getLinkedSheetName(); } catch { /* noop */ }
  const driveLink = (() => { try { return userData.getAgentKeysSheet?.() || null; } catch { return null; } })();

  // Fresh device: pull the account link down.
  if (!localId && driveLink && driveLink.id) {
    storage.setRaw(LS_SHEET_ID, JSON.stringify(driveLink.id));
    storage.setRaw(LS_SHEET_NAME, JSON.stringify(driveLink.name || driveLink.id));
    return { action: 'pulled', id: driveLink.id };
  }

  // Existing device with a link the account doesn't have yet: migrate it up.
  if (localId && (!driveLink || !driveLink.id)) {
    try { await userData.saveAgentKeysSheet?.({ id: localId, name: localName || localId }); } catch { /* best-effort */ }
    return { action: 'pushed', id: localId };
  }

  // Account has a different link than this device: adopt the account value.
  if (localId && driveLink && driveLink.id && driveLink.id !== localId) {
    storage.setRaw(LS_SHEET_ID, JSON.stringify(driveLink.id));
    storage.setRaw(LS_SHEET_NAME, JSON.stringify(driveLink.name || driveLink.id));
    _session = null; // link changed → force re-unlock
    return { action: 'pulled', id: driveLink.id };
  }

  return { action: 'noop', id: localId };
}

/* ---------- Lock / Unlock status ---------- */

/** @returns {boolean} a sheet has been linked */
function isVaultSetUp() {
  return !!getLinkedSheetId();
}

/** @returns {boolean} keys are decrypted and in memory */
function isVaultUnlocked() {
  return _session !== null;
}

/** Lock — evict in-memory keys and encryption key. */
function lockVault() {
  const id = getLinkedSheetId();
  if (id) encryption.lock(id);
  _session = null;
  _lastUnlockedPassword = null;
}

/* ---------- Unlock ---------- */

/**
 * Read the linked passwords sheet and decrypt the Password column.
 * Classifies each row as a Gemini key or Claude key by Site/Category/Notes.
 * Returns true on success, false on wrong password or unreadable sheet.
 * @param {string} password — sheet unlock password (empty string if unencrypted)
 * @returns {Promise<boolean>}
 */
async function unlockVault(password) {
  const sheetId = getLinkedSheetId();
  if (!sheetId) return false;

  try {
    const sheet = await api.sheets.getSpreadsheet(sheetId);
    const headers = (sheet.values?.[0] || []).map(h => String(h).toLowerCase().trim());
    const rows    = (sheet.values || []).slice(1);

    /* Identify column indices (passwords template roles) */
    const siteCol     = headers.findIndex(h => /^(site|service|website|domain|app|account|platform)/.test(h));
    const usernameCol = headers.findIndex(h => /^(user.?name|login|email|user|id)/.test(h));
    const passwordCol = headers.findIndex(h => /^(password|passwd|secret|credential|pass)/.test(h));
    const categoryCol = headers.findIndex(h => /^(category|type|group|folder|tag)/.test(h));
    const notesCol    = headers.findIndex(h => /^(notes?|comment|detail|info|description)/.test(h));

    /* Check if column is encrypted and validate password */
    const encryptedSample = passwordCol >= 0
      ? rows.map(r => (r[passwordCol] || '')).find(v => encryption.isEncrypted(v))
      : undefined;
    const anyEncryptedCols = encryption.detectEncryptedColumns(sheet.values || []);

    if (encryptedSample || anyEncryptedCols.size > 0) {
      if (anyEncryptedCols.size > 0 && encryption.getEncryptedColumns(sheetId).size === 0) {
        encryption.setEncryptedColumns(sheetId, anyEncryptedCols);
      }
      if (!password) {
        if (!encryption.isUnlocked(sheetId)) return false;
      } else {
        const ok = await encryption.unlock(password, sheetId, encryptedSample);
        if (!ok) return false;
      }
    } else if (password) {
      await encryption.unlock(password, sheetId);
    }

    /* Read and classify rows */
    const geminiKeys = [];
    const claudeKeys = [];
    const openaiKeys = [];

    for (const row of rows) {
      const site      = siteCol     >= 0 ? String(row[siteCol]     || '') : '';
      const username  = usernameCol >= 0 ? String(row[usernameCol] || '') : '';
      const rawPw     = passwordCol >= 0 ? String(row[passwordCol] || '') : '';
      const category  = categoryCol >= 0 ? String(row[categoryCol] || '') : '';
      const notes     = notesCol    >= 0 ? String(row[notesCol]    || '') : '';

      if (!rawPw) continue;

      const decrypted = encryption.isEncrypted(rawPw)
        ? await encryption.decrypt(sheetId, rawPw)
        : rawPw;

      if (!decrypted) continue; // wrong key → skip silently

      const searchText = `${site} ${username} ${category} ${notes}`.toLowerCase();
      const entry = {
        key:           decrypted.trim(),
        nickname:      site || 'Sheet Key',
        addedAt:       new Date().toISOString(),
        requestsToday: 0,
        lastUsed:      null,
        lastError:     null,
        isBilled:      /billed|paid|pro/i.test(searchText),
      };

      if (/openai|gpt|dall.?e|gpt-image|platform\.openai/i.test(searchText)) {
        openaiKeys.push(entry);
      } else if (/gemini|google|aistudio|ai\.google/i.test(searchText)) {
        geminiKeys.push(entry);
      } else if (/claude|anthropic|sonnet|haiku|opus/i.test(searchText)) {
        claudeKeys.push(entry);
      }
    }

    _session = { geminiKeys, claudeKeys, openaiKeys };
    if (typeof password === 'string' && password.length > 0) {
      _lastUnlockedPassword = password;
    } else if (!_lastUnlockedPassword) {
      const cached = encryption.getUnlockedPassword(sheetId);
      if (cached) {
        _lastUnlockedPassword = cached;
      } else if (!encryptedSample && anyEncryptedCols.size === 0) {
        _lastUnlockedPassword = '';
      }
    }
    return true;
  } catch (err) {
    console.error('[keys-sheet] unlock failed:', err);
    return false;
  }
}

/* ---------- Key accessors ---------- */

/** @returns {Array} Gemini key entries (empty when locked) */
function getGeminiKeys() { return _session?.geminiKeys || []; }

/** @returns {Array} Claude key entries (empty when locked) */
function getClaudeKeys() { return _session?.claudeKeys || []; }

/** @returns {Array} OpenAI key entries (empty when locked) */
function getOpenAIKeys() { return _session?.openaiKeys || []; }

/* ---------- Write a new key into the linked sheet ---------- */

/**
 * Append a new API key row to the linked passwords sheet.
 * If the Password column is encrypted, the key will be stored encrypted.
 * Uses `api.sheets.appendRows` under the hood.
 *
 * @param {{ key: string, nickname: string, provider: 'gemini'|'claude', isBilled?: boolean }} keyEntry
 * @returns {Promise<boolean>} — true on success
 */
async function addKeyToSheet(keyEntry) {
  const sheetId = getLinkedSheetId();
  if (!sheetId || !_session) return false; // must be linked and unlocked

  try {
    const sheet = await api.sheets.getSpreadsheet(sheetId);
    const headers = (sheet.values?.[0] || []).map(h => String(h).toLowerCase().trim());

    const siteCol     = headers.findIndex(h => /^(site|service|website|domain|app|account|platform)/.test(h));
    const usernameCol = headers.findIndex(h => /^(user.?name|login|email|user|id)/.test(h));
    const passwordCol = headers.findIndex(h => /^(password|passwd|secret|credential|pass)/.test(h));
    const urlCol      = headers.findIndex(h => /^(url|link|address|href|web)/.test(h));
    const categoryCol = headers.findIndex(h => /^(category|type|group|folder|tag)/.test(h));
    const notesCol    = headers.findIndex(h => /^(notes?|comment|detail|info|description)/.test(h));

    const numCols = headers.length || 6;
    const row = Array(numCols).fill('');

    // Site name describes the provider
    const siteName = keyEntry.provider === 'claude'
      ? `Claude API Key${keyEntry.nickname ? ` (${keyEntry.nickname})` : ''}`
      : keyEntry.provider === 'openai'
        ? `OpenAI API Key${keyEntry.nickname ? ` (${keyEntry.nickname})` : ''}`
        : `Gemini API Key${keyEntry.nickname ? ` (${keyEntry.nickname})` : ''}`;

    if (siteCol >= 0) row[siteCol] = siteName;
    if (usernameCol >= 0) {
      row[usernameCol] = keyEntry.provider === 'claude' ? 'anthropic'
        : keyEntry.provider === 'openai' ? 'openai'
        : 'google';
    }

    // Encrypt the key value if the password column is encrypted on other rows
    const existingRows = (sheet.values || []).slice(1);
    const isColumnEncrypted = passwordCol >= 0
      && existingRows.some(r => encryption.isEncrypted(r[passwordCol] || ''));

    let keyValue = keyEntry.key;
    if (isColumnEncrypted && encryption.isUnlocked(sheetId)) {
      keyValue = await encryption.encrypt(sheetId, keyEntry.key);
    }
    if (passwordCol >= 0) row[passwordCol] = keyValue;

    if (urlCol >= 0) {
      row[urlCol] = keyEntry.provider === 'claude'
        ? 'https://console.anthropic.com'
        : keyEntry.provider === 'openai'
          ? 'https://platform.openai.com'
          : 'https://aistudio.google.com';
    }
    if (categoryCol >= 0) row[categoryCol] = 'AI';
    if (notesCol >= 0) row[notesCol] = keyEntry.isBilled ? 'Billed key' : '';

    const sheetTitle = sheet.sheetTitle || 'Sheet1';
    await api.sheets.appendRows(sheetId, sheetTitle, [row]);

    // Also update in-memory session
    const entry = {
      key:           keyEntry.key,
      nickname:      siteName,
      addedAt:       new Date().toISOString(),
      requestsToday: 0,
      lastUsed:      null,
      lastError:     null,
      isBilled:      !!keyEntry.isBilled,
    };
    if (keyEntry.provider === 'claude') {
      _session.claudeKeys.push(entry);
    } else if (keyEntry.provider === 'openai') {
      (_session.openaiKeys = _session.openaiKeys || []).push(entry);
    } else {
      _session.geminiKeys.push(entry);
    }
    return true;
  } catch (err) {
    console.error('[keys-sheet] addKeyToSheet failed:', err);
    return false;
  }
}


export {
  isMobileWeb,
  isBiometricSupported,
  hasKnownVaultPassword,
  hasBiometricVault,
  clearBiometricVault,
  enrollBiometricVault,
  unlockPasswordWithBiometrics,
  unlockVaultWithBiometrics,
  ensureVaultUnlocked,
  getLinkedSheetId,
  getLinkedSheetName,
  linkSheet,
  unlinkSheet,
  hydrateFromDrive,
  syncVaultLink,
  isVaultSetUp,
  isVaultUnlocked,
  lockVault,
  unlockVault,
  getGeminiKeys,
  getClaudeKeys,
  getOpenAIKeys,
  addKeyToSheet,
};
