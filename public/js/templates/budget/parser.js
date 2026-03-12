/* ============================================================
   templates/budget/parser.js — Bank statement parser
   ============================================================
   Parses CSV, OFX, and QFX bank/credit card statements into
   normalised transaction arrays for the budget template.
   All logic runs in the browser — no server-side processing.
   ============================================================ */

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
 * @param {string} text — raw CSV content
 * @returns {{ transactions: Array<{date:string, description:string, amount:string, category:string}>, columns: Object, rawHeaders: string[] }}
 */
export function parseCSVStatement(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return { transactions: [], columns: {}, rawHeaders: [] };

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const colMap = detectCSVColumns(headers, dataRows);

  const transactions = [];
  for (const row of dataRows) {
    // Skip empty rows
    const nonEmpty = row.filter(c => c.trim()).length;
    if (nonEmpty === 0) continue;

    let amount;
    if (colMap.amount >= 0) {
      amount = parseAmount(row[colMap.amount] || '');
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

/* ---------- Public API ---------- */

/**
 * Detect file type and parse a statement file into transactions.
 * @param {string} text — file content as text
 * @param {string} filename — original filename for type detection
 * @returns {{ transactions: Array<{date:string, description:string, amount:string, category:string}>, format: string }}
 */
export function parseStatement(text, filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();

  if (ext === 'ofx' || ext === 'qfx' || text.includes('<OFX>') || text.includes('<STMTTRN>')) {
    const result = parseOFXStatement(text);
    return { ...result, format: 'OFX' };
  }

  const result = parseCSVStatement(text);
  return { ...result, format: 'CSV' };
}
