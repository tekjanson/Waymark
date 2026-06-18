/* ============================================================
   templates/aivault.js — AI Secrets Vault: encrypted API keys
   with client-side AES-GCM-256 encryption, category grouping
   ============================================================ */

import { el, cell, editableCell, delegateEvent, registerTemplate } from './shared.js';

/* ---------- Encryption utilities ---------- */

/**
 * Derive a key from a master password using PBKDF2.
 * @param {string} password — master password
 * @param {Uint8Array} salt — 16 bytes
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 100000 },
    passwordKey,
    256
  );
  return window.crypto.subtle.importKey('raw', derivedBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a plaintext API key.
 * @param {string} plaintext — the API key
 * @param {string} masterPassword — master password
 * @returns {Promise<{ciphertext: string, salt: string, nonce: string, algVersion: string}>}
 */
async function encryptKey(plaintext, masterPassword) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(masterPassword, salt);
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    data
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    salt: btoa(String.fromCharCode(...salt)),
    nonce: btoa(String.fromCharCode(...nonce)),
    algVersion: 'AES-GCM-256-v1'
  };
}

/**
 * Decrypt a ciphertext API key.
 * @param {string} ciphertext — base64 ciphertext
 * @param {string} salt — base64 salt
 * @param {string} nonce — base64 nonce
 * @param {string} masterPassword — master password
 * @returns {Promise<string>} — decrypted plaintext
 */
async function decryptKey(ciphertext, salt, nonce, masterPassword) {
  const saltBytes = new Uint8Array(atob(salt).split('').map(c => c.charCodeAt(0)));
  const nonceBytes = new Uint8Array(atob(nonce).split('').map(c => c.charCodeAt(0)));
  const ciphertextBytes = new Uint8Array(atob(ciphertext).split('').map(c => c.charCodeAt(0)));
  const key = await deriveKey(masterPassword, saltBytes);
  try {
    const plaintext = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonceBytes },
      key,
      ciphertextBytes
    );
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    throw new Error('Decryption failed: incorrect password or corrupted data');
  }
}

