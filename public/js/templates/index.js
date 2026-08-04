/* ============================================================
   templates/index.js — Template registry & detection engine

   The fallback checklist template is loaded eagerly so the app can
   render immediately, while the rest of the template modules load
   on demand when a sheet/view actually requires them.
   ============================================================ */

import { TEMPLATES, onEdit } from './shared.js';
import { TEMPLATE_REGISTRY } from './registry-data.js';

/* Load the fallback template eagerly so the app can render immediately. */
import './checklist.js';

const _loadingTemplates = new Map();

const STRONG_SIGNALS = new Set([
  'timestamp','logged','entry.date','log.date','recorded','created.at',
  'company','lead','prospect','account','organization','org','deal','pipeline','stage','value','opportunity',
  'workflow','automation','script','scenario','action','target','selector','locator',
  'blog','post','author','article','doc','google doc',
  'goal','metric','email','phone','mobile','cell','name','contact','person',
  'amount','budget','expense','income','category','quantity','qty','stock','price','cost',
  'time','day','hour','slot','shift','period','block',
  'agent','provider','tuning','heartbeat','model','status','workboard','command',
  'version','release','changelog','breaking','added','fixed','what changed','what.changed',
  'result','expected','actual','test','case','priority','started','objective','key result','owner','quarter',
]);
const WEAK_SIGNALS = new Set([
  'status','done','complete','check','progress','percent','score','rating','level','grade','completion',
  'start','end','date','type','title','description','item','task','notes','note','activity','entry','record','board',
  'version','release','change','changes','changed','type','kind','label',
  'goal','target','started','result','expected','actual','priority','test','case',
]);

/**
 * Create a lightweight placeholder definition for metadata-driven
 * detection and metadata-only UI access before the real module loads.
 * @param {string} key
 * @param {Object} meta
 * @returns {Object}
 */
function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function signalMatches(header, signal) {
  const headerText = normalizeText(header);
  const signalText = normalizeText(signal);
  if (!headerText || !signalText) return false;
  if (headerText === signalText) return true;
  const headerTokens = headerText.split(' ');
  const signalTokens = signalText.split(' ');
  return signalTokens.every(token => headerTokens.includes(token));
}

function evaluateTemplateSignals(lower, meta) {
  const signals = Array.isArray(meta?.detectSignals) ? meta.detectSignals : [];
  const requiredSignals = Array.isArray(meta?.detectRequiredSignals) ? meta.detectRequiredSignals : [];
  const matched = signals.filter(signal => lower.some(h => signalMatches(h, signal)));
  if (matched.length === 0) return null;

  const requiredMatched = requiredSignals.filter(signal => lower.some(h => signalMatches(h, signal)));
  if (requiredSignals.length > 0 && requiredMatched.length !== requiredSignals.length) return null;

  const hasStrongMatch = matched.some(signal => STRONG_SIGNALS.has(normalizeText(signal)));
  const hasWeakMatch = matched.some(signal => WEAK_SIGNALS.has(normalizeText(signal)));
  const exactHeaderMatches = matched.filter(signal => lower.some(h => normalizeText(h) === normalizeText(signal))).length;
  const isMatch = hasStrongMatch || requiredMatched.length > 0 || exactHeaderMatches >= 2 || (hasWeakMatch && matched.length >= 2) || matched.length >= 4;
  if (!isMatch) return null;

  let score = matched.length * 10;
  score += requiredMatched.length * 35;
  if (hasStrongMatch) score += 80;
  if (hasWeakMatch) score += 8;
  score += exactHeaderMatches * 6;

  return { score, matchedCount: matched.length, requiredMatched: requiredMatched.length };
}

