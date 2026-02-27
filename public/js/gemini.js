/* ============================================================
   gemini.js — Gemini API wrapper via Google OAuth token
   Uses the Generative Language REST endpoint.
   ============================================================ */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'models/gemini-2.0-flash';

/**
 * Check whether the user's account has Gemini access.
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function isAvailable(token) {
  try {
    const res = await fetch(`${BASE}/${MODEL}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Perform a natural-language query against the user's sheet data.
 * @param {string} token
 * @param {string} userQuery   the user's search text
 * @param {Object[]} context   array of { id, name, folder } for known sheets
 * @returns {Promise<{matches: Object[], summary: string}>}
 */
export async function query(token, userQuery, context = []) {
  const prompt = buildPrompt(userQuery, context);

  const res = await fetch(`${BASE}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  const data = await res.json();

  try {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return JSON.parse(text);
  } catch {
    return { matches: [], summary: 'Could not parse AI response.' };
  }
}

/* ---------- Prompt construction ---------- */

function buildPrompt(userQuery, context) {
  const sheetList = context.map(s => `- "${s.name}" (id: ${s.id}, folder: ${s.folder || 'root'})`).join('\n');

  return `You are a helpful assistant for WayMark, a checklist app that reads Google Sheets.

The user has these sheets available:
${sheetList || '(none loaded yet)'}

The user asks: "${userQuery}"

Return a JSON object with:
- "matches": an array of objects with "sheetId", "sheetName", and "reason" fields for sheets that match the query.
  Only include sheets from the list above.
- "summary": a brief one-sentence summary of the search results.

If nothing matches, return { "matches": [], "summary": "No matching sheets found." }`;
}

export { buildPrompt };
