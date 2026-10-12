/* ============================================================
   floorplan/ai-vision.js — Multi-photo AI floor plan drafting

   Accepts multiple photos, runs iterative vision extraction, and
   returns a normalized layout payload consumable by the floorplan
   canvas renderer.
   ============================================================ */

import { captureStillFromCamera, el, generateVision, showToast } from '../shared.js';

const SYSTEM_PROMPT =
  'You are a residential floor-plan extraction assistant. ' +
  'Given one interior/home photo at a time, infer or refine a simple top-down plan. ' +
  'Return strict JSON only. Schema: ' +
  '{"rooms":[{"label":"string","x":0-100,"y":0-100,"width":1-100,"height":1-100}],' +
  '"walls":[{"label":"string","x1":0-100,"y1":0-100,"x2":0-100,"y2":0-100}],' +
  '"electrical":[{"label":"string","x":0-100,"y":0-100}],' +
  '"plumbing":[{"label":"string","x":0-100,"y":0-100}],' +
  '"fixtures":[{"label":"string","x":0-100,"y":0-100}],' +
  '"notes":["string"]}. ' +
  'Use empty arrays when unknown. Keep coordinates within 0-100. No markdown.';

const MAX_PHOTOS = 8;
const MAX_EDGE = 1600;
const MAX_IMAGE_BYTES = 1_800_000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function loadImageFromFile(file) {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not decode image "${file.name}"`));
    img.src = dataUrl;
  });
}

async function prepareInlineImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Only image files are supported.');
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare image for AI analysis.');
  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let base64 = dataUrl.split(',')[1] || '';
  let bytes = Math.floor((base64.length * 3) / 4);
  while (bytes > MAX_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    base64 = dataUrl.split(',')[1] || '';
    bytes = Math.floor((base64.length * 3) / 4);
  }

  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image "${file.name}" is too large after compression. Try a smaller photo.`);
  }

  return {
    name: file.name,
    mimeType: 'image/jpeg',
    base64,
  };
}

function parseJsonPayload(text) {
  if (!text) return null;
  let raw = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePlan(raw) {
  const plan = raw && typeof raw === 'object' ? raw : {};
  const norm = {
    rooms: [],
    walls: [],
    electrical: [],
    plumbing: [],
    fixtures: [],
    notes: Array.isArray(plan.notes) ? plan.notes.map(note => String(note || '').trim()).filter(Boolean) : [],
  };

  const normalizeRoom = (item) => ({
    label: String(item?.label || '').trim(),
    x: clamp(num(item?.x), 0, 100),
    y: clamp(num(item?.y), 0, 100),
    width: clamp(num(item?.width, 15), 1, 100),
    height: clamp(num(item?.height, 12), 1, 100),
  });

  const normalizeWall = (item) => ({
    label: String(item?.label || '').trim(),
    x1: clamp(num(item?.x1), 0, 100),
    y1: clamp(num(item?.y1), 0, 100),
    x2: clamp(num(item?.x2), 0, 100),
    y2: clamp(num(item?.y2), 0, 100),
  });

  const normalizePoint = (item) => ({
    label: String(item?.label || '').trim(),
    x: clamp(num(item?.x), 0, 100),
    y: clamp(num(item?.y), 0, 100),
  });

  if (Array.isArray(plan.rooms)) norm.rooms = plan.rooms.map(normalizeRoom);
  if (Array.isArray(plan.walls)) norm.walls = plan.walls.map(normalizeWall);
  if (Array.isArray(plan.electrical)) norm.electrical = plan.electrical.map(normalizePoint);
  if (Array.isArray(plan.plumbing)) norm.plumbing = plan.plumbing.map(normalizePoint);
  if (Array.isArray(plan.fixtures)) norm.fixtures = plan.fixtures.map(normalizePoint);

  return norm;
}

async function inferPlanFromImages(images) {
  const mock = typeof window !== 'undefined' ? window.__WAYMARK_FLOORPLAN_VISION_MOCK : null;
  if (mock) {
    const payload = typeof mock === 'function' ? mock(images) : mock;
    return normalizePlan(payload);
  }

  if (!images.length) throw new Error('Attach at least one photo before generating.');

  let draft = {
    rooms: [],
    walls: [],
    electrical: [],
    plumbing: [],
    fixtures: [],
    notes: [],
  };

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const msg = i === 0
      ? 'Create an initial floor-plan draft from this first photo.'
      : `Refine this existing draft with another photo. Existing draft JSON: ${JSON.stringify(draft)}`;
    const text = await generateVision(SYSTEM_PROMPT, image.base64, image.mimeType, {
      userMessage: `Photo ${i + 1} of ${images.length}. ${msg}`,
      temperature: 0.2,
      maxTokens: 1800,
    });
    const parsed = parseJsonPayload(text);
    if (!parsed) throw new Error('AI returned an invalid response. Try again with clearer photos.');
    draft = normalizePlan(parsed);
  }

  return draft;
}

