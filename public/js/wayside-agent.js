/* ============================================================
   wayside-agent.js — Waymark AI Agent threads, shared agent
   host switching, and Browser-to-Agent P2P OAuth tunnel modal.
   ============================================================ */

import { el, showToast, copyToClipboard } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as collab from './collab.js';
import { detectTemplate } from './templates/index.js';

function deriveAgentThreadTitle(text) {
  const clean = String(text || '')
    .replace(/@[a-z0-9_-]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'New Conversation';
  return clean.length > 34 ? `${clean.slice(0, 31).trim()}…` : clean;
}

function buildAgentThreadList(chatRows = [], activeThreadId = 'default', {
  pendingThreads = new Map(),
  activeThreadTitle = '',
} = {}) {
  const byThread = new Map();
  for (const m of chatRows) {
    const tId = String(m.threadId || 'default').trim() || 'default';
    let entry = byThread.get(tId);
    if (!entry) {
      entry = {
        id: tId,
        title: m.threadTitle || '',
        count: 0,
        lastTs: m.ts || '',
      };
      byThread.set(tId, entry);
    }
    if (m.threadTitle && !entry.title) entry.title = m.threadTitle;
    if (!entry.title && m.sender && m.sender.toLowerCase() !== 'assistant@waymark.internal') {
      entry.title = deriveAgentThreadTitle(m.text);
    }
    entry.count += 1;
    if (m.ts && (!entry.lastTs || m.ts > entry.lastTs)) {
      entry.lastTs = m.ts;
    }
  }

  for (const [pendingId, pendingMeta] of pendingThreads.entries()) {
    if (!byThread.has(pendingId)) {
      byThread.set(pendingId, {
        id: pendingId,
        title: pendingMeta.title || 'New Conversation',
        count: 0,
        lastTs: pendingMeta.createdAt || new Date().toISOString(),
      });
    }
  }

  if (!byThread.has('default')) {
    byThread.set('default', {
      id: 'default',
      title: 'General Conversation',
      count: 0,
      lastTs: '',
    });
  }

  if (activeThreadId && !byThread.has(activeThreadId)) {
    byThread.set(activeThreadId, {
      id: activeThreadId,
      title: activeThreadTitle || 'New Conversation',
      count: 0,
      lastTs: new Date().toISOString(),
    });
  }

  const list = [...byThread.values()].map(t => {
    const title = t.title || (t.id === 'default' ? 'General Conversation' : 'Conversation');
    return {
      ...t,
      title,
      label: `💬 ${title} (${t.count})`,
    };
  });

  list.sort((a, b) => {
    if (a.id === activeThreadId && a.count === 0) return -1;
    if (b.id === activeThreadId && b.count === 0) return 1;
    return String(b.lastTs || '').localeCompare(String(a.lastTs || ''));
  });

  return list;
}

async function ensurePrivateGuestAgentLedger(guestEmail) {
  const normalizedGuest = String(guestEmail || '').trim().toLowerCase();
  const pairEmails = ['assistant@waymark.internal', normalizedGuest].sort();
  const fileName = `.waymark-ledger-contact-pair-${pairEmails.join('--')}`;
  try {
    const existing = await api.drive.findFilesGlobal(fileName);
    if (Array.isArray(existing) && existing[0]?.id) {
      return existing[0].id;
    }
  } catch {
    /* fallback to creating the spreadsheet */
  }
  const sharedDocsHeaders = [
    'Document_ID', 'Document_Title', 'Waymark_Type', 'Shared_With_Email',
    'Group', 'Permission_Level', 'Shared_Timestamp', 'Status',
  ];
  const presenceHeaders = ['User_Email', 'Display_Name', 'Group', 'Online_Status', 'Last_Heartbeat_UTC', 'Active_Waymark_ID'];
  const chatHeaders = ['Message_ID', 'Timestamp_UTC', 'Sender_Email', 'Target_Group_Or_Contact', 'Message_Text', 'Attached_Waymark_Link'];
  const signalingHeaders = ['Session_ID', 'Caller_Email', 'Callee_Email', 'SDP_Offer_Answer_JSON', 'ICE_Candidates_JSON', 'Call_Status'];
  const created = await api.sheets.createSpreadsheet(fileName, [sharedDocsHeaders], null);
  const sheetId = created.spreadsheetId || created.id;
  await api.sheets.writeTab(sheetId, 'Shared_Docs', [sharedDocsHeaders]);
  await api.sheets.writeTab(sheetId, 'Presence', [presenceHeaders]);
  await api.sheets.writeTab(sheetId, 'Chat', [chatHeaders]);
  await api.sheets.writeTab(sheetId, 'WebRTC_Signaling', [signalingHeaders]);
  return sheetId;
}

function getAgentLedgerEntry() {
  const ledgers = userData.getShareLedgers?.() || [];
  return ledgers.find(l => l.contactEmail === 'assistant@waymark.internal') || null;
}

function formatWaysideSubtitle(isAgentTarget, sheetId, ledgerOverride = null) {
  if (!sheetId) return 'Linked on first share';
  if (!isAgentTarget) return `Linked: ${sheetId}`;
  const entry = ledgerOverride || getAgentLedgerEntry();
  const me = collab.currentEmail();
  if (entry?.preferred && entry?.ownerEmail && entry.ownerEmail !== me) {
    return `🤝 Shared Agent (${entry.ownerEmail}) · ${sheetId}`;
  }
  if (entry?.preferred && entry?.label) {
    const cleanLabel = entry.label.replace(/^🤝\s*/, '');
    return `🤝 ${cleanLabel} · ${sheetId}`;
  }
  return `🏠 Personal Agent · ${sheetId}`;
}

function syncSettingsAgentLabel() {
  const agentHostLabel = document.getElementById('settings-agent-host-label');
  if (!agentHostLabel) return;
  const entry = getAgentLedgerEntry();
  const me = collab.currentEmail();
  if (entry?.preferred && entry?.ownerEmail && entry.ownerEmail !== me) {
    agentHostLabel.textContent = entry.label || `Shared Agent (${entry.ownerEmail})`;
  } else if (entry?.preferred && entry?.label) {
    agentHostLabel.textContent = entry.label;
  } else if (entry?.label) {
    agentHostLabel.textContent = entry.label;
  } else {
    agentHostLabel.textContent = `Personal Agent (${me || 'My Account'})`;
  }
}

function parseSheetIdFromInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const ledgerParam = text.match(/[?&]ledger=([a-zA-Z0-9_-]+)/);
  if (ledgerParam?.[1]) return ledgerParam[1];
  const docsMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch?.[1]) return docsMatch[1];
  const hashMatch = text.match(/#\/sheet\/([a-zA-Z0-9_-]+)/);
  if (hashMatch?.[1]) return hashMatch[1];
  return text;
}

