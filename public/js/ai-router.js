/* ============================================================
   ai-router.js — Capability- and cost-aware multi-provider router
   ------------------------------------------------------------
   One entry point, routeAI(capability, payload), picks the
   cheapest capable + configured provider and calls it. Multiple
   providers (Ollama, Gemini, Anthropic, OpenAI) can be active at
   once; the router always defaults to the freest provider that
   supports the requested capability and falls back to the next
   cheapest on rate-limit / capability gaps.
   ============================================================ */

import {
  getAgentModel,
  getAgentProvider,
  getClaudeModel,
  getOllamaModel,
  getOllamaBaseUrl,
  getOpenAIModel,
  getOpenAIImageModel,
  getOpenAIKeys,
  getClaudeKeys,
  getGeminiTier,
  getEnabledProviders,
  recordKeyUsage,
  recordKeyError,
  recordClaudeKeyUsage,
  recordClaudeKeyError,
  recordOpenAIKeyUsage,
  recordOpenAIKeyError,
} from './storage.js';
import {
  geminiUrl,
  geminiHeaders,
  claudeUrl,
  claudeHeaders,
  ollamaChatUrl,
  openAiChatUrl,
  openAiImageUrl,
  openAiImageEditUrl,
  openAiHeaders,
  pickBestKey,
  pickBestClaudeKey,
  pickBestOpenAIKey,
  GEMINI_API_BASE,
  CLAUDE_API_BASE,
  OPENAI_API_BASE,
  DEFAULT_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_IMAGE_MODEL,
} from './agent/config.js';

/* ---------- Capabilities ---------- */

export const CAP = {
  TEXT_BASIC: 'text_basic',
  STRUCTURED_JSON: 'structured_json',
  AGENT_REASONING: 'agent_reasoning',
  VISION_ANALYSIS: 'vision_analysis',
  AUDIO_ANALYSIS: 'audio_analysis',
  IMAGE_GENERATION_PHOTOREAL: 'image_generation_photoreal',
};

const TEXT_CAPS = [CAP.TEXT_BASIC, CAP.STRUCTURED_JSON, CAP.AGENT_REASONING];

/* Provider knowledge: which capabilities each supports and a base cost tier.
   Lower tier = cheaper/freer. Gemini's tier is dynamic (free vs paid). */
const PROVIDER_META = {
  ollama: { label: 'Ollama', order: ['ollama'], caps: new Set(TEXT_CAPS) },
  gemini: { label: 'Gemini', caps: new Set([...TEXT_CAPS, CAP.VISION_ANALYSIS, CAP.AUDIO_ANALYSIS]) },
  openai: { label: 'OpenAI', caps: new Set([...TEXT_CAPS, CAP.VISION_ANALYSIS, CAP.IMAGE_GENERATION_PHOTOREAL]) },
  claude: { label: 'Claude', caps: new Set([...TEXT_CAPS, CAP.VISION_ANALYSIS]) },
};

export const ALL_PROVIDERS = ['ollama', 'gemini', 'openai', 'claude'];

/* ---------- Provider configuration / cost ---------- */

function serverKeyEntry(globalName) {
  const key = typeof window !== 'undefined' ? window[globalName] : null;
  return key ? { key, idx: -1 } : null;
}

/**
 * Whether a provider has a usable configuration (keys or local endpoint).
 * @param {string} provider
 * @returns {boolean}
 */
export function providerHasConfig(provider) {
  switch (provider) {
    case 'gemini': return pickBestKey().length > 0;
    case 'claude': return !!pickBestClaudeKey() || !!serverKeyEntry('__WAYMARK_CLAUDE_KEY');
    case 'openai': return (getOpenAIKeys().length > 0) || !!pickBestOpenAIKey() || !!serverKeyEntry('__WAYMARK_OPENAI_KEY');
    case 'ollama': return !!(getOllamaBaseUrl() || getOllamaModel());
    default: return false;
  }
}

