/* ============================================================
   calorie/ai-vision.js — Gemini meal-photo macro estimation

   Captures a food photo (camera or file), sends it to the Waymark
   Gemini pipeline (generateVision), and renders an interactive
   breakdown modal where the user adjusts servings or deletes
   misidentified items before confirming the log.

   Offline / test hook:
     window.__WAYMARK_VISION_MOCK — an { items:[…] } object (or array,
     or a function returning one). When present, the network call is
     skipped and the mock breakdown is used directly.
   ============================================================ */

import { el, showToast, generateVision, captureStillFromCamera } from '../shared.js';
import { parseNum, round1, MEAL_TYPES } from './helpers.js';

const SYSTEM_PROMPT =
  'Analyze this food image. Break down each distinct food item visible on the ' +
  'plate, including subtle elements like sauces and seasonings. Output strict ' +
  'JSON containing an "items" array. Each item must have: name, serving_qty, ' +
  'serving_unit (g/oz/cup), calories, protein, carbs, and fat. Return only JSON.';

/* ---------- Helpers ---------- */

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.readAsDataURL(file);
  });
}

/** Pull the first JSON object out of a possibly fenced model response. */
function parseItems(text) {
  if (!text) return [];
  let raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  try {
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : (data.items || []);
    return items.map(normalizeItem).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeItem(it) {
  if (!it || !it.name) return null;
  return {
    name: String(it.name),
    qty: parseNum(it.serving_qty ?? it.qty ?? 1) || 1,
    unit: String(it.serving_unit || it.unit || 'g'),
    calories: Math.round(parseNum(it.calories)),
    protein: round1(parseNum(it.protein)),
    carbs: round1(parseNum(it.carbs)),
    fat: round1(parseNum(it.fat)),
  };
}

/**
 * Analyze a meal photo File → itemized breakdown.
 * @param {File} file
 * @returns {Promise<Array<Object>>}
 */
export async function analyzeMealPhoto(file) {
  const mock = typeof window !== 'undefined' ? window.__WAYMARK_VISION_MOCK : null;
  if (mock) {
    const val = typeof mock === 'function' ? mock() : mock;
    const items = Array.isArray(val) ? val : (val.items || []);
    return items.map(normalizeItem).filter(Boolean);
  }
  const base64 = await fileToBase64(file);
  const text = await generateVision(SYSTEM_PROMPT, base64, file.type || 'image/jpeg', {
    userMessage: 'Identify every food item and estimate macros.',
    temperature: 0.3,
  });
  return parseItems(text);
}

/* ---------- Breakdown modal ---------- */

function buildBreakdownModal(items, mealType, onConfirm) {
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal calorie-ai-modal' });
  const close = () => overlay.remove();

  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, ['AI meal breakdown']),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.calorie-modal-close').addEventListener('click', close);

  const mealSelect = el('select', { className: 'calorie-serving-meal' },
    MEAL_TYPES.map(m => el('option', { value: m }, [m])));
  mealSelect.value = mealType;

  const list = el('div', { className: 'calorie-ai-list' });
  const state = items.map(it => ({ ...it }));

  function renderList() {
    list.innerHTML = '';
    if (!state.length) {
      list.append(el('div', { className: 'calorie-search-empty' }, ['No items. Close and try another photo.']));
      return;
    }
    state.forEach((item, idx) => {
      const nameInput = el('input', { className: 'calorie-ai-name', type: 'text', value: item.name });
      const qtyInput = el('input', { className: 'calorie-ai-qty', type: 'number', min: '0', step: 'any', value: String(item.qty) });
      const unitInput = el('input', { className: 'calorie-ai-unit', type: 'text', value: item.unit });
      const calInput = el('input', { className: 'calorie-ai-cal', type: 'number', min: '0', step: 'any', value: String(item.calories) });

      nameInput.addEventListener('input', () => { item.name = nameInput.value; });
      unitInput.addEventListener('input', () => { item.unit = unitInput.value; });
      calInput.addEventListener('input', () => { item.calories = Math.round(parseNum(calInput.value)); });
      qtyInput.addEventListener('input', () => {
        const oldQty = item.qty || 1;
        const newQty = parseNum(qtyInput.value) || 0;
        const f = newQty / oldQty;
        if (f > 0 && isFinite(f)) {
          item.calories = Math.round(item.calories * f);
          item.protein = round1(item.protein * f);
          item.carbs = round1(item.carbs * f);
          item.fat = round1(item.fat * f);
          calInput.value = String(item.calories);
        }
        item.qty = newQty;
      });

      const del = el('button', { className: 'calorie-ai-del', type: 'button', 'aria-label': 'Remove item' }, ['\uD83D\uDDD1']);
      del.addEventListener('click', () => { state.splice(idx, 1); renderList(); });

      list.append(el('div', { className: 'calorie-ai-item' }, [
        el('div', { className: 'calorie-ai-item-main' }, [nameInput, del]),
        el('div', { className: 'calorie-ai-item-fields' }, [
          qtyInput, unitInput,
          el('span', { className: 'calorie-ai-callabel' }, ['cal']), calInput,
        ]),
      ]));
    });
  }
  renderList();

  const confirmBtn = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Log all items']);
  confirmBtn.addEventListener('click', async () => {
    if (!state.length) { close(); return; }
    const meal = mealSelect.value;
    for (const item of state) {
      await onConfirm({
        name: item.name,
        qty: item.qty, unit: item.unit,
        calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat,
        barcode: '', mealType: meal,
      });
    }
    close();
  });

  modal.append(
    header,
    el('div', { className: 'calorie-modal-body' }, [
      el('div', { className: 'calorie-serving-row' }, [el('label', {}, ['Meal']), mealSelect]),
      list,
      confirmBtn,
    ]),
  );
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

/* ---------- Public entry ---------- */

/**
 * Open the AI meal-scan flow: pick a photo → analyze → review breakdown.
 * @param {{ mealType:string, onConfirm:Function }} opts
 */
export function openAiScanModal({ mealType, onConfirm }) {
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal' });
  const close = () => overlay.remove();

  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, [`AI meal scan \u2014 ${mealType}`]),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.calorie-modal-close').addEventListener('click', close);

  const status = el('div', { className: 'calorie-ai-status' }, ['Capture or upload a photo of your meal.']);
  const fileInput = el('input', { className: 'calorie-ai-file', type: 'file', accept: 'image/*' });

  async function process(file) {
    if (!file) return;
    status.textContent = 'Analyzing photo…';
    try {
      const items = await analyzeMealPhoto(file);
      close();
      if (!items.length) { showToast('No food detected in photo', 'error'); return; }
      buildBreakdownModal(items, mealType, onConfirm);
    } catch (err) {
      status.textContent = '';
      showToast(err.message || 'AI analysis failed', 'error');
    }
  }

  const cameraBtn = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['\uD83D\uDCF8 Take photo']);
  cameraBtn.addEventListener('click', async () => {
    try {
      const file = await captureStillFromCamera({ title: 'Snap your meal' });
      if (file) await process(file);
    } catch (err) {
      showToast(err.message || 'Camera unavailable', 'error');
    }
  });

  fileInput.addEventListener('change', () => process(fileInput.files?.[0]));

  modal.append(
    header,
    el('div', { className: 'calorie-modal-body' }, [
      status,
      el('div', { className: 'calorie-ai-actions' }, [cameraBtn, fileInput]),
    ]),
  );
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}
