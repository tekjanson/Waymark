#!/usr/bin/env node
/**
 * One-time migration script: updates the USA Road Trip itinerary sheet
 * from 5 columns (Activity, Date, Location, Booking, Cost) to 7 columns
 * (Activity, Date, Location, Link, Cost, People, Notes).
 *
 * Booking column is split:
 *   - Domain/URL before " — " → Link (prefixed with https:// if needed)
 *   - Text after " — " → Notes (full text if no separator)
 *
 * Cost column extras:
 *   - "(N adults)" or "x N" suffix → People column (informational)
 *   - Cost value unchanged
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/migrate-travel-sheet.js
 */

'use strict';

const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = '1fXnhU-m93ZZvl4pMlsFxtLMc-25uZieUm_aB1Hv9l2A';
const RANGE_READ   = 'Sheet1!A1:E200';
const RANGE_HEADER = 'Sheet1!A1:G1';

/** @param {string} text */
function splitBooking(text) {
  if (!text) return { link: '', notes: '' };

  const sep = ' \u2014 '; // em dash with spaces
  const altSep = ' -- ';   // ASCII fallback

  let before, after;
  if (text.includes(sep)) {
    const parts = text.split(sep);
    before = parts[0];
    after  = parts.slice(1).join(sep);
  } else if (text.includes(altSep)) {
    const parts = text.split(altSep);
    before = parts[0];
    after  = parts.slice(1).join(altSep);
  } else {
    return { link: '', notes: text };
  }

  before = before.trim();
  after  = after.trim();

  // Is "before" a URL or domain?
  const isDomain = /^https?:\/\//i.test(before) || /^[a-z0-9.-]+\.(com|org|gov|net|edu|io|us)\b/i.test(before);
  if (isDomain) {
    const link = /^https?:\/\//i.test(before) ? before : 'https://' + before;
    return { link, notes: after };
  }

  // before is a highway reference or free-text direction — put it all in notes
  return { link: '', notes: text };
}

/** Extract people count from cost string. Returns '' if none found. */
function extractPeople(costStr) {
  if (!costStr) return '';
  // Match "(2 adults)", "(2 adults + toddler)"
  const m1 = costStr.match(/\((\d+)\s*(adults?|guests?|persons?|people)/i);
  if (m1) return m1[1];
  // Match "x 2 nights", "x 2"
  const m2 = costStr.match(/x\s*(\d+)\b/);
  if (m2) return m2[1];
  return '';
}

async function main() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();

  async function request(method, url, body) {
    const res = await client.request({ method, url, data: body });
    return res.data;
  }

  const base = 'https://sheets.googleapis.com/v4/spreadsheets';

  // 1. Read current data
  console.log('Reading current sheet data…');
  const readRes = await request('GET', `${base}/${SPREADSHEET_ID}/values/${encodeURIComponent(RANGE_READ)}`);
  const rows = readRes.values || [];
  if (rows.length < 2) {
    console.error('No data rows found. Aborting.');
    process.exit(1);
  }

  const [header, ...dataRows] = rows;
  console.log(`Found ${dataRows.length} data rows. Headers: ${header.join(', ')}`);

  // 2. Build new column D (Link), F (People), G (Notes) for each row
  const linkValues   = [['Link']];  // D column, starting at D1
  const peopleValues = [['People']]; // F column, starting at F1
  const notesValues  = [['Notes']];  // G column, starting at G1

  for (const row of dataRows) {
    const booking = row[3] || '';
    const cost    = row[4] || '';

    const { link, notes } = splitBooking(booking);
    const people = extractPeople(cost);

    linkValues.push([link]);
    peopleValues.push([people]);
    notesValues.push([notes]);
  }

  console.log('\nSample transforms (first 5 rows):');
  for (let i = 1; i <= 5 && i < linkValues.length; i++) {
    const orig = dataRows[i - 1];
    console.log(`  Row ${i + 1}:`);
    console.log(`    Booking: "${(orig[3] || '').substring(0, 60)}…"`);
    console.log(`    → Link: "${linkValues[i][0].substring(0, 60)}"`);
    console.log(`    → Notes: "${notesValues[i][0].substring(0, 60)}…"`);
    console.log(`    Cost: "${orig[4] || ''}"`);
    console.log(`    → People: "${peopleValues[i][0]}"`);
  }

  // 3. Batch update
  const lastDataRow = dataRows.length + 1; // +1 for header

  const batchData = [
    {
      range: `Sheet1!D1:D${lastDataRow}`,
      values: linkValues,
    },
    {
      range: `Sheet1!F1:F${lastDataRow}`,
      values: peopleValues,
    },
    {
      range: `Sheet1!G1:G${lastDataRow}`,
      values: notesValues,
    },
  ];

  console.log(`\nUpdating ${lastDataRow} rows across columns D, F, G…`);
  const updateRes = await request('POST', `${base}/${SPREADSHEET_ID}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: batchData,
  });

  console.log(`\nDone! Updated ${updateRes.totalUpdatedCells} cells.`);
  console.log('Sheet now has 7 columns: Activity | Date | Location | Link | Cost | People | Notes');
}

main().catch(err => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});
