/* ============================================================
   recipe-vision.js — AI Vision recipe extraction

   Sends an image of a recipe (photo, scan, screenshot) to the
   Gemini Vision API and extracts structured recipe data in the
   same format returned by recipe-scraper.js, so both import
   paths share the same downstream processing.

   Requires window.__WAYMARK_API_KEY to be set (server-injected).
   ============================================================ */

/* ---------- Constants ---------- */

const VISION_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/* ---------- Vision prompt ---------- */

const EXTRACTION_PROMPT = `You are a recipe extraction assistant. Carefully read the recipe in this image and return ONLY a valid JSON object — no markdown, no code fences, no commentary.

Return this exact structure:
{
  "name": "Recipe title",
  "servings": "e.g. 4",
  "prepTime": "e.g. 15 min",
  "cookTime": "e.g. 30 min",
  "category": "e.g. Italian",
  "difficulty": "Easy | Medium | Hard",
  "ingredients": [
    { "qty": "400", "unit": "g", "name": "spaghetti" },
    { "qty": "1", "unit": "tsp", "name": "salt" },
    { "qty": "", "unit": "", "name": "black pepper to taste" }
  ],
  "instructions": [
    "First step text",
    "Second step text"
  ],
  "description": "Brief description (optional)"
}

Rules:
- Each ingredient is a separate object. Split quantity, unit, and name.
- qty should be a number string (e.g. "2", "0.5") or empty if not present.
- unit should be standard (tsp, tbsp, cup, g, kg, ml, oz, lb, cloves, etc.) or empty.
- Each instruction is a separate string in the array.
- If a field is unknown, use an empty string.
- Return ONLY the JSON — nothing else.`;

/* ---------- Helpers ---------- */

/**
 * Convert a File to a base64 data string (without the data-URL prefix).
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // Strip "data:image/...;base64," prefix
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Parse the raw text response from Gemini and return a recipe object.
 * Handles minor JSON formatting issues gracefully.
 * @param {string} text
 * @returns {Object}
 */
function parseVisionResponse(text) {
  if (!text) throw new Error('Empty response from vision API');

  // Strip potential markdown code fences the model may add despite instructions
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to find a JSON object anywhere in the response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse recipe from image — no JSON found in response');
    try {
      parsed = JSON.parse(match[0]);
    } catch (e2) {
      throw new Error(`Could not parse recipe JSON: ${e2.message}`);
    }
  }

  // Normalise to expected shape
  const ingredients = Array.isArray(parsed.ingredients)
    ? parsed.ingredients.map(i => ({
        qty:  String(i.qty  ?? '').trim(),
        unit: String(i.unit ?? '').trim(),
        name: String(i.name ?? '').trim(),
      })).filter(i => i.name || i.qty)
    : [];

  const instructions = Array.isArray(parsed.instructions)
    ? parsed.instructions.map(s => String(s || '').trim()).filter(Boolean)
    : [];

  return {
    name:        String(parsed.name        || 'Scanned Recipe').trim(),
    servings:    String(parsed.servings    || '').trim(),
    prepTime:    String(parsed.prepTime    || '').trim(),
    cookTime:    String(parsed.cookTime    || '').trim(),
    category:    String(parsed.category    || '').trim(),
    difficulty:  String(parsed.difficulty  || '').trim(),
    description: String(parsed.description || '').trim(),
    ingredients,
    instructions,
    method: 'vision',
  };
}

/* ---------- Public API ---------- */

/**
 * Scan a recipe from an image file using the Gemini Vision API.
 * Returns a recipe object in the same format as scrapeRecipe().
 *
 * @param {File} file — the image file (JPEG, PNG, WebP, HEIC)
 * @returns {Promise<Object>} recipe object
 * @throws {Error} if no API key, invalid file, or API failure
 */
export async function scanRecipeFromImage(file) {
  // Validate input type
  if (!(file instanceof File)) throw new Error('Expected a File object');
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image format. Please use JPEG, PNG, or WebP.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (max 10 MB). Please use a smaller image.`);
  }

  // Get API key (server-injected)
  const apiKey = window.__WAYMARK_API_KEY;
  if (!apiKey) {
    throw new Error('Vision scanning requires an API key — please contact the administrator.');
  }

  // Read image as base64
  const imageBase64 = await fileToBase64(file);

  // Build Gemini request
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(VISION_MODEL)}:generateContent`;
  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: file.type,
            data: imageBase64,
          },
        },
        { text: EXTRACTION_PROMPT },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`Vision API request failed: ${err.message}`);
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Vision API error: ${msg}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    throw new Error('Vision API returned an empty response — the image may not contain a recipe.');
  }

  return parseVisionResponse(text);
}