function pickImageFiles({ capture = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = !!multiple;
    if (capture) input.setAttribute('capture', capture);
    input.onchange = () => resolve(Array.from(input.files || []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export function openFloorplanAiModal({ onApply }) {
  const overlay = el('div', { className: 'floorplan-ai-overlay' });
  const modal = el('div', { className: 'floorplan-ai-modal' });
  const close = () => overlay.remove();

  const state = {
    images: [],
    generated: null,
    busy: false,
  };

  const title = el('div', { className: 'floorplan-ai-title' }, ['AI Floor Plan From Photos']);
  const closeBtn = el('button', { className: 'floorplan-ai-close', type: 'button', 'aria-label': 'Close' }, ['x']);
  closeBtn.addEventListener('click', close);
  const header = el('div', { className: 'floorplan-ai-header' }, [title, closeBtn]);

  const status = el('div', { className: 'floorplan-ai-status' }, ['Attach 2-8 photos (different angles), then generate.']);
  const list = el('div', { className: 'floorplan-ai-files' });

  const updateFileList = () => {
    list.innerHTML = '';
    if (!state.images.length) {
      list.append(el('div', { className: 'floorplan-ai-empty' }, ['No photos attached yet.']));
      return;
    }
    state.images.forEach((img, idx) => {
      const removeBtn = el('button', { className: 'floorplan-ai-remove', type: 'button' }, ['Remove']);
      removeBtn.addEventListener('click', () => {
        state.images.splice(idx, 1);
        updateFileList();
      });
      list.append(el('div', { className: 'floorplan-ai-file-row' }, [
        el('span', { className: 'floorplan-ai-file-name' }, [img.name]),
        removeBtn,
      ]));
    });
  };
  updateFileList();

  const attachBtn = el('button', { className: 'floorplan-ai-btn', type: 'button' }, ['Attach Photos']);
  attachBtn.addEventListener('click', async () => {
    try {
      const files = await pickImageFiles({ multiple: true });
      if (!files.length) return;
      const prepared = [];
      for (const file of files.slice(0, MAX_PHOTOS)) {
        prepared.push(await prepareInlineImage(file));
      }
      state.images = [...state.images, ...prepared].slice(0, MAX_PHOTOS);
      updateFileList();
      showToast(`Attached ${prepared.length} photo${prepared.length > 1 ? 's' : ''}`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not attach photos', 'error');
    }
  });

  const cameraBtn = el('button', { className: 'floorplan-ai-btn', type: 'button' }, ['Take Photo']);
  cameraBtn.addEventListener('click', async () => {
    try {
      const file = await captureStillFromCamera({ title: 'Capture floor plan reference' });
      if (!file) return;
      const prepared = await prepareInlineImage(file);
      state.images = [...state.images, prepared].slice(0, MAX_PHOTOS);
      updateFileList();
      showToast('Photo captured', 'success');
    } catch (err) {
      showToast(err.message || 'Could not capture photo', 'error');
    }
  });

  const generateBtn = el('button', { className: 'floorplan-ai-btn floorplan-ai-btn-primary', type: 'button' }, ['Generate Floor Plan']);
  generateBtn.addEventListener('click', async () => {
    if (state.busy) return;
    state.busy = true;
    generateBtn.disabled = true;
    status.textContent = 'Analyzing photos and drafting floor plan...';
    try {
      state.generated = await inferPlanFromImages(state.images);
      const summary = `Draft ready: ${state.generated.rooms.length} rooms, ${state.generated.walls.length} walls, ${state.generated.electrical.length} electrical, ${state.generated.plumbing.length} plumbing.`;
      status.textContent = summary;
      showToast('AI draft generated', 'success');
    } catch (err) {
      status.textContent = err.message || 'Generation failed.';
      showToast(err.message || 'Generation failed', 'error');
    } finally {
      state.busy = false;
      generateBtn.disabled = false;
    }
  });

  const applyBtn = el('button', { className: 'floorplan-ai-btn floorplan-ai-btn-primary', type: 'button' }, ['Apply to Canvas']);
  applyBtn.addEventListener('click', () => {
    if (!state.generated) {
      showToast('Generate a draft first', 'error');
      return;
    }
    try {
      const appliedCount = typeof onApply === 'function' ? onApply(state.generated) : 0;
      if (!appliedCount) {
        showToast('Nothing was applied to canvas. Try generating again.', 'error');
        return;
      }
      close();
    } catch (err) {
      showToast(err.message || 'Could not apply AI draft to canvas.', 'error');
    }
  });

  const footer = el('div', { className: 'floorplan-ai-actions' }, [
    attachBtn,
    cameraBtn,
    generateBtn,
    applyBtn,
  ]);

  modal.append(header, status, list, footer);
  overlay.append(modal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.appendChild(overlay);
}
