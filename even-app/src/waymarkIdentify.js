/**
 * waymarkIdentify.js — Gemini vision "point & identify" for the G2 glasses
 *
 * The Waymark idea, on the glasses: the wearer points at something, we capture a
 * photo through the Even SDK camera, ask Gemini what the pointed-at object is,
 * and show a concise answer on the G2 HUD.
 *
 * Reuses the same Gemini endpoint + request shape as the Waymark web app
 * (generativelanguage generateContent with an inline image part). Pure and
 * fetch-injectable so it is unit-testable with `node --test`.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Default vision-capable Gemini model (fast, cheap, supports image input). */
export const DEFAULT_VISION_MODEL = 'gemini-2.0-flash';

const KEY_STORAGE = 'waymark_gemini_key';
const MODEL_STORAGE = 'waymark_gemini_model';

/* ---------- Local credential/model storage (browser) ---------- */

export function getStoredApiKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, String(key || '').trim());
  } catch {
    /* non-browser / storage blocked — ignore */
  }
}

export function getStoredModel() {
  try {
    return localStorage.getItem(MODEL_STORAGE) || DEFAULT_VISION_MODEL;
  } catch {
    return DEFAULT_VISION_MODEL;
  }
}

export function setStoredModel(model) {
  try {
    localStorage.setItem(MODEL_STORAGE, String(model || '').trim() || DEFAULT_VISION_MODEL);
  } catch {
    /* ignore */
  }
}

/* ---------- Pure request/response helpers ---------- */

/**
 * Build the Gemini generateContent request for a point-and-identify query.
 * @param {{ imageBase64: string, mimeType?: string, question?: string, model?: string }} opts
 * @returns {{ url: string, headers: Object, body: Object }}
 */
export function buildIdentifyRequest({ imageBase64, mimeType = 'image/jpeg', question, model = DEFAULT_VISION_MODEL }) {
  const q = (question || '').trim() || 'What am I pointing at?';
  const system =
    'You are the vision assistant for Even Realities G2 smart glasses. ' +
    'The wearer is pointing at something in the photo — look for a hand or ' +
    'extended finger and follow its direction. Answer the question about the ' +
    'object being pointed at. Be concise and concrete: at most ~14 words, no ' +
    'markdown, no preamble, so it fits on a tiny heads-up display line.';

  return {
    url: `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': '' },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: q },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 120 },
    },
  };
}

/**
 * Extract the answer text from a Gemini generateContent response.
 * @param {Object} data
 * @returns {string}
 */
export function parseIdentifyResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text || '')
    .join('')
    .trim();

  if (!text) {
    const blocked = data?.promptFeedback?.blockReason;
    if (blocked) throw new Error(`Gemini blocked the request (${blocked}).`);
    throw new Error('No answer from Gemini. Try again.');
  }
  return text;
}

/**
 * Send a captured frame + question to Gemini and return a concise answer.
 * @param {{ imageBase64: string, mimeType?: string, question?: string,
 *           apiKey: string, model?: string, fetchImpl?: Function }} opts
 * @returns {Promise<string>}
 */
export async function identifyPointedObject({ imageBase64, mimeType = 'image/jpeg', question, apiKey, model, fetchImpl }) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('No Gemini API key set. Add your key first.');
  if (!imageBase64) throw new Error('No image to identify.');

  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) throw new Error('fetch is unavailable in this environment.');

  const req = buildIdentifyRequest({ imageBase64, mimeType, question, model: model || getStoredModel() });
  const res = await doFetch(req.url, {
    method: 'POST',
    headers: { ...req.headers, 'X-goog-api-key': key },
    body: JSON.stringify(req.body),
  });

  if (!res.ok) {
    let msg = `Gemini API error ${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }

  const data = await res.json();
  return parseIdentifyResponse(data);
}
