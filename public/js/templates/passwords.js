/* ============================================================
   templates/passwords.js — Password Manager: encrypted vault
   with inline editing, category grouping, and search
   ============================================================ */

import { el, cell, editableCell, delegateEvent, registerTemplate } from './shared.js';

/* ---------- Encryption Utilities (AES-GCM-256 + PBKDF2) ---------- */

/**
 * Derive a key from master password using PBKDF2
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 100000 },
    passwordKey,
    256
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a value with AES-GCM-256
 * @param {string} plaintext
 * @param {string} masterPassword
 * @returns {Promise<{ciphertext: string, salt: string, nonce: string, algVersion: number}>}
 */
async function encryptValue(plaintext, masterPassword) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterPassword, salt);
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    encoder.encode(plaintext)
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    salt: btoa(String.fromCharCode(...salt)),
    nonce: btoa(String.fromCharCode(...nonce)),
    algVersion: 1,
  };
}

/**
 * Decrypt a value with AES-GCM-256
 * @param {string} ciphertext (base64)
 * @param {string} salt (base64)
 * @param {string} nonce (base64)
 * @param {string} masterPassword
 * @returns {Promise<string>}
 */
async function decryptValue(ciphertext, salt, nonce, masterPassword) {
  const saltBytes = new Uint8Array(atob(salt).split('').map(c => c.charCodeAt(0)));
  const nonceBytes = new Uint8Array(atob(nonce).split('').map(c => c.charCodeAt(0)));
  const ciphertextBytes = new Uint8Array(atob(ciphertext).split('').map(c => c.charCodeAt(0)));
  const key = await deriveKey(masterPassword, saltBytes);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonceBytes },
    key,
    ciphertextBytes
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Check if a value is encrypted
 * @param {string} val
 * @returns {boolean}
 */
function isEncrypted(val) {
  return val && typeof val === 'string' && val.startsWith('🔒ENC:');
}

/**
 * Parse encrypted format: 🔒ENC:ciphertext:salt:nonce:algVersion
 * @param {string} val
 * @returns {Object|null}
 */
function parseEncrypted(val) {
  if (!isEncrypted(val)) return null;
  const parts = val.replace('🔒ENC:', '').split(':');
  if (parts.length < 4) return null;
  return {
    ciphertext: parts[0],
    salt: parts[1],
    nonce: parts[2],
    algVersion: parseInt(parts[3], 10),
  };
}

/**
 * Format encrypted data as a single cell value
 * @param {Object} meta
 * @returns {string}
 */
function formatEncrypted(meta) {
  return `🔒ENC:${meta.ciphertext}:${meta.salt}:${meta.nonce}:${meta.algVersion}`;
}

/* ---------- Copy to clipboard helper ---------- */

function copyToClip(text, label) {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => {});
}

