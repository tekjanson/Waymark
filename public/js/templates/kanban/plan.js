/* ============================================================
   kanban/plan.js — Feature Plan Mode for kanban

   Transforms refined brainstorming ideas into structured
   feature roadmaps with tasks, sub-tasks, and acceptance
   criteria. Enables breaking down scope into actionable items.
   ============================================================ */

import { el, editableCell, emitEdit, getUserName, showToast } from '../shared.js';
import { formatRelativeDate, nowTimestamp } from './helpers.js';

/* ---------- Feature Plan State ---------- */

let _featurePlans = [];
let _planMode = false;
let _currentPlanIdx = null;

const PLAN_STORAGE_KEY = 'waymark_feature_plans';

/* ---------- Storage Helpers ---------- */

function saveFeaturePlans() {
  const data = JSON.stringify(_featurePlans);
  try {
    localStorage.setItem(PLAN_STORAGE_KEY, data);
  } catch (e) {
    console.warn('Failed to save feature plans:', e);
  }
}

function loadFeaturePlans() {
  try {
    const data = localStorage.getItem(PLAN_STORAGE_KEY);
    _featurePlans = data ? JSON.parse(data) : [];
  } catch (e) {
    console.warn('Failed to load feature plans:', e);
    _featurePlans = [];
  }
}

/* ---------- Plan Model ---------- */

/**
 * Create a new feature plan from an idea.
 * @param {Object} idea - brainstorm idea object
 * @returns {Object} feature plan object
 */
export function createPlanFromIdea(idea) {
  const plan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: idea.title,
    description: idea.description || '',
    objectives: [],
    acceptanceCriteria: [],
    tasks: [],
    status: 'planning', // planning -> ready -> implemented
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
    creator: getUserName() || 'System',
    ideaId: idea.id,
  };
  _featurePlans.push(plan);
  saveFeaturePlans();
  return plan;
}

/**
 * Add an objective to a plan.
 * @param {string} planId
 * @param {string} text
 */
export function addObjective(planId, text) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  plan.objectives.push({
    id: `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text: text,
    createdAt: nowTimestamp(),
  });
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Remove an objective from a plan.
 * @param {string} planId
 * @param {string} objectiveId
 */
export function removeObjective(planId, objectiveId) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  plan.objectives = plan.objectives.filter(o => o.id !== objectiveId);
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Add an acceptance criterion to a plan.
 * @param {string} planId
 * @param {string} text
 */
export function addCriterion(planId, text) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  plan.acceptanceCriteria.push({
    id: `crit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text: text,
    completed: false,
    createdAt: nowTimestamp(),
  });
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Toggle acceptance criterion completion status.
 * @param {string} planId
 * @param {string} criterionId
 */
export function toggleCriterion(planId, criterionId) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  const crit = plan.acceptanceCriteria.find(c => c.id === criterionId);
  if (crit) {
    crit.completed = !crit.completed;
    plan.updatedAt = nowTimestamp();
    saveFeaturePlans();
  }
}

/**
 * Remove an acceptance criterion.
 * @param {string} planId
 * @param {string} criterionId
 */
export function removeCriterion(planId, criterionId) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  plan.acceptanceCriteria = plan.acceptanceCriteria.filter(c => c.id !== criterionId);
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Add a task to a plan.
 * @param {string} planId
 * @param {Object} taskData - { title, description, subtasks, owner, priority }
 */
export function addTask(planId, taskData) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  const task = {
    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: taskData.title || 'New Task',
    description: taskData.description || '',
    subtasks: taskData.subtasks || [],
    owner: taskData.owner || '',
    priority: taskData.priority || 'P2',
    status: 'pending', // pending -> in-progress -> completed
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
  plan.tasks.push(task);
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
  return task;
}

/**
 * Remove a task from a plan.
 * @param {string} planId
 * @param {string} taskId
 */
export function removeTask(planId, taskId) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  plan.tasks = plan.tasks.filter(t => t.id !== taskId);
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Add a subtask to a task.
 * @param {string} planId
 * @param {string} taskId
 * @param {string} text
 */
