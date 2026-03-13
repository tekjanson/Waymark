/* ============================================================
   templates/budget/parser.js — Bank statement parser
   ============================================================
   Parses CSV, OFX, QFX, and PDF bank/credit card statements into
   normalised transaction arrays for the budget template.
   All logic runs in the browser — no server-side processing.
   PDF parsing uses pdf.js v4.4.168 vendored locally in
   public/js/vendor/pdfjs/ — loaded lazily on first PDF upload.
   ============================================================ */

/* ---------- PDF.js (vendored, lazy-loaded) ---------- */

// Use __WAYMARK_BASE so paths resolve correctly behind the /waymark proxy
const _BASE = (typeof window !== 'undefined' && window.__WAYMARK_BASE) || '';
const PDFJS_PATH = _BASE + '/js/vendor/pdfjs/pdf.min.mjs';
const PDFJS_WORKER_PATH = _BASE + '/js/vendor/pdfjs/pdf.worker.min.mjs';
let _pdfjsPromise = null;

/**
 * Lazily load pdf.js from the vendored local copy.
 * Cached after first successful load.
 * Sets the worker source so pdf.js can parse documents correctly.
 * @returns {Promise<Object>} pdf.js library
 */
async function loadPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(/* webpackIgnore: true */ PDFJS_PATH)
      .then(pdfjsLib => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_PATH;
        return pdfjsLib;
      })
      .catch(err => {
        _pdfjsPromise = null;
        throw new Error('Failed to load PDF library. Please try again.');
      });
  }
  return _pdfjsPromise;
}

/* ---------- CSV Parsing ---------- */

/**
 * Split a CSV line respecting quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function splitCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse CSV text into a 2D array.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSVRows(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(splitCSVLine(trimmed));
  }
  return rows;
}

/**
 * Score how well a column matches a date pattern.
 * @param {string[]} values — sample values from the column
 * @returns {number} 0-1 confidence score
 */
function scoreDateColumn(values) {
  let hits = 0;
  for (const v of values) {
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(v)) hits++;
    else if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v)) hits++;
    else if (/^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/.test(v)) hits++;
    else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(v)) hits++;
  }
  return values.length ? hits / values.length : 0;
}

/**
 * Score how well a column matches a numeric/amount pattern.
 * @param {string[]} values
 * @returns {number} 0-1 confidence
 */