const definition = {
  name: 'Password Manager',
  icon: '🔑',
  color: '#7c3aed',
  priority: 22,
  itemNoun: 'Entry',
  defaultHeaders: ['Site', 'Username', 'Password', 'URL', 'Category', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(password|passwd|secret|credential)/.test(h))
      && lower.some(h => /^(site|service|website|domain|app|account|login|user.?name)/.test(h));
  },

  columns(lower) {
    const cols = { site: -1, username: -1, password: -1, url: -1, category: -1, notes: -1 };
    cols.site     = lower.findIndex(h => /^(site|service|website|domain|app|account|platform)/.test(h));
    cols.username = lower.findIndex((h, i) => /^(user.?name|login|email|user|id)/.test(h) && i !== cols.site);
    cols.password = lower.findIndex(h => /^(password|passwd|secret|credential|pass)/.test(h));
    cols.url      = lower.findIndex((h, i) => /^(url|link|address|href|web)/.test(h) && i !== cols.site && i !== cols.username);
    cols.category = lower.findIndex((h, i) => /^(category|type|group|folder|tag)/.test(h) && i !== cols.site);
    cols.notes    = lower.findIndex((h, i) => /^(notes?|comment|detail|info|description)/.test(h) && i !== cols.site && i !== cols.password);
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'site',     label: 'Site',     colIndex: cols.site,     type: 'text', placeholder: 'e.g. GitHub', required: true },
      { role: 'username', label: 'Username', colIndex: cols.username, type: 'text', placeholder: 'Username or email' },
      { role: 'password', label: 'Password', colIndex: cols.password, type: 'text', placeholder: 'Password' },
      { role: 'url',      label: 'URL',      colIndex: cols.url,      type: 'text', placeholder: 'https://...' },
      { role: 'category', label: 'Category', colIndex: cols.category, type: 'text', placeholder: 'e.g. Work, Personal' },
      { role: 'notes',    label: 'Notes',    colIndex: cols.notes,    type: 'text', placeholder: 'Optional notes' },
    ];
  },

  render(container, rows, cols) {
    /* ---------- Encryption state ---------- */
    let masterPassword = null;

    /* ---------- Master password modal ---------- */
    function showAuthModal() {
      return new Promise((resolve) => {
        const modal = el('div', { className: 'passwords-auth-modal' }, [
          el('div', { className: 'passwords-modal-overlay', on: { click: () => {
            modal.remove();
            resolve(null);
          }}}, null),
          el('div', { className: 'passwords-modal' }, [
            el('div', { className: 'passwords-modal-header' }, [
              el('h3', {}, ['🔐 Vault Authentication']),
              el('p', {}, ['Enter master password to decrypt encrypted entries']),
            ]),
            el('div', { className: 'passwords-modal-body' }, [
              el('input', {
                type: 'password',
                className: 'passwords-modal-input',
                placeholder: 'Master password',
                id: 'passwords-auth-input',
                autocomplete: 'current-password',
              }),
            ]),
            el('div', { className: 'passwords-modal-footer' }, [
              el('button', {
                className: 'passwords-btn passwords-btn-secondary',
                type: 'button',
                on: { click: () => {
                  modal.remove();
                  resolve(null);
                }},
              }, ['Cancel']),
              el('button', {
                className: 'passwords-btn passwords-btn-primary',
                type: 'button',
                on: { click: () => {
                  const pwd = document.getElementById('passwords-auth-input').value;
                  modal.remove();
                  resolve(pwd || null);
                }},
              }, ['Authenticate']),
            ]),
          ]),
        ]);
        container.appendChild(modal);
        const input = document.getElementById('passwords-auth-input');
        input?.focus();
        input?.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            const pwd = input.value;
            modal.remove();
            resolve(pwd || null);
          }
        });
      });
    }

    /* ---------- Group by category ---------- */
    const groups = new Map(); // category → [{row, rowIdx}]
    const uncategorized = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const cat = (cols.category >= 0 ? cell(row, cols.category) : '').trim() || '';
      const entry = { row, rowIdx: i + 1 };
      if (cat) {
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(entry);
      } else {
        uncategorized.push(entry);
      }
    }

    /* ---------- Search bar and unlock button ---------- */
    const searchInput = el('input', {
      className: 'passwords-search',
      type: 'text',
      placeholder: '🔍 Search passwords…',
    });

    const unlockBtn = el('button', {
      className: 'passwords-auth-btn',
      type: 'button',
      on: { click: async () => {
        const pwd = await showAuthModal();
        if (pwd) {
          masterPassword = pwd;
          unlockBtn.setAttribute('disabled', '');
          unlockBtn.textContent = '🔓 Unlocked';
        }
      }},
    }, ['🔒 Unlock']);

    const toolbar = el('div', { className: 'passwords-toolbar' }, [searchInput, unlockBtn]);
    container.append(toolbar);

    /* ---------- Stats bar ---------- */
    const total = rows.length;
    const encrypted = rows.filter(r => cols.password >= 0 && isEncrypted(cell(r, cols.password))).length;
    container.append(el('div', { className: 'passwords-stats' }, [
      el('span', {}, [`${total} ${total === 1 ? 'entry' : 'entries'}`]),
      encrypted > 0 ? el('span', { className: 'passwords-stats-hint' }, [
        `🔐 ${encrypted} encrypted • Unlock button decrypts entries`
      ]) : el('span', { className: 'passwords-stats-hint' }, [
        '🔐 Enable column encryption from the ⋮ menu to protect sensitive data'
      ]),
    ]));

    /* ---------- Vault grid ---------- */
    const grid = el('div', { className: 'passwords-grid' });
    container.append(grid);

    function renderAllGroups() {
      grid.innerHTML = '';
      const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, entries] of sortedGroups) {
        if (name) {
          grid.append(el('div', { className: 'passwords-category-header' }, [
            el('span', { className: 'passwords-category-name' }, [name]),
            el('span', { className: 'passwords-category-count' }, [`${entries.length}`]),
          ]));
        }
        for (const { row, rowIdx } of entries) {
          grid.append(buildCard(row, rowIdx, cols, masterPassword));
        }
      }
      if (uncategorized.length) {
        if (groups.size > 0) {
          grid.append(el('div', { className: 'passwords-category-header' }, [
            el('span', { className: 'passwords-category-name' }, ['Uncategorized']),
            el('span', { className: 'passwords-category-count' }, [`${uncategorized.length}`]),
          ]));
        }
        for (const { row, rowIdx } of uncategorized) {
          grid.append(buildCard(row, rowIdx, cols, masterPassword));
        }
      }
    }

    renderAllGroups();

    /* ---------- Search filter ---------- */
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const cards = grid.querySelectorAll('.passwords-card');
      const headers = grid.querySelectorAll('.passwords-category-header');

      for (const card of cards) {
        const text = card.textContent.toLowerCase();
        card.classList.toggle('hidden', q && !text.includes(q));
      }

      for (const header of headers) {
        let next = header.nextElementSibling;
        let anyVisible = false;
        while (next && !next.classList.contains('passwords-category-header')) {
          if (next.classList.contains('passwords-card') && !next.classList.contains('hidden')) {
            anyVisible = true;
          }
          next = next.nextElementSibling;
        }
        header.classList.toggle('hidden', q && !anyVisible);
      }
    });

    /* ---------- Delegated copy buttons ---------- */
    delegateEvent(grid, 'click', '.passwords-copy-btn', async (e, btn) => {
      const field = btn.dataset.field;
      const rIdx = Number(btn.dataset.rowIdx);
      const entry = rows[rIdx - 1];
      if (!entry) return;
      let val = '';
      if (field === 'username' && cols.username >= 0) val = cell(entry, cols.username);
      if (field === 'password' && cols.password >= 0) {
        val = cell(entry, cols.password);
        if (isEncrypted(val) && masterPassword) {
          try {
            const meta = parseEncrypted(val);
            val = await decryptValue(meta.ciphertext, meta.salt, meta.nonce, masterPassword);
          } catch (err) {
            val = '';
          }
        }
      }
      if (field === 'url' && cols.url >= 0) val = cell(entry, cols.url);
      if (val) {
        copyToClip(val, field);
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📋'; }, 1200);
      }
    });
  },
};

