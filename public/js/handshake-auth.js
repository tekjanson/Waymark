/* ============================================================
   handshake-auth.js — Reusable UI helper for session password
   protection on WebRTC handshakes in public sheets.

   Usage:
     import { buildHandshakePasswordRow } from '../handshake-auth.js';

     const { row, getPassword } = buildHandshakePasswordRow({
       onPasswordChange(pw) {
         if (_waymarkConnect) _waymarkConnect.setPassword(pw);
       },
     });
     container.append(row);

   The caller is responsible for passing the initial password to
   WaymarkConnect via opts.password. The onPasswordChange callback
   fires whenever the user changes the value.
   ============================================================ */

import { el } from './ui.js';

/**
 * Build a password input row for handshake session protection.
 *
 * @param {object} opts
 * @param {function} [opts.onPasswordChange] — called with the new password string when the user changes it
 * @param {string}   [opts.initialValue]     — initial password value (default: empty)
 * @param {string}   [opts.prefix]           — CSS class prefix (default: 'handshake')
 *
 * @returns {{ row: HTMLElement, getPassword: () => string }}
 */
export function buildHandshakePasswordRow({ onPasswordChange, initialValue = '', prefix = 'handshake' } = {}) {
  let _value = initialValue;

  const input = el('input', {
    type: 'password',
    className: `${prefix}-password-input`,
    placeholder: 'Session password (optional)',
    value: _value,
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const toggle = el('button', {
    type: 'button',
    className: `${prefix}-password-toggle`,
    title: 'Show / hide password',
    'aria-label': 'Toggle password visibility',
  }, ['👁']);

  toggle.addEventListener('click', () => {
    const next = input.type === 'password' ? 'text' : 'password';
    input.type = next;
    toggle.textContent = next === 'text' ? '🙈' : '👁';
  });

  input.addEventListener('change', () => {
    _value = input.value;
    onPasswordChange?.(_value || null);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      _value = input.value;
      onPasswordChange?.(_value || null);
      input.blur();
    }
  });

  const row = el('div', { className: `${prefix}-password-row` }, [
    el('span', { className: `${prefix}-password-label` }, ['🔐 Password']),
    input,
    toggle,
  ]);

  return {
    row,
    getPassword: () => _value || null,
  };
}
