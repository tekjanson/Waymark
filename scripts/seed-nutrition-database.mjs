/* ============================================================
   seed-nutrition-database.mjs — Build the food reference DB

   Downloads the full USDA FoodData Central "SR Legacy" dataset
   (~7,800 whole foods with per-100 g macros) plus the "Foundation"
   foods, and compiles them into a compact reference file:

     public/data/nutrition-reference.json

   The file uses a compact tuple layout (expanded at runtime by
   templates/calorie/helpers.js → loadFoodDatabase) so the full
   database stays well under 1 MB.

   The dataset is public-domain (USDA). This is a build-time script:
   the generated JSON is committed so the app/tests never fetch at
   runtime. Re-run it to refresh the data:

     node scripts/seed-nutrition-database.mjs

   Requires `curl` and `unzip` on PATH (dev tooling only).
   ============================================================ */

import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../public/data/nutrition-reference.json');

/* USDA FoodData Central bulk CSV datasets (public domain). */
const DATASETS = [
  { key: 'sr_legacy', url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip' },
  { key: 'foundation', url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-04-24.zip' },
];

/* FDC nutrient IDs. */
const N_ENERGY = '1008';
const N_ENERGY_ATWATER_A = '2047';
const N_ENERGY_ATWATER_B = '2048';
const N_PROTEIN = '1003';
const N_FAT = '1004';
const N_CARBS = '1005';

/* Curated barcodes so barcode scans resolve locally in demos/tests (per 100 g). */
const BARCODES = {
  '038000000805': ['Corn Flakes (Kellogg\'s)', 'Kellogg\'s', 357, 7, 84, 0.4],
  '028400090858': ['Potato Chips (Lay\'s Classic)', 'Lay\'s', 536, 7, 53, 35],
  '722252100177': ['Builder\'s Protein Bar (Clif)', 'Clif', 373, 27, 40, 11],
};

/* ---------- Minimal CSV parsing ---------- */

/** Parse one CSV line into fields (handles quotes + embedded commas). */
function parseLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Read a CSV file into an array of objects keyed by header. */
async function readCsv(path) {
  const text = await readFile(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const fields = parseLine(lines[i]);
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = fields[j];
    rows.push(obj);
  }
  return rows;
}

/* ---------- Extraction ---------- */

function round(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function cleanName(desc) { return (desc || '').replace(/\s+/g, ' ').trim(); }

/**
 * Extract per-100 g foods from one unpacked USDA CSV dataset directory.
 * Streams food_nutrient.csv keeping only the 4 macros we need.
 * @param {string} dir
 * @param {string} source
 * @returns {Promise<Array<[string,number,number,number,number]>>}  [name,kcal,p,c,f]
 */
async function extractDataset(dir, source) {
  const foods = await readCsv(join(dir, 'food.csv'));
  const nameById = new Map();
  for (const f of foods) nameById.set(f.fdc_id, cleanName(f.description));

  const macros = new Map();
  const nutrientText = await readFile(join(dir, 'food_nutrient.csv'), 'utf8');
  const lines = nutrientText.split(/\r?\n/);
  const header = parseLine(lines[0]);
  const iFdc = header.indexOf('fdc_id');
  const iNut = header.indexOf('nutrient_id');
  const iAmt = header.indexOf('amount');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const fields = parseLine(line);
    const nutId = fields[iNut];
    if (nutId !== N_ENERGY && nutId !== N_PROTEIN && nutId !== N_FAT &&
        nutId !== N_CARBS && nutId !== N_ENERGY_ATWATER_A && nutId !== N_ENERGY_ATWATER_B) {
      continue;
    }
    const fdc = fields[iFdc];
    if (!nameById.has(fdc)) continue;
    const amt = parseFloat(fields[iAmt]) || 0;
    let m = macros.get(fdc);
    if (!m) { m = { kcal: null, atwater: null, protein: 0, carbs: 0, fat: 0 }; macros.set(fdc, m); }
    if (nutId === N_ENERGY) m.kcal = amt;
    else if (nutId === N_ENERGY_ATWATER_A || nutId === N_ENERGY_ATWATER_B) m.atwater = amt;
    else if (nutId === N_PROTEIN) m.protein = amt;
    else if (nutId === N_CARBS) m.carbs = amt;
    else if (nutId === N_FAT) m.fat = amt;
  }

  const out = [];
  for (const [fdc, name] of nameById) {
    const m = macros.get(fdc);
    if (!m) continue;
    const kcal = m.kcal != null ? m.kcal : m.atwater;
    if (kcal == null) continue;
    if (kcal === 0 && m.protein === 0 && m.carbs === 0 && m.fat === 0) continue;
    out.push([name, Math.round(kcal), round(m.protein), round(m.carbs), round(m.fat)]);
  }
  console.log(`  ${source}: ${out.length} foods`);
  return out;
}

/* ---------- Download helpers ---------- */

function sh(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
}

async function downloadAndUnzip(url, workDir) {
  await mkdir(workDir, { recursive: true });
  const zip = join(workDir, 'ds.zip');
  console.log(`  downloading ${url}`);
  sh('curl', ['-sS', '-L', '--max-time', '300', '-o', zip, url]);
  sh('unzip', ['-q', '-o', zip, '-d', workDir]);
  const listing = sh('unzip', ['-Z1', zip]).toString().split('\n').filter(Boolean);
  const top = listing[0].split('/')[0];
  return join(workDir, top);
}

/* ---------- Main ---------- */

async function main() {
  const work = join(tmpdir(), `wm-nutrition-${Date.now()}`);
  await mkdir(work, { recursive: true });

  const seen = new Set();
  const foods = [];
  let ok = false;

  for (const ds of DATASETS) {
    try {
      const dir = await downloadAndUnzip(ds.url, join(work, ds.key));
      const extracted = await extractDataset(dir, ds.key);
      for (const tuple of extracted) {
        const key = tuple[0].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        foods.push(tuple);
      }
      ok = true;
    } catch (err) {
      console.warn(`  ${ds.key} skipped: ${err.message}`);
    }
  }

  if (!ok || !foods.length) {
    console.error('No USDA data could be downloaded. Aborting so the committed file is not clobbered.');
    process.exit(1);
  }

  foods.sort((a, b) => a[0].localeCompare(b[0]));

  const payload = {
    version: 2,
    generated: new Date().toISOString().slice(0, 10),
    source: 'USDA FoodData Central (SR Legacy + Foundation, public domain)',
    unit: 'g',
    qty: 100,
    fields: ['name', 'kcal', 'protein', 'carbs', 'fat'],
    count: foods.length,
    foods,
    barcodes: BARCODES,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload));
  await rm(work, { recursive: true, force: true });

  const bytes = JSON.stringify(payload).length;
  console.log(`Wrote ${foods.length} foods (${(bytes / 1024).toFixed(0)} KB) → ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