/**
 * Numeric cost tier for a provider (lower = cheaper). Gemini is dynamic:
 * Free Tier = 0 (cheapest), Paid Tier = 1.
 * @param {string} provider
 * @returns {number}
 */
export function effectiveTier(provider) {
  switch (provider) {
    case 'ollama': return 0;
    case 'gemini': return getGeminiTier() === 'paid' ? 1 : 0;
    case 'openai': return 2;
    case 'claude': return 3;
    default: return 9;
  }
}

/**
 * Human badge for a provider's cost tier (used by the settings UI).
 * @param {string} provider
 * @returns {string}
 */
export function tierBadge(provider) {
  switch (provider) {
    case 'ollama': return 'LOCAL/FREE';
    case 'gemini': return getGeminiTier() === 'paid' ? '$' : 'FREE TIER';
    case 'openai': return '$$';
    case 'claude': return '$$$';
    default: return '';
  }
}

/**
 * The providers that are enabled for simultaneous use. When the user has not
 * set an explicit list, every configured provider is considered enabled so
 * existing single-provider setups keep working unchanged.
 * @returns {string[]}
 */
export function enabledProviders() {
  const explicit = getEnabledProviders();
  if (Array.isArray(explicit)) {
    return explicit.filter(p => ALL_PROVIDERS.includes(p) && providerHasConfig(p));
  }
  return ALL_PROVIDERS.filter(p => providerHasConfig(p));
}

/**
 * The enabled + configured providers that support a capability, cheapest first.
 * @param {string} capability
 * @returns {string[]}
 */
export function providersForCapability(capability) {
  return enabledProviders()
    .filter(p => PROVIDER_META[p] && PROVIDER_META[p].caps.has(capability))
    .sort((a, b) => effectiveTier(a) - effectiveTier(b));
}

/**
 * Status snapshot of every provider — for the AI settings UI.
 * @returns {Array<{provider:string,label:string,configured:boolean,enabled:boolean,tier:number,badge:string,caps:string[]}>}
 */
export function getProviderStatus() {
  const enabled = new Set(enabledProviders());
  return ALL_PROVIDERS.map(provider => ({
    provider,
    label: PROVIDER_META[provider].label,
    configured: providerHasConfig(provider),
    enabled: enabled.has(provider),
    tier: effectiveTier(provider),
    badge: tierBadge(provider),
    caps: [...PROVIDER_META[provider].caps],
  }));
}

/**
 * Resolve which provider the conversational agent should use. Honours the
 * user's preferred provider when it is enabled + capable, otherwise falls back
 * to the cheapest enabled provider that can reason.
 * @returns {string}
 */
export function resolveAgentProvider() {
  const preferred = getAgentProvider();
  const candidates = providersForCapability(CAP.AGENT_REASONING);
  if (candidates.includes(preferred)) return preferred;
  return candidates[0] || preferred;
}

/**
 * Lightweight connection test for a provider — lists models (or Ollama tags)
 * without spending generation tokens.
 * @param {string} provider
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function testProviderConnection(provider) {
  try {
    if (provider === 'gemini') {
      const entry = pickBestKey()[0];
      if (!entry) return { ok: false, message: 'No Gemini key' };
      const res = await fetch(`${GEMINI_API_BASE}?key=${encodeURIComponent(entry.key)}`);
      return { ok: res.ok, message: res.ok ? 'Connected' : `HTTP ${res.status}` };
    }
    if (provider === 'claude') {
      const picked = pickBestClaudeKey() || serverKeyEntry('__WAYMARK_CLAUDE_KEY');
      if (!picked) return { ok: false, message: 'No Claude key' };
      const res = await fetch(`${CLAUDE_API_BASE}/models`, { headers: claudeHeaders(picked.key) });
      return { ok: res.ok, message: res.ok ? 'Connected' : `HTTP ${res.status}` };
    }
    if (provider === 'openai') {
      const picked = pickBestOpenAIKey() || serverKeyEntry('__WAYMARK_OPENAI_KEY');
      if (!picked) return { ok: false, message: 'No OpenAI key' };
      const res = await fetch(`${OPENAI_API_BASE}/models`, { headers: openAiHeaders(picked.key) });
      return { ok: res.ok, message: res.ok ? 'Connected' : `HTTP ${res.status}` };
    }
    if (provider === 'ollama') {
      const baseUrl = getOllamaBaseUrl() || DEFAULT_OLLAMA_BASE_URL;
      const res = await fetch(`${baseUrl}/api/tags`);
      return { ok: res.ok, message: res.ok ? 'Connected' : `HTTP ${res.status}` };
    }
    return { ok: false, message: 'Unknown provider' };
  } catch (err) {
    return { ok: false, message: err.message || 'Connection failed' };
  }
}

/* ---------- Routing ---------- */