export function addSubtask(planId, taskId, text) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  const task = plan.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subtasks.push({
    id: `subtask-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text: text,
    completed: false,
    createdAt: nowTimestamp(),
  });
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Toggle subtask completion status.
 * @param {string} planId
 * @param {string} taskId
 * @param {string} subtaskId
 */
export function toggleSubtask(planId, taskId, subtaskId) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  const task = plan.tasks.find(t => t.id === taskId);
  if (!task) return;
  const subtask = task.subtasks.find(s => s.id === subtaskId);
  if (subtask) {
    subtask.completed = !subtask.completed;
    plan.updatedAt = nowTimestamp();
    saveFeaturePlans();
  }
}

/**
 * Mark plan as ready for implementation.
 * @param {string} planId
 */
export function markPlanReady(planId) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return;
  plan.status = 'ready';
  plan.updatedAt = nowTimestamp();
  saveFeaturePlans();
}

/**
 * Convert plan tasks to kanban task rows.
 * @param {string} planId
 * @param {Object} cols - column mapping
 * @returns {Array<Array>} task rows
 */
export function planToTaskRows(planId, cols) {
  const plan = _featurePlans.find(p => p.id === planId);
  if (!plan) return [];

  const rows = [];
  const totalCols = Math.max(...Object.values(cols).filter(v => v >= 0)) + 1;

  for (const task of plan.tasks) {
    const row = new Array(totalCols).fill('');

    if (cols.text >= 0) row[cols.text] = task.title;
    if (cols.description >= 0) {
      const subtaskList = task.subtasks.map(st => `- ${st.text}`).join('\n');
      const fullDesc = [task.description, subtaskList].filter(Boolean).join('\n');
      row[cols.description] = fullDesc;
    }
    if (cols.stage >= 0) row[cols.stage] = 'To Do';
    if (cols.priority >= 0) row[cols.priority] = task.priority;
    if (cols.assignee >= 0) row[cols.assignee] = task.owner;

    rows.push(row);
  }

  return rows;
}

/**
 * Get a plan by ID.
 * @param {string} planId
 * @returns {Object}
 */
export function getPlan(planId) {
  return _featurePlans.find(p => p.id === planId);
}

/**
 * Delete a feature plan.
 * @param {string} planId
 */
export function deletePlan(planId) {
  _featurePlans = _featurePlans.filter(p => p.id !== planId);
  saveFeaturePlans();
}

/* ---------- UI Builders ---------- */

function buildPlanCard(plan, onOpenFn) {
  const card = el('div', { className: 'kanban-plan-card', dataset: { planId: plan.id } });

  // Header
  const header = el('div', { className: 'kanban-plan-header' });
  header.append(el('span', { className: 'kanban-plan-status' }, ['📋']));
  header.append(editableCell('span', { className: 'kanban-plan-title' }, plan.title, plan.id, 'title'));

  const meta = el('div', { className: 'kanban-plan-meta' }, [
    el('span', { className: 'kanban-plan-creator' }, [`By ${plan.creator}`]),
    el('span', { className: 'kanban-plan-date' }, [formatRelativeDate(plan.createdAt)]),
  ]);
  header.append(meta);

  card.append(header);

  // Quick stats
  const stats = el('div', { className: 'kanban-plan-stats' }, [
    el('span', {}, [`📌 ${plan.objectives.length} objectives`]),
    el('span', {}, [`✓ ${plan.acceptanceCriteria.length} criteria`]),
    el('span', {}, [`📝 ${plan.tasks.length} tasks`]),
  ]);
  card.append(stats);

  // Open button
  const openBtn = el('button', {
    className: 'kanban-plan-open-btn',
    title: 'Open plan details',
  }, ['Open →']);
  openBtn.addEventListener('click', () => onOpenFn(plan));
  card.append(openBtn);

  return card;
}

function buildPlansGrid(plans, onOpenFn) {
  const grid = el('div', { className: 'kanban-plans-grid' });

  for (const plan of plans) {
    grid.append(buildPlanCard(plan, onOpenFn));
  }

  return grid;
}

function buildObjectivesList(plan, onAddFn, onRemoveFn) {
  const div = el('div', { className: 'kanban-plan-objectives' });
  div.append(el('h4', {}, ['Key Objectives']));

  const list = el('ul', { className: 'kanban-plan-objectives-list' });
  for (const obj of plan.objectives) {
    const item = el('li', { className: 'kanban-plan-objective-item' });
    item.append(el('span', {}, [obj.text]));
    const removeBtn = el('button', { className: 'kanban-plan-remove-btn' }, ['×']);
    removeBtn.addEventListener('click', () => {
      onRemoveFn(plan.id, obj.id);
    });
    item.append(removeBtn);
    list.append(item);
  }
  div.append(list);

  const inputDiv = el('div', { className: 'kanban-plan-add-objective' });
  const input = el('input', {
    type: 'text',
    className: 'kanban-plan-objective-input',
    placeholder: 'Add objective...',
  });
  const addBtn = el('button', { className: 'kanban-plan-add-btn' }, ['Add']);
  addBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
      onAddFn(plan.id, text);
      input.value = '';
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });
  inputDiv.append(input, addBtn);
  div.append(inputDiv);

  return div;
}

function buildCriteria(plan, onAddFn, onToggleFn, onRemoveFn) {
  const div = el('div', { className: 'kanban-plan-criteria' });
  div.append(el('h4', {}, ['Acceptance Criteria']));

  const list = el('ul', { className: 'kanban-plan-criteria-list' });
  for (const crit of plan.acceptanceCriteria) {
    const item = el('li', {
      className: `kanban-plan-criteria-item ${crit.completed ? 'completed' : ''}`,
    });
    const checkbox = el('input', {
      type: 'checkbox',
      checked: crit.completed,
      className: 'kanban-plan-criteria-checkbox',
    });
    checkbox.addEventListener('change', () => {
      onToggleFn(plan.id, crit.id);
    });
    item.append(checkbox);
    item.append(el('span', {}, [crit.text]));
    const removeBtn = el('button', { className: 'kanban-plan-remove-btn' }, ['×']);
    removeBtn.addEventListener('click', () => {
      onRemoveFn(plan.id, crit.id);
    });
    item.append(removeBtn);
    list.append(item);
  }
  div.append(list);

  const inputDiv = el('div', { className: 'kanban-plan-add-criteria' });
  const input = el('input', {
    type: 'text',
    className: 'kanban-plan-criteria-input',
    placeholder: 'Add acceptance criterion...',
  });
  const addBtn = el('button', { className: 'kanban-plan-add-btn' }, ['Add']);
  addBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
      onAddFn(plan.id, text);
      input.value = '';
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });
  inputDiv.append(input, addBtn);
  div.append(inputDiv);

  return div;
}

function buildTasksList(plan, onAddSubtaskFn, onToggleSubtaskFn, onRemoveTaskFn) {
  const div = el('div', { className: 'kanban-plan-tasks' });
  div.append(el('h4', {}, ['Feature Tasks']));

  const list = el('div', { className: 'kanban-plan-tasks-list' });

  for (const task of plan.tasks) {
    const taskEl = el('div', { className: 'kanban-plan-task-item' });

    // Task header
    const header = el('div', { className: 'kanban-plan-task-header' });
    header.append(el('span', { className: 'kanban-plan-task-title' }, [task.title]));
    header.append(el('span', { className: 'kanban-plan-task-priority' }, [task.priority]));
    const removeBtn = el('button', { className: 'kanban-plan-remove-btn' }, ['×']);
    removeBtn.addEventListener('click', () => {
      onRemoveTaskFn(plan.id, task.id);
    });
    header.append(removeBtn);
    taskEl.append(header);

    // Task description
    if (task.description) {
      taskEl.append(el('div', { className: 'kanban-plan-task-desc' }, [task.description]));
    }

    // Subtasks
    const subtasksDiv = el('div', { className: 'kanban-plan-subtasks' });
    for (const subtask of task.subtasks) {
      const subtaskEl = el('div', {
        className: `kanban-plan-subtask-item ${subtask.completed ? 'completed' : ''}`,
      });
      const checkbox = el('input', {
        type: 'checkbox',
        checked: subtask.completed,
        className: 'kanban-plan-subtask-checkbox',
      });
      checkbox.addEventListener('change', () => {
        onToggleSubtaskFn(plan.id, task.id, subtask.id);
      });
      subtaskEl.append(checkbox);
      subtaskEl.append(el('span', {}, [subtask.text]));
      subtasksDiv.append(subtaskEl);
    }

    // Add subtask input
    const addSubtaskDiv = el('div', { className: 'kanban-plan-add-subtask' });
    const subtaskInput = el('input', {
      type: 'text',
      className: 'kanban-plan-subtask-input',
      placeholder: 'Add subtask...',
    });
    const addSubtaskBtn = el('button', { className: 'kanban-plan-add-btn' }, ['Add']);
    addSubtaskBtn.addEventListener('click', () => {
      const text = subtaskInput.value.trim();
      if (text) {
        onAddSubtaskFn(plan.id, task.id, text);
        subtaskInput.value = '';
      }
    });
    subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addSubtaskBtn.click();
    });
    addSubtaskDiv.append(subtaskInput, addSubtaskBtn);

    subtasksDiv.append(addSubtaskDiv);
    taskEl.append(subtasksDiv);

    list.append(taskEl);
  }

  div.append(list);

  return div;
}

function buildPlanDetailPanel(plan, onAddObjectiveFn, onRemoveObjectiveFn, onAddCriterionFn, onToggleCriterionFn, onRemoveCriterionFn, onAddSubtaskFn, onToggleSubtaskFn, onRemoveTaskFn, onMarkReadyFn, onConvertFn) {
  const panel = el('div', { className: 'kanban-plan-detail-panel' });

  // Header
  const header = el('div', { className: 'kanban-plan-detail-header' });
  header.append(el('span', { className: 'kanban-plan-icon' }, ['📋']));
  header.append(el('h2', { className: 'kanban-plan-detail-title' }, [plan.title]));

  const statusSpan = el('span', {
    className: `kanban-plan-status-badge ${plan.status}`,
  }, [plan.status === 'ready' ? '✓ Ready' : '🔄 Planning']);
  header.append(statusSpan);

  panel.append(header);

  // Description
  if (plan.description) {
    panel.append(el('div', { className: 'kanban-plan-description' }, [plan.description]));
  }

  // Objectives
  panel.append(buildObjectivesList(plan, onAddObjectiveFn, onRemoveObjectiveFn));

  // Criteria
  panel.append(buildCriteria(plan, onAddCriterionFn, onToggleCriterionFn, onRemoveCriterionFn));

  // Tasks
  panel.append(buildTasksList(plan, onAddSubtaskFn, onToggleSubtaskFn, onRemoveTaskFn));

  // Action buttons
  const actionsDiv = el('div', { className: 'kanban-plan-actions' });

  const readyBtn = el('button', {
    className: `kanban-plan-ready-btn ${plan.status === 'ready' ? 'ready' : ''}`,
  }, [plan.status === 'ready' ? '✓ Ready for Implementation' : 'Mark Ready']);
  readyBtn.addEventListener('click', () => {
    onMarkReadyFn(plan.id);
    statusSpan.textContent = '✓ Ready';
    statusSpan.classList.add('ready');
    statusSpan.classList.remove('planning');
    readyBtn.textContent = '✓ Ready for Implementation';
    readyBtn.classList.add('ready');
  });
  actionsDiv.append(readyBtn);

  if (plan.status === 'ready') {
    const convertBtn = el('button', { className: 'kanban-plan-convert-btn' }, ['Add to Kanban']);
    convertBtn.addEventListener('click', () => onConvertFn(plan.id));
    actionsDiv.append(convertBtn);
  }

  panel.append(actionsDiv);

  return panel;
}

/* ---------- Mode Manager ---------- */

/**
 * Toggle feature plan mode on/off.
 * @param {HTMLElement} container
 * @param {Object} cols - kanban column mapping
 * @param {Function} onConvertFn - callback when plan is converted to tasks
 */
export function togglePlanMode(container, cols, onConvertFn) {
  loadFeaturePlans();
  _planMode = !_planMode;

  if (_planMode) {
    renderPlanView(container, cols, onConvertFn);
  } else {
    container.innerHTML = '';
    _currentPlanIdx = null;
  }
}

/**
 * Render the feature plan view.
 * @param {HTMLElement} container
 * @param {Object} cols - kanban column mapping
 * @param {Function} onConvertFn - callback when plan is converted to tasks
 */
export function renderPlanView(container, cols, onConvertFn) {
  loadFeaturePlans();
  container.innerHTML = '';

  const planView = el('div', { className: 'kanban-plan-view' });

  // Header
  const headerDiv = el('div', { className: 'kanban-plan-header' });
  headerDiv.append(el('h2', { className: 'kanban-plan-view-title' }, ['📋 Feature Planning']));

  const newPlanBtn = el('button', { className: 'kanban-new-plan-btn' }, ['+ New Plan']);
  newPlanBtn.addEventListener('click', () => {
    const title = prompt('Feature name:');
    if (title) {
      createPlanFromIdea({ title, description: '' });
      renderPlanView(container, cols, onConvertFn);
    }
  });
  headerDiv.append(newPlanBtn);
  planView.append(headerDiv);

  // Content
  const contentDiv = el('div', { className: 'kanban-plan-content' });

  if (_currentPlanIdx !== null && _featurePlans[_currentPlanIdx]) {
    const plan = _featurePlans[_currentPlanIdx];

    const backBtn = el('button', { className: 'kanban-plan-back-btn' }, ['← Back to Plans']);
    backBtn.addEventListener('click', () => {
      _currentPlanIdx = null;
      renderPlanView(container, cols, onConvertFn);
    });
    contentDiv.append(backBtn);

    const detailPanel = buildPlanDetailPanel(
      plan,
      (planId, text) => {
        addObjective(planId, text);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, objId) => {
        removeObjective(planId, objId);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, text) => {
        addCriterion(planId, text);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, critId) => {
        toggleCriterion(planId, critId);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, critId) => {
        removeCriterion(planId, critId);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, taskId, text) => {
        addSubtask(planId, taskId, text);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, taskId, subtaskId) => {
        toggleSubtask(planId, taskId, subtaskId);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId, taskId) => {
        removeTask(planId, taskId);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId) => {
        markPlanReady(planId);
        renderPlanView(container, cols, onConvertFn);
      },
      (planId) => {
        const rows = planToTaskRows(planId, cols);
        if (rows.length > 0) {
          onConvertFn(rows, plan.title);
          deletePlan(planId);
          showToast('Plan tasks added to kanban!', 'success');
          _currentPlanIdx = null;
          renderPlanView(container, cols, onConvertFn);
        }
      }
    );
    contentDiv.append(detailPanel);
  } else {
    // Grid view
    if (_featurePlans.length === 0) {
      contentDiv.append(el('div', { className: 'kanban-plan-empty' }, [
        '📋 No feature plans yet. Start planning!',
      ]));
    } else {
      const plansGrid = buildPlansGrid(_featurePlans, (plan) => {
        _currentPlanIdx = _featurePlans.indexOf(plan);
        renderPlanView(container, cols, onConvertFn);
      });
      contentDiv.append(plansGrid);
    }
  }

  planView.append(contentDiv);
  container.append(planView);
}

/**
 * Check if plan mode is active.
 * @returns {boolean}
 */
export function isPlanMode() {
  return _planMode;
}

/**
 * Get all feature plans.
 * @returns {Array}
 */
export function getAllPlans() {
  loadFeaturePlans();
  return _featurePlans;
}
