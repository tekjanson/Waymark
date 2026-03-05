/* ============================================================
   public/js/recipe-scraper.js — Recipe URL scraper

   Fetches a web page via the server-side /api/fetch-url proxy,
   parses the HTML in-browser using DOMParser, and extracts
   recipe data.

   Strategies (in order):
   1. JSON-LD structured data (schema.org/Recipe) — most reliable
   2. Heuristic HTML parsing (common CSS classes & headings) — fallback

   Returns a normalised recipe object:
   { name, servings, prepTime, cookTime, category, difficulty,
     ingredients: { quantity, name }[], instructions: string[],
     sourceUrl, method }
   ============================================================ */

// ---------- Page fetching via server proxy ----------

/**
 * Fetch a URL via the server-side proxy at /api/fetch-url.
 * Respects __WAYMARK_BASE so it works at both / (dev) and /waymark (prod).
 * @param {string} url
 * @returns {Promise<string>} HTML text
 */
async function fetchPage(url) {
  const base = (typeof window !== 'undefined' && window.__WAYMARK_BASE) || '';
  const endpoint = `${base}/api/fetch-url`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Server returned HTTP ${resp.status}`);
  }

  const data = await resp.json();
  if (!data.html || data.html.length < 100) {
    throw new Error('Empty or too-short response from the recipe page');
  }
  return data.html;
}

// ---------- HTML utility helpers ----------

/**
 * Strip HTML tags from a string, decode common entities, collapse whitespace.
 * @param {string} html
 * @returns {string}
 */
function stripTags(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|li|div|h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Parse an ISO 8601 duration (PT30M, PT1H15M) to human-readable string.
 * @param {string} iso
 * @returns {string}
 */
function parseDuration(iso) {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return iso;
  const parts = [];
  if (m[1]) parts.push(`${m[1]} hr`);
  if (m[2]) parts.push(`${m[2]} min`);
  if (m[3] && parts.length === 0) parts.push(`${m[3]} sec`);
  return parts.join(' ') || iso;
}

// ---------- JSON-LD extraction ----------

/**
 * Extract JSON-LD Recipe objects from a parsed DOM document.
 * @param {Document} doc
 * @returns {Object|null}
 */
function extractJsonLd(doc) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent);

      // Handle @graph arrays
      if (data['@graph'] && Array.isArray(data['@graph'])) {
        data = data['@graph'];
      }

      // If it's an array, search for Recipe
      if (Array.isArray(data)) {
        const recipe = data.find(item =>
          item['@type'] === 'Recipe' ||
          (Array.isArray(item['@type']) && item['@type'].includes('Recipe'))
        );
        if (recipe) return recipe;
      }

      // Direct Recipe object
      if (data['@type'] === 'Recipe' ||
          (Array.isArray(data['@type']) && data['@type'].includes('Recipe'))) {
        return data;
      }
    } catch { /* skip invalid JSON */ }
  }
  return null;
}

// ---------- Normalisation helpers ----------

/**
 * Normalise instruction entries into plain text steps.
 * @param {*} instructions
 * @returns {string[]}
 */
function normaliseInstructions(instructions) {
  if (!instructions) return [];
  if (typeof instructions === 'string') {
    return stripTags(instructions).split('\n').filter(Boolean);
  }
  if (Array.isArray(instructions)) {
    const steps = [];
    for (const item of instructions) {
      if (typeof item === 'string') {
        steps.push(stripTags(item));
      } else if (item.text) {
        steps.push(stripTags(item.text));
      } else if (item['@type'] === 'HowToSection' && item.itemListElement) {
        for (const sub of item.itemListElement) {
          steps.push(stripTags(sub.text || sub.name || JSON.stringify(sub)));
        }
      } else if (item.name) {
        steps.push(stripTags(item.name));
      }
    }
    return steps.filter(Boolean);
  }
  return [];
}

/**
 * Normalise ingredient entries and split each into qty + unit + name.
 * @param {*} ingredients
 * @returns {{ qty: string, unit: string, name: string }[]}
 */
function normaliseIngredients(ingredients) {
  if (!ingredients) return [];
  let raw = [];
  if (typeof ingredients === 'string') {
    raw = stripTags(ingredients).split('\n').filter(Boolean);
  } else if (Array.isArray(ingredients)) {
    raw = ingredients
      .map(i => stripTags(typeof i === 'string' ? i : (i.name || i.text || '')))
      .filter(Boolean);
  }
  return raw.map(splitIngredient);
}

/**
 * Split a raw ingredient string like "2 cups all-purpose flour" into
 * { qty: "2", unit: "cups", name: "all-purpose flour" }.
 *
 * Handles integers, decimals, Unicode fractions (½), slash fractions (1/2),
 * mixed numbers (1 1/2), and common unit abbreviations.
 *
 * @param {string} text — full ingredient string
 * @returns {{ qty: string, unit: string, name: string }}
 */
function splitIngredient(text) {
  if (!text) return { qty: '', unit: '', name: '' };
  const s = text.trim();

  // Known unit words/abbreviations
  const units = '(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|kg|ml|l|litres?|liters?|cloves?|cans?|heads?|bunch(?:es)?|pinch(?:es)?|dash(?:es)?|slices?|pieces?|sticks?|sprigs?|stalks?|handfuls?|packs?|packets?|bags?|boxes?|bottles?|jars?|containers?)';

  // Regex: optional number (int, decimal, fraction, mixed) + optional unit,
  // then the rest is the ingredient name.
  // Number patterns: "2", "2.5", "1/2", "1 1/2", "½", "1½"
  const qtyRe = new RegExp(
    `^((?:\\d+\\s+)?\\d+\\/\\d+|\\d+[\\u00BC-\\u00BE\\u2150-\\u215E]|[\\u00BC-\\u00BE\\u2150-\\u215E]|\\d+(?:\\.\\d+)?)` +
    `(?:\\s*(${units}))?\\s+(.+)$`,
    'i'
  );

  const m = s.match(qtyRe);
  if (m) {
    return { qty: m[1].trim(), unit: (m[2] || '').trim(), name: m[3].trim() };
  }

  // Fallback: number glued to unit without space, e.g. "400g spaghetti"
  const gluedRe = new RegExp(
    `^(\\d+(?:\\.\\d+)?)\\s*(${units})\\s+(.+)$`, 'i'
  );
  const gm = s.match(gluedRe);
  if (gm) {
    return { qty: gm[1].trim(), unit: gm[2].trim(), name: gm[3].trim() };
  }

  // No quantity detected — entire string is the ingredient name
  return { qty: '', unit: '', name: s };
}

// ---------- Recipe builders ----------

/**
 * Build a recipe object from JSON-LD data.
 * @param {Object} ld
 * @param {string} sourceUrl
 * @returns {Object}
 */
function recipeFromJsonLd(ld, sourceUrl) {
  const servingsRaw = ld.recipeYield;
  const servings = Array.isArray(servingsRaw) ? servingsRaw[0] : (servingsRaw || '');

  return {
    name: ld.name || 'Imported Recipe',
    servings: String(servings),
    prepTime: parseDuration(ld.prepTime),
    cookTime: parseDuration(ld.cookTime),
    totalTime: parseDuration(ld.totalTime),
    category: Array.isArray(ld.recipeCategory)
      ? ld.recipeCategory.join(', ')
      : (ld.recipeCategory || ld.recipeCuisine || ''),
    difficulty: ld.difficulty || '',
    ingredients: normaliseIngredients(ld.recipeIngredient),
    instructions: normaliseInstructions(ld.recipeInstructions),
    sourceUrl,
    description: stripTags(ld.description || ''),
  };
}

/**
 * Heuristic: extract recipe data from raw HTML/DOM when no structured data exists.
 * Uses the DOMParser output for traversal.
 * @param {Document} doc
 * @param {string} html - raw HTML string for regex fallbacks
 * @param {string} sourceUrl
 * @returns {Object}
 */
function recipeFromHeuristic(doc, html, sourceUrl) {
  const recipe = {
    name: '',
    servings: '',
    prepTime: '',
    cookTime: '',
    totalTime: '',
    category: '',
    difficulty: '',
    ingredients: [],
    instructions: [],
    sourceUrl,
    description: '',
  };

  // Title from <title> or first <h1>
  const titleEl = doc.querySelector('title') || doc.querySelector('h1');
  if (titleEl) {
    recipe.name = (titleEl.textContent || '')
      .replace(/\s*[-|–]\s*.*$/, '')
      .trim();
  }

  // Meta description
  const descMeta = doc.querySelector('meta[name="description"]');
  if (descMeta) recipe.description = descMeta.getAttribute('content') || '';

  // --- Ingredients ---
  // Look for elements whose class/id contains "ingredient"
  const ingredContainers = doc.querySelectorAll(
    '[class*="ingredient"], [id*="ingredient"]'
  );
  for (const container of ingredContainers) {
    const items = container.querySelectorAll('li');
    if (items.length > 0) {
      for (const li of items) {
        const text = (li.textContent || '').trim();
        if (text && text.length < 200) recipe.ingredients.push(text);
      }
      if (recipe.ingredients.length > 0) break;
    }
  }

  // Fallback: heading containing "Ingredient" followed by list
  if (recipe.ingredients.length === 0) {
    const headings = doc.querySelectorAll('h2, h3, h4');
    for (const h of headings) {
      if (/ingredient/i.test(h.textContent)) {
        let sibling = h.nextElementSibling;
        while (sibling && !['H2', 'H3', 'H4'].includes(sibling.tagName)) {
          const lis = sibling.querySelectorAll('li');
          for (const li of lis) {
            const text = (li.textContent || '').trim();
            if (text && text.length < 200) recipe.ingredients.push(text);
          }
          sibling = sibling.nextElementSibling;
        }
        if (recipe.ingredients.length > 0) break;
      }
    }
  }

  // --- Instructions ---
  const instrContainers = doc.querySelectorAll(
    '[class*="instruction"], [class*="direction"], [class*="step"], [class*="method"], ' +
    '[id*="instruction"], [id*="direction"], [id*="step"], [id*="method"]'
  );
  for (const container of instrContainers) {
    const items = container.querySelectorAll('li, p');
    if (items.length > 0) {
      for (const el of items) {
        const text = (el.textContent || '').trim();
        if (text && text.length < 500) recipe.instructions.push(text);
      }
      if (recipe.instructions.length > 0) break;
    }
  }

  // Fallback: heading containing "Instruction"/"Direction"/"Method" followed by list
  if (recipe.instructions.length === 0) {
    const headings = doc.querySelectorAll('h2, h3, h4');
    for (const h of headings) {
      if (/instruction|direction|method|step/i.test(h.textContent)) {
        let sibling = h.nextElementSibling;
        while (sibling && !['H2', 'H3', 'H4'].includes(sibling.tagName)) {
          const items = sibling.querySelectorAll('li, p');
          for (const el of items) {
            const text = (el.textContent || '').trim();
            if (text && text.length < 500) recipe.instructions.push(text);
          }
          sibling = sibling.nextElementSibling;
        }
        if (recipe.instructions.length > 0) break;
      }
    }
  }

  // Servings
  const servMatch = html.match(/(?:serves?|servings?|yield|portions?)\s*:?\s*(\d+)/i);
  if (servMatch) recipe.servings = servMatch[1];

  // Prep / Cook time
  const prepMatch = html.match(/prep(?:\s*time)?\s*:?\s*([\d]+\s*(?:min(?:ute)?s?|hr|hours?))/i);
  if (prepMatch) recipe.prepTime = prepMatch[1];
  const cookMatch = html.match(/cook(?:\s*time)?\s*:?\s*([\d]+\s*(?:min(?:ute)?s?|hr|hours?))/i);
  if (cookMatch) recipe.cookTime = cookMatch[1];

  // Normalise ingredients from raw strings into { qty, unit, name }
  recipe.ingredients = recipe.ingredients.map(splitIngredient);

  return recipe;
}

// ---------- Main public API ----------

/**
 * Scrape a recipe from the given URL. Runs entirely in the browser.
 * Uses a CORS proxy to fetch the page, then parses in-browser.
 *
 * @param {string} url
 * @returns {Promise<Object>}  normalised recipe object
 */
export async function scrapeRecipe(url) {
  // Validate URL
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are supported');
  }

  const html = await fetchPage(url);

  // Parse into a DOM document
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Strategy 1: JSON-LD (most recipe sites use this)
  const ld = extractJsonLd(doc);
  if (ld) {
    const recipe = recipeFromJsonLd(ld, url);
    if (recipe.ingredients.length > 0 || recipe.instructions.length > 0) {
      recipe.method = 'json-ld';
      return recipe;
    }
  }

  // Strategy 2: Heuristic HTML parsing via DOM
  const recipe = recipeFromHeuristic(doc, html, url);
  recipe.method = 'heuristic';

  if (recipe.ingredients.length === 0 && recipe.instructions.length === 0) {
    throw new Error(
      'Could not find recipe data on this page. The site may not contain a recognisable recipe format.'
    );
  }

  return recipe;
}