/**
 * Route an AI task to the cheapest capable provider, falling back to the next
 * cheapest provider on rate-limit / capability errors.
 *
 * @param {string} capability — one of CAP.*
 * @param {Object} payload
 *   text/json/reasoning: { systemPrompt, userMessage }
 *   vision:  { systemPrompt, userMessage?, base64Image, mimeType }
 *   audio:   { systemPrompt, userMessage?, base64Audio, mimeType }
 *   image:   { prompt, size?, n? }
 * @param {{ temperature?: number, maxTokens?: number }} [opts]
 * @returns {Promise<string>} text, or an image data URL / URL for image generation
 */
export async function routeAI(capability, payload = {}, opts = {}) {
  const providers = providersForCapability(capability);
  if (!providers.length) throw new Error(noProviderMessage(capability));

  let lastErr;
  for (const provider of providers) {
    try {
      return await callProvider(provider, capability, payload, opts);
    } catch (err) {
      lastErr = err;
      // Try the next cheapest provider on any failure (rate limit, capability
      // gap, transient error). Only the final error surfaces to the caller.
    }
  }
  throw lastErr || new Error('All configured AI providers failed.');
}

function noProviderMessage(capability) {
  if (capability === CAP.IMAGE_GENERATION_PHOTOREAL) {
    return 'Photorealistic image generation needs an OpenAI key — Gemini Free Tier cannot generate images. Add an OpenAI key in AI settings.';
  }
  if (capability === CAP.AUDIO_ANALYSIS) {
    return 'Voice features need a Gemini key. Add one in AI settings.';
  }
  return 'No AI provider is configured for this task. Add a key in AI settings.';
}

function callProvider(provider, capability, payload, opts) {
  if (capability === CAP.IMAGE_GENERATION_PHOTOREAL) {
    if (provider === 'openai') return callOpenAIImage(payload, opts);
    throw new Error(`${provider} cannot generate photorealistic images`);
  }
  switch (provider) {
    case 'gemini': return callGemini(capability, payload, opts);
    case 'claude': return callClaude(capability, payload, opts);
    case 'ollama': return callOllama(capability, payload, opts);
    case 'openai': return callOpenAIChat(capability, payload, opts);
    default: throw new Error(`Unknown provider ${provider}`);
  }
}

/* ---------- Gemini adapter ---------- */

