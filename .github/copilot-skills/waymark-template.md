---
name: waymark-template
description: Create a new Waymark template. Covers all required artifacts so nothing is missed. Use this skill when adding any new template type.
---

# Waymark Template Creation Skill

Every new template requires ALL of these artifacts (missing any breaks the app or tests):

## Required files

| File | Path |
|------|------|
| Template JS | `public/js/templates/{key}.js` |
| Template CSS | `public/css/templates/{key}.css` |
| CSS import | Add `@import 'templates/{key}.css';` to `public/css/style.css` |
| Template import | Add `import './{key}.js';` to `public/js/templates/index.js` |
| Fixture JSON | `tests/fixtures/sheets/{key}-{desc}.json` |
| Fixture ID mapping | Add `'sheet-NNN': '{key}-{desc}'` to `public/js/api-client.js` |
| Folder entry | Add sheet ref to Examples folder in `tests/fixtures/folders.json` |
| E2E test | `tests/e2e/{key}.spec.js` |
| Registry entry | `template-registry.json` — bump `nextSheetId` and `totalTemplates` |
| Example data | Add definition to `public/js/example-data.js` |
| Import roles | Add `ROLE_LABELS` entries to `public/js/import.js` |

## Template JS structure
```javascript
/* ============================================================
   {key}.js — {Name} template
   ============================================================ */
import { registerTemplate, editableCell, emitEdit, el } from './shared.js';

const definition = {
  name: '{Name}',
  icon: '📊',
  color: '#2563eb',
  priority: 20,
  detect(lower) { return lower.some(h => /pattern/.test(h)); },
  columns(lower) {
    return {
      title: lower.findIndex(h => /title|name/.test(h)),
      status: lower.findIndex(h => /status|stage/.test(h)),
    };
  },
  render(container, rows, cols) {
    container.innerHTML = '';
    rows.forEach((row, i) => {
      container.appendChild(el('div', { className: '{key}-card' }, [
        editableCell(row[cols.title], i + 1, cols.title),
      ]));
    });
  },
};

registerTemplate('{key}', definition);
export default definition;
```

## Fixture shape
```json
{
  "id": "sheet-NNN",
  "title": "Human Readable Title",
  "sheetTitle": "Sheet1",
  "values": [
    ["Header1", "Header2"],
    ["value1", "value2"]
  ]
}
```

## After creating all files, run
```bash
make test
```
All tests must pass before marking the workboard task QA.
