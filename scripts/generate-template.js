#!/usr/bin/env node
/* ============================================================
   generate-template.js — Template Generator Agent for WayMark.

   Reads template-registry.json, identifies gaps in coverage,
   and generates all artifacts for a new template:
     - Fixture JSON
     - Template definition + renderer (for templates.js)
     - Example sheets data (for examples.js)
     - CSS styles (for style.css)
     - E2E tests (for templates.spec.js)
     - Registry, api-client, and folders.json updates

   Usage:
     # Auto-pick the next template from the idea bank:
     node scripts/generate-template.js

     # Specify a template idea:
     node scripts/generate-template.js "Recipe Book"

     # Write files directly (otherwise prints to stdout):
     node scripts/generate-template.js --write

     # Dry-run a specific idea:
     node scripts/generate-template.js "Recipe Book" --dry-run
   ============================================================ */

const fs   = require('fs');
const path = require('path');

/* ── Paths ── */
const ROOT          = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'template-registry.json');
const FIXTURES_DIR  = path.join(ROOT, 'tests', 'fixtures', 'sheets');
const GEN_DIR       = path.join(ROOT, 'generated');

/* ── Idea Bank — potential templates not yet built ── */
const IDEA_BANK = [
  {
    key: 'recipe',
    name: 'Recipe Book',
    icon: '📖',
    color: '#ea580c',
    category: 'Personal',
    description: 'Cooking recipes with ingredients, servings, prep/cook time',
    priority: 17,
    headers: ['Recipe', 'Servings', 'Prep Time', 'Cook Time', 'Category', 'Difficulty'],
    detectSignals: ['recipe', 'ingredients', 'servings', 'prep', 'cook', 'cuisine'],
    columnRoles: ['text', 'servings', 'prepTime', 'cookTime', 'category', 'difficulty'],
    interactive: false,
    interactionType: null,
    cssClass: 'recipe',
    rows: [
      ['Spaghetti Bolognese', '4', '15 min', '45 min', 'Italian', 'Easy'],
      ['Chicken Tikka Masala', '4', '20 min', '35 min', 'Indian', 'Medium'],
      ['Caesar Salad', '2', '10 min', '0 min', 'American', 'Easy'],
      ['Beef Stir Fry', '3', '15 min', '20 min', 'Asian', 'Easy'],
      ['Mushroom Risotto', '4', '10 min', '40 min', 'Italian', 'Medium'],
      ['Fish Tacos', '4', '15 min', '15 min', 'Mexican', 'Easy'],
      ['Pad Thai', '3', '20 min', '15 min', 'Thai', 'Medium'],
      ['Banana Pancakes', '2', '5 min', '15 min', 'Breakfast', 'Easy'],
    ],
  },
  {
    key: 'reading',
    name: 'Reading List',
    icon: '📚',
    color: '#92400e',
    category: 'Personal',
    description: 'Book tracking with author, genre, rating, read status',
    priority: 16,
    headers: ['Title', 'Author', 'Genre', 'Rating', 'Status', 'Pages'],
    detectSignals: ['author', 'genre', 'isbn', 'publisher', 'reading', 'pages', 'book'],
    columnRoles: ['text', 'author', 'genre', 'rating', 'status', 'pages'],
    interactive: true,
    interactionType: 'status-cycle',
    interactionStates: ['To Read', 'Reading', 'Finished', 'Abandoned'],
    cssClass: 'reading',
    rows: [
      ['Dune', 'Frank Herbert', 'Sci-Fi', '5', 'Finished', '412'],
      ['1984', 'George Orwell', 'Dystopian', '4', 'Finished', '328'],
      ['Project Hail Mary', 'Andy Weir', 'Sci-Fi', '5', 'Reading', '476'],
      ['Atomic Habits', 'James Clear', 'Self-Help', '4', 'To Read', '320'],
      ['The Hobbit', 'J.R.R. Tolkien', 'Fantasy', '5', 'Finished', '310'],
      ['Sapiens', 'Yuval Noah Harari', 'History', '4', 'To Read', '443'],
      ['Educated', 'Tara Westover', 'Memoir', '4', 'Reading', '334'],
    ],
  },
  {
    key: 'workout',
    name: 'Workout Plan',
    icon: '🏋️',
    color: '#dc2626',
    category: 'Health',
    description: 'Exercise routines with sets, reps, weight, muscle group',
    priority: 17,
    headers: ['Exercise', 'Sets', 'Reps', 'Weight', 'Muscle Group', 'Rest'],
    detectSignals: ['exercise', 'sets', 'reps', 'weight', 'muscle', 'workout', 'bench', 'squat'],
    columnRoles: ['text', 'sets', 'reps', 'weight', 'muscleGroup', 'rest'],
    interactive: true,
    interactionType: 'inline-edit',
    cssClass: 'workout',
    rows: [
      ['Bench Press', '4', '8', '185 lbs', 'Chest', '90s'],
      ['Squats', '4', '10', '225 lbs', 'Legs', '120s'],
      ['Deadlift', '3', '5', '275 lbs', 'Back', '180s'],
      ['Pull-ups', '3', '12', 'BW', 'Back', '60s'],
      ['Overhead Press', '3', '8', '115 lbs', 'Shoulders', '90s'],
      ['Barbell Row', '4', '8', '155 lbs', 'Back', '90s'],
      ['Lunges', '3', '12', '50 lbs', 'Legs', '60s'],
      ['Plank', '3', '60s', 'BW', 'Core', '30s'],
    ],
  },
  {
    key: 'event',
    name: 'Event Planner',
    icon: '🎉',
    color: '#0d9488',
    category: 'Planning',
    description: 'Event task management with venue, deadline, budget, owner',
    priority: 17,
    headers: ['Task', 'Deadline', 'Owner', 'Budget', 'Status', 'Notes'],
    detectSignals: ['venue', 'rsvp', 'catering', 'event', 'guest', 'invitation', 'deadline'],
    columnRoles: ['text', 'deadline', 'owner', 'budget', 'status', 'notes'],
    interactive: true,
    interactionType: 'status-cycle',
    interactionStates: ['Not Started', 'In Progress', 'Done', 'Blocked'],
    cssClass: 'event',
    rows: [
      ['Book Venue', '2026-06-01', 'Sarah', '$2000', 'Done', 'Grand Ballroom confirmed'],
      ['Order Catering', '2026-06-15', 'Mike', '$1500', 'In Progress', 'Menu selection'],
      ['Send Invitations', '2026-06-20', 'Lisa', '$200', 'Not Started', 'Design pending'],
      ['Hire Photographer', '2026-06-10', 'Sarah', '$800', 'Done', 'Studio Lumiere'],
      ['Plan Decorations', '2026-07-01', 'Amy', '$500', 'Not Started', ''],
      ['Arrange Transport', '2026-07-05', 'Mike', '$300', 'Not Started', 'Shuttle service'],
      ['Sound & Music', '2026-06-25', 'Tom', '$600', 'In Progress', 'DJ vs band'],
    ],
  },
  {
    key: 'sprint',
    name: 'Sprint Board',
    icon: '🏃',
    color: '#1d4ed8',
    category: 'Engineering',
    description: 'Agile sprint with story points, assignee, acceptance criteria',
    priority: 24,
    headers: ['Story', 'Points', 'Assignee', 'Status', 'Sprint', 'Priority'],
    detectSignals: ['story', 'points', 'sprint', 'epic', 'velocity', 'standup', 'backlog'],
    columnRoles: ['text', 'points', 'assignee', 'status', 'sprint', 'priority'],
    interactive: true,
    interactionType: 'status-cycle',
    interactionStates: ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'],
    cssClass: 'sprint',
    rows: [
      ['User authentication flow', '8', 'Alice', 'Done', 'Sprint 12', 'High'],
      ['Dashboard redesign', '5', 'Bob', 'In Progress', 'Sprint 12', 'Medium'],
      ['API rate limiting', '3', 'Charlie', 'Review', 'Sprint 12', 'High'],
      ['Fix login bug #234', '2', 'Alice', 'Done', 'Sprint 12', 'Critical'],
      ['Add export to CSV', '3', 'Diana', 'To Do', 'Sprint 12', 'Low'],
      ['Database migration', '8', 'Bob', 'Backlog', 'Sprint 13', 'High'],
      ['Performance audit', '5', 'Charlie', 'Backlog', 'Sprint 13', 'Medium'],
    ],
  },
  {
    key: 'asset',
    name: 'Asset Register',
    icon: '🏢',
    color: '#64748b',
    category: 'Operations',
    description: 'IT/office asset tracking with serial, location, purchase date',
    priority: 16,
    headers: ['Asset', 'Serial Number', 'Location', 'Purchase Date', 'Value', 'Status'],
    detectSignals: ['serial', 'asset', 'barcode', 'purchase', 'warranty', 'depreciation'],
    columnRoles: ['text', 'serial', 'location', 'date', 'value', 'status'],
    interactive: false,
    interactionType: null,
    cssClass: 'asset',
    rows: [
      ['MacBook Pro 16"', 'MBP-2024-001', 'Desk 4A', '2024-01-15', '$2499', 'Active'],
      ['Dell Monitor 27"', 'MON-2024-012', 'Desk 4A', '2024-02-01', '$449', 'Active'],
      ['Standing Desk', 'DSK-2023-008', 'Desk 4A', '2023-06-15', '$699', 'Active'],
      ['Logitech Webcam', 'CAM-2024-003', 'Conf Room B', '2024-03-10', '$129', 'Active'],
      ['Herman Miller Chair', 'CHR-2022-015', 'Storage', '2022-09-01', '$1299', 'Surplus'],
      ['iPad Air', 'TAB-2023-007', 'Desk 2B', '2023-11-20', '$599', 'Active'],
    ],
  },
  {
    key: 'okr',
    name: 'OKR Tracker',
    icon: '🎯',
    color: '#7c3aed',
    category: 'Goals',
    description: 'Objectives & Key Results with progress and confidence',
    priority: 21,
    headers: ['Objective', 'Key Result', 'Progress', 'Confidence', 'Owner', 'Quarter'],
    detectSignals: ['objective', 'key result', 'okr', 'confidence', 'kr', 'quarter'],
    columnRoles: ['objective', 'keyResult', 'progress', 'confidence', 'owner', 'quarter'],
    interactive: true,
    interactionType: 'inline-edit',
    cssClass: 'okr',
    rows: [
      ['Increase Revenue', 'Close 10 enterprise deals', '70%', 'High', 'Sales Team', 'Q1 2026'],
      ['Increase Revenue', 'Launch premium tier', '40%', 'Medium', 'Product', 'Q1 2026'],
      ['Improve Quality', 'Reduce bugs by 50%', '85%', 'High', 'Engineering', 'Q1 2026'],
      ['Improve Quality', 'Test coverage > 90%', '60%', 'Medium', 'QA', 'Q1 2026'],
      ['Expand Market', 'Enter APAC region', '20%', 'Low', 'Biz Dev', 'Q1 2026'],
      ['Expand Market', 'Localize for 3 languages', '50%', 'Medium', 'Product', 'Q1 2026'],
    ],
  },
];

