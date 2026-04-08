/* ============================================================
   templates/travel.js — Travel Itinerary: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Helpers ---------- */

/**
 * Parse a cost string to a number.
 * Extracts the first $ amount (e.g. "$49 (2 adults)" → 49, "~$30 gas" → 30).
 * Falls back to a bare leading number ("120" → 120, "~30" → 30).
 * Returns 0 for "FREE", null, or unparseable strings.
 */
function parseCost(raw) {
  if (!raw) return 0;
  const s = String(raw);
  // Prefer the first dollar-prefixed number
  const dollar = s.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/);
  if (dollar) return parseFloat(dollar[1].replace(/,/g, '')) || 0;
  // Fallback: bare leading number (no currency symbol)
  const bare = s.match(/^~?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (bare) return parseFloat(bare[1].replace(/,/g, '')) || 0;
  return 0;
}

/** Build a Google Maps link for a location string */
function mapsLink(loc) {
  if (!loc) return null;
  const q = encodeURIComponent(loc);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Return days until a date, or null if unparseable/past */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d - now) / 86400000);
  return diff > 0 ? diff : null;
}

const definition = {
  name: 'Travel Itinerary',
  icon: '✈️',
  color: '#0891b2',
  priority: 20,
  itemNoun: 'Activity',
  defaultHeaders: ['Activity', 'Date', 'Location', 'Link', 'Cost', 'People', 'Notes'],

  detect(lower) {
    return lower.some(h => /^(flight|hotel|booking|itinerary|accommodation|departure|arrival|transport)/.test(h) || /^(activity|event|attraction)/.test(h))
      && lower.some(h => /^(booking|confirmation|ref|reservation|link|url|cost|price)/.test(h) || /flight|hotel|hostel|airbnb/.test(h));
  },

  columns(lower) {
    const cols = { activity: -1, date: -1, location: -1, link: -1, booking: -1, cost: -1, people: -1, notes: -1 };
    cols.activity = lower.findIndex(h => /^(activity|event|item|flight|hotel|what|description|name|attraction|plan)/.test(h));
    if (cols.activity === -1) cols.activity = 0;
    cols.date     = lower.findIndex(h => /^(date|day|when|depart|arrive|check)/.test(h));
    cols.location = lower.findIndex(h => /^(location|where|city|place|destination|from|to|route|address)/.test(h));
    cols.link     = lower.findIndex(h => /^(link|url)/.test(h));
    cols.booking  = lower.findIndex(h => /^(booking|confirmation|ref|reservation|code|ticket|record)/.test(h));
    cols.cost     = lower.findIndex(h => /^(cost|price|amount|total|fee|\$|budget|paid)/.test(h));
    cols.people   = lower.findIndex(h => /^(people|person|guests?|adults?|count|qty|quantity|party|pax)/.test(h));
    cols.notes    = lower.findIndex(h => /^(notes?|comments?|details?)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    const linkColIdx = cols.link >= 0 ? cols.link : cols.booking;
    return [
      { role: 'activity', label: 'Activity', colIndex: cols.activity, type: 'text', placeholder: 'Flight, hotel, excursion…', required: true },
      { role: 'date',     label: 'Date',     colIndex: cols.date,     type: 'date' },
      { role: 'location', label: 'Location', colIndex: cols.location, type: 'text', placeholder: 'City or address' },
      linkColIdx >= 0 ? { role: 'link',   label: 'Link/Ref', colIndex: linkColIdx,   type: 'text', placeholder: 'URL or confirmation #' } : null,
      { role: 'cost',     label: 'Cost',     colIndex: cols.cost,     type: 'text', placeholder: 'Amount, e.g. $49 or FREE' },
      cols.people >= 0 ? { role: 'people', label: 'People', colIndex: cols.people, type: 'number', placeholder: '# of guests' } : null,
      cols.notes  >= 0 ? { role: 'notes',  label: 'Notes',  colIndex: cols.notes,  type: 'text',   placeholder: 'Booking details…' } : null,
    ].filter(Boolean);
  },

  render(container, rows, cols) {
    /* ---------- Compute totals, first date, and unique locations ---------- */
    let totalCost = 0;
    let firstDate = null;
    const locationsList = [];
    for (const row of rows) {
      totalCost += parseCost(cell(row, cols.cost));
      const d = cell(row, cols.date);
      if (d && (!firstDate || d < firstDate)) firstDate = d;
      const loc = cell(row, cols.location);
      if (loc) locationsList.push(loc);
    }
    const uniqueLocs = [...new Set(locationsList)];

    /* ---------- Summary bar ---------- */
    const summaryItems = [];
    if (cols.cost >= 0) {
      summaryItems.push(el('div', { className: 'travel-summary-item' }, [
        el('span', { className: 'travel-summary-label' }, ['Total Cost']),
        el('span', { className: 'travel-summary-value travel-summary-cost' }, [`$${totalCost.toLocaleString()}`]),
      ]));
    }
    summaryItems.push(el('div', { className: 'travel-summary-item' }, [
      el('span', { className: 'travel-summary-label' }, ['Activities']),
      el('span', { className: 'travel-summary-value' }, [`${rows.length}`]),
    ]));

    const countdown = daysUntil(firstDate);
    if (countdown !== null) {
      summaryItems.push(el('div', { className: 'travel-summary-item travel-summary-countdown' }, [
        el('span', { className: 'travel-summary-label' }, ['Departure']),
        el('span', { className: 'travel-summary-value' }, [
          `${countdown} day${countdown !== 1 ? 's' : ''} away`,
        ]),
      ]));
    }

    /* Google Maps route button when 2+ unique locations exist */
    if (uniqueLocs.length >= 2) {
      const routeUrl = 'https://www.google.com/maps/dir/' + uniqueLocs.map(encodeURIComponent).join('/');
      summaryItems.push(el('div', { className: 'travel-summary-item' }, [
        el('a', {
          className: 'travel-map-route-btn',
          href: routeUrl,
          target: '_blank',
          rel: 'noopener',
          title: `View route with ${uniqueLocs.length} stops on Google Maps`,
        }, ['\uD83D\uDDFA\uFE0F View Route']),
      ]));
    }
    container.append(el('div', { className: 'travel-summary' }, summaryItems));

    /* ---------- Itinerary cards ---------- */
    /* Support both old (booking) and new (link) column formats */
    const linkColIdx = cols.link >= 0 ? cols.link : cols.booking;
    let prevDate = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const activity = cell(row, cols.activity) || row[0] || '\u2014';
      const date = cell(row, cols.date);
      const location = cell(row, cols.location);
      const linkVal = linkColIdx >= 0 ? cell(row, linkColIdx) : '';
      const cost = cell(row, cols.cost);
      const people = cols.people >= 0 ? cell(row, cols.people) : '';
      const notes  = cols.notes  >= 0 ? cell(row, cols.notes)  : '';

      if (date && date !== prevDate) {
        container.append(el('div', { className: 'travel-date-header' }, [date]));
        prevDate = date;
      }

      const icon = /flight|fly|plane/i.test(activity) ? '\u2708\uFE0F' :
                   /hotel|hostel|airbnb|accommodation|stay|overnight/i.test(activity) ? '\uD83C\uDFE8' :
                   /train|rail/i.test(activity) ? '\uD83D\uDE86' :
                   /museum|gallery|tour/i.test(activity) ? '\uD83C\uDFAD' :
                   /restaurant|food|dine|dinner/i.test(activity) ? '\uD83C\uDF7D\uFE0F' : '\uD83D\uDCCD';

      /* Location with optional per-item map link */
      let locationEl = null;
      if (cols.location >= 0 && location) {
        const href = mapsLink(location);
        locationEl = el('div', { className: 'travel-card-location-wrap' }, [
          editableCell('span', { className: 'travel-card-location' }, location, rowIdx, cols.location),
          href ? el('a', {
            className: 'travel-map-link',
            href,
            target: '_blank',
            rel: 'noopener',
            title: `View ${location} on Google Maps`,
          }, ['\uD83D\uDDFA\uFE0F']) : null,
        ]);
      }

      /* Link element — URL → clickable link, non-URL text → editable ref */
      let linkEl = null;
      if (linkColIdx >= 0 && linkVal) {
        if (/^https?:\/\//.test(linkVal)) {
          linkEl = el('a', {
            className: 'travel-booking-link',
            href: linkVal,
            target: '_blank',
            rel: 'noopener',
            title: linkVal,
          }, ['\uD83D\uDCCE Book']);
        } else {
          linkEl = editableCell('span', { className: 'travel-booking-ref' }, linkVal, rowIdx, linkColIdx);
        }
      }

      const costEl = cols.cost >= 0
        ? editableCell('span', { className: 'travel-cost' }, cost, rowIdx, cols.cost)
        : null;

      const peopleEl = people
        ? el('span', { className: 'travel-people', title: `${people} person(s)` }, ['\uD83D\uDC65 ' + people])
        : null;

      const notesEl = notes
        ? el('div', { className: 'travel-notes' }, [notes])
        : null;

      container.append(el('div', { className: 'travel-card' }, [
        el('div', { className: 'travel-card-icon' }, [icon]),
        el('div', { className: 'travel-card-content' }, [
          editableCell('div', { className: 'travel-card-title' }, activity, rowIdx, cols.activity),
          locationEl,
          el('div', { className: 'travel-card-meta' }, [
            linkEl,
            costEl,
            peopleEl,
          ]),
          notesEl,
        ]),
      ]));
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'travel-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'travel-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'travel-dir-icon tmpl-dir-icon' }, ['\u2708\uFE0F']),
      el('span', { className: 'travel-dir-title tmpl-dir-title' }, ['Travel Itineraries']),
      el('span', { className: 'travel-dir-count tmpl-dir-count' }, [
        `${sheets.length} itinerar${sheets.length !== 1 ? 'ies' : 'y'}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'travel-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'travel-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'travel-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'travel-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} activit${rows.length !== 1 ? 'ies' : 'y'}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.travel-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('travel', definition);
export { parseCost };
export default definition;