/**
 * Build a single password entry card.
 * @param {string[]} row
 * @param {number} rowIdx — 1-based
 * @param {Object} cols
 * @param {string|null} masterPassword
 * @returns {HTMLElement}
 */
function buildCard(row, rowIdx, cols, masterPassword) {
  const site     = cell(row, cols.site) || row[0] || '—';
  const username = cell(row, cols.username);
  const password = cell(row, cols.password);
  const url      = cell(row, cols.url);
  const notes    = cell(row, cols.notes);

  // Determine if password is encrypted
  const isEnc = isEncrypted(password);
  const maskedPw = isEnc ? '🔒 Encrypted' : (password ? '••••••••' : '—');

  const card = el('div', { className: 'passwords-card' }, [
    el('div', { className: 'passwords-card-header' }, [
      el('span', { className: 'passwords-card-icon' }, [site[0]?.toUpperCase() || '?']),
      el('div', { className: 'passwords-card-title-group' }, [
        editableCell('div', { className: 'passwords-card-site' }, site, rowIdx, cols.site),
        url ? el('a', {
          className: 'passwords-card-url',
          href: url.startsWith('http') ? url : `https://${url}`,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [url.replace(/^https?:\/\/(www\.)?/, '')]) : null,
      ]),
    ]),
    el('div', { className: 'passwords-card-fields' }, [
      cols.username >= 0 ? el('div', { className: 'passwords-field' }, [
        el('span', { className: 'passwords-field-label' }, ['Username']),
        el('div', { className: 'passwords-field-value-row' }, [
          editableCell('span', { className: 'passwords-field-value' }, username, rowIdx, cols.username),
          el('button', {
            className: 'passwords-copy-btn',
            type: 'button',
            dataset: { field: 'username', rowIdx: String(rowIdx) },
            title: 'Copy username',
          }, ['📋']),
        ]),
      ]) : null,
      cols.password >= 0 ? el('div', { className: 'passwords-field' }, [
        el('span', { className: 'passwords-field-label' }, ['Password']),
        el('div', { className: 'passwords-field-value-row' }, [
          isEnc
            ? el('span', { 
                className: 'passwords-field-value encrypted-cell',
                title: masterPassword ? 'Encrypted (unlocked)' : 'Encrypted (locked)'
              }, [masterPassword ? '🔓 Decrypted' : '🔒 Encrypted'])
            : editableCell('span', { className: 'passwords-field-value passwords-field-pw' }, password, rowIdx, cols.password),
          el('button', {
            className: 'passwords-copy-btn',
            type: 'button',
            dataset: { field: 'password', rowIdx: String(rowIdx) },
            title: 'Copy password',
          }, ['📋']),
        ]),
      ]) : null,
    ]),
    cols.notes >= 0 && notes ? editableCell('div', { className: 'passwords-card-notes' }, notes, rowIdx, cols.notes) : null,
  ]);

  return card;
}

registerTemplate('passwords', definition);

/**
 * Helper: Retrieve a decrypted AI key from vault rows.
 * Searches for a row with matching service name and decrypts the password field.
 * @param {string} service — e.g. 'claude', 'openai', 'ai-claude'
 * @param {string[][]} rows — all sheet rows (header excluded)
 * @param {Object} cols — column mapping from template.columns()
 * @param {string} masterPassword — master password for decryption
 * @returns {Promise<string|null>} — decrypted API key, or null if not found
 */
export async function getDecryptedKey(service, rows, cols, masterPassword) {
  if (!masterPassword || !service) return null;
  const lowerService = service.toLowerCase();
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const site = (cols.site >= 0 ? cell(row, cols.site) : '').toLowerCase() || '';
    if (site.includes(lowerService)) {
      const password = cols.password >= 0 ? cell(row, cols.password) : '';
      if (isEncrypted(password)) {
        try {
          const meta = parseEncrypted(password);
          const decrypted = await decryptValue(meta.ciphertext, meta.salt, meta.nonce, masterPassword);
          return decrypted;
        } catch (err) {
          return null;
        }
      }
      return password || null;
    }
  }
  return null;
}

export default definition;