/**
 * Check if a cell value is encrypted (starts with marker).
 * @param {string} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  return value && value.startsWith('🔒ENC:');
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'AI Secrets Vault',
  icon: '🔐',
  color: '#d946ef',
  priority: 24,
  itemNoun: 'Key',
  defaultHeaders: ['Service', 'Key Name', 'Ciphertext', 'Salt', 'Nonce', 'AlgVersion', 'Category', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(ciphertext|encrypted|cryptotext)/.test(h))
      && lower.some(h => /^(salt|key.?derivation)/.test(h))
      && lower.some(h => /^(nonce|iv|initialization)/.test(h))
      && lower.some(h => /^(service|provider|platform|ai)/.test(h));
  },

  columns(lower) {
    const cols = {
      service: -1,
      keyName: -1,
      ciphertext: -1,
      salt: -1,
      nonce: -1,
      algVersion: -1,
      category: -1,
      notes: -1
    };
    cols.service = lower.findIndex(h => /^(service|provider|platform|ai|vendor)/.test(h));
    cols.keyName = lower.findIndex((h, i) => /^(key.?name|name|description|key.?id|label)/.test(h) && i !== cols.service);
    cols.ciphertext = lower.findIndex(h => /^(ciphertext|encrypted|cryptotext|cipher)/.test(h));
    cols.salt = lower.findIndex(h => /^(salt|key.?derivation|kdf.?salt)/.test(h));
    cols.nonce = lower.findIndex(h => /^(nonce|iv|initialization)/.test(h));
    cols.algVersion = lower.findIndex(h => /^(alg.?version|algorithm|algo|version)/.test(h));
    cols.category = lower.findIndex((h, i) => /^(category|type|group|folder|tag)/.test(h) && i !== cols.service);
    cols.notes = lower.findIndex((h, i) => /^(notes?|comment|detail|info|description)/.test(h) && i !== cols.keyName);
    return cols;
  },

  render(container, rows, cols) {
    /* ---------- State: master password ---------- */
    let masterPassword = '';
    const isAuthenticated = { value: false };

    /* ---------- Auth modal ---------- */
    const authModal = el('div', { className: 'aivault-auth-modal hidden', id: 'aivault-auth-modal' }, [
      el('div', { className: 'modal-overlay' }, [
        el('div', { className: 'modal' }, [
          el('div', { className: 'modal-header' }, [
            el('h2', {}, ['🔑 Vault Authentication'])
          ]),
          el('div', { className: 'modal-body' }, [
            el('p', {}, ['Enter your master password to decrypt API keys.']),
            el('input', {
              id: 'aivault-password-input',
              type: 'password',
              className: 'aivault-password-input',
              placeholder: 'Master password',
              autocomplete: 'off'
            })
          ]),
          el('div', { className: 'modal-footer' }, [
            el('button', {
              className: 'btn btn-primary',
              id: 'aivault-auth-btn',
              onclick: () => {
                const input = document.getElementById('aivault-password-input');
                masterPassword = input.value;
                isAuthenticated.value = true;
                authModal.classList.add('hidden');
                renderVault();
              }
            }, ['Unlock Vault']),
            el('button', {
              className: 'btn btn-secondary',
              onclick: () => {
                authModal.classList.add('hidden');
              }
            }, ['Cancel'])
          ])
        ])
      ])
    ]);
    container.append(authModal);

    /* ---------- Main vault container ---------- */
    const vaultContainer = el('div', { className: 'aivault-container' });
    container.append(vaultContainer);

    function renderVault() {
      vaultContainer.innerHTML = '';

      /* ---------- Header with unlock button ---------- */
      const header = el('div', { className: 'aivault-header' }, [
        el('h2', {}, ['🔐 AI Secrets Vault']),
        el('button', {
          className: 'aivault-reauth-btn',
          onclick: () => {
            masterPassword = '';
            isAuthenticated.value = false;
            document.getElementById('aivault-password-input').value = '';
            authModal.classList.remove('hidden');
            vaultContainer.innerHTML = '';
          }
        }, ['🔓 Change Password'])
      ]);
      vaultContainer.append(header);

      /* ---------- Group by category ---------- */
      const groups = new Map();
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

      /* ---------- Search bar ---------- */
      const searchInput = el('input', {
        className: 'aivault-search',
        type: 'text',
        placeholder: '🔍 Search keys…'
      });
      vaultContainer.append(el('div', { className: 'aivault-toolbar' }, [searchInput]));

      /* ---------- Stats ---------- */
      vaultContainer.append(el('div', { className: 'aivault-stats' }, [
        el('span', {}, [`${rows.length} ${rows.length === 1 ? 'key' : 'keys'} stored`])
      ]));

      /* ---------- Grid ---------- */
      const grid = el('div', { className: 'aivault-grid' });
      vaultContainer.append(grid);

      function renderGroup(name, entries) {
        if (name) {
          grid.append(el('div', { className: 'aivault-category-header' }, [
            el('span', { className: 'aivault-category-name' }, [name]),
            el('span', { className: 'aivault-category-count' }, [`${entries.length}`])
          ]));
        }
        for (const { row, rowIdx } of entries) {
          grid.append(buildKeyCard(row, rowIdx, cols, masterPassword, isAuthenticated.value));
        }
      }

      const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [name, entries] of sortedGroups) {
        renderGroup(name, entries);
      }
      if (uncategorized.length) {
        renderGroup(groups.size > 0 ? 'Uncategorized' : '', uncategorized);
      }

      /* ---------- Search filter ---------- */
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const cards = grid.querySelectorAll('.aivault-card');
        const headers = grid.querySelectorAll('.aivault-category-header');

        for (const card of cards) {
          const text = card.textContent.toLowerCase();
          card.classList.toggle('hidden', q && !text.includes(q));
        }

        for (const header of headers) {
          let next = header.nextElementSibling;
          let anyVisible = false;
          while (next && !next.classList.contains('aivault-category-header')) {
            if (next.classList.contains('aivault-card') && !next.classList.contains('hidden')) {
              anyVisible = true;
            }
            next = next.nextElementSibling;
          }
          header.classList.toggle('hidden', q && !anyVisible);
        }
      });

      /* ---------- Delegated actions ---------- */
      delegateEvent(grid, 'click', '.aivault-decrypt-btn', async (e, btn) => {
        const rIdx = Number(btn.dataset.rowIdx);
        const entry = rows[rIdx - 1];
        if (!entry) return;

        const ciphertext = cell(entry, cols.ciphertext);
        const salt = cell(entry, cols.salt);
        const nonce = cell(entry, cols.nonce);

        try {
          const plaintext = await decryptKey(ciphertext, salt, nonce, masterPassword);
          navigator.clipboard.writeText(plaintext).catch(() => {});
          btn.textContent = '✓ Copied';
          setTimeout(() => { btn.textContent = '📋'; }, 1200);
        } catch (err) {
          btn.textContent = '❌';
          setTimeout(() => { btn.textContent = '📋'; }, 2000);
        }
      });

      delegateEvent(grid, 'click', '.aivault-view-btn', async (e, btn) => {
        const rIdx = Number(btn.dataset.rowIdx);
        const entry = rows[rIdx - 1];
        if (!entry) return;

        const ciphertext = cell(entry, cols.ciphertext);
        const salt = cell(entry, cols.salt);
        const nonce = cell(entry, cols.nonce);

        try {
          const plaintext = await decryptKey(ciphertext, salt, nonce, masterPassword);
          const valueSpan = btn.parentElement.querySelector('.aivault-field-value');
          if (valueSpan.textContent === '••••••••') {
            valueSpan.textContent = plaintext;
            btn.textContent = '👁️‍🗨️ Hide';
          } else {
            valueSpan.textContent = '••••••••';
            btn.textContent = '👁️ View';
          }
        } catch (err) {
          btn.textContent = '❌';
          setTimeout(() => { btn.textContent = '👁️ View'; }, 2000);
        }
      });
    }

    // Show auth modal on load
    authModal.classList.remove('hidden');
  }
};

