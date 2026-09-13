/* ============================================================
   calorie/profile.js — Profile & goal setup + living mascot

   • openProfileModal — capture sex/age/height/weight/activity/goal and
     preview the recommended daily calories + macro split (Mifflin-St Jeor).
   • buildMascot — a plant that grows through 6 stages as the user keeps
     hitting their goal (streak-driven), making the tracker feel alive.
   ============================================================ */

import { el, showToast, goalFromProfile, ACTIVITY_LABELS, GOAL_LABELS } from '../shared.js';
import { parseNum } from './helpers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Namespaced SVG element factory (mirrors charts.js). */
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/* ---------- Living mascot ---------- */

const STAGE_LABELS = [
  'Plant a seed — log a day to begin',
  'Sprouting',
  'Seedling',
  'Growing strong',
  'Thriving',
  'Flourishing!',
];

/**
 * Build the growth-garden mascot for a given stage (0..5).
 * @param {number} stage
 * @param {{streak?:number, score?:number, loggedDays?:number}} [adh]
 * @returns {HTMLElement}
 */
export function buildMascot(stage, adh = {}) {
  const s = Math.max(0, Math.min(5, stage | 0));
  const svg = svgEl('svg', {
    viewBox: '0 0 120 120', class: 'calorie-mascot-svg',
    role: 'img', 'aria-label': `Growth stage ${s} of 5`,
  });

  // Pot / soil mound.
  svg.append(svgEl('ellipse', { cx: '60', cy: '104', rx: '34', ry: '9', class: 'calorie-mascot-soil' }));

  const leaf = (x, y, rot, scale) => svgEl('path', {
    d: 'M0,0 C10,-6 22,-4 26,6 C16,10 4,8 0,0 Z',
    transform: `translate(${x},${y}) rotate(${rot}) scale(${scale})`,
    class: 'calorie-mascot-leaf',
  });

  if (s === 0) {
    // Seed under soil.
    svg.append(svgEl('ellipse', { cx: '60', cy: '100', rx: '5', ry: '3.5', class: 'calorie-mascot-seed' }));
  } else {
    // Stem grows taller with stage.
    const stemTop = 100 - s * 14;
    svg.append(svgEl('path', {
      d: `M60,100 C58,${90 - s * 4} 62,${80 - s * 6} 60,${stemTop}`,
      class: 'calorie-mascot-stem', fill: 'none',
    }));
    // Leaves increase with stage.
    const pairs = Math.min(4, s);
    for (let i = 0; i < pairs; i++) {
      const y = 96 - i * ((96 - stemTop) / (pairs)) - 6;
      svg.append(leaf(60, y, 200, 0.7 + i * 0.1));
      svg.append(leaf(60, y, -20, 0.7 + i * 0.1));
    }
    // Canopy / crown for later stages.
    if (s >= 4) {
      svg.append(svgEl('circle', { cx: '60', cy: String(stemTop - 4), r: String(14 + (s - 4) * 6), class: 'calorie-mascot-crown' }));
    }
    // Blossoms/fruit at the top stage.
    if (s === 5) {
      for (const [dx, dy] of [[-10, -6], [8, -10], [0, 4], [12, 2], [-8, 6]]) {
        svg.append(svgEl('circle', { cx: String(60 + dx), cy: String(stemTop - 4 + dy), r: '3.2', class: 'calorie-mascot-bloom' }));
      }
    }
  }

  const caption = STAGE_LABELS[s];
  const streak = adh.streak || 0;
  const best = adh.bestStreak || 0;
  const streakLine = streak > 0
    ? `${streak}-day streak · ${adh.onTrackDays || 0}/${adh.loggedDays || 0} on target`
    : (adh.loggedDays ? `${adh.onTrackDays || 0}/${adh.loggedDays} days on target` : 'Log meals to grow your garden');
  const sub = best > 0 ? `${streakLine} · best ${best}d` : streakLine;

  return el('div', { className: 'calorie-mascot' }, [
    el('div', { className: 'calorie-mascot-art' }, [svg]),
    el('div', { className: 'calorie-mascot-info' }, [
      el('div', { className: 'calorie-mascot-caption' }, [caption]),
      el('div', { className: 'calorie-mascot-sub' }, [sub]),
      el('div', { className: 'calorie-mascot-dots' },
        [0, 1, 2, 3, 4].map(i => el('span', { className: `calorie-mascot-dot ${i < s ? 'filled' : ''}` }))),
    ]),
  ]);
}

