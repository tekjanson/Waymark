/* ============================================================
   calorie/voice.js — Speak-to-log magical pipeline

   Record voice → Gemini multimodal (audio) → structured food/exercise
   items → interactive confirm → log to the sheet.

   "I had two eggs, toast with butter, and a banana, then ran for 20
   minutes" → itemized rows, one tap to log.

   Offline / test hook:
     window.__WAYMARK_VOICE_MOCK — an { items:[…] } object (or array, or
     a function returning one). When present the mic + network are skipped.
   ============================================================ */

import { el, showToast, generateAudio } from '../shared.js';
import { parseNum, round1, MEAL_TYPES } from './helpers.js';

const SYSTEM_PROMPT =
  'You are a nutrition logging assistant. The user will speak a description ' +
  'of food they ate and/or exercise they did. Transcribe and interpret it, ' +
  'then output STRICT JSON only (no prose) with an "items" array. Each item ' +
  'is either food or exercise:\n' +
  '- food: {"type":"food","name":string,"meal":"Breakfast|Lunch|Dinner|Snacks",' +
  '"serving_qty":number,"serving_unit":string,"calories":number,"protein":number,' +
  '"carbs":number,"fat":number}\n' +
  '- exercise: {"type":"exercise","name":string,"duration_min":number,' +
  '"calories_burned":number}\n' +
  'Estimate reasonable calories/macros from typical nutrition data. If a meal ' +
  'is not stated, infer from the food. Return only the JSON object.';

/* ---------- Audio helpers ---------- */

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read audio'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

/* ---------- Parsing ---------- */

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
  const type = (it.type || '').toLowerCase() === 'exercise'
    || it.calories_burned != null || it.duration_min != null ? 'exercise' : 'food';
  if (type === 'exercise') {
    return {
      type: 'exercise',
      name: String(it.name),
      duration: parseNum(it.duration_min ?? it.duration),
      burned: Math.round(parseNum(it.calories_burned ?? it.burned ?? it.calories)),
    };
  }
  const meal = MEAL_TYPES.includes(it.meal) ? it.meal : 'Snacks';
  return {
    type: 'food',
    name: String(it.name),
    mealType: meal,
    qty: parseNum(it.serving_qty ?? it.qty ?? 1) || 1,
    unit: String(it.serving_unit || it.unit || 'serving'),
    calories: Math.round(parseNum(it.calories)),
    protein: round1(parseNum(it.protein)),
    carbs: round1(parseNum(it.carbs)),
    fat: round1(parseNum(it.fat)),
  };
}

/**
 * Analyze a recorded audio blob into structured items.
 * @param {Blob} blob
 * @param {string} mimeType
 * @returns {Promise<Array<Object>>}
 */
export async function analyzeVoice(blob, mimeType) {
  const mock = typeof window !== 'undefined' ? window.__WAYMARK_VOICE_MOCK : null;
  if (mock) {
    const val = typeof mock === 'function' ? mock() : mock;
    const items = Array.isArray(val) ? val : (val.items || []);
    return items.map(normalizeItem).filter(Boolean);
  }
  const base64 = await blobToBase64(blob);
  const text = await generateAudio(SYSTEM_PROMPT, base64, mimeType || 'audio/webm', {
    userMessage: 'Log what I said.',
    temperature: 0.2,
  });
  return parseItems(text);
}

/* ---------- Confirm modal ---------- */