/* ── Main ── */

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith('--'));
  const positional = args.filter(a => !a.startsWith('--'));

  const shouldWrite = flags.includes('--write');
  const dryRun      = flags.includes('--dry-run');
  const listIdeas   = flags.includes('--list');

  // Load registry
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  const existingKeys = new Set(registry.templates.map(t => t.key));

  if (listIdeas) {
    console.log('\n📋 Template Idea Bank:\n');
    for (const idea of IDEA_BANK) {
      const exists = existingKeys.has(idea.key);
      const status = exists ? '✅ exists' : '🆕 available';
      console.log(`  ${idea.icon}  ${idea.name} (${idea.key}) — ${status}`);
      console.log(`     ${idea.description}`);
      console.log(`     Category: ${idea.category} | Priority: ${idea.priority}`);
      console.log();
    }
    console.log(`\nExisting templates: ${registry.totalTemplates}`);
    console.log(`Available new ideas: ${IDEA_BANK.filter(i => !existingKeys.has(i.key)).length}`);
    return;
  }

  // Pick an idea
  let idea;
  if (positional.length > 0) {
    const query = positional.join(' ').toLowerCase();
    idea = IDEA_BANK.find(i =>
      i.key === query || i.name.toLowerCase() === query || i.name.toLowerCase().includes(query)
    );
    if (!idea) {
      console.error(`❌ No idea found matching "${positional.join(' ')}". Use --list to see available ideas.`);
      process.exit(1);
    }
  } else {
    // Auto-pick first available
    idea = IDEA_BANK.find(i => !existingKeys.has(i.key));
    if (!idea) {
      console.error('❌ All ideas in the bank have been built. Add more to IDEA_BANK!');
      process.exit(1);
    }
  }

  if (existingKeys.has(idea.key)) {
    console.error(`⚠️  Template "${idea.name}" (${idea.key}) already exists in the registry.`);
    if (!flags.includes('--force')) {
      console.error('   Use --force to regenerate anyway.');
      process.exit(1);
    }
  }

  console.log(`\n🚀 Generating template: ${idea.icon} ${idea.name}\n`);
  console.log(`   Key:      ${idea.key}`);
  console.log(`   Category: ${idea.category}`);
  console.log(`   Priority: ${idea.priority}`);
  console.log(`   Interactive: ${idea.interactive ? idea.interactionType : 'read-only'}`);
  console.log();

  // Determine IDs
  const sheetId     = registry.nextSheetId;
  const sheetNum    = parseInt(sheetId.split('-')[1]);
  const fixtureFile = `${idea.key}-${idea.rows[0][0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;

  // Generate all artifacts
  const fixture    = generateFixture(idea, sheetId);
  const templateDef = generateTemplateDef(idea);
  const renderer   = generateRenderer(idea);
  const examples   = generateExamples(idea);
  const css        = generateCSS(idea);
  const tests      = generateTests(idea, sheetId);
  const apiMapping = generateAPIMapping(sheetId, fixtureFile);
  const folderEntry = generateFolderEntry(sheetId, idea);
  const registryEntry = generateRegistryEntry(idea, sheetId, fixtureFile);

  if (dryRun) {
    console.log('🔍 DRY RUN — no files will be written.\n');
  }

  // Output or write
  const sections = [
    { label: 'Fixture JSON', file: `tests/fixtures/sheets/${fixtureFile}.json`, content: fixture },
    { label: 'Template Definition (paste into templates.js TEMPLATES object)', content: templateDef },
    { label: 'Renderer Function (paste into templates.js after other renderers)', content: renderer },
    { label: 'Example Sheets (paste into examples.js EXAMPLE_SHEETS)', content: examples },
    { label: 'CSS Styles (append to style.css)', content: css },
    { label: 'E2E Tests (append to templates.spec.js)', content: tests },
    { label: 'API Client Mapping (add to loadMockSheet mapping)', content: apiMapping },
    { label: 'Folder Entry (add to folders.json WayMark Examples files array)', content: folderEntry },
    { label: 'Registry Entry (add to template-registry.json templates array)', content: registryEntry },
  ];

  if (shouldWrite && !dryRun) {
    // Write fixture file
    const fixturePath = path.join(FIXTURES_DIR, `${fixtureFile}.json`);
    fs.writeFileSync(fixturePath, fixture, 'utf-8');
    console.log(`  ✅ Written: ${path.relative(ROOT, fixturePath)}`);

    // Write generated code to a single output file
    if (!fs.existsSync(GEN_DIR)) fs.mkdirSync(GEN_DIR, { recursive: true });
    const outPath = path.join(GEN_DIR, `${idea.key}-template.generated.js`);
    let combined = `/* ============================================================\n`;
    combined += `   Generated Template: ${idea.icon} ${idea.name}\n`;
    combined += `   Key: ${idea.key} | Sheet ID: ${sheetId}\n`;
    combined += `   Generated at: ${new Date().toISOString()}\n`;
    combined += `   ============================================================ */\n\n`;

    for (const section of sections) {
      combined += `/* ${'─'.repeat(60)} */\n`;
      combined += `/* ${section.label} */\n`;
      combined += `/* ${'─'.repeat(60)} */\n\n`;
      combined += section.content + '\n\n';
    }

    fs.writeFileSync(outPath, combined, 'utf-8');
    console.log(`  ✅ Written: ${path.relative(ROOT, outPath)}`);

    // Update registry
    const updatedRegistry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    updatedRegistry.templates.push(JSON.parse(registryEntry));
    updatedRegistry.nextSheetId = `sheet-${String(sheetNum + 1).padStart(3, '0')}`;
    updatedRegistry.totalTemplates = updatedRegistry.templates.length;
    if (!updatedRegistry.categories.includes(idea.category)) {
      updatedRegistry.categories.push(idea.category);
    }
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(updatedRegistry, null, 2) + '\n', 'utf-8');
    console.log(`  ✅ Updated: template-registry.json`);

    console.log(`\n📝 Next steps:`);
    console.log(`   1. Review generated/${idea.key}-template.generated.js`);
    console.log(`   2. Paste each section into its target file`);
    console.log(`   3. Run: npx playwright test --config=tests/playwright.config.js`);
  } else {
    for (const section of sections) {
      console.log(`\n${'═'.repeat(64)}`);
      console.log(`  ${section.label}`);
      if (section.file) console.log(`  → ${section.file}`);
      console.log(`${'═'.repeat(64)}\n`);
      console.log(section.content);
    }
  }

  console.log(`\n✨ Template "${idea.name}" generation complete!\n`);
}

/* ── Generators ── */

function generateFixture(idea, sheetId) {
  const values = [idea.headers, ...idea.rows];
  return JSON.stringify({
    id: sheetId,
    title: `${idea.rows[0][0]} ${idea.name}`,
    sheetTitle: 'Sheet1',
    values,
  }, null, 2);
}

function generateTemplateDef(idea) {
  const detectConds = [];
  // Group detect signals into a primary + secondary condition
  const primary = idea.detectSignals.slice(0, Math.ceil(idea.detectSignals.length / 2));
  const secondary = idea.detectSignals.slice(Math.ceil(idea.detectSignals.length / 2));

  const lines = [];
  lines.push(`  /* ${idea.icon} ${idea.name} — ${idea.description} */`);
  lines.push(`  ${idea.key}: {`);
  lines.push(`    name: '${idea.name}',`);
  lines.push(`    icon: '${idea.icon}',`);
  lines.push(`    color: '${idea.color}',`);
  lines.push(`    priority: ${idea.priority},`);
  lines.push(`    detect(lower) {`);
  lines.push(`      return lower.some(h => /^(${primary.join('|')})/.test(h))`);
  lines.push(`        && lower.some(h => /^(${secondary.join('|')})/.test(h));`);
  lines.push(`    },`);
  lines.push(`    columns(lower) {`);
  lines.push(`      const cols = { ${idea.columnRoles.map(r => `${r}: -1`).join(', ')} };`);

  for (let i = 0; i < idea.columnRoles.length; i++) {
    const role = idea.columnRoles[i];
    const header = idea.headers[i].toLowerCase();
    if (i === 0) {
      lines.push(`      cols.${role} = lower.findIndex(h => /^(${header}|name|title|description|item)/.test(h));`);
      lines.push(`      if (cols.${role} === -1) cols.${role} = 0;`);
    } else {
      lines.push(`      cols.${role} = lower.findIndex(h => /^(${header})/.test(h));`);
    }
  }

  lines.push(`      return cols;`);
  lines.push(`    },`);

  if (idea.interactive && idea.interactionStates) {
    lines.push(`    ${idea.interactionType === 'status-cycle' ? 'states' : 'editType'}: ${JSON.stringify(idea.interactionStates)},`);
  }

  lines.push(`    render: render${capitalize(idea.key)},`);
  lines.push(`  },`);

  return lines.join('\n');
}

function generateRenderer(idea) {
  const fnName = `render${capitalize(idea.key)}`;
  const cls = idea.cssClass;
  const lines = [];

  lines.push(`/* --- ${idea.name} Renderer --- */`);
  lines.push(`function ${fnName}(container, rows, cols, template) {`);
  lines.push(`  for (let i = 0; i < rows.length; i++) {`);
  lines.push(`    const row = rows[i];`);
  lines.push(`    const rowIdx = i + 1;`);

  // First column is always the text
  const textRole = idea.columnRoles[0];
  lines.push(`    const text = cell(row, cols.${textRole}) || row[0] || '—';`);

  // Other columns
  for (let j = 1; j < idea.columnRoles.length; j++) {
    const role = idea.columnRoles[j];
    lines.push(`    const ${role} = cell(row, cols.${role});`);
  }

  lines.push('');
  lines.push(`    const rowEl = el('div', { className: '${cls}-row' }, [`);
  lines.push(`      el('div', { className: '${cls}-row-title' }, [text]),`);

  for (let j = 1; j < idea.columnRoles.length; j++) {
    const role = idea.columnRoles[j];
    const label = idea.headers[j];
    lines.push(`      ${role} ? el('span', { className: '${cls}-${role}' }, [\`${label}: \${${role}}\`]) : null,`);
  }

  lines.push(`    ]);`);
  lines.push('');
  lines.push(`    container.append(rowEl);`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join('\n');
}

function generateExamples(idea) {
  // Generate two example sheets
  const lines = [];
  const folderName = `${capitalize(idea.key)}s`;

  lines.push(`  // --- ${idea.name} examples ---`);

  // Example 1
  lines.push(`  '${idea.name} Example 1': {`);
  lines.push(`    folder: '${folderName}',`);
  lines.push(`    rows: [`);
  lines.push(`      ${JSON.stringify(idea.headers)},`);
  for (const row of idea.rows.slice(0, 5)) {
    lines.push(`      ${JSON.stringify(row)},`);
  }
  lines.push(`    ],`);
  lines.push(`  },`);

  // Example 2 (slight variation)
  lines.push(`  '${idea.name} Example 2': {`);
  lines.push(`    folder: '${folderName}',`);
  lines.push(`    rows: [`);
  lines.push(`      ${JSON.stringify(idea.headers)},`);
  for (const row of idea.rows.slice(3)) {
    lines.push(`      ${JSON.stringify(row)},`);
  }
  lines.push(`    ],`);
  lines.push(`  },`);

  return lines.join('\n');
}

function generateCSS(idea) {
  const cls = idea.cssClass;
  return `/* --- ${idea.name} Template --- */

.${cls}-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}
.${cls}-row:hover {
  background: var(--hover);
}
.${cls}-row-title {
  flex: 1;
  font-weight: 500;
}
${idea.columnRoles.slice(1).map(role => `
.${cls}-${role} {
  font-size: 0.85rem;
  color: var(--muted);
  padding: 0.2rem 0.5rem;
  background: var(--hover);
  border-radius: 4px;
}`).join('\n')}`;
}

function generateTests(idea, sheetId) {
  const cls = idea.cssClass;
  const lines = [];

  lines.push(`/* ===== ${idea.name} template ===== */`);
  lines.push('');

  // Detection test
  lines.push(`test('${idea.key} detected as ${idea.name} template', async ({ page }) => {`);
  lines.push(`  await setupApp(page);`);
  lines.push(`  await navigateToSheet(page, '${sheetId}');`);
  lines.push(`  await page.waitForSelector('.${cls}-row', { timeout: 5_000 });`);
  lines.push(`  await expect(page.locator('#template-badge')).toContainText('${idea.name}');`);
  lines.push(`});`);
  lines.push('');

  // Row count test
  lines.push(`test('${idea.key} renders correct number of rows', async ({ page }) => {`);
  lines.push(`  await setupApp(page);`);
  lines.push(`  await navigateToSheet(page, '${sheetId}');`);
  lines.push(`  await page.waitForSelector('.${cls}-row', { timeout: 5_000 });`);
  lines.push('');
  lines.push(`  const rows = page.locator('.${cls}-row');`);
  lines.push(`  expect(await rows.count()).toBe(${idea.rows.length});`);
  lines.push(`});`);
  lines.push('');

  // Content test
  lines.push(`test('${idea.key} shows first item text', async ({ page }) => {`);
  lines.push(`  await setupApp(page);`);
  lines.push(`  await navigateToSheet(page, '${sheetId}');`);
  lines.push(`  await page.waitForSelector('.${cls}-row', { timeout: 5_000 });`);
  lines.push('');
  lines.push(`  const firstTitle = page.locator('.${cls}-row-title').first();`);
  lines.push(`  await expect(firstTitle).toContainText('${idea.rows[0][0]}');`);
  lines.push(`});`);

  return lines.join('\n');
}

function generateAPIMapping(sheetId, fixtureFile) {
  return `    '${sheetId}': '${fixtureFile}',`;
}

function generateFolderEntry(sheetId, idea) {
  return JSON.stringify({
    id: sheetId,
    name: `${idea.rows[0][0]} ${idea.name}`,
    mimeType: 'application/vnd.google-apps.spreadsheet',
  }, null, 2);
}

function generateRegistryEntry(idea, sheetId, fixtureFile) {
  return JSON.stringify({
    key: idea.key,
    name: idea.name,
    icon: idea.icon,
    color: idea.color,
    priority: idea.priority,
    category: idea.category,
    detectSignals: idea.detectSignals,
    columnRoles: idea.columnRoles,
    interactive: idea.interactive,
    interactionType: idea.interactionType || 'none',
    ...(idea.interactionStates ? { interactionStates: idea.interactionStates } : {}),
    exampleCount: 2,
    fixtureIds: [sheetId],
    fixtureFiles: [fixtureFile],
  }, null, 2);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ── Run ── */
main();
