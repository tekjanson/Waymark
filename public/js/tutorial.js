/* ============================================================
   tutorial.js — Guided onboarding tutorial for WayMark
   
   Walks new users through the app's purpose and key features
   with spotlight highlights and tooltip explanations.
   ============================================================ */

import * as storage from './storage.js';

/* ---------- Tutorial Steps ---------- */

const STEPS = [
  {
    title: 'Welcome to WayMark!',
    body: 'WayMark turns your Google Sheets into beautiful, interactive views — checklists, trackers, kanban boards, budgets, and more. Let\'s take a quick tour!',
    target: null, // no spotlight — centered welcome
    position: 'center',
  },
  {
    title: 'Drive Explorer',
    body: 'Browse your Google Drive folders and sheets right from the sidebar. Click any folder to expand it and find your spreadsheets.',
    target: '#sidebar',
    position: 'right',
  },
  {
    title: 'Pin Your Favorites',
    body: 'Found a folder you use often? Pin it for quick access. Pinned folders appear on your home screen so you can jump back in instantly.',
    target: '#pinned-folders',
    position: 'bottom',
  },
  {
    title: 'Search Your Sheets',
    body: 'Looking for a specific sheet? Use the search bar to find sheets by name — results appear instantly as you type.',
    target: '#search-form',
    position: 'bottom',
  },
  {
    title: 'Smart Templates',
    body: 'WayMark automatically detects what kind of data your sheet contains — checklists, schedules, budgets, kanban boards, and 15+ other types — and renders a specialised interactive view.',
    target: null,
    position: 'center',
  },
  {
    title: 'Edit In Place',
    body: 'Click any value in a sheet view to edit it directly. Changes sync back to your Google Sheet in real-time. No need to switch tabs!',
    target: null,
    position: 'center',
  },
  {
    title: 'Open in Google Sheets',
    body: 'Need full spreadsheet editing power? Use the "Edit in Sheets" button in any sheet view to open it directly in Google Sheets.',
    target: null,
    position: 'center',
  },
  {
    title: 'Generate Examples',
    body: 'Not sure where to start? Click "Generate Example Sheets" to create sample spreadsheets for every template type. You can pick which categories you want!',
    target: '#generate-section',
    position: 'top',
  },
  {
    title: 'You\'re All Set!',
    body: 'That\'s everything you need to get started. You can revisit this tutorial anytime using the help button in the top bar. Happy organising!',
    target: '#tutorial-btn',
    position: 'bottom',
  },
];

/* ---------- Tutorial Controller ---------- */

let currentStep = 0;
let isActive = false;

const elements = {};

function getElements() {
  if (elements.overlay) return elements;
  elements.overlay   = document.getElementById('tutorial-overlay');
  elements.spotlight = document.getElementById('tutorial-spotlight');
  elements.tooltip   = document.getElementById('tutorial-tooltip');
  elements.title     = document.getElementById('tutorial-title');
  elements.body      = document.getElementById('tutorial-body');
  elements.stepText  = document.getElementById('tutorial-step-text');
  elements.prevBtn   = document.getElementById('tutorial-prev');
  elements.nextBtn   = document.getElementById('tutorial-next');
  elements.skipBtn   = document.getElementById('tutorial-skip');
  return elements;
}

function bindEvents() {
  const els = getElements();
  els.nextBtn.addEventListener('click', next);
  els.prevBtn.addEventListener('click', prev);
  els.skipBtn.addEventListener('click', stop);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isActive) stop();
  });
}

let eventsBound = false;

function start() {
  if (isActive) return;
  const els = getElements();
  if (!eventsBound) { bindEvents(); eventsBound = true; }
  isActive = true;
  currentStep = 0;
  els.overlay.classList.remove('hidden');
  renderStep();
}

function stop() {
  isActive = false;
  const els = getElements();
  els.overlay.classList.add('hidden');
  els.spotlight.style.display = 'none';
  storage.setTutorialCompleted(true);
}

function next() {
  if (currentStep < STEPS.length - 1) {
    currentStep++;
    renderStep();
  } else {
    stop();
  }
}

function prev() {
  if (currentStep > 0) {
    currentStep--;
    renderStep();
  }
}

function renderStep() {
  const els = getElements();
  const step = STEPS[currentStep];

  // Update content
  els.title.textContent = step.title;
  els.body.textContent = step.body;
  els.stepText.textContent = `${currentStep + 1} of ${STEPS.length}`;

  // Button states
  els.prevBtn.classList.toggle('hidden', currentStep === 0);
  els.nextBtn.textContent = currentStep === STEPS.length - 1 ? 'Finish' : 'Next';

  // Position spotlight and tooltip
  if (step.target) {
    const targetEl = document.querySelector(step.target);
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const pad = 8;

      els.spotlight.style.display = 'block';
      els.spotlight.style.top    = `${rect.top - pad}px`;
      els.spotlight.style.left   = `${rect.left - pad}px`;
      els.spotlight.style.width  = `${rect.width + pad * 2}px`;
      els.spotlight.style.height = `${rect.height + pad * 2}px`;

      positionTooltip(els.tooltip, rect, step.position);
    } else {
      // Target not visible — center tooltip
      centerTooltip(els);
    }
  } else {
    // No target — center
    centerTooltip(els);
  }
}

function centerTooltip(els) {
  els.spotlight.style.display = 'none';
  els.tooltip.style.position = 'fixed';
  els.tooltip.style.top = '50%';
  els.tooltip.style.left = '50%';
  els.tooltip.style.transform = 'translate(-50%, -50%)';
  els.tooltip.style.right = 'auto';
  els.tooltip.style.bottom = 'auto';
}

function positionTooltip(tooltip, targetRect, position) {
  const gap = 16;
  tooltip.style.position = 'fixed';
  tooltip.style.transform = 'none';

  // Reset
  tooltip.style.top = 'auto';
  tooltip.style.left = 'auto';
  tooltip.style.right = 'auto';
  tooltip.style.bottom = 'auto';

  switch (position) {
    case 'bottom':
      tooltip.style.top  = `${targetRect.bottom + gap}px`;
      tooltip.style.left = `${Math.max(16, targetRect.left)}px`;
      break;
    case 'top':
      tooltip.style.bottom = `${window.innerHeight - targetRect.top + gap}px`;
      tooltip.style.left   = `${Math.max(16, targetRect.left)}px`;
      break;
    case 'right':
      tooltip.style.top  = `${targetRect.top}px`;
      tooltip.style.left = `${targetRect.right + gap}px`;
      break;
    case 'left':
      tooltip.style.top   = `${targetRect.top}px`;
      tooltip.style.right = `${window.innerWidth - targetRect.left + gap}px`;
      break;
    default:
      centerTooltip({ tooltip, spotlight: { style: {} } });
  }

  // Clamp to viewport
  requestAnimationFrame(() => {
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth - 16) {
      tooltip.style.left = 'auto';
      tooltip.style.right = '16px';
    }
    if (rect.bottom > window.innerHeight - 16) {
      tooltip.style.top = 'auto';
      tooltip.style.bottom = '16px';
    }
  });
}

/* ---------- Public API ---------- */

export const Tutorial = { start, stop, next, prev };
