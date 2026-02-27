#!/usr/bin/env node
/* ============================================================
   generate-examples.js — CLI tool to create WayMark example
   sheets in a Google Drive account.
   
   Usage:
     # Interactive (opens browser for OAuth):
     node scripts/generate-examples.js
   
     # With existing access token:
     GOOGLE_TOKEN=ya29.xxx node scripts/generate-examples.js
   
   Requires:
     - GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env or env vars
     - Google Sheets API and Google Drive API enabled
   ============================================================ */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const path = require('path');

// Load .env
try {
  const fs = require('fs');
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch { /* ignore */ }

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_PORT = 8089;
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

/* ---------- Example Sheet Data ---------- */

const EXAMPLE_SHEETS = {
  'Grocery List': {
    folder: 'Checklists',
    rows: [
      ['Item', 'Status', 'Quantity', 'Notes'],
      ['Milk', 'done', '2', 'Whole milk'],
      ['Eggs', 'done', '12', 'Free range'],
      ['Bread', '', '1', 'Sourdough'],
      ['Butter', '', '1', 'Unsalted'],
      ['Chicken Breast', 'done', '2 lbs', 'Organic'],
      ['Spinach', '', '1 bag', 'Baby spinach'],
      ['Tomatoes', 'done', '6', 'Roma'],
      ['Cheese', '', '1', 'Cheddar block'],
      ['Rice', 'done', '1 bag', 'Jasmine 5 lb'],
      ['Olive Oil', '', '1', 'Extra virgin'],
    ],
  },
  'Moving Day Checklist': {
    folder: 'Checklists',
    rows: [
      ['Task', 'Done', 'Due', 'Notes'],
      ['Get moving boxes', 'yes', '2 weeks before', 'Home Depot'],
      ['Change address at USPS', 'yes', '2 weeks before', 'usps.com'],
      ['Pack non-essentials', 'yes', '1 week before', 'Books, decor'],
      ['Clean out fridge', '', '2 days before', 'Donate perishables'],
      ['Pack essentials box', '', 'Day before', 'Toiletries, chargers'],
      ['Final walkthrough', '', 'Moving day', 'Check all rooms'],
      ['Transfer utilities', '', 'Moving day', 'Electric, water, internet'],
    ],
  },
  'Fitness Goals': {
    folder: 'Trackers',
    rows: [
      ['Goal', 'Progress', 'Target', 'Notes'],
      ['Run a 5K', '4.2', '5', 'Building up distance'],
      ['Pushups in a row', '35', '50', 'Up from 20'],
      ['Plank hold (min)', '2.5', '5', 'Core strength'],
      ['Pull-ups', '8', '15', 'Wide grip'],
      ['Weight loss (lbs)', '12', '20', 'Since January'],
      ['Daily steps', '8500', '10000', 'Average this week'],
    ],
  },
  'Reading List': {
    folder: 'Trackers',
    rows: [
      ['Title', 'Progress', 'Target', 'Status'],
      ['Atomic Habits', '100', '100', 'Finished!'],
      ['Deep Work', '75', '100', 'Almost done'],
      ['The Design of Everyday Things', '40', '100', 'Reading'],
      ['Clean Code', '60', '100', 'Halfway'],
    ],
  },
  'Weekly Schedule': {
    folder: 'Schedules',
    rows: [
      ['Day', 'Time', 'Activity', 'Location'],
      ['Monday', '8:00 AM', 'Team Standup', 'Conference Room A'],
      ['Monday', '10:00 AM', 'Design Review', 'Zoom'],
      ['Tuesday', '9:00 AM', 'Sprint Planning', 'Conference Room B'],
      ['Wednesday', '11:00 AM', 'Lunch & Learn', 'Break Room'],
      ['Thursday', '9:00 AM', 'Focus Time', 'Home Office'],
      ['Friday', '10:00 AM', 'Demo Day', 'All Hands Room'],
    ],
  },
  'Pantry Inventory': {
    folder: 'Inventories',
    rows: [
      ['Item', 'Quantity', 'Category', 'Expires'],
      ['Jasmine Rice', '5 lbs', 'Grains', '2026-06-01'],
      ['Black Beans', '4 cans', 'Canned', '2027-03-15'],
      ['Pasta', '3 boxes', 'Grains', '2026-12-01'],
      ['Olive Oil', '750 ml', 'Oils', '2026-09-01'],
      ['Flour', '2 lbs', 'Baking', '2026-04-15'],
      ['Sugar', '3 lbs', 'Baking', '2027-06-01'],
    ],
  },
  'Emergency Contacts': {
    folder: 'Contacts',
    rows: [
      ['Name', 'Phone', 'Email', 'Relationship'],
      ['Dr. Sarah Johnson', '555-0101', 'sjohnson@medical.com', 'Doctor'],
      ['Mike Chen', '555-0102', 'mike.c@email.com', 'Spouse'],
      ['Lisa Park', '555-0103', 'lisa.park@email.com', 'Parent'],
      ['City Hospital', '555-0911', 'info@cityhospital.org', 'Hospital'],
    ],
  },
  'Workout Log': {
    folder: 'Logs',
    rows: [
      ['Timestamp', 'Activity', 'Duration', 'Type'],
      ['2026-02-27 07:00', 'Morning run — 5K', '28 min', 'Cardio'],
      ['2026-02-26 18:00', 'Upper body strength', '45 min', 'Strength'],
      ['2026-02-25 17:30', 'HIIT circuit', '25 min', 'Cardio'],
      ['2026-02-24 07:00', 'Morning run — 3K', '18 min', 'Cardio'],
      ['2026-02-23 18:00', 'Lower body strength', '50 min', 'Strength'],
    ],
  },
};

/* ---------- HTTP helpers ---------- */

function httpsRequest(url, options = {}, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/* ---------- OAuth ---------- */

async function getAccessToken() {
  // Check env first
  if (process.env.GOOGLE_TOKEN) {
    console.log('Using GOOGLE_TOKEN from environment');
    return process.env.GOOGLE_TOKEN;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
    process.exit(1);
  }

  // PKCE
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&access_type=offline&prompt=consent`;

  console.log('\nOpen this URL in your browser to authorize:\n');
  console.log(authUrl);
  console.log('\nWaiting for callback...\n');

  // Start local server to capture code
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (reqUrl.pathname === '/callback') {
        const code = reqUrl.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization complete!</h1><p>You can close this tab.</p>');
        server.close();
        if (code) resolve(code);
        else reject(new Error('No code received'));
      }
    });
    server.listen(REDIRECT_PORT);
    server.on('error', reject);
  });

  // Exchange code for token
  const tokenBody = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  }).toString();

  const tokenRes = await httpsRequest(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    tokenBody
  );

  if (tokenRes.data.access_token) {
    console.log('Got access token');
    return tokenRes.data.access_token;
  }
  console.error('Token exchange failed:', tokenRes.data);
  process.exit(1);
}

/* ---------- Google API helpers ---------- */

async function createDriveFolder(token, name, parents = []) {
  const res = await httpsRequest(
    'https://www.googleapis.com/drive/v3/files',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents,
    })
  );
  if (res.status !== 200) throw new Error(`Drive create folder failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function createSheet(token, title, rows, parentId) {
  const body = {
    properties: { title },
    sheets: [{
      properties: { title: 'Sheet1' },
      data: rows.length ? [{
        startRow: 0,
        startColumn: 0,
        rowData: rows.map(row => ({
          values: row.map(cell => ({ userEnteredValue: { stringValue: String(cell) } })),
        })),
      }] : [],
    }],
  };

  const res = await httpsRequest(
    'https://sheets.googleapis.com/v4/spreadsheets',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    JSON.stringify(body)
  );
  if (res.status !== 200) throw new Error(`Sheets create failed: ${res.status} ${JSON.stringify(res.data)}`);

  // Move to parent folder
  if (parentId) {
    await httpsRequest(
      `https://www.googleapis.com/drive/v3/files/${res.data.spreadsheetId}?addParents=${parentId}&fields=id`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  }

  return res.data;
}

/* ---------- Main ---------- */

async function main() {
  console.log('WayMark — Example Sheet Generator\n');

  const token = await getAccessToken();

  // Create root folder
  console.log('Creating "WayMark Examples" folder...');
  const rootFolder = await createDriveFolder(token, 'WayMark Examples');
  console.log(`  → ${rootFolder.id}`);

  // Create subfolders
  const subfolderNames = [...new Set(Object.values(EXAMPLE_SHEETS).map(s => s.folder))];
  const subfolders = {};

  for (const name of subfolderNames) {
    console.log(`Creating subfolder: ${name}`);
    const folder = await createDriveFolder(token, name, [rootFolder.id]);
    subfolders[name] = folder.id;
    console.log(`  → ${folder.id}`);
  }

  // Create sheets
  let count = 0;
  for (const [title, def] of Object.entries(EXAMPLE_SHEETS)) {
    count++;
    console.log(`Creating sheet [${count}]: ${title}`);
    const result = await createSheet(token, title, def.rows, subfolders[def.folder]);
    console.log(`  → ${result.spreadsheetId}`);
  }

  console.log(`\nDone! Created ${count} sheets in "WayMark Examples" folder.`);
  console.log(`Root folder ID: ${rootFolder.id}`);
  console.log(`View at: https://drive.google.com/drive/folders/${rootFolder.id}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
