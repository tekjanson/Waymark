/* ============================================================
   templates/agents.js — AI Agent Registry: remote personality
   and tuning config panel for dev-worker agents.

   Each row = one named agent (Alex, Sam, Jordan…).
   Operators edit tuning strings and target workboards here;
   agents read their row on boot and pick up the config.
   ============================================================ */

import { el, cell, editableCell, textareaCell, emitEdit, registerTemplate, showToast } from './shared.js';

/* ---------- Fleet webhook config (localStorage key) ---------- */
const LS_WEBHOOK_KEY = 'waymark_fleet_webhook_url';

/* ---------- Status config ---------- */
const STATUS_CYCLE  = ['Online', 'Idle', 'Offline', 'Error'];
const STATUS_COLORS = {
  Online:  { bg: '#dcfce7', text: '#15803d', dot: '#16a34a' },
  Idle:    { bg: '#fef9c3', text: '#854d0e', dot: '#ca8a04' },
  Offline: { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' },
  Error:   { bg: '#fee2e2', text: '#991b1b', dot: '#dc2626' },
};

/* ---------- Human names pool (for new-agent suggestions) ---------- */
export const AGENT_NAME_POOL = [
  'Alex', 'Sam', 'Jordan', 'Morgan', 'Casey', 'Riley', 'Quinn',
  'Avery', 'Blake', 'Drew', 'Finley', 'Harper', 'Indigo', 'Jules',
  'Kendall', 'Lane', 'Marlow', 'Noel', 'Oakley', 'Payton',
];

/* ---------- Time-ago helper ---------- */
function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (isNaN(secs) || secs < 0) return '—';
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

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

  render(container, rows, cols) {
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
          _statBadge('Total', rows.length),
          _statBadge('Online', rows.filter(r => /online/i.test(cell(r, cols.status))).length, '#16a34a'),
          _statBadge('Idle', rows.filter(r => /idle/i.test(cell(r, cols.status))).length, '#ca8a04'),
        ]),
        syncBtn,
        cfgBtn,
        cfgInput,
      ]),
    ]);
    container.append(header);

    /* ---------- Agent cards grid ---------- */
    const grid = el('div', { className: 'agents-grid' });

    rows.forEach((row, i) => {
      const rowIdx    = i + 1;
      const name      = cell(row, cols.name)      || `Agent ${rowIdx}`;
      const model     = cell(row, cols.model)      || '';
      const provider  = cell(row, cols.provider)   || 'auto';
      const statusVal = cell(row, cols.status)     || 'Offline';
      const tuning    = cell(row, cols.tuning)     || '';
      const taskVal   = cell(row, cols.task)       || '';
      const project   = cell(row, cols.project)    || '';
      const heartbeat = cell(row, cols.heartbeat)  || '';
      const workboard = cell(row, cols.workboard)  || '';
      const command   = cell(row, cols.command)    || '';
      const folder    = cell(row, cols.folder)     || '';

      const statusKey   = STATUS_CYCLE.includes(statusVal) ? statusVal : 'Offline';
      const statusColor = STATUS_COLORS[statusKey];

      /* -- Status badge (click to cycle) -- */
      const statusBadge = el('span', {
        className: 'agents-status-badge',
        style: `background:${statusColor.bg}; color:${statusColor.text}; cursor:pointer`,
        title: 'Click to change status',
        on: { click() {
          if (cols.status === -1) return;
          const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(statusVal) + 1) % STATUS_CYCLE.length];
          emitEdit(rowIdx, cols.status, next);
        }},
      }, [
        el('span', { className: 'agents-status-dot', style: `background:${statusColor.dot}` }),
        statusVal,
      ]);

      /* -- Provider badge (inline edit) -- */
      const providerCell = cols.provider !== -1
        ? editableCell('span', { className: `agents-provider-badge agents-provider-${provider.toLowerCase()}` }, provider, rowIdx, cols.provider)
        : el('span', { className: `agents-provider-badge agents-provider-${provider.toLowerCase()}` }, [provider]);

      /* -- Agent initials avatar -- */
      const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      const hue      = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
      const avatar   = el('div', { className: 'agents-avatar', style: `background:hsl(${hue},60%,55%)` }, [initials]);

      /* -- Tuning textarea (the main control) -- */
      const tuningCell = textareaCell(
        'div', { className: 'agents-tuning-cell' },
        tuning, rowIdx, cols.tuning,
        { placeholder: 'Personality and behavior instructions. Injected at the start of every session.' }
      );

      /* -- Model (inline edit) -- */
      const modelCell = cols.model !== -1
        ? editableCell('span', { className: 'agents-model-cell' }, model || '—', rowIdx, cols.model, { placeholder: 'model' })
        : null;

      /* -- Task display (read-only, written by agent) -- */
      const taskDisplay = cols.task !== -1
        ? el('div', { className: 'agents-task' + (taskVal ? '' : ' agents-task-empty') }, [
            el('span', { className: 'agents-task-label' }, ['Current task: ']),
            taskVal || 'idle',
          ])
        : null;

      /* -- Heartbeat -- */
      const heartbeatEl = (cols.heartbeat !== -1 && heartbeat)
        ? el('div', { className: 'agents-heartbeat' }, ['⏱ Last seen: ', timeAgo(heartbeat)])
        : null;

      /* -- Workboard target: clickable link + inline edit -- */
      const wbEdit = cols.workboard !== -1
        ? editableCell('span', { className: 'agents-workboard-cell' }, workboard || '—', rowIdx, cols.workboard, { placeholder: 'Sheet ID' })
        : null;
      const workboardEl = cols.workboard !== -1
        ? el('div', { className: 'agents-workboard' }, [
            el('span', { className: 'agents-field-label' }, ['📋 Workboard: ']),
            el('span', { className: 'agents-workboard-value' }, [
              ...(workboard ? [el('a', {
                className: 'agents-workboard-open',
                href: `#/sheet/${workboard}`,
                title: `Open workboard in Waymark`,
                on: { click(e) { e.stopPropagation(); } },
              }, ['↗ Open'])] : []),
              wbEdit,
            ]),
          ])
        : null;

      /* -- Command override (inline edit) -- */
      const commandEl = cols.command !== -1
        ? el('div', { className: 'agents-command' }, [
            el('span', { className: 'agents-field-label' }, ['⌘ Command: ']),
            editableCell('span', { className: 'agents-command-cell' }, command || '—', rowIdx, cols.command, { placeholder: '@waymark-builder start' }),
          ])
        : null;

      /* -- Project (inline edit) -- */
      const projectEl = (cols.project !== -1 && project)
        ? el('div', { className: 'agents-project' }, [
            el('span', { className: 'agents-field-label' }, ['Project: ']),
            editableCell('span', { className: 'agents-project-cell' }, project, rowIdx, cols.project, { placeholder: 'project' }),
          ])
        : null;

      /* -- Folder (inline edit) -- */
      const folderEl = (cols.folder !== -1 && folder)
        ? el('div', { className: 'agents-folder' }, [
            el('span', { className: 'agents-field-label' }, ['📁 Folder: ']),
            editableCell('span', { className: 'agents-folder-cell' }, folder, rowIdx, cols.folder, { placeholder: 'Team/Group folder' }),
          ])
        : null;

      /* -- Delete agent button -- */
      const deleteBtn = el('button', {
        className: 'agents-delete-btn',
        title: `Delete agent "${name}"`,
        on: { click() {
          const deleteModal = document.querySelector('.agents-delete-modal');
          const deleteAgentName = document.querySelector('.agents-delete-agent-name');
          const deleteAgentRow = document.querySelector('.agents-delete-agent-row');
          const confirmDeleteBtn = document.querySelector('.agents-confirm-delete-btn');

          deleteAgentName.textContent = name;
          deleteAgentRow.dataset.rowIdx = rowIdx;

          confirmDeleteBtn.onclick = () => {
            emitEdit(rowIdx, cols.name, '');
            deleteModal.classList.add('hidden');
          };

          deleteModal.classList.remove('hidden');
        }},
      }, ['🗑️ Delete']);

      /* -- Card assembly -- */
      const metaRow = el('div', { className: 'agents-meta-row' }, [
        statusBadge,
        providerCell,
        ...(modelCell ? [el('span', { className: 'agents-meta-sep' }, ['·']), modelCell] : []),
      ]);

      const cardActions = el('div', { className: 'agents-card-actions' }, [deleteBtn]);

      const card = el('div', {
        className: `agents-card agents-card-status-${statusKey.toLowerCase()}`,
        dataset: { agentName: name },
      }, [
        el('div', { className: 'agents-card-top' }, [
          avatar,
          el('div', { className: 'agents-card-identity' }, [
            editableCell('h3', { className: 'agents-name' }, name, rowIdx, cols.name, { placeholder: 'Agent name' }),
            metaRow,
          ]),
          cardActions,
        ]),
        el('div', { className: 'agents-tuning-section' }, [
          el('label', { className: 'agents-tuning-label' }, ['✏️ Tuning']),
          el('div', { className: 'agents-tuning-hint' }, [
            'Personality + behavior. Prepended to every session prompt.',
          ]),
          tuningCell,
        ]),
        ...(workboardEl ? [workboardEl] : []),
        ...(commandEl   ? [commandEl]   : []),
        ...(taskDisplay ? [taskDisplay] : []),
        ...(projectEl   ? [projectEl]   : []),
        ...(folderEl    ? [folderEl]    : []),
        ...(heartbeatEl ? [heartbeatEl] : []),
      ]);

      grid.append(card);
    });

    container.append(grid);

    /* ---------- Delete confirmation modal ---------- */
    const deleteModal = el('div', {
      className: 'agents-delete-modal hidden',
      on: { click(e) {
        if (e.target === deleteModal) deleteModal.classList.add('hidden');
      }},
    }, [
      el('div', { className: 'agents-delete-modal-content' }, [
        el('div', { className: 'agents-delete-modal-header' }, [
          el('h3', { className: 'agents-delete-modal-title' }, ['Delete Agent']),
          el('button', {
            className: 'agents-delete-modal-close',
            on: { click() { deleteModal.classList.add('hidden'); }},
          }, ['×']),
        ]),
        el('div', { className: 'agents-delete-modal-body' }, [
          el('p', {}, [
            'Are you sure you want to delete ',
            el('strong', { className: 'agents-delete-agent-name' }, ['Agent']),
            '? This will remove them from the registry.',
          ]),
        ]),
        el('div', { className: 'agents-delete-modal-footer' }, [
          el('button', {
            className: 'agents-delete-modal-cancel',
            on: { click() { deleteModal.classList.add('hidden'); }},
          }, ['Cancel']),
          el('button', {
            className: 'agents-confirm-delete-btn',
          }, ['Delete']),
        ]),
      ]),
    ]);

    // Add data attribute to modal for storing row index
    const deleteAgentRow = document.createElement('div');
    deleteAgentRow.className = 'agents-delete-agent-row';
    deleteAgentRow.style.display = 'none';
    deleteModal.append(deleteAgentRow);

    container.append(deleteModal);
  },
};

/* ---------- Private helpers ---------- */
function _statBadge(label, count, color = null) {
  return el('div', { className: 'agents-stat' }, [
    el('span', {
      className: 'agents-stat-count',
      ...(color ? { style: `color:${color}` } : {}),
    }, [String(count)]),
    el('span', { className: 'agents-stat-label' }, [label]),
  ]);
}

registerTemplate('agents', definition);
export default definition;