function createPlaceholderTemplate(key, meta) {
  const signals = Array.isArray(meta?.detectSignals) ? meta.detectSignals : [];

  return {
    key,
    name: meta?.name || key,
    icon: meta?.icon || '📊',
    color: meta?.color || '#64748b',
    priority: meta?.priority || 10,
    detect(lower) {
      return !!evaluateTemplateSignals(lower, meta);
    },
    columns(lower) {
      const result = {};
      const roles = Array.isArray(meta?.columnRoles) ? meta.columnRoles : [];
      roles.forEach((role) => {
        const idx = lower.findIndex(h => {
          const text = (h || '').toLowerCase();
          if (!text) return false;
          if (role === 'text') return /(^|[^a-z])text($|[^a-z])/.test(text) || /description|name|title|item|task|entry|activity|post|content|recipe|company|employee|student|objective|goal|question|choice|version|invoice|job|game|contact|ticket|subject|note/.test(text);
          if (role === 'status') return /status|done|complete|checked|flag|state/.test(text);
          if (role === 'date') return /date|day|week|time|when/.test(text);
          if (role === 'notes') return /notes|comment|details|remarks/.test(text);
          if (role === 'category') return /category|type|group|section|class|tag|kind/.test(text);
          if (role === 'amount') return /amount|price|cost|value|total|balance|payment|fee/.test(text);
          if (role === 'progress') return /progress|percent|score|rating|level|grade|completion/.test(text);
          if (role === 'quantity') return /quantity|qty|count|stock|units|size/.test(text);
          if (role === 'priority') return /priority|severity|importance/.test(text);
          return text.includes(role.replace(/[^a-z]/g, ''));
        });
        if (idx >= 0) result[role] = idx;
      });
      return result;
    },
    render() {},
    _lazyPlaceholder: true,
  };
}

Object.entries(TEMPLATE_REGISTRY).forEach(([key, meta]) => {
  if (!TEMPLATES[key]) {
    TEMPLATES[key] = createPlaceholderTemplate(key, meta);
  }
});

/**
 * Load a template module on demand and return its definition.
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
export async function loadTemplate(key) {
  if (!key) return null;
  const existing = TEMPLATES[key];
  if (existing && !existing._lazyPlaceholder) return existing;

  const meta = TEMPLATE_REGISTRY[key];
  if (!meta) return existing || null;

  if (_loadingTemplates.has(key)) {
    return _loadingTemplates.get(key);
  }

  const promise = import(meta.modulePath)
    .then(() => TEMPLATES[key] || createPlaceholderTemplate(key, meta))
    .catch((err) => {
      console.warn(`[templates] Failed to load ${key}`, err);
      return TEMPLATES[key] || createPlaceholderTemplate(key, meta);
    });

  _loadingTemplates.set(key, promise);
  try {
    return await promise;
  } finally {
    _loadingTemplates.delete(key);
  }
}

/**
 * Return the currently known template definition for a key.
 * @param {string} key
 * @returns {Object|null}
 */
export function getTemplate(key) {
  return TEMPLATES[key] || null;
}

/**
 * Detect the best-matching template for the given headers.
 * Returns { key, template } or defaults to checklist.
 */
export function detectTemplate(headers) {
  if (!headers || headers.length === 0) {
    return { key: 'checklist', template: TEMPLATES.checklist };
  }

  const lower = headers.map(h => (h || '').toLowerCase().trim());

  const candidates = Object.entries(TEMPLATE_REGISTRY)
    .map(([key, meta]) => {
      const template = TEMPLATES[key] || createPlaceholderTemplate(key, meta);
      let scoreInfo = null;
      const metadataScore = evaluateTemplateSignals(lower, meta);
      if (metadataScore) {
        scoreInfo = metadataScore;
      } else if (template && typeof template.detect === 'function') {
        const isMatch = template.detect(lower);
        if (isMatch) scoreInfo = { score: 1000 + (template.priority || 0), matchedCount: 0 };
      }
      return { key, template, scoreInfo };
    })
    .filter(({ scoreInfo }) => scoreInfo)
    .sort((a, b) => {
      const scoreDelta = (b.scoreInfo?.score || 0) - (a.scoreInfo?.score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      const priorityDelta = (b.template.priority || 0) - (a.template.priority || 0);
      if (priorityDelta !== 0) return priorityDelta;
      return (b.key === 'checklist' ? -1 : 0) - (a.key === 'checklist' ? -1 : 0);
    });

  if (candidates.length > 0) {
    const { key, template } = candidates[0];
    return { key, template };
  }

  return { key: 'checklist', template: TEMPLATES.checklist };
}

export { TEMPLATES, onEdit };
