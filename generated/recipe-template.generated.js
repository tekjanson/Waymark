/* ============================================================
   Generated Template: 📖 Recipe Book
   Key: recipe | Sheet ID: sheet-027
   Generated at: 2026-02-27T20:34:29.715Z
   ============================================================ */

/* ──────────────────────────────────────────────────────────── */
/* Fixture JSON */
/* ──────────────────────────────────────────────────────────── */

{
  "id": "sheet-027",
  "title": "Spaghetti Bolognese Recipe Book",
  "sheetTitle": "Sheet1",
  "values": [
    [
      "Recipe",
      "Servings",
      "Prep Time",
      "Cook Time",
      "Category",
      "Difficulty"
    ],
    [
      "Spaghetti Bolognese",
      "4",
      "15 min",
      "45 min",
      "Italian",
      "Easy"
    ],
    [
      "Chicken Tikka Masala",
      "4",
      "20 min",
      "35 min",
      "Indian",
      "Medium"
    ],
    [
      "Caesar Salad",
      "2",
      "10 min",
      "0 min",
      "American",
      "Easy"
    ],
    [
      "Beef Stir Fry",
      "3",
      "15 min",
      "20 min",
      "Asian",
      "Easy"
    ],
    [
      "Mushroom Risotto",
      "4",
      "10 min",
      "40 min",
      "Italian",
      "Medium"
    ],
    [
      "Fish Tacos",
      "4",
      "15 min",
      "15 min",
      "Mexican",
      "Easy"
    ],
    [
      "Pad Thai",
      "3",
      "20 min",
      "15 min",
      "Thai",
      "Medium"
    ],
    [
      "Banana Pancakes",
      "2",
      "5 min",
      "15 min",
      "Breakfast",
      "Easy"
    ]
  ]
}

/* ──────────────────────────────────────────────────────────── */
/* Template Definition (paste into templates.js TEMPLATES object) */
/* ──────────────────────────────────────────────────────────── */

  /* 📖 Recipe Book — Cooking recipes with ingredients, servings, prep/cook time */
  recipe: {
    name: 'Recipe Book',
    icon: '📖',
    color: '#ea580c',
    priority: 17,
    detect(lower) {
      return lower.some(h => /^(recipe|ingredients|servings)/.test(h))
        && lower.some(h => /^(prep|cook|cuisine)/.test(h));
    },
    columns(lower) {
      const cols = { text: -1, servings: -1, prepTime: -1, cookTime: -1, category: -1, difficulty: -1 };
      cols.text = lower.findIndex(h => /^(recipe|name|title|description|item)/.test(h));
      if (cols.text === -1) cols.text = 0;
      cols.servings = lower.findIndex(h => /^(servings)/.test(h));
      cols.prepTime = lower.findIndex(h => /^(prep time)/.test(h));
      cols.cookTime = lower.findIndex(h => /^(cook time)/.test(h));
      cols.category = lower.findIndex(h => /^(category)/.test(h));
      cols.difficulty = lower.findIndex(h => /^(difficulty)/.test(h));
      return cols;
    },
    render: renderRecipe,
  },

/* ──────────────────────────────────────────────────────────── */
/* Renderer Function (paste into templates.js after other renderers) */
/* ──────────────────────────────────────────────────────────── */

/* --- Recipe Book Renderer --- */
function renderRecipe(container, rows, cols, template) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIdx = i + 1;
    const text = cell(row, cols.text) || row[0] || '—';
    const servings = cell(row, cols.servings);
    const prepTime = cell(row, cols.prepTime);
    const cookTime = cell(row, cols.cookTime);
    const category = cell(row, cols.category);
    const difficulty = cell(row, cols.difficulty);

    const rowEl = el('div', { className: 'recipe-row' }, [
      el('div', { className: 'recipe-row-title' }, [text]),
      servings ? el('span', { className: 'recipe-servings' }, [`Servings: ${servings}`]) : null,
      prepTime ? el('span', { className: 'recipe-prepTime' }, [`Prep Time: ${prepTime}`]) : null,
      cookTime ? el('span', { className: 'recipe-cookTime' }, [`Cook Time: ${cookTime}`]) : null,
      category ? el('span', { className: 'recipe-category' }, [`Category: ${category}`]) : null,
      difficulty ? el('span', { className: 'recipe-difficulty' }, [`Difficulty: ${difficulty}`]) : null,
    ]);

    container.append(rowEl);
  }
}