function buildConfirmModal(items, onConfirm) {
  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal calorie-ai-modal' });
  const close = () => overlay.remove();

  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, ['\uD83C\uDF99\uFE0F Voice log']),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.calorie-modal-close').addEventListener('click', close);

  const list = el('div', { className: 'calorie-ai-list' });
  const state = items.map(it => ({ ...it }));

  function renderList() {
    list.innerHTML = '';
    if (!state.length) {
      list.append(el('div', { className: 'calorie-search-empty' }, ['Nothing recognised. Close and try again.']));
      return;
    }
    state.forEach((item, idx) => {
      const isEx = item.type === 'exercise';
      const nameInput = el('input', { className: 'calorie-ai-name', type: 'text', value: item.name });
      nameInput.addEventListener('input', () => { item.name = nameInput.value; });

      const del = el('button', { className: 'calorie-ai-del', type: 'button', 'aria-label': 'Remove' }, ['\uD83D\uDDD1']);
      del.addEventListener('click', () => { state.splice(idx, 1); renderList(); });

      let fields;
      if (isEx) {
        const dur = el('input', { className: 'calorie-ai-qty', type: 'number', min: '0', step: 'any', value: String(item.duration || '') });
        const burned = el('input', { className: 'calorie-ai-cal', type: 'number', min: '0', step: 'any', value: String(item.burned) });
        dur.addEventListener('input', () => { item.duration = parseNum(dur.value); });
        burned.addEventListener('input', () => { item.burned = Math.round(parseNum(burned.value)); });
        fields = el('div', { className: 'calorie-ai-item-fields' }, [
          dur, el('span', { className: 'calorie-ai-callabel' }, ['min']),
          burned, el('span', { className: 'calorie-ai-callabel' }, ['cal burned']),
        ]);
      } else {
        const qty = el('input', { className: 'calorie-ai-qty', type: 'number', min: '0', step: 'any', value: String(item.qty) });
        const unit = el('input', { className: 'calorie-ai-unit', type: 'text', value: item.unit });
        const cal = el('input', { className: 'calorie-ai-cal', type: 'number', min: '0', step: 'any', value: String(item.calories) });
        const mealSel = el('select', { className: 'calorie-ai-meal' },
          MEAL_TYPES.map(m => el('option', { value: m }, [m])));
        mealSel.value = item.mealType;
        qty.addEventListener('input', () => {
          const f = (parseNum(qty.value) || 0) / (item.qty || 1);
          if (f > 0 && isFinite(f)) {
            item.calories = Math.round(item.calories * f);
            item.protein = round1(item.protein * f);
            item.carbs = round1(item.carbs * f);
            item.fat = round1(item.fat * f);
            cal.value = String(item.calories);
          }
          item.qty = parseNum(qty.value);
        });
        unit.addEventListener('input', () => { item.unit = unit.value; });
        cal.addEventListener('input', () => { item.calories = Math.round(parseNum(cal.value)); });
        mealSel.addEventListener('change', () => { item.mealType = mealSel.value; });
        fields = el('div', { className: 'calorie-ai-item-fields' }, [
          qty, unit, mealSel,
          el('span', { className: 'calorie-ai-callabel' }, ['cal']), cal,
        ]);
      }

      list.append(el('div', { className: `calorie-ai-item ${isEx ? 'calorie-ai-exercise' : ''}` }, [
        el('div', { className: 'calorie-ai-item-main' }, [
          el('span', { className: 'calorie-ai-badge' }, [isEx ? '\uD83C\uDFC3' : '\uD83C\uDF7D\uFE0F']),
          nameInput, del,
        ]),
        fields,
      ]));
    });
  }
  renderList();

  const confirmBtn = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Log all']);
  confirmBtn.addEventListener('click', async () => {
    if (!state.length) { close(); return; }
    for (const item of state) await onConfirm(item);
    close();
  });

  modal.append(header, el('div', { className: 'calorie-modal-body' }, [list, confirmBtn]));
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
}

/* ---------- Public entry ---------- */

/**
 * Open the voice-logging flow. onConfirm(item) receives normalized food or
 * exercise items (item.type distinguishes them).
 * @param {{ onConfirm:Function }} opts
 */
export async function openVoiceModal({ onConfirm }) {
  // Test / offline path: skip mic entirely.
  if (typeof window !== 'undefined' && window.__WAYMARK_VOICE_MOCK) {
    const items = await analyzeVoice(null, '');
    if (!items.length) { showToast('Nothing recognised', 'error'); return; }
    buildConfirmModal(items, onConfirm);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('Voice logging is not supported in this browser', 'error');
    return;
  }

  const overlay = el('div', { className: 'calorie-modal-overlay' });
  const modal = el('div', { className: 'calorie-modal' });
  const close = () => { cleanup(); overlay.remove(); };
  const header = el('div', { className: 'calorie-modal-header' }, [
    el('span', { className: 'calorie-modal-title' }, ['\uD83C\uDF99\uFE0F Speak your meal']),
    el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']),
  ]);
  header.querySelector('.calorie-modal-close').addEventListener('click', close);

  const status = el('div', { className: 'calorie-ai-status' }, ['Tap the mic, then say what you ate or did.']);
  const micBtn = el('button', { className: 'calorie-voice-mic', type: 'button', 'aria-label': 'Record' }, ['\uD83C\uDF99\uFE0F']);
  const hint = el('div', { className: 'calorie-voice-hint' }, ['e.g. "two scrambled eggs, toast with butter, and a coffee"']);

  modal.append(header, el('div', { className: 'calorie-modal-body calorie-voice-body' }, [status, micBtn, hint]));
  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);

  let stream = null, recorder = null, chunks = [], recording = false;
  const cleanup = () => {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* noop */ }
    if (stream) stream.getTracks().forEach(t => t.stop());
  };

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast('Microphone permission denied', 'error');
      return;
    }
    const mimeType = pickMimeType();
    chunks = [];
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
    recorder.addEventListener('stop', async () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      status.textContent = 'Analyzing…';
      micBtn.classList.remove('calorie-voice-recording');
      try {
        const items = await analyzeVoice(blob, blob.type);
        overlay.remove();
        if (!items.length) { showToast('Nothing recognised — try again', 'error'); return; }
        buildConfirmModal(items, onConfirm);
      } catch (err) {
        status.textContent = 'Tap the mic to try again.';
        showToast(err.message || 'Voice analysis failed', 'error');
      }
    });
    recorder.start();
    recording = true;
    micBtn.classList.add('calorie-voice-recording');
    status.textContent = 'Listening… tap again to stop.';
  }

  micBtn.addEventListener('click', () => {
    if (!recording) startRecording();
    else { recording = false; try { recorder.stop(); } catch { /* noop */ } }
  });
}