async function switchActiveAgentLedger(sheetId, host, { preferred = false, ownerEmail = '', label = '' } = {}, ctx = {}) {
  const me = collab.currentEmail();
  const pairKey = `contact-pair:${['assistant@waymark.internal', me].filter(Boolean).sort().join('::')}`;
  const existing = getAgentLedgerEntry();
  const knownList = Array.isArray(existing?.knownAgentLedgers) ? [...existing.knownAgentLedgers] : [];
  const resolvedOwner = preferred
    ? (ownerEmail && ownerEmail !== me
      ? ownerEmail
      : (existing?.ownerEmail && existing.ownerEmail !== me ? existing.ownerEmail : ''))
    : me;
  const resolvedLabel = label || (preferred
    ? (resolvedOwner ? `Shared Agent (${resolvedOwner})` : `Shared Agent (${sheetId})`)
    : `Personal Agent (${me || 'My Account'})`);

  if (preferred && sheetId) {
    const existingIdx = knownList.findIndex(k => k.sheetId === sheetId);
    const knownItem = {
      sheetId,
      ownerEmail: resolvedOwner,
      label: resolvedLabel,
      mode: 'shared',
    };
    if (existingIdx >= 0) {
      knownList[existingIdx] = { ...knownList[existingIdx], ...knownItem };
    } else {
      knownList.push(knownItem);
    }
  }

  await userData.addShareLedger({
    key: pairKey,
    sheetId,
    contactEmail: 'assistant@waymark.internal',
    ownerEmail: resolvedOwner,
    preferred,
    label: resolvedLabel,
    knownAgentLedgers: knownList,
    aliases: existing?.aliases || [],
  });

  if (ctx.setActiveLedgerId) ctx.setActiveLedgerId(sheetId);
  if (ctx.setCachedTargetLedger) {
    ctx.setCachedTargetLedger('contact:assistant@waymark.internal', getAgentLedgerEntry() || { sheetId });
  }
  if (ctx.clearRefreshKey) ctx.clearRefreshKey();

  const widget = ctx.getWidget ? ctx.getWidget() : null;
  if (widget) {
    widget.clearMessages();
    widget.setSignaling(sheetId, collab.createLedgerSignal(sheetId));
    widget.setSubtitle(formatWaysideSubtitle(true, sheetId, getAgentLedgerEntry()));
    if (ctx.applyCachedSnapshot) {
      ctx.applyCachedSnapshot(sheetId);
    }
  }
  syncSettingsAgentLabel();
  if (host && ctx.refreshSocial) {
    await ctx.refreshSocial().catch(() => {});
  }
}

