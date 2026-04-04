/* ============================================================
   social/helpers.js — Pure helpers and constants for Social template
   ============================================================ */

import {
  getEchoCancellation, getNoiseSuppression, getAutoGainControl,
  getNoiseGateThreshold, getHighPassFreq, getEchoSuppression,
} from '../shared.js';

/** Column reserved for WebRTC signaling (must match webrtc.js SIG_COL). */
export const SIG_COL = 20;

/**
 * Build getUserMedia audio constraints from saved preferences.
 * Returns a detailed constraints object with echo cancellation,
 * noise suppression, and auto gain control settings.
 * @returns {Object} Audio constraints for getUserMedia
 */
export function buildAudioConstraints() {
  return {
    echoCancellation: { ideal: getEchoCancellation() },
    noiseSuppression: { ideal: getNoiseSuppression() },
    autoGainControl: { ideal: getAutoGainControl() },
  };
}

/**
 * Build the audioProcessing options bag passed to WaymarkConnect.startCall().
 * These control the Web Audio processing pipeline (high-pass + noise gate).
 * @returns {Object}
 */
export function buildAudioProcessing() {
  return {
    highPassFreq: getHighPassFreq(),
    gateThreshold: Math.pow(10, getNoiseGateThreshold() / 20),
    echoSuppression: getEchoSuppression(),
  };
}

export const MOOD_MAP = {
  happy: '😊', sad: '😢', excited: '🎉', angry: '😤',
  love: '❤️', thinking: '🤔', laughing: '😂', cool: '😎',
  tired: '😴', surprised: '😮', grateful: '🙏', proud: '💪',
};

export const CATEGORY_COLORS = {
  update: '#3b82f6', photo: '#8b5cf6', link: '#0d9488',
  thought: '#f59e0b', milestone: '#22c55e', question: '#ec4899',
  chat: '#64748b',
};

/** First letter avatar with a stable color */
export function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 50%)`;
}

/** Relative time string */
export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