async function callGemini(capability, payload, opts) {
  const keys = pickBestKey();
  if (!keys.length) throw new Error('No Gemini key configured.');
  const model = getAgentModel() || DEFAULT_MODEL;
  const url = geminiUrl(model, 'generateContent');

  const parts = [];
  if (capability === CAP.VISION_ANALYSIS || capability === CAP.AUDIO_ANALYSIS) {
    if (payload.userMessage) parts.push({ text: payload.userMessage });
    const data = capability === CAP.AUDIO_ANALYSIS ? payload.base64Audio : payload.base64Image;
    const mimeType = payload.mimeType || (capability === CAP.AUDIO_ANALYSIS ? 'audio/webm' : 'image/jpeg');
    parts.push({ inlineData: { mimeType, data } });
  } else {
    parts.push({ text: payload.userMessage || '' });
  }

  const generationConfig = {
    temperature: opts.temperature ?? 0.4,
    maxOutputTokens: opts.maxTokens ?? 1024,
  };
  if (capability === CAP.STRUCTURED_JSON) generationConfig.responseMimeType = 'application/json';

  const body = {
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: payload.systemPrompt || '' }] },
    generationConfig,
  };

  let lastErr;
  for (const keyEntry of keys) {
    const res = await fetch(url, { method: 'POST', headers: geminiHeaders(keyEntry.key), body: JSON.stringify(body) });
    if (!res.ok) {
      if (keyEntry.idx >= 0) recordKeyError(keyEntry.idx);
      const errBody = await res.json().catch(() => ({}));
      lastErr = new Error(errBody?.error?.message || `Gemini API error ${res.status}`);
      if (res.status === 429 || res.status === 503) continue;
      throw lastErr;
    }
    if (keyEntry.idx >= 0) recordKeyUsage(keyEntry.idx);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) throw new Error('No response from Gemini.');
    return text;
  }
  throw lastErr || new Error('All Gemini keys exhausted.');
}

/* ---------- Claude adapter ---------- */

async function callClaude(capability, payload, opts) {
  if (capability === CAP.AUDIO_ANALYSIS) throw new Error('Claude has no audio capability.');
  const picked = pickBestClaudeKey() || serverKeyEntry('__WAYMARK_CLAUDE_KEY');
  if (!picked) throw new Error('No Claude key configured.');
  const model = getClaudeModel() || DEFAULT_CLAUDE_MODEL;

  let content;
  if (capability === CAP.VISION_ANALYSIS) {
    content = [
      ...(payload.userMessage ? [{ type: 'text', text: payload.userMessage }] : []),
      { type: 'image', source: { type: 'base64', media_type: payload.mimeType || 'image/jpeg', data: payload.base64Image } },
    ];
  } else {
    content = payload.userMessage || '';
  }

  const body = {
    model,
    system: payload.systemPrompt || '',
    messages: [{ role: 'user', content }],
    max_tokens: opts.maxTokens ?? 1024,
  };

  const res = await fetch(claudeUrl(), { method: 'POST', headers: claudeHeaders(picked.key), body: JSON.stringify(body) });
  if (!res.ok) {
    if (picked.idx >= 0) recordClaudeKeyError(picked.idx);
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `Claude API error ${res.status}`);
  }
  if (picked.idx >= 0) recordClaudeKeyUsage(picked.idx);
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('').trim();
  if (!text) throw new Error('No response from Claude.');
  return text;
}

/* ---------- Ollama adapter (local, free) ---------- */

