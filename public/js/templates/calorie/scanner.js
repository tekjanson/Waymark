/* ============================================================
   calorie/scanner.js — Hybrid barcode scanning

   Uses the native window.BarcodeDetector when available (hardware-
   accelerated on modern devices) with a graceful manual-entry fallback
   for older iOS WebKit. Resolves the detected code against the local
   Food DB, then Open Food Facts, and hands the result to the serving modal.
   ============================================================ */

import { el, showToast } from '../shared.js';
import { lookupBarcode, loadFoodDatabase } from './helpers.js';
import { openServingModal } from './modal.js';

/** Trigger a short haptic pulse where supported. */
function vibrate() {
  try { if (navigator.vibrate) navigator.vibrate(100); } catch { /* ignore */ }
}

/**
 * Resolve a barcode string → food, then open the serving modal.
 * @param {string} code
 * @param {string} mealType
 * @param {Function} onConfirm
 */
async function resolveAndLog(code, mealType, onConfirm) {
  const foods = await loadFoodDatabase();
  const food = await lookupBarcode(code, foods);
  if (!food) {
    showToast(`No product found for ${code}`, 'error');
    return false;
  }
  openServingModal({ food, mealType, onConfirm });
  return true;
}

/**
 * Open the barcode scanner overlay. When BarcodeDetector is unsupported,
 * shows a manual numeric entry fallback instead of the live camera.
 *
 * @param {{ mealType:string, onConfirm:Function }} opts
 */
export async function openBarcodeScanner({ mealType, onConfirm }) {
  const supported = typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && !!navigator.mediaDevices?.getUserMedia;

  const overlay = el('div', { className: 'calorie-scan-overlay' });
  const panel = el('div', { className: 'calorie-scan-panel' });
  const title = el('div', { className: 'calorie-scan-title' }, ['Scan barcode']);
  const closeBtn = el('button', { className: 'calorie-modal-close', type: 'button', 'aria-label': 'Close' }, ['\u00D7']);
  const header = el('div', { className: 'calorie-scan-header' }, [title, closeBtn]);
  panel.append(header);
  overlay.append(panel);
  document.body.appendChild(overlay);

  let stream = null;
  let rafId = null;
  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach(t => t.stop());
    overlay.remove();
  };
  closeBtn.addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  /* ---- Manual entry (always available as fallback) ---- */
  const manualInput = el('input', {
    className: 'calorie-scan-manual-input', type: 'text', inputmode: 'numeric',
    placeholder: 'Enter barcode number', autocomplete: 'off',
  });
  const manualBtn = el('button', { className: 'calorie-modal-submit', type: 'button' }, ['Look up']);
  const manualForm = el('div', { className: 'calorie-scan-manual' }, [manualInput, manualBtn]);
  const submitManual = async () => {
    const code = manualInput.value.trim();
    if (!code) return;
    const ok = await resolveAndLog(code, mealType, onConfirm);
    if (ok) cleanup();
  };
  manualBtn.addEventListener('click', submitManual);
  manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitManual(); });

  if (!supported) {
    panel.append(
      el('div', { className: 'calorie-scan-hint' }, ['Live scanning is not supported on this device. Enter the barcode manually:']),
      manualForm,
    );
    manualInput.focus();
    return;
  }

  /* ---- Live scanning path ---- */
  const video = el('video', { className: 'calorie-scan-video', autoplay: true, playsInline: true, muted: true });
  const reticle = el('div', { className: 'calorie-scan-reticle' });
  panel.append(
    el('div', { className: 'calorie-scan-video-wrap' }, [video, reticle]),
    el('div', { className: 'calorie-scan-hint' }, ['Point the camera at a barcode']),
    manualForm,
  );

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    video.srcObject = stream;
  } catch {
    showToast('Camera unavailable — enter the barcode manually', 'error');
    return;
  }

  const detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
  });

  let done = false;
  const scan = async () => {
    if (done) return;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) {
        done = true;
        vibrate();
        const code = codes[0].rawValue;
        const ok = await resolveAndLog(code, mealType, onConfirm);
        cleanup();
        if (!ok) openBarcodeScanner({ mealType, onConfirm });
        return;
      }
    } catch { /* transient decode error — keep scanning */ }
    rafId = requestAnimationFrame(scan);
  };
  rafId = requestAnimationFrame(scan);
}