/* ──────────────────────────────────────────────────────────── */
/* Example Sheets (paste into examples.js EXAMPLE_SHEETS) */
/* ──────────────────────────────────────────────────────────── */

  // --- Recipe Book examples ---
  'Recipe Book Example 1': {
    folder: 'Recipes',
    rows: [
      ["Recipe","Servings","Prep Time","Cook Time","Category","Difficulty"],
      ["Spaghetti Bolognese","4","15 min","45 min","Italian","Easy"],
      ["Chicken Tikka Masala","4","20 min","35 min","Indian","Medium"],
      ["Caesar Salad","2","10 min","0 min","American","Easy"],
      ["Beef Stir Fry","3","15 min","20 min","Asian","Easy"],
      ["Mushroom Risotto","4","10 min","40 min","Italian","Medium"],
    ],
  },
  'Recipe Book Example 2': {
    folder: 'Recipes',
    rows: [
      ["Recipe","Servings","Prep Time","Cook Time","Category","Difficulty"],
      ["Beef Stir Fry","3","15 min","20 min","Asian","Easy"],
      ["Mushroom Risotto","4","10 min","40 min","Italian","Medium"],
      ["Fish Tacos","4","15 min","15 min","Mexican","Easy"],
      ["Pad Thai","3","20 min","15 min","Thai","Medium"],
      ["Banana Pancakes","2","5 min","15 min","Breakfast","Easy"],
    ],
  },

/* ──────────────────────────────────────────────────────────── */
/* CSS Styles (append to style.css) */
/* ──────────────────────────────────────────────────────────── */

/* --- Recipe Book Template --- */

.recipe-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.recipe-row:hover {
  background: var(--hover);
}
.recipe-row-title {
  flex: 1;
  font-weight: 500;
}

.recipe-servings {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.2rem 0.5rem;
  background: var(--hover);
  border-radius: 4px;
}

.recipe-prepTime {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.2rem 0.5rem;
  background: var(--hover);
  border-radius: 4px;
}

.recipe-cookTime {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.2rem 0.5rem;
  background: var(--hover);
  border-radius: 4px;
}

.recipe-category {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.2rem 0.5rem;
  background: var(--hover);
  border-radius: 4px;
}

.recipe-difficulty {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.2rem 0.5rem;
  background: var(--hover);
  border-radius: 4px;
}

/* ──────────────────────────────────────────────────────────── */
/* E2E Tests (append to templates.spec.js) */
/* ──────────────────────────────────────────────────────────── */

/* ===== Recipe Book template ===== */

test('recipe detected as Recipe Book template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Recipe Book');
});

test('recipe renders correct number of rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-row', { timeout: 5_000 });

  const rows = page.locator('.recipe-row');
  expect(await rows.count()).toBe(8);
});

test('recipe shows first item text', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-row', { timeout: 5_000 });

  const firstTitle = page.locator('.recipe-row-title').first();
  await expect(firstTitle).toContainText('Spaghetti Bolognese');
});

/* ──────────────────────────────────────────────────────────── */
/* API Client Mapping (add to loadMockSheet mapping) */
/* ──────────────────────────────────────────────────────────── */

    'sheet-027': 'recipe-spaghetti-bolognese',

/* ──────────────────────────────────────────────────────────── */
/* Folder Entry (add to folders.json WayMark Examples files array) */
/* ──────────────────────────────────────────────────────────── */

{
  "id": "sheet-027",
  "name": "Spaghetti Bolognese Recipe Book",
  "mimeType": "application/vnd.google-apps.spreadsheet"
}

/* ──────────────────────────────────────────────────────────── */
/* Registry Entry (add to template-registry.json templates array) */
/* ──────────────────────────────────────────────────────────── */

{
  "key": "recipe",
  "name": "Recipe Book",
  "icon": "📖",
  "color": "#ea580c",
  "priority": 17,
  "category": "Personal",
  "detectSignals": [
    "recipe",
    "ingredients",
    "servings",
    "prep",
    "cook",
    "cuisine"
  ],
  "columnRoles": [
    "text",
    "servings",
    "prepTime",
    "cookTime",
    "category",
    "difficulty"
  ],
  "interactive": false,
  "interactionType": "none",
  "exampleCount": 2,
  "fixtureIds": [
    "sheet-027"
  ],
  "fixtureFiles": [
    "recipe-spaghetti-bolognese"
  ]
}