async function openShareAgentModal(host, ctx = {}) {
  let sheetId = ctx.getActiveLedgerId ? ctx.getActiveLedgerId() : '';
  const activeTarget = ctx.getActiveTarget ? ctx.getActiveTarget() : null;
  if (!sheetId) {
    try {
      const ensured = await collab.ensureShareLedger(activeTarget || {
        contactEmail: 'assistant@waymark.internal',
        label: 'Waymark AI',
      });
      sheetId = ensured?.sheetId || '';
      if (sheetId) {
        if (ctx.setActiveLedgerId) ctx.setActiveLedgerId(sheetId);
        const widget = ctx.getWidget ? ctx.getWidget() : null;
        if (widget) {
          widget.setSignaling(sheetId, collab.createLedgerSignal(sheetId));
          widget.setSubtitle(formatWaysideSubtitle(true, sheetId, ensured));
        }
      }
    } catch (err) {
      showToast(`Could not prepare AI ledger: ${err.message}`, 'error');
      return;
    }
  }

  const existingModal = document.getElementById('wayside-share-agent-modal');
  if (existingModal) existingModal.remove();

  const me = collab.currentEmail();
  const agentEntry = getAgentLedgerEntry();
  const knownShared = Array.isArray(agentEntry?.knownAgentLedgers)
    ? [...agentEntry.knownAgentLedgers]
    : [];
  if (agentEntry?.preferred && agentEntry?.sheetId && !knownShared.some(k => k.sheetId === agentEntry.sheetId)) {
    knownShared.push({
      sheetId: agentEntry.sheetId,
      ownerEmail: agentEntry.ownerEmail || '',
      label: agentEntry.label || `Shared Agent (${agentEntry.ownerEmail || agentEntry.sheetId})`,
      mode: 'shared',
    });
  }

  const hostOptions = [
    el('option', { value: 'personal' }, [`🏠 My Personal Agent (${me || 'My Account'})`]),
    ...knownShared.map(item =>
      el('option', { value: item.sheetId }, [
        `🤝 ${item.label || (item.ownerEmail ? `Shared Agent (${item.ownerEmail})` : `Shared Agent (${item.sheetId})`)}`,
      ])
    ),
  ];

  const hostSelect = el('select', {
    id: 'wayside-agent-host-select',
    className: 'input',
    on: {
      change: async () => {
        const val = hostSelect.value;
        if (val === 'personal') {
          try {
            const personalSheetId = await ensurePrivateGuestAgentLedger(me || 'user@example.com');
            await switchActiveAgentLedger(personalSheetId, host, {
              preferred: false,
              ownerEmail: me,
              label: `Personal Agent (${me || 'My Account'})`,
            }, ctx);
            showToast('Switched to your Personal Waymark AI Agent', 'success');
            await openShareAgentModal(host, ctx);
          } catch (err) {
            showToast(`Could not switch to personal agent: ${err.message}`, 'error');
          }
        } else {
          try {
            const reg = await collab.registerSharedLedger({
              sheetId: val,
              contactEmail: 'assistant@waymark.internal',
              preferred: true,
              isShared: true,
            });
            await switchActiveAgentLedger(val, host, {
              preferred: true,
              ownerEmail: reg?.ownerEmail || '',
              label: reg?.label || '',
            }, ctx);
            showToast(`Switched to ${reg?.label || 'Shared Waymark AI Agent'}`, 'success');
            await openShareAgentModal(host, ctx);
          } catch (err) {
            showToast(`Could not switch agent: ${err.message}`, 'error');
          }
        }
      },
    },
  }, hostOptions);
  hostSelect.value = (agentEntry?.preferred && agentEntry?.sheetId) ? agentEntry.sheetId : 'personal';

  const connectInput = el('input', {
    id: 'wayside-connect-agent-input',
    type: 'text',
    className: 'input',
    placeholder: 'Paste shared agent invite link or Sheet ID…',
  });

  const connectBtn = el('button', {
    id: 'wayside-connect-agent-btn',
    type: 'button',
    className: 'btn btn-secondary',
    on: {
      click: async () => {
        const targetSheetId = parseSheetIdFromInput(connectInput.value);
        if (!targetSheetId) {
          showToast('Paste a valid shared agent invite link or Google Sheet ID', 'error');
          return;
        }
        connectBtn.disabled = true;
        try {
          const reg = await collab.registerSharedLedger({
            sheetId: targetSheetId,
            contactEmail: 'assistant@waymark.internal',
            preferred: true,
            isShared: true,
          });
          await switchActiveAgentLedger(targetSheetId, host, {
            preferred: true,
            ownerEmail: reg?.ownerEmail || '',
            label: reg?.label || `Shared Agent (${reg?.ownerEmail || targetSheetId})`,
          }, ctx);
          showToast(`Connected to ${reg?.label || 'Shared Waymark AI Agent'}!`, 'success');
          await openShareAgentModal(host, ctx);
        } catch (err) {
          showToast(`Could not connect shared agent: ${err.message}`, 'error');
        } finally {
          connectBtn.disabled = false;
        }
      },
    },
  }, ['🔗 Connect Agent']);

  const pickSharedBtn = el('button', {
    id: 'wayside-pick-shared-agent-btn',
    type: 'button',
    className: 'btn btn-secondary',
    on: {
      click: async () => {
        try {
          const connected = await collab.connectSharedLedgerViaPicker({
            contactEmail: 'assistant@waymark.internal',
            label: 'Waymark AI',
          });
          const picked = connected?.[0];
          if (!picked?.sheetId) return;
          await switchActiveAgentLedger(picked.sheetId, host, {
            preferred: true,
            ownerEmail: picked.ownerEmail || '',
            label: picked.label || `Shared Agent (${picked.ownerEmail || picked.sheetId})`,
          }, ctx);
          showToast(`Connected to ${picked.label || 'Shared Waymark AI Agent'}!`, 'success');
          await openShareAgentModal(host, ctx);
        } catch (err) {
          showToast(`Could not browse shared agent: ${err.message}`, 'error');
        }
      },
    },
  }, ['📂 Browse Drive']);

  const oauthTokenInput = el('input', {
    id: 'wayside-oauth-token-input',
    type: 'password',
    className: 'input',
    placeholder: 'Optional: paste custom OAuth JSON (leave blank to push active browser session)',
  });

  const oauthStatusEl = el('div', {
    id: 'wayside-oauth-tunnel-status',
    className: 'wayside-oauth-tunnel-status',
  }, [
    'P2P Tunnel Ready — push your active Waymark OAuth credentials directly to the connected agent daemon.',
  ]);

  let ackHandler = null;
  const cleanupAckListener = () => {
    if (ackHandler) {
      document.removeEventListener('waymark:agent-oauth-ack', ackHandler);
      ackHandler = null;
    }
  };

  const pushOauthBtn = el('button', {
    id: 'wayside-push-oauth-btn',
    type: 'button',
    className: 'btn btn-primary',
    on: {
      click: async () => {
        pushOauthBtn.disabled = true;
        cleanupAckListener();
        try {
          let tokenBundle = null;
          const customRaw = String(oauthTokenInput.value || '').trim();
          if (customRaw) {
            try {
              tokenBundle = JSON.parse(customRaw);
            } catch {
              tokenBundle = { access_token: customRaw, token_type: 'Bearer' };
            }
          } else {
            tokenBundle = await api.auth.getAgentTokenBundle();
          }
          if (!tokenBundle || (!tokenBundle.access_token && !tokenBundle.refresh_token)) {
            throw new Error('No OAuth token available to push');
          }

          const requestId = `oauth-${Date.now().toString(36)}`;
          ackHandler = (e) => {
            const detail = e.detail || {};
            if (detail.requestId && detail.requestId !== requestId) return;
            cleanupAckListener();
            if (detail.ok) {
              oauthStatusEl.className = 'wayside-oauth-tunnel-status is-success';
              oauthStatusEl.textContent = `✓ Agent acknowledged OAuth credentials over P2P tunnel (${detail.hasRefreshToken ? 'with refresh_token' : 'access_token active'}).`;
              showToast('Agent OAuth credentials updated via P2P tunnel!', 'success');
            } else {
              oauthStatusEl.className = 'wayside-oauth-tunnel-status is-error';
              oauthStatusEl.textContent = `✕ Agent rejected OAuth credentials: ${detail.error || 'Unknown error'}`;
              showToast(`Agent rejected OAuth update: ${detail.error || 'Unknown error'}`, 'error');
            }
          };
          document.addEventListener('waymark:agent-oauth-ack', ackHandler);

          const widget = ctx.getWidget ? ctx.getWidget() : null;
          if (widget?.session) {
            if (!widget.session.sheetId && sheetId) {
              widget.setSignaling(sheetId, collab.createLedgerSignal(sheetId));
            }
            widget.session.send('', 'agent-oauth-setup', {
              requestId,
              sender: me,
              tokenBundle,
            });
          }

          if (sheetId) {
            await api.sheets.appendRows(sheetId, collab.CHAT_TAB, [[
              requestId,
              new Date().toISOString(),
              me || '',
              '__agent_oauth_setup__',
              JSON.stringify({ requestId, sender: me || '', tokenBundle }),
              '',
            ]]).catch(() => {});
          }

          oauthStatusEl.className = 'wayside-oauth-tunnel-status is-success';
          oauthStatusEl.textContent = `🔑 Pushed OAuth token bundle (${tokenBundle.refresh_token ? 'access + refresh token' : 'access token'}) through encrypted P2P tunnel.`;
          showToast('OAuth token bundle pushed over P2P tunnel', 'info');
        } catch (err) {
          oauthStatusEl.className = 'wayside-oauth-tunnel-status is-error';
          oauthStatusEl.textContent = `✕ Could not push OAuth token: ${err.message}`;
          showToast(`Could not push OAuth token: ${err.message}`, 'error');
        } finally {
          pushOauthBtn.disabled = false;
        }
      },
    },
  }, ['🔑 Push OAuth Token via P2P Tunnel']);

  const defaultInviteLink = sheetId
    ? api.drive.generateShareLink('', '', undefined, {
        ledger: sheetId,
        from: 'assistant@waymark.internal',
      })
    : '';

  const modeSelect = el('select', {
    id: 'wayside-share-agent-mode',
    className: 'input',
  }, [
    el('option', { value: 'shared' }, ['Shared Household AI Chat — same chat & files']),
    el('option', { value: 'private' }, ['Dedicated 1-on-1 AI Chat — private ledger']),
  ]);

  const emailInput = el('input', {
    id: 'wayside-share-agent-email',
    type: 'email',
    className: 'input',
    placeholder: 'collaborator@gmail.com',
  });

  const linkInput = el('input', {
    id: 'wayside-share-agent-link',
    type: 'text',
    className: 'input',
    readOnly: true,
    value: defaultInviteLink,
  });

  const copyBtn = el('button', {
    id: 'wayside-share-agent-copy-btn',
    type: 'button',
    className: 'btn btn-secondary',
    on: {
      click: async () => {
        if (!linkInput.value) return;
        await copyToClipboard(linkInput.value);
      },
    },
  }, ['📋 Copy Link']);

  const grantBtn = el('button', {
    id: 'wayside-share-agent-grant-btn',
    type: 'button',
    className: 'btn btn-primary',
    on: {
      click: async () => {
        const email = String(emailInput.value || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          showToast('Enter a valid Google email address to share with', 'error');
          return;
        }
        grantBtn.disabled = true;
        try {
          let targetLedgerId = sheetId;
          if (modeSelect.value === 'private') {
            targetLedgerId = await ensurePrivateGuestAgentLedger(email);
          }
          await api.drive.createDrivePermission(targetLedgerId, email, 'writer');
          const inviteLink = api.drive.generateShareLink('', '', undefined, {
            ledger: targetLedgerId,
            from: 'assistant@waymark.internal',
          });
          linkInput.value = inviteLink;
          await copyToClipboard(inviteLink);
          showToast(`Shared Waymark AI with ${email} — invite link copied!`, 'success');
          if (host && ctx.refreshSocial) await ctx.refreshSocial().catch(() => {});
        } catch (err) {
          showToast(`Could not share Waymark AI: ${err.message}`, 'error');
        } finally {
          grantBtn.disabled = false;
        }
      },
    },
  }, ['🤝 Share & Copy Invite Link']);

  const closeModal = () => {
    cleanupAckListener();
    modal.remove();
  };

  const modal = el('div', {
    id: 'wayside-share-agent-modal',
    className: 'modal-overlay',
    on: {
      click: (e) => {
        if (e.target === modal) closeModal();
      },
    },
  }, [
    el('div', { className: 'modal' }, [
      el('div', { className: 'modal-header' }, [
        el('h3', {}, ['🤝 Share Waymark AI Agent']),
        el('button', {
          type: 'button',
          className: 'btn-icon wayside-share-agent-close',
          title: 'Close',
          on: { click: closeModal },
        }, ['✕']),
      ]),
      el('div', { className: 'modal-body' }, [
        el('div', { className: 'wayside-agent-section' }, [
          el('div', { className: 'wayside-agent-section-title' }, [
            el('span', {}, ['🤖 Active Agent Connection (Which Agent to Use)']),
            pickSharedBtn,
          ]),
          el('p', { className: 'wayside-agent-section-desc' }, [
            'Choose whether Waymark AI routes to your own personal agent ledger or an agent shared with you by another account (such as a spouse or teammate).',
          ]),
          el('label', { className: 'form-label', htmlFor: 'wayside-agent-host-select' }, ['Active Agent Host']),
          hostSelect,
          el('label', { className: 'form-label', htmlFor: 'wayside-connect-agent-input' }, ['Connect Shared Agent by Invite Link or Sheet ID']),
          el('div', { className: 'wayside-share-link-row' }, [connectInput, connectBtn]),
        ]),
        el('div', { className: 'wayside-agent-section' }, [
          el('div', { className: 'wayside-agent-section-title' }, [
            el('span', {}, ['🔑 Browser-to-Agent OAuth Setup (P2P Tunnel)']),
          ]),
          el('p', { className: 'wayside-agent-section-desc' }, [
            'Configure the connected Waymark AI daemon directly from your browser over the encrypted WebRTC P2P DataChannel tunnel.',
          ]),
          oauthTokenInput,
          el('div', { className: 'modal-actions' }, [pushOauthBtn]),
          oauthStatusEl,
        ]),
        el('div', { className: 'wayside-agent-section' }, [
          el('div', { className: 'wayside-agent-section-title' }, [
            el('span', {}, ['🤝 Share Your Agent with Family / Collaborators']),
          ]),
          el('p', { className: 'wayside-agent-section-desc' }, [
            'Grant a family member or collaborator access to your Waymark AI agent. Once shared, they can open the invite link or paste it above to use your agent.',
          ]),
          el('label', { className: 'form-label', htmlFor: 'wayside-share-agent-mode' }, ['Sharing Mode']),
          modeSelect,
          el('label', { className: 'form-label', htmlFor: 'wayside-share-agent-email' }, ['Collaborator Google Email']),
          emailInput,
          el('div', { className: 'modal-actions' }, [grantBtn]),
          el('label', { className: 'form-label', htmlFor: 'wayside-share-agent-link' }, ['One-Time Invite Link']),
          el('div', { className: 'wayside-share-link-row' }, [linkInput, copyBtn]),
        ]),
      ]),
    ]),
  ]);

  document.body.append(modal);
  emailInput.focus();
}

