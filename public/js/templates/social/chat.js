/* ============================================================
   social/chat.js — Live P2P chat module for Social template
   Backed by the unified SocialChatWidget abstraction.
   ============================================================ */

import { SocialChatWidget } from '../../social-widget.js';

let _activeWidget = null;
let _activeSheetId = null;
let _socialPassword = '';

/** Set session password for encrypted WebRTC handshakes. */
export function setSocialPassword(pw) {
  _socialPassword = pw || '';
  if (_activeWidget) {
    _activeWidget.setPassword(_socialPassword);
  }
}

/** Clean up active connection and chat panel. */
export async function destroyChat() {
  if (_activeWidget) {
    await _activeWidget.saveChatHistory().catch(() => {});
    _activeWidget.destroy({ keepBlock: _activeWidget.session?.connect?._paused });
    _activeWidget = null;
  }
  _activeSheetId = null;
}

// When navigating away from a sheet, save history and pause connection
window.addEventListener('waymark:sheet-hidden', () => {
  if (_activeWidget) {
    _activeWidget.saveChatHistory().catch(() => {}).finally(() => {
      if (_activeWidget) {
        _activeWidget.destroy({ keepBlock: true });
        _activeWidget = null;
      }
    });
  }
});

/**
 * Build the floating chat panel and connect to peers.
 * @param {string} sheetId
 * @param {string} displayName
 * @param {Object} [signal] — Sheets signaling callbacks
 */
export function openChat(sheetId, displayName, signal) {
  // Don't double-open for the same sheet if panel is already active
  if (_activeWidget?.session?.connect && !_activeWidget.session.connect._destroyed && _activeSheetId === sheetId) {
    if (_activeWidget.root) {
      _activeWidget.root.classList.remove('hidden');
      return;
    }
  }

  destroyChat();
  _activeSheetId = sheetId;

  _activeWidget = new SocialChatWidget({
    mode: 'floating',
    sheetId,
    displayName,
    password: _socialPassword,
    signal,
    mountTo: document.body,
    showClose: true,
    showMinimize: true,
    showSheetLink: false,
    showConnectDrive: false,
    onClose: destroyChat,
  });
}
