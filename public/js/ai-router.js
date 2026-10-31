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
  openAiGenerationParams,
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
import * as vault from './agent/vault.js';

/* ---------- Capabilities ---------- */
const CAP = {
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
const ALL_PROVIDERS = ['ollama', 'gemini', 'openai', 'claude'];

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
function providerHasConfig(provider) {
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
function effectiveTier(provider) {
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
function tierBadge(provider) {
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
function enabledProviders() {
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
function providersForCapability(capability) {
  return enabledProviders()
    .filter(p => PROVIDER_META[p] && PROVIDER_META[p].caps.has(capability))
    .sort((a, b) => effectiveTier(a) - effectiveTier(b));
}

/**
 * Status snapshot of every provider — for the AI settings UI.
 * @returns {Array<{provider:string,label:string,configured:boolean,enabled:boolean,tier:number,badge:string,caps:string[]}>}
 */
function getProviderStatus() {
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
function resolveAgentProvider() {
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
async function testProviderConnection(provider) {
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
 * @param {{ temperature?: number, maxTokens?: number, provider?: string }} [opts]
 * @returns {Promise<string>} text, or an image data URL / URL for image generation
 */
async function routeAI(capability, payload = {}, opts = {}) {
  if (vault.isVaultSetUp() && !vault.isVaultUnlocked()) {
    const hasBiometrics = vault.hasBiometricVault();
    const unlocked = await vault.ensureVaultUnlocked();
    if (!unlocked) {
      throw new Error(hasBiometrics
        ? 'Biometric unlock was cancelled or failed. Unlock your AI keys and try again.'
        : 'Your AI keys are locked. Unlock them in AI settings and enable biometric unlock for next time.');
    }
  }

  const capableProviders = providersForCapability(capability);
  const providers = opts.provider ? capableProviders.filter(provider => provider === opts.provider) : capableProviders;
  if (!providers.length) {
    throw new Error(opts.provider
      ? `${PROVIDER_META[opts.provider]?.label || opts.provider} is not enabled and configured for this task.`
      : noProviderMessage(capability));
  }

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

function providerError(provider, model, res, body) {
  const error = new Error(`${provider} (${model}): ${body?.error?.message || `API error ${res.status}`}`);
  error.status = res.status;
  error.code = body?.error?.code;
  error.param = body?.error?.param;
  return error;
}

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
    maxOutputTokens: opts.maxTokens ?? 1024,
  };
  // Gemini 3+ uses its default sampling settings for reasoning.
  const geminiVersion = Number(model.replace(/^models\//, '').match(/^gemini-(\d+)/)?.[1] || 0);
  if (geminiVersion < 3) generationConfig.temperature = opts.temperature ?? 0.4;
  if (capability === CAP.STRUCTURED_JSON) generationConfig.responseMimeType = 'application/json';

  const body = {
    contents: [{ role: 'user', parts }],
    systemInstruction: { parts: [{ text: payload.systemPrompt || '' }] },
    generationConfig,
  };

  let lastErr;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const keyEntry = keys[attempt % keys.length];
    const res = await fetch(url, { method: 'POST', headers: geminiHeaders(keyEntry.key), body: JSON.stringify(body) });
    if (!res.ok) {
      if (keyEntry.idx >= 0) recordKeyError(keyEntry.idx);
      const errBody = await res.json().catch(() => ({}));
      lastErr = providerError('Gemini', model, res, errBody);
      if ((res.status === 408 || res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) {
        const retryAfter = Number(res.headers?.get?.('Retry-After'));
        const delay = retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000) + Math.floor(Math.random() * 200)));
        continue;
      }
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
    ...openAiGenerationParams(model, { maxTokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.4 }),
    ...(capability === CAP.STRUCTURED_JSON ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetch(openAiChatUrl(), { method: 'POST', headers: openAiHeaders(picked.key), body: JSON.stringify(body) });
  if (!res.ok) {
    if (picked.idx >= 0) recordOpenAIKeyError(picked.idx);
    const errBody = await res.json().catch(() => ({}));
    throw providerError('OpenAI', model, res, errBody);
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
  const selectedModel = getOpenAIImageModel() || DEFAULT_OPENAI_IMAGE_MODEL;
  // DALL·E image models have been retired. Existing saved settings should use
  // the app's GPT Image default instead of repeatedly sending rejected calls.
  const model = /^dall-e-[23]$/.test(selectedModel) ? DEFAULT_OPENAI_IMAGE_MODEL : selectedModel;
  if (!/^(?:gpt-image-|chatgpt-image-latest$)/.test(model)) {
    throw new Error('Photoreal rendering requires a GPT Image model.');
  }
  const n = payload.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('Image count must be between 1 and 10.');
  const legacySizes = { '1792x1024': '1536x1024', '1024x1792': '1024x1536', '256x256': '1024x1024', '512x512': '1024x1024' };
  const size = legacySizes[payload.size] || payload.size || 'auto';
  if (/^gpt-image-1(?:[.-]|$)/.test(model) && !['auto', '1024x1024', '1536x1024', '1024x1536'].includes(size)) {
    throw new Error('This GPT Image model supports auto, 1024x1024, 1536x1024, or 1024x1536 image sizes.');
  }
  const imagePayload = { ...payload, n, size };

  if (payload.referenceImage) {
    return callOpenAIImageEdit(picked, model, imagePayload);
  }

  const body = {
    model,
    prompt: payload.prompt || '',
    n,
    size,
  };
  // GPT Image does not accept seed or response_format. Its base64 result is
  // returned by default; reference edits supply the actual drawing geometry.

  const res = await fetch(openAiImageUrl(), { method: 'POST', headers: openAiHeaders(picked.key), body: JSON.stringify(body) });
  if (!res.ok) {
    if (picked.idx >= 0) recordOpenAIKeyError(picked.idx);
    const errBody = await res.json().catch(() => ({}));
    throw providerError('OpenAI image', model, res, errBody);
  }
  if (picked.idx >= 0) recordOpenAIKeyUsage(picked.idx);
  const data = await res.json();
  const item = (data.data && data.data[0]) || {};
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error('No image returned from OpenAI.');
}

async function callOpenAIImageEdit(picked, model, payload) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z\d+/=]+)$/i.exec(String(payload.referenceImage || ''));
  if (!match) throw new Error('Could not prepare the 3D view for image editing.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const imageBlob = new Blob([bytes], { type: match[1].toLowerCase() });
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', payload.prompt || '');
  const extension = match[1].toLowerCase().split('/')[1];
  form.append('image', imageBlob, `floorplan-3d-view.${extension}`);
  if (model === 'gpt-image-1' || model === 'gpt-image-1.5') {
    form.append('input_fidelity', 'high');
  }
  form.append('n', String(payload.n));
  form.append('size', payload.size);

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
    throw providerError('OpenAI image edit', model, res, errBody);
  }
  if (picked.idx >= 0) recordOpenAIKeyUsage(picked.idx);
  const data = await res.json();
  const item = (data.data && data.data[0]) || {};
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error('No image returned from OpenAI.');
}

export {
  ALL_PROVIDERS,
  CAP,
  effectiveTier,
  enabledProviders,
  getProviderStatus,
  providerHasConfig,
  providersForCapability,
  resolveAgentProvider,
  routeAI,
  testProviderConnection,
  tierBadge,
};