if (typeof document !== 'undefined' && !document.__waymarkP2pSheetListener) {
  document.__waymarkP2pSheetListener = true;
  document.addEventListener('waymark:agent-p2p-ensure-sheet', async (e) => {
    const detail = e.detail || {};
    const me = collab.currentEmail();
    if (detail.targetEmail && me && detail.targetEmail.toLowerCase() !== me) return;
    try {
      const rows = Array.isArray(detail.rows) && detail.rows.length
        ? detail.rows
        : [['Title', 'Notes']];
      const created = await api.sheets.createSpreadsheet(detail.title || 'Waymark Sheet', rows, null);
      const sheetId = created.spreadsheetId || created.id;
      for (const shareEmail of detail.shareWith || []) {
        if (shareEmail && shareEmail.toLowerCase() !== me) {
          await api.drive.createDrivePermission(sheetId, shareEmail, 'writer').catch(() => {});
        }
      }
      // Created through Waymark itself (this browser's drive.file scope), so the
      // new Waymark is immediately openable. Register it in Recent Waymarks so it
      // shows up in the Wayboard UI instead of only as a chat link.
      try {
        const headers = Array.isArray(rows[0]) ? rows[0] : [];
        const { key } = detectTemplate(headers);
        await userData.addRecentSheet({ id: sheetId, name: detail.title || 'Waymark Sheet', templateKey: key || '' });
      } catch { /* non-fatal: sheet is still accessible via the chat link */ }
      showToast(`New Waymark "${detail.title || 'Waymark'}" is ready in your Wayboard`, 'success');
      if (detail.session?.send) {
        detail.session.send('', 'agent-p2p-sheet-ready', {
          requestId: detail.requestId || '',
          ok: true,
          sheetId,
          ownerEmail: me,
        });
      }
    } catch (err) {
      if (detail.session?.send) {
        detail.session.send('', 'agent-p2p-sheet-ready', {
          requestId: detail.requestId || '',
          ok: false,
          error: err.message || 'Failed to create sheet in browser',
        });
      }
    }
  });
}

export {
  deriveAgentThreadTitle,
  buildAgentThreadList,
  formatWaysideSubtitle,
  syncSettingsAgentLabel,
  openShareAgentModal,
};