async function callOllama(capability, payload, opts) {
  if (capability === CAP.VISION_ANALYSIS || capability === CAP.AUDIO_ANALYSIS) {
    throw new Error('Local Ollama models have no vision/audio capability.');
  }
  const model = getOllamaModel() || DEFAULT_OLLAMA_MODEL;
  const baseUrl = getOllamaBaseUrl() || DEFAULT_OLLAMA_BASE_URL;
  const body = {
    model,
    messages: [
      { role: 'system', content: payload.systemPrompt || '' },
      { role: 'user', content: payload.userMessage || '' },
    ],
    stream: false,
    options: { temperature: opts.temperature ?? 0.4 },
    ...(capability === CAP.STRUCTURED_JSON ? { format: 'json' } : {}),
  };
  const res = await fetch(ollamaChatUrl(baseUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const data = await res.json();
  const text = (data.message?.content || '').trim();
  if (!text) throw new Error('No response from Ollama.');
  return text;
}

/* ---------- OpenAI adapters ---------- */

async function callOpenAIChat(capability, payload, opts) {
  if (capability === CAP.AUDIO_ANALYSIS) throw new Error('OpenAI chat has no inline-audio capability.');
  const picked = pickBestOpenAIKey() || serverKeyEntry('__WAYMARK_OPENAI_KEY');
  if (!picked) throw new Error('No OpenAI key configured.');
  const model = getOpenAIModel() || DEFAULT_OPENAI_MODEL;

  let userContent;
  if (capability === CAP.VISION_ANALYSIS) {
    const dataUrl = `data:${payload.mimeType || 'image/jpeg'};base64,${payload.base64Image}`;
    userContent = [
      ...(payload.userMessage ? [{ type: 'text', text: payload.userMessage }] : []),
      { type: 'image_url', image_url: { url: dataUrl } },
    ];
  } else {
    userContent = payload.userMessage || '';
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: payload.systemPrompt || '' },
      { role: 'user', content: userContent },
    ],
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.4,
    ...(capability === CAP.STRUCTURED_JSON ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(openAiChatUrl(), { method: 'POST', headers: openAiHeaders(picked.key), body: JSON.stringify(body) });
  if (!res.ok) {
    if (picked.idx >= 0) recordOpenAIKeyError(picked.idx);
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `OpenAI API error ${res.status}`);
  }
  if (picked.idx >= 0) recordOpenAIKeyUsage(picked.idx);
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('No response from OpenAI.');
  return text;
}

async function callOpenAIImage(payload, opts) {
  const picked = pickBestOpenAIKey() || serverKeyEntry('__WAYMARK_OPENAI_KEY');
  if (!picked) throw new Error('No OpenAI key configured for image generation.');
  const model = getOpenAIImageModel() || DEFAULT_OPENAI_IMAGE_MODEL;

  if (payload.referenceImage) {
    if (!model.startsWith('gpt-image-')) {
      throw new Error('Using the 3D view as a geometry reference requires a GPT Image model. Choose gpt-image-1 in AI settings.');
    }
    return callOpenAIImageEdit(picked, model, payload);
  }

  const body = {
    model,
    prompt: payload.prompt || '',
    n: payload.n || 1,
    size: payload.size || '1024x1024',
  };
  // Inject the drawing seed so iterative renders stay locked to the layout
  // (ignored by models that don't support it).
  if (payload.seed != null && Number.isFinite(Number(payload.seed))) {
    body.seed = Number(payload.seed);
  }
  // dall-e-3 returns a URL unless asked for base64; gpt-image-1 always returns base64.
  if (model === 'dall-e-3') body.response_format = 'b64_json';

  const res = await fetch(openAiImageUrl(), { method: 'POST', headers: openAiHeaders(picked.key), body: JSON.stringify(body) });
  if (!res.ok) {
    if (picked.idx >= 0) recordOpenAIKeyError(picked.idx);
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `OpenAI image API error ${res.status}`);
  }
  if (picked.idx >= 0) recordOpenAIKeyUsage(picked.idx);
  const data = await res.json();
  const item = (data.data && data.data[0]) || {};
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error('No image returned from OpenAI.');
}

async function callOpenAIImageEdit(picked, model, payload) {
  const source = await fetch(payload.referenceImage);
  if (!source.ok) throw new Error('Could not prepare the 3D view for image editing.');
  const imageBlob = await source.blob();
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', payload.prompt || '');
  form.append('image', imageBlob, 'floorplan-3d-view.png');
  if (model === 'gpt-image-1' || model === 'gpt-image-1.5') {
    form.append('input_fidelity', 'high');
  }
  if (payload.n) form.append('n', String(payload.n));

  // The browser supplies the multipart boundary; setting Content-Type here
  // would prevent the API from reading the uploaded reference image.
  const res = await fetch(openAiImageEditUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${picked.key}` },
    body: form,
  });
  if (!res.ok) {
    if (picked.idx >= 0) recordOpenAIKeyError(picked.idx);
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `OpenAI image edit API error ${res.status}`);
  }
  if (picked.idx >= 0) recordOpenAIKeyUsage(picked.idx);
  const data = await res.json();
  const item = (data.data && data.data[0]) || {};
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error('No image returned from OpenAI.');
}
