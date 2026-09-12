/* ============================================================
   seed-exercise-database.mjs — Build the exercise reference DB

   Downloads the 2024 Adult Compendium of Physical Activities
   (~1,300 activities with MET values) and compiles it into a compact
   reference file:

     public/data/exercise-reference.json

   Calories burned are computed at runtime as:
     kcal = MET × bodyweight(kg) × duration(hours)

   MET values are factual reference data (Compendium of Physical
   Activities, pacompendium.com). This is a build-time script; the
   generated JSON is committed so the app/tests never fetch at runtime.

     node scripts/seed-exercise-database.mjs

   Requires `curl` on PATH (dev tooling only).
   ============================================================ */

import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../public/data/exercise-reference.json');

/* Pinned commit so the build is reproducible. Source: 2024 Adult
   Compendium of Physical Activities (English descriptions + MET). */
const CSV_URL =
  'https://raw.githubusercontent.com/BenSuqw123/HealthyPlan/' +
  'a4250dcd1ee66804c4d598c517c3c12a9befb5d3/' +
  'HealthyPlan/data/dished_excercises/exercise_activities_cleaned.csv';

/* Curated fallback if the download fails (common activities). */
const FALLBACK = [
  ['Walking, 3.0 mph, level, moderate pace', 3.5, 'Walking', 'moderate'],
  ['Running, 6 mph (10 min/mile)', 9.8, 'Running', 'vigorous'],
  ['Bicycling, general', 7.5, 'Bicycling', 'vigorous'],
  ['Swimming laps, freestyle, moderate', 5.8, 'Water Activities', 'moderate'],
  ['Weightlifting, general', 3.5, 'Conditioning Exercise', 'moderate'],
  ['Yoga, Hatha', 2.5, 'Conditioning Exercise', 'light'],
  ['Elliptical trainer, moderate effort', 5.0, 'Conditioning Exercise', 'moderate'],
  ['Rowing machine, moderate', 4.8, 'Conditioning Exercise', 'moderate'],
  ['Hiking, cross country', 6.0, 'Walking', 'vigorous'],
  ['Jump rope, moderate', 11.8, 'Conditioning Exercise', 'vigorous'],
];

/* ---------- CSV parsing ---------- */

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

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function clean(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/* ---------- Main ---------- */

function sh(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
}

async function main() {
  let activities = [];
  const seen = new Set();

  try {
    const work = join(tmpdir(), `wm-exercise-${Date.now()}`);
    await mkdir(work, { recursive: true });
    const csvPath = join(work, 'comp.csv');
    console.log(`  downloading ${CSV_URL}`);
    sh('curl', ['-sS', '-L', '--max-time', '120', '-o', csvPath, CSV_URL]);

    const text = await readFile(csvPath, 'utf8');
    const lines = text.split(/\r?\n/);
    const header = parseLine(lines[0]);
    const iName = header.indexOf('description_en');
    const iMet = header.indexOf('met_value');
    const iCat = header.indexOf('category_name_en');
    const iIntensity = header.indexOf('intensity_level');

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const f = parseLine(lines[i]);
      const name = clean(f[iName]);
      const met = parseFloat(f[iMet]);
      const category = titleCase(clean(f[iCat] || 'Other'));
      const intensity = clean(f[iIntensity] || '');
      if (!name || !met || !isFinite(met)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      activities.push([name, met, category, intensity]);
    }
    await rm(work, { recursive: true, force: true });
  } catch (err) {
    console.warn(`  compendium download failed: ${err.message}`);
  }

  if (!activities.length) {
    console.warn('  using curated fallback exercise list');
    activities = FALLBACK.slice();
  }

  activities.sort((a, b) => a[0].localeCompare(b[0]));

  const payload = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    source: '2024 Adult Compendium of Physical Activities (pacompendium.com)',
    formula: 'kcal = MET × bodyweight(kg) × duration(hours)',
    fields: ['name', 'met', 'category', 'intensity'],
    count: activities.length,
    activities,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload));
  const bytes = JSON.stringify(payload).length;
  console.log(`Wrote ${activities.length} activities (${(bytes / 1024).toFixed(0)} KB) → ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
