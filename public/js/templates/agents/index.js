/* ============================================================
   templates/agents/index.js — AI Agent Registry template
   ============================================================ */

import { el, cell, registerTemplate, showToast } from '../shared.js';
import { AGENT_NAME_POOL, LS_WEBHOOK_KEY, STATUS_CYCLE, STATUS_COLORS, buildStatBadge, groupAgentsByFolder } from './helpers.js';
import { buildAgentCard } from './cards.js';
import { buildDeleteModal, setupDeleteConfirmation } from './modal.js';

const definition = {
  name: 'Agent Registry',
  icon: '🤖',
  color: '#7c3aed',
  priority: 24,
  itemNoun: 'Agent',
  defaultHeaders: ['Name', 'Model', 'Provider', 'Status', 'Tuning', 'Task', 'Project', 'Heartbeat'],

  detect(lower) {
    const hasTuning = lower.some(h => /\btuning\b|\bpersonality\b|\bprompt\b/.test(h));
    const hasAgent  = lower.some(h => /\bagent\b|\bworker\b/.test(h));
    return hasTuning || (hasAgent && lower.some(h => /\bstatus\b|\bheartbeat\b|\bmodel\b/.test(h)));
  },

  columns(lower) {
    const cols = {
      name: -1, model: -1, provider: -1, status: -1,
      tuning: -1, task: -1, project: -1, heartbeat: -1,
      workboard: -1, command: -1, folder: -1,
    };
    cols.name      = lower.findIndex(h => /^(name|agent|worker|identity)$/.test(h));
    if (cols.name === -1) cols.name = 0;
    cols.model     = lower.findIndex(h => /^(model|ai model|llm)/.test(h));
    cols.provider  = lower.findIndex(h => /^(provider|engine|backend|runtime)/.test(h));
    cols.status    = lower.findIndex(h => /^(status|state|online|active)/.test(h));
    cols.tuning    = lower.findIndex(h => /^(tuning|personality|system prompt|prompt|flavor|character)/.test(h));
    cols.task      = lower.findIndex(h => /^(task|current task|working on|job|doing)/.test(h));
    cols.project   = lower.findIndex(h => /^(project|board|scope)/.test(h));
    cols.heartbeat = lower.findIndex(h => /^(heartbeat|last seen|ping|updated|timestamp)/.test(h));
    cols.workboard = lower.findIndex(h => /^(workboard|sheet|sheet id|board id|target)/.test(h));
    cols.command   = lower.findIndex(h => /^(command|cmd|initial command|start command)/.test(h));
    cols.folder    = lower.findIndex(h => /^(folder|directory|team|group)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    const nextName = AGENT_NAME_POOL[Math.floor(Math.random() * AGENT_NAME_POOL.length)];
    return [
      { role: 'name',      label: 'Name',      colIndex: cols.name,      type: 'text', placeholder: nextName, required: true },
      { role: 'model',     label: 'Model',     colIndex: cols.model,     type: 'text', placeholder: 'claude-opus-4-5' },
      { role: 'provider',  label: 'Provider',  colIndex: cols.provider,  type: 'text', placeholder: 'auto' },
      { role: 'workboard', label: 'Workboard', colIndex: cols.workboard, type: 'text', placeholder: 'Google Sheet ID of the task board' },
      { role: 'tuning',    label: 'Tuning',    colIndex: cols.tuning,    type: 'text', placeholder: 'Be direct and thorough. Prioritize clean code.' },
    ];
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    /* ---------- Fleet webhook URL (server-injected or user-configured) ---------- */
    // window.__WAYMARK_FLEET_WEBHOOK is set by the server when FLEET_WEBHOOK_URL is in env.
    // Users accessing via swiftirons.com can configure their local webhook URL via the ⚙️ button
    // and it will be persisted in localStorage so the Sync Fleet button works for them too.
    const webhookUrl = window.__WAYMARK_FLEET_WEBHOOK
      || localStorage.getItem(LS_WEBHOOK_KEY)
      || null;

    /* -- Sync Fleet button (visible when webhook URL is known) -- */
    const syncBtn = el('button', {
      className: 'agents-sync-btn',
      title: webhookUrl ? `Sync fleet via ${webhookUrl}` : 'Configure a webhook URL first (⚙️)',
      style: webhookUrl ? '' : 'display:none',
    }, ['🔄 Sync Fleet']);

    syncBtn.addEventListener('click', async () => {
      const url = window.__WAYMARK_FLEET_WEBHOOK || localStorage.getItem(LS_WEBHOOK_KEY);
      if (!url) { showToast('No webhook URL configured — click ⚙️ to set one', 'error'); return; }
      syncBtn.textContent = '⏳ Syncing…';
      syncBtn.disabled = true;
      try {
        const res  = await fetch(`${url}/fleet-sync`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) showToast('Fleet synced — new agents started', 'success');
        else         showToast(`Fleet sync failed: ${data.error}`, 'error');
      } catch (err) {
        showToast(`Fleet sync error: ${err.message}`, 'error');
      } finally {
        syncBtn.textContent = '🔄 Sync Fleet';
        syncBtn.disabled = false;
      }
    });

    /* -- Configure webhook button (⚙️) with inline input -- */
    const cfgInput = el('input', {
      type: 'text',
      className: 'agents-cfg-input hidden',
      value: webhookUrl || '',
      placeholder: 'http://localhost:3002',
    });

    function _saveCfgUrl() {
      const v = cfgInput.value.trim();
      if (v) {
        localStorage.setItem(LS_WEBHOOK_KEY, v);
        syncBtn.style.display = '';
        syncBtn.title = `Sync fleet via ${v}`;
      } else {
        localStorage.removeItem(LS_WEBHOOK_KEY);
        if (!window.__WAYMARK_FLEET_WEBHOOK) syncBtn.style.display = 'none';
      }
      cfgInput.classList.add('hidden');
      showToast(v ? 'Webhook URL saved' : 'Webhook URL cleared', 'success');
    }

    cfgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  _saveCfgUrl();
      if (e.key === 'Escape') cfgInput.classList.add('hidden');
    });

    const cfgBtn = el('button', {
      className: 'agents-cfg-btn',
      title: webhookUrl
        ? `Fleet webhook: ${webhookUrl} — click to change`
        : 'Configure fleet webhook URL',
      on: { click() {
        cfgInput.classList.toggle('hidden');
        if (!cfgInput.classList.contains('hidden')) cfgInput.focus();
      }},
    }, ['⚙️']);

    /* ---------- Header bar ---------- */
    const header = el('div', { className: 'agents-header' }, [
      el('div', { className: 'agents-header-left' }, [
        el('h2', { className: 'agents-title' }, ['🤖 Agent Registry']),
        el('p', { className: 'agents-subtitle' }, [
          'Edit tuning strings and workboard targets. Agents read their row on boot.',
        ]),
      ]),
      el('div', { className: 'agents-header-actions' }, [
        el('div', { className: 'agents-header-stats' }, [
          buildStatBadge('Total', rows.length),
          buildStatBadge('Online', rows.filter(r => /online/i.test(cell(r, cols.status))).length, '#16a34a'),
          buildStatBadge('Idle', rows.filter(r => /idle/i.test(cell(r, cols.status))).length, '#ca8a04'),
        ]),
        syncBtn,
        cfgBtn,
        cfgInput,
      ]),
    ]);
    container.append(header);

    /* ---------- Agent cards grid ---------- */
    const grid = el('div', { className: 'agents-grid' });

    /* Delete handler for card delete buttons */
    const handleDeleteClick = (name, rowIdx, tmpl) => {
      deleteModal.querySelector('.agents-delete-agent-name').textContent = name;
      setupDeleteConfirmation(deleteModal, name, rowIdx, tmpl);
    };

    /* Group agents by folder */
    const folderGroups = groupAgentsByFolder(rows, cols);
    const folderNames = Object.keys(folderGroups).sort();

    /* Render folder sections */
    folderNames.forEach(folderName => {
      const folderSection = el('div', {
        className: 'agents-folder-section',
        dataset: { folder: folderName },
      }, [
        el('div', { className: 'agents-folder-header' }, [
          el('h3', { className: 'agents-folder-title' }, [
            `📁 ${folderName}`,
          ]),
          el('span', { className: 'agents-folder-count' }, [
            `(${folderGroups[folderName].length})`,
          ]),
        ]),
        el('div', { className: 'agents-folder-grid' }, 
          folderGroups[folderName].map(rowIdx => {
            const row = rows[rowIdx - 1];
            const card = buildAgentCard(row, rowIdx, cols, template, handleDeleteClick);
            return card;
          })
        ),
      ]);
      grid.append(folderSection);
    });

    container.append(grid);

    /* ---------- Delete confirmation modal ---------- */
    const deleteModal = buildDeleteModal();
    container.append(deleteModal);
  },
};

registerTemplate('agents', definition);
export default definition;
