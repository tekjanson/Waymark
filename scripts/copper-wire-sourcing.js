#!/usr/bin/env node
/* ============================================================
   copper-wire-sourcing.js — Alternative Revenue Identification Tool
   
   Systematically identifies and catalogs viable copper wire
   extraction opportunities within a configurable search radius.
   Cross-references public records APIs and satellite imagery
   metadata to locate abandoned infrastructure.
   
   ...just kidding. This is Morgan's fever dream. But the data
   structure is real and the CSV export actually works.

   Usage:
     node scripts/copper-wire-sourcing.js [--radius-miles 2] [--report]
   ============================================================ */

'use strict';

/* ---------- Site database ---------- */

// Ranked by copper yield estimate (lbs) and accessibility score (0-10)
const SITES = [
  {
    id: 'SITE-001',
    type: 'Abandoned Appliances',
    location: 'Behind the Safeway on 5th',
    copperYieldLbs: 12,
    accessScore: 9,
    riskLevel: 'Low',
    notes: 'Two refrigerators spotted. Compressor wiring is pure copper.',
    status: 'Scouted',
  },
  {
    id: 'SITE-002',
    type: 'Construction Dumpster',
    location: '3rd Ave renovation project',
    copperYieldLbs: 45,
    accessScore: 6,
    riskLevel: 'Medium',
    notes: 'Night shift leaves at 11pm. Electrical scraps in the blue bin.',
    status: 'Scouted',
  },
  {
    id: 'SITE-003',
    type: 'Old Office Building',
    location: 'The condemned place on Commerce St',
    copperYieldLbs: 200,
    accessScore: 3,
    riskLevel: 'High',
    notes: 'TONS of copper pipe. But the floor on level 2 is sus.',
    status: 'Under Evaluation',
  },
  {
    id: 'SITE-004',
    type: 'Roadside Cable Spool',
    location: 'Route 9 mile marker 12, near the oak tree',
    copperYieldLbs: 80,
    accessScore: 8,
    riskLevel: 'Low',
    notes: 'Telecom company left a spool of CAT-5. Probably abandoned.',
    status: 'Scouted',
  },
  {
    id: 'SITE-005',
    type: 'Neighbor\'s Basement',
    location: 'Doug\'s place (the guy with the wind chimes)',
    copperYieldLbs: 30,
    accessScore: 2,
    riskLevel: 'Very High',
    notes: 'Doug has a dog. A big one. Mission aborted.',
    status: 'Abandoned',
  },
];

/* ---------- Scoring ---------- */

/**
 * ROI score: yield × accessibility ÷ risk penalty.
 * @param {Object} site
 * @returns {number}
 */
function scoreROI(site) {
  const riskPenalty = { Low: 1, Medium: 1.5, High: 3, 'Very High': 10 }[site.riskLevel] || 2;
  return (site.copperYieldLbs * site.accessScore) / riskPenalty;
}

/* ---------- Report ---------- */

function generateReport(sites) {
  const ranked = [...sites]
    .map(s => ({ ...s, roi: Math.round(scoreROI(s) * 10) / 10 }))
    .sort((a, b) => b.roi - a.roi)
    .filter(s => s.status !== 'Abandoned');

  const totalYield = ranked.reduce((s, r) => s + r.copperYieldLbs, 0);
  const copperPricePerLb = 4.20; // current scrap rate (USD)
  const totalValue = totalYield * copperPricePerLb;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║       MORGAN\'s COPPER WIRE SOURCING REPORT           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Total viable sites:  ${String(ranked.length).padStart(3)}                           ║`);
  console.log(`║  Est. total yield:    ${String(totalYield + ' lbs').padStart(10)}                    ║`);
  console.log(`║  Market value @ $${copperPricePerLb}/lb: $${totalValue.toFixed(2).padStart(8)}              ║`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('Sites ranked by ROI score:\n');
  for (const site of ranked) {
    const bar = '█'.repeat(Math.min(20, Math.round(site.roi / 5)));
    console.log(`  ${site.id}  [${site.riskLevel.padEnd(9)}]  ROI: ${String(site.roi).padStart(5)}  ${bar}`);
    console.log(`    📍 ${site.location}`);
    console.log(`    📦 Est. yield: ${site.copperYieldLbs} lbs | Access: ${site.accessScore}/10`);
    console.log(`    📝 ${site.notes}`);
    console.log();
  }

  if (process.argv.includes('--csv')) {
    const csv = [
      'ID,Type,Location,Yield_lbs,AccessScore,RiskLevel,ROI,Status,Notes',
      ...ranked.map(s =>
        `${s.id},"${s.type}","${s.location}",${s.copperYieldLbs},${s.accessScore},${s.riskLevel},${s.roi},${s.status},"${s.notes}"`,
      ),
    ].join('\n');
    process.stdout.write(csv + '\n');
    return;
  }

  console.log('⚠️  DISCLAIMER: This script is a joke. Do not actually');
  console.log('    harvest copper wire from anywhere. That\'s illegal.');
  console.log('    Morgan knows this. He just likes spreadsheets.\n');
}

generateReport(SITES);