/**
 * Build a single key card.
 * @param {string[]} row
 * @param {number} rowIdx — 1-based
 * @param {Object} cols
 * @param {string} masterPassword
 * @param {boolean} isAuthenticated
 * @returns {HTMLElement}
 */
function buildKeyCard(row, rowIdx, cols, masterPassword, isAuthenticated) {
  const service = cell(row, cols.service) || row[0] || '—';
  const keyName = cell(row, cols.keyName) || '—';
  const ciphertext = cell(row, cols.ciphertext) || '';
  const salt = cell(row, cols.salt) || '';
  const nonce = cell(row, cols.nonce) || '';
  const notes = cell(row, cols.notes) || '';

  const card = el('div', { className: 'aivault-card' }, [
    el('div', { className: 'aivault-card-header' }, [
      el('span', { className: 'aivault-card-icon' }, [service[0]?.toUpperCase() || '?']),
      el('div', { className: 'aivault-card-title-group' }, [
        el('div', { className: 'aivault-card-service' }, [service]),
        el('div', { className: 'aivault-card-keyname' }, [keyName])
      ])
    ]),
    el('div', { className: 'aivault-card-fields' }, [
      el('div', { className: 'aivault-field' }, [
        el('span', { className: 'aivault-field-label' }, ['Key']),
        el('div', { className: 'aivault-field-value-row' }, [
          el('span', { className: 'aivault-field-value' }, ['••••••••']),
          el('button', {
            className: 'aivault-view-btn',
            type: 'button',
            dataset: { rowIdx: String(rowIdx) },
            title: 'View or hide key'
          }, ['👁️ View']),
          el('button', {
            className: 'aivault-decrypt-btn',
            type: 'button',
            dataset: { rowIdx: String(rowIdx) },
            title: 'Copy to clipboard'
          }, ['📋'])
        ])
      ])
    ]),
    notes ? el('div', { className: 'aivault-card-notes' }, [notes]) : null
  ]);

  return card;
}

registerTemplate('aivault', definition);
export default definition;