function scoreAmountColumn(values) {
  let hits = 0;
  for (const v of values) {
    const cleaned = v.replace(/[$,\s"]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(cleaned) && cleaned !== '') hits++;
  }
  return values.length ? hits / values.length : 0;
}

/**
 * Score how well a column matches a text/description pattern.
 * @param {string[]} values
 * @returns {number} 0-1 confidence
 */
function scoreDescriptionColumn(values) {
  let hits = 0;
  for (const v of values) {
    if (v.length > 5 && /[a-zA-Z]/.test(v)) hits++;
  }
  return values.length ? hits / values.length : 0;
}

/** Well-known header aliases for auto-detection */
const DATE_HEADERS     = /^(date|trans(action)?[\s_-]?date|posted?[\s_-]?date|post[\s_-]?date|settlement|effective|when|day)/i;
const AMOUNT_HEADERS   = /^(amount|debit|credit|sum|total|cost|price|value|charge|payment|withdrawal|deposit|\$)/i;
const DESC_HEADERS     = /^(desc(ription)?|memo|narration|details?|particulars?|payee|merchant|name|reference|transaction|what|item|label|note)/i;
const CATEGORY_HEADERS = /^(category|type|group|class|tag|label)/i;

/**
 * Detect column mapping from CSV headers.
 * @param {string[]} headers — first row of the CSV
 * @param {string[][]} sampleRows — a few data rows for heuristic scoring
 * @returns {{ date: number, amount: number, description: number, category: number }}
 */
function detectCSVColumns(headers, sampleRows) {
  const map = { date: -1, amount: -1, description: -1, category: -1 };
  const lower = headers.map(h => (h || '').toLowerCase().trim());

  // Phase 1: match by known header names
  for (let i = 0; i < lower.length; i++) {
    if (map.date === -1 && DATE_HEADERS.test(lower[i])) map.date = i;
    if (map.amount === -1 && AMOUNT_HEADERS.test(lower[i])) map.amount = i;
    if (map.description === -1 && DESC_HEADERS.test(lower[i])) map.description = i;
    if (map.category === -1 && CATEGORY_HEADERS.test(lower[i])) map.category = i;
  }

  // Phase 2: if amount not found, check for separate debit/credit columns
  let debitCol = -1, creditCol = -1;
  if (map.amount === -1) {
    for (let i = 0; i < lower.length; i++) {
      if (/^debit/.test(lower[i])) debitCol = i;
      if (/^credit/.test(lower[i])) creditCol = i;
    }
  }

  // Phase 3: heuristic scoring for unmatched columns
  if (sampleRows.length > 0 && (map.date === -1 || map.amount === -1 || map.description === -1)) {
    const colCount = headers.length;
    const samples = sampleRows.slice(0, 10);

    for (let col = 0; col < colCount; col++) {
      if (col === map.date || col === map.amount || col === map.description || col === map.category) continue;
      const vals = samples.map(r => (r[col] || '').trim()).filter(Boolean);
      if (!vals.length) continue;

      if (map.date === -1 && scoreDateColumn(vals) > 0.5) {
        map.date = col;
      } else if (map.amount === -1 && scoreAmountColumn(vals) > 0.5) {
        map.amount = col;
      } else if (map.description === -1 && scoreDescriptionColumn(vals) > 0.5) {
        map.description = col;
      }
    }
  }

  return { ...map, debitCol, creditCol };
}

/**
 * Normalise a date string to YYYY-MM-DD.
 * @param {string} raw
 * @returns {string}
 */
function normaliseDate(raw) {
  if (!raw) return '';
  const s = raw.trim();

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split(/[\/\-]/);
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
    const [m, d, y] = s.split(/[\/\-]/);
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YY
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2}$/.test(s)) {
    const [m, d, yy] = s.split(/[\/\-]/);
    const y = parseInt(yy) > 50 ? `19${yy}` : `20${yy}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Month DD, YYYY (e.g. "Mar 15, 2026")
  const mdyMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdyMatch) {
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const mo = months[mdyMatch[1].slice(0, 3).toLowerCase()];
    if (mo) return `${mdyMatch[3]}-${mo}-${mdyMatch[2].padStart(2, '0')}`;
  }

  return s;
}

/**
 * Parse a currency / numeric string to a plain number.
 * @param {string} raw
 * @returns {number}
 */
function parseAmount(raw) {
  if (!raw) return 0;
  const negative = raw.includes('(') || raw.includes('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned) || 0;
  return negative ? -num : num;
}

/**
 * Parse a CSV bank statement into normalised transaction objects.
 * Handles multi-section CSVs (e.g. BofA) where a summary section
 * precedes the actual transaction table. Scans for the row that
 * looks most like a transaction header (contains Date + Amount columns),
 * then uses that as the header and everything after as data.
 *
 * @param {string} text — raw CSV content
 * @returns {{ transactions: Array<{date:string, description:string, amount:string, category:string}>, columns: Object, rawHeaders: string[] }}
 */
export function parseCSVStatement(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return { transactions: [], columns: {}, rawHeaders: [] };

  // Find the best header row — the one that looks most like a transaction header.
  // In multi-section CSVs (e.g. BofA), the summary section comes first with
  // different columns (Description, Summary Amt), and the real transaction
  // header (Date, Description, Amount, Running Bal.) is further down.
  let headerIdx = 0;
  let bestScore = 0;

  for (let i = 0; i < Math.min(rows.length - 1, 20); i++) {
    const row = rows[i];
    let score = 0;
    const joined = row.map(c => (c || '').toLowerCase().trim()).join(' ');

    // Strong signals: row contains canonical transaction header names
    if (row.some(c => DATE_HEADERS.test((c || '').trim()))) score += 3;
    if (row.some(c => AMOUNT_HEADERS.test((c || '').trim()))) score += 3;
    if (row.some(c => DESC_HEADERS.test((c || '').trim()))) score += 2;

    // Bonus: row has more columns (transaction tables tend to be wider)
    if (row.length >= 3) score += 1;
    if (row.length >= 4) score += 1;

    // Penalty: if any cell looks like data (dates, amounts), it's a data row not a header
    const hasDateData = row.some(c => /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test((c || '').trim()));
    if (hasDateData) score -= 5;

    // Penalty: if part of a summary section (common BofA pattern)
    if (/total\s+(credits?|debits?)|(beginning|ending)\s+balance/i.test(joined)) score -= 5;

    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  const headers = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);
  const colMap = detectCSVColumns(headers, dataRows);

  const transactions = [];
  for (const row of dataRows) {
    // Skip empty rows
    const nonEmpty = row.filter(c => c.trim()).length;
    if (nonEmpty === 0) continue;

    // Skip summary/balance rows that aren't real transactions
    const rowText = row.join(' ').toLowerCase();
    if (/^(beginning|ending)\s+balance/i.test(rowText)) continue;
    if (/^total\s+(credits?|debits?|deposits?|withdrawals?)/i.test(rowText)) continue;

    let amount;
    if (colMap.amount >= 0) {
      const amtStr = (row[colMap.amount] || '').trim();
      if (!amtStr) continue; // Skip rows with no amount (e.g. opening balance lines)
      amount = parseAmount(amtStr);
    } else if (colMap.debitCol >= 0 || colMap.creditCol >= 0) {
      const debit = parseAmount(row[colMap.debitCol] || '');
      const credit = parseAmount(row[colMap.creditCol] || '');
      amount = credit > 0 ? credit : -Math.abs(debit);
    } else {
      continue; // Cannot determine amount — skip row
    }

    if (amount === 0) continue; // Skip zero-amount rows

    const date = colMap.date >= 0 ? normaliseDate(row[colMap.date] || '') : '';
    const description = colMap.description >= 0 ? (row[colMap.description] || '').trim() : '';
    const category = colMap.category >= 0 ? (row[colMap.category] || '').trim() : '';

    transactions.push({
      date,
      description: description || 'Unknown transaction',
      amount: String(amount),
      category,
    });
  }

  return { transactions, columns: colMap, rawHeaders: headers };
}

/* ---------- OFX / QFX Parsing ---------- */

/**
 * Extract a tag value from OFX/SGML markup.
 * OFX uses angle-bracket tags without closing tags for leaf values.
 * @param {string} block — text chunk to search
 * @param {string} tag — tag name (e.g. 'DTPOSTED', 'TRNAMT')
 * @returns {string}
 */
function ofxVal(block, tag) {
  const re = new RegExp(`<${tag}>([^<\\n]+)`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Parse OFX date (YYYYMMDD or YYYYMMDDHHMMSS) to YYYY-MM-DD.
 * @param {string} raw
 * @returns {string}
 */
function parseOFXDate(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\[.*$/, '').trim();
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return raw;
}

/**
 * Parse an OFX / QFX bank statement into normalised transactions.
 * @param {string} text — raw OFX/QFX content
 * @returns {{ transactions: Array<{date:string, description:string, amount:string, category:string}> }}
 */
export function parseOFXStatement(text) {
  const transactions = [];

  // Split on <STMTTRN> blocks
  const parts = text.split(/<STMTTRN>/i);
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/<\/STMTTRN>/i)[0] || parts[i];

    const amount = parseFloat(ofxVal(block, 'TRNAMT')) || 0;
    if (amount === 0) continue;

    const rawDate = ofxVal(block, 'DTPOSTED');
    const name = ofxVal(block, 'NAME') || ofxVal(block, 'MEMO') || 'Unknown transaction';
    const memo = ofxVal(block, 'MEMO');

    transactions.push({
      date: parseOFXDate(rawDate),
      description: name + (memo && memo !== name ? ` - ${memo}` : ''),
      amount: String(amount),
      category: '',
    });
  }

  return { transactions };
}

/* ---------- PDF Parsing ---------- */

/**
 * Detect column boundaries by clustering text item X-positions.
 * Items whose X positions are within CLUSTER_GAP of each other
 * belong to the same column.
 * @param {Array<{text:string, x:number, y:number}>} items
 * @returns {number[]} — sorted array of column left-edge X positions
 */
function detectColumnBoundaries(items) {
  if (!items.length) return [];

  const CLUSTER_GAP = 25; // px gap that separates distinct columns
  const xs = items.map(i => i.x).sort((a, b) => a - b);

  const clusters = [[xs[0]]];
  for (let i = 1; i < xs.length; i++) {
    const last = clusters[clusters.length - 1];
    if (xs[i] - last[last.length - 1] <= CLUSTER_GAP) {
      last.push(xs[i]);
    } else {
      clusters.push([xs[i]]);
    }
  }

  // Minimum items per cluster to count as a real column (10% of rows)
  const minClusterSize = Math.max(2, Math.floor(items.length * 0.02));
  return clusters
    .filter(c => c.length >= minClusterSize)
    .map(c => Math.min(...c));
}

/**
 * Assign a text item to a column based on its X position.
 * Returns the index of the closest column boundary to the left.
 * @param {number} x — item X position
 * @param {number[]} boundaries — sorted column boundaries
 * @returns {number}
 */
function assignToColumn(x, boundaries) {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (x >= boundaries[i] - 15) return i; // 15px tolerance for right-aligned text
  }
  return 0;
}

/**
 * Group text items into visual rows based on Y position.
 * Items within Y_TOLERANCE pixels of each other are on the same row.
 * @param {Array<{text:string, x:number, y:number}>} items
 * @returns {Array<Array<{text:string, x:number, y:number}>>}
 */
function groupTextIntoRows(items) {
  if (!items.length) return [];

  const Y_TOLERANCE = 5;
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  let currentY = sorted[0].y;
  let currentRow = [];

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) > Y_TOLERANCE) {
      if (currentRow.length) rows.push(currentRow);
      currentRow = [];
      currentY = item.y;
    }
    currentRow.push(item);
  }
  if (currentRow.length) rows.push(currentRow);

  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
  }

  return rows;
}

/**
 * Build a structured 2D table from PDF text items.
 * Uses X-position clustering to detect column boundaries,
 * then assigns each text item to its column within its row.
 * @param {Array<{text:string, x:number, y:number}>} items
 * @returns {{ table: string[][], boundaries: number[] }}
 */
function buildPDFTable(items) {
  const boundaries = detectColumnBoundaries(items);
  if (!boundaries.length) return { table: [], boundaries: [] };

  const numCols = boundaries.length;
  const rawRows = groupTextIntoRows(items);
  const table = [];

  for (const row of rawRows) {
    const cells = new Array(numCols).fill('');
    for (const item of row) {
      const col = assignToColumn(item.x, boundaries);
      cells[col] = cells[col] ? cells[col] + ' ' + item.text : item.text;
    }
    // Skip completely empty rows
    if (cells.some(c => c.trim())) {
      table.push(cells.map(c => c.trim()));
    }
  }

  return { table, boundaries };
}

/**
 * Filter out non-data rows from a PDF table.
 * Removes likely headers, footers, page markers, and blank rows.
 * @param {string[][]} table
 * @returns {string[][]}
 */
function filterNonDataRows(table) {
  if (table.length <= 1) return table;

  // Patterns for rows to skip
  const SKIP_PATTERNS = [
    /^page\s+\d+/i,
    /^\d+\s+of\s+\d+$/i,
    /statement\s+(period|date|ending)/i,
    /account\s+(number|summary|type)/i,
    /^continued\b/i,
    /^\*{3,}/,
    /^-{5,}$/,
    /^={5,}$/,
    /beginning\s+balance/i,
    /ending\s+balance/i,
    /total\s+(deposits?|withdrawals?|charges?|credits?|debits?)/i,
    /^daily\s+balance/i,
    /this\s+statement/i,
  ];

  return table.filter(row => {
    const text = row.join(' ').trim();
    if (!text) return false;
    if (text.length < 5) return false;
    for (const pattern of SKIP_PATTERNS) {
      if (pattern.test(text)) return false;
    }
    return true;
  });
}

/**
 * Detect column roles in a PDF table using content analysis.
 * Similar to CSV column detection but works on the PDF table structure.
 * @param {string[][]} dataRows — rows of cell values (after filtering)
 * @returns {{ date: number, amount: number, description: number, balance: number }}
 */
function detectPDFColumnRoles(dataRows) {
  const numCols = dataRows.length > 0 ? dataRows[0].length : 0;
  if (numCols === 0) return { date: -1, amount: -1, description: -1, balance: -1 };

  const scores = {
    date: new Array(numCols).fill(0),
    amount: new Array(numCols).fill(0),
    description: new Array(numCols).fill(0),
  };

  // Analyse sample rows (up to 20)
  const samples = dataRows.slice(0, 20);

  for (let col = 0; col < numCols; col++) {
    const vals = samples.map(r => (r[col] || '').trim()).filter(Boolean);
    if (!vals.length) continue;

    scores.date[col] = scoreDateColumn(vals);
    scores.amount[col] = scoreAmountColumn(vals);
    scores.description[col] = scoreDescriptionColumn(vals);
  }

  // Assign roles: highest-scoring column for each role, without overlap
  const assigned = new Set();
  const mapping = { date: -1, amount: -1, description: -1, balance: -1 };

  // Date first (most distinctive)
  let bestDate = -1, bestDateScore = 0.3; // minimum threshold
  for (let col = 0; col < numCols; col++) {
    if (scores.date[col] > bestDateScore) {
      bestDate = col;
      bestDateScore = scores.date[col];
    }
  }
  if (bestDate >= 0) { mapping.date = bestDate; assigned.add(bestDate); }

  // Description (longest text, most alphabetic)
  let bestDesc = -1, bestDescScore = 0.3;
  for (let col = 0; col < numCols; col++) {
    if (assigned.has(col)) continue;
    if (scores.description[col] > bestDescScore) {
      bestDesc = col;
      bestDescScore = scores.description[col];
    }
  }
  if (bestDesc >= 0) { mapping.description = bestDesc; assigned.add(bestDesc); }

  // Amount: pick the first (leftmost) high-scoring numeric column
  const amountCols = [];
  for (let col = 0; col < numCols; col++) {
    if (assigned.has(col)) continue;
    if (scores.amount[col] > 0.3) {
      amountCols.push(col);
    }
  }

  if (amountCols.length >= 2) {
    // Multiple amount columns: first is transaction amount, last is balance
    mapping.amount = amountCols[0];
    mapping.balance = amountCols[amountCols.length - 1];
  } else if (amountCols.length === 1) {
    mapping.amount = amountCols[0];
  }

  return mapping;
}

/**
 * Extract transactions from a PDF table using a column mapping.
 * @param {string[][]} tableRows — 2D string table
 * @param {{ date: number, amount: number, description: number, balance?: number }} colMap
 * @returns {Array<{date:string, description:string, amount:string, category:string}>}
 */
function applyColumnMapping(tableRows, colMap) {
  const transactions = [];

  for (const row of tableRows) {
    const dateStr = colMap.date >= 0 ? (row[colMap.date] || '').trim() : '';
    const descStr = colMap.description >= 0 ? (row[colMap.description] || '').trim() : '';
    const amtStr = colMap.amount >= 0 ? (row[colMap.amount] || '').trim() : '';

    // Must have at least a date or an amount to be a transaction
    const hasDate = dateStr && PDF_DATE_RE.test(dateStr);
    const hasAmount = amtStr && PDF_AMOUNT_RE.test(amtStr);

    if (!hasDate && !hasAmount) continue;
    if (!hasAmount) continue; // Amount is required

    const amount = parseAmount(amtStr);
    if (amount === 0) continue;

    transactions.push({
      date: hasDate ? normaliseDate(dateStr.match(PDF_DATE_RE)[1]) : '',
      description: descStr || 'Unknown transaction',
      amount: String(amount),
      category: '',
    });
  }

  return transactions;
}

/** Date pattern for PDF row scanning */
const PDF_DATE_RE = /\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/;
/** Amount pattern: optional sign, optional $, digits with commas, decimal */
const PDF_AMOUNT_RE = /[-+]?\$?\d{1,3}(?:,\d{3})*\.\d{2}/;

/**
 * Parse a PDF bank statement into normalised transactions.
 * Uses column detection to build a proper table structure,
 * then auto-detects column roles (date, description, amount).
 * Returns both the raw table and transactions so the UI can
 * offer column mapping adjustment.
 *
 * @param {ArrayBuffer} arrayBuffer — PDF file content
 * @returns {Promise<{transactions: Array, rawTable: string[][], autoMapping: Object, format: string}>}
 */
export async function parsePDFStatement(arrayBuffer) {
  const pdfjsLib = await loadPdfJs();

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: true,
  }).promise;

  const allItems = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    for (const item of content.items) {
      const text = (item.str || '').trim();
      if (!text) continue;

      allItems.push({
        text,
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      });
    }
  }

  const { table } = buildPDFTable(allItems);
  const filtered = filterNonDataRows(table);
  const autoMapping = detectPDFColumnRoles(filtered);
  const transactions = applyColumnMapping(filtered, autoMapping);

  return { transactions, rawTable: filtered, autoMapping };
}

/**
 * Re-parse a previously extracted PDF table with a different column mapping.
 * Used when the user adjusts column assignments in the mapping UI.
 * @param {string[][]} rawTable — raw table rows from parsePDFStatement
 * @param {{ date: number, amount: number, description: number }} colMap
 * @returns {{ transactions: Array<{date:string, description:string, amount:string, category:string}> }}
 */
export function reParsePDFTransactions(rawTable, colMap) {
  const transactions = applyColumnMapping(rawTable, colMap);
  return { transactions };
}

/* ---------- Public API ---------- */

/**
 * Parse a fixed-width / space-aligned text statement (e.g. BofA .txt export).
 * Uses a right-to-left parsing strategy: numeric values (amount, balance) are
 * found at the right edge of each line, then everything between the date and
 * the first number is the description. This handles long descriptions that
 * overflow past the nominal "Amount" column position.
 *
 * @param {string} text — raw text content
 * @returns {{ transactions: Array<{date:string, description:string, amount:string, category:string}>, format: string }}
 */
export function parseFixedWidthStatement(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Find the header line containing column names
  let headerLineIdx = -1;
  let hasBalanceColumn = false;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (/\bdate\b/.test(lower) && (/\bamount\b/.test(lower) || /\bdescription?\b/.test(lower))) {
      headerLineIdx = i;
      hasBalanceColumn = /\bbal(ance)?\.?\b/i.test(lower);
      break;
    }
  }

  if (headerLineIdx === -1) {
    // No recognisable header — fall back to CSV parser
    return parseCSVStatement(text);
  }

  // Pattern: one or two right-aligned numbers at end of line
  // Match amounts like: -2,507.62   19,786.58  or just  -185.02
  const TRAILING_NUMBERS_RE = /\s+([-]?\d{1,3}(?:,\d{3})*\.\d{2})\s+([-]?\d{1,3}(?:,\d{3})*\.\d{2})\s*$/;
  const SINGLE_NUMBER_RE = /\s+([-]?\d{1,3}(?:,\d{3})*\.\d{2})\s*$/;
  const DATE_START_RE = /^(\d{2}\/\d{2}\/\d{4})\s+/;

  const transactions = [];
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Must start with a date
    const dateMatch = line.match(DATE_START_RE);
    if (!dateMatch) continue;

    const dateStr = dateMatch[1];

    // Strip the date from the front
    let rest = line.substring(dateMatch[0].length);

    // Extract trailing numbers (amount + optional balance) from the right
    let amountStr = '';
    let twoNumMatch = rest.match(TRAILING_NUMBERS_RE);
    if (twoNumMatch) {
      // Two numbers: first is amount, second is running balance
      amountStr = twoNumMatch[1];
      // Remove both numbers from description
      rest = rest.substring(0, twoNumMatch.index).trim();
    } else {
      let oneNumMatch = rest.match(SINGLE_NUMBER_RE);
      if (oneNumMatch) {
        amountStr = oneNumMatch[1];
        rest = rest.substring(0, oneNumMatch.index).trim();
      }
    }

    const description = rest.trim();

    // Skip summary rows
    if (/^(beginning|ending)\s+balance/i.test(description)) continue;
    if (/^total\s+(credits?|debits?)/i.test(description)) continue;

    if (!amountStr) continue;
    const amount = parseAmount(amountStr);
    if (amount === 0) continue;

    transactions.push({
      date: normaliseDate(dateStr),
      description: description || 'Unknown transaction',
      amount: String(amount),
      category: '',
    });
  }

  return { transactions, format: 'TXT' };
}

/**
 * Detect file type and parse a statement file into transactions.
 * Now async to support PDF parsing (pdf.js loaded from CDN).
 * For CSV/OFX/TXT, resolves immediately. For PDF, awaits pdf.js load + extraction.
 *
 * @param {string|ArrayBuffer} data — file content (text for CSV/OFX/TXT, ArrayBuffer for PDF)
 * @param {string} filename — original filename for type detection
 * @returns {Promise<{transactions: Array, format: string}>}
 */
export async function parseStatement(data, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();

  if (ext === 'pdf') {
    const result = await parsePDFStatement(data);
    return { ...result, format: 'PDF' };
  }

  // Text-based formats — ensure we have a string
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);

  if (ext === 'ofx' || ext === 'qfx' || text.includes('<OFX>') || text.includes('<STMTTRN>')) {
    const result = parseOFXStatement(text);
    return { ...result, format: 'OFX' };
  }

  // TXT files: try fixed-width parsing first
  if (ext === 'txt') {
    const result = parseFixedWidthStatement(text);
    return { ...result, format: result.format || 'TXT' };
  }

  const result = parseCSVStatement(text);
  return { ...result, format: 'CSV' };
}