/* ---------- Profile & goal modal ---------- */

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

/**
 * Open the profile/goal editor. Calls onSave(profile) with a normalized
 * metric profile: { sex, age, heightCm, weightKg, activityLevel, goalType,
 * rateKgPerWeek, units }.
 * @param {{ profile:Object|null, onSave:Function }} opts
 */
export function openProfileModal({ profile, onSave }) {
  const p = profile || {};
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal' });
  const close = () => overlay.remove();

  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, ['\u2699\uFE0F Your profile & goal']),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.calorie-modal-close').addEventListener('click', close);

  let units = p.units === 'imperial' ? 'imperial' : 'metric';

  /* Units toggle */
  const metricBtn = el('button', { className: 'calorie-seg-btn', type: 'button' }, ['Metric']);
  const imperialBtn = el('button', { className: 'calorie-seg-btn', type: 'button' }, ['Imperial']);
  const unitsSeg = el('div', { className: 'calorie-segmented calorie-units-seg' }, [metricBtn, imperialBtn]);

  /* Inputs */
  const sexSel = el('select', { className: 'calorie-serving-meal' },
    [['male', 'Male'], ['female', 'Female'], ['other', 'Prefer not to say']]
      .map(([v, l]) => el('option', { value: v }, [l])));
  sexSel.value = p.sex || 'male';

  const age = el('input', { className: 'calorie-p-input', type: 'number', min: '0', step: '1', value: p.age ? String(p.age) : '' });

  // Height: metric = one cm field; imperial = ft + in.
  const heightCm = el('input', { className: 'calorie-p-input', type: 'number', min: '0', step: 'any', placeholder: 'cm' });
  const heightFt = el('input', { className: 'calorie-p-input calorie-p-half', type: 'number', min: '0', step: '1', placeholder: 'ft' });
  const heightIn = el('input', { className: 'calorie-p-input calorie-p-half', type: 'number', min: '0', step: '1', placeholder: 'in' });
  const heightRow = el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Height'])]);

  const weight = el('input', { className: 'calorie-p-input', type: 'number', min: '0', step: 'any' });
  const weightUnit = el('span', { className: 'calorie-serving-unit' }, ['kg']);

  const activitySel = el('select', { className: 'calorie-serving-meal' },
    Object.entries(ACTIVITY_LABELS).map(([v, l]) => el('option', { value: v }, [l])));
  activitySel.value = p.activityLevel || 'moderate';

  const goalSel = el('select', { className: 'calorie-serving-meal' },
    Object.entries(GOAL_LABELS).map(([v, l]) => el('option', { value: v }, [l])));
  goalSel.value = p.goalType || 'maintain';

  const rateSel = el('select', { className: 'calorie-serving-meal' },
    [['0.25', 'Gentle (0.25 kg/wk)'], ['0.5', 'Standard (0.5 kg/wk)'], ['0.75', 'Aggressive (0.75 kg/wk)'], ['1', 'Rapid (1 kg/wk)']]
      .map(([v, l]) => el('option', { value: v }, [l])));
  rateSel.value = String(p.rateKgPerWeek || 0.5);

  /* Preview */
  const preview = el('div', { className: 'calorie-p-preview' });

  /* Seed initial values from profile (stored metric). */
  function seedInputs() {
    if (units === 'metric') {
      heightCm.value = p.heightCm ? String(p.heightCm) : '';
      weight.value = p.weightKg ? String(p.weightKg) : '';
      weightUnit.textContent = 'kg';
    } else {
      if (p.heightCm) {
        const totalIn = p.heightCm / CM_PER_IN;
        heightFt.value = String(Math.floor(totalIn / 12));
        heightIn.value = String(Math.round(totalIn % 12));
      }
      if (p.weightKg) weight.value = String(Math.round(p.weightKg / KG_PER_LB));
      weightUnit.textContent = 'lb';
    }
  }

  function renderHeightRow() {
    heightRow.innerHTML = '';
    heightRow.append(el('label', {}, ['Height']));
    if (units === 'metric') {
      heightRow.append(heightCm, el('span', { className: 'calorie-serving-unit' }, ['cm']));
    } else {
      heightRow.append(heightFt, el('span', { className: 'calorie-serving-unit' }, ['ft']), heightIn, el('span', { className: 'calorie-serving-unit' }, ['in']));
    }
  }

  function currentMetric() {
    let heightCmVal, weightKgVal;
    if (units === 'metric') {
      heightCmVal = parseNum(heightCm.value);
      weightKgVal = parseNum(weight.value);
    } else {
      heightCmVal = Math.round((parseNum(heightFt.value) * 12 + parseNum(heightIn.value)) * CM_PER_IN);
      weightKgVal = Math.round(parseNum(weight.value) * KG_PER_LB * 10) / 10;
    }
    return {
      sex: sexSel.value,
      age: parseNum(age.value),
      heightCm: heightCmVal,
      weightKg: weightKgVal,
      activityLevel: activitySel.value,
      goalType: goalSel.value,
      rateKgPerWeek: parseNum(rateSel.value),
      units,
    };
  }

  function renderPreview() {
    const prof = currentMetric();
    const goal = goalFromProfile(prof);
    preview.innerHTML = '';
    if (!goal) {
      preview.append(el('div', { className: 'calorie-p-preview-empty' }, ['Enter age, height and weight to see your targets.']));
      return;
    }
    preview.append(
      el('div', { className: 'calorie-p-preview-cal' }, [
        el('span', { className: 'calorie-p-preview-num' }, [String(goal.calories)]),
        el('span', { className: 'calorie-p-preview-lbl' }, ['cal / day target']),
      ]),
      el('div', { className: 'calorie-p-preview-macros' }, [
        el('span', {}, [`Protein ${goal.macros.protein}g`]),
        el('span', {}, [`Carbs ${goal.macros.carbs}g`]),
        el('span', {}, [`Fat ${goal.macros.fat}g`]),
      ]),
      el('div', { className: 'calorie-p-preview-meta' }, [`BMR ${goal.bmr} · TDEE ${goal.tdee} cal`]),
    );
  }

  function setUnits(u) {
    units = u;
    metricBtn.classList.toggle('active', u === 'metric');
    imperialBtn.classList.toggle('active', u === 'imperial');
    seedInputs();
    renderHeightRow();
    renderPreview();
  }
  metricBtn.addEventListener('click', () => setUnits('metric'));
  imperialBtn.addEventListener('click', () => setUnits('imperial'));

  for (const inp of [age, heightCm, heightFt, heightIn, weight]) inp.addEventListener('input', renderPreview);
  for (const sel of [sexSel, activitySel, goalSel, rateSel]) sel.addEventListener('change', renderPreview);

  const save = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Save & apply goal']);
  save.addEventListener('click', () => {
    const prof = currentMetric();
    if (!prof.age || !prof.heightCm || !prof.weightKg) {
      showToast('Enter age, height and weight', 'error');
      return;
    }
    onSave(prof);
    close();
  });

  const body = el('div', { className: 'calorie-modal-body' }, [
    unitsSeg,
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Sex']), sexSel]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Age']), age]),
    heightRow,
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Weight']), weight, weightUnit]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Activity']), activitySel]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Goal']), goalSel]),
    el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Pace']), rateSel]),
    preview,
    save,
  ]);

  modal.append(header, body);
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  setUnits(units);
}
