/* ============================================================
   templates/travel.js — Travel Itinerary: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/** Parse a cost string like "$650", "$180/night", "120" to a number */
function parseCost(raw) {
  return parseFloat((raw || '0').replace(/[^-\d.]/g, '')) || 0;
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

  detect(lower) {
    return lower.some(h => /^(flight|hotel|booking|itinerary|accommodation|departure|arrival|transport)/.test(h) || /^(activity|event|attraction)/.test(h))
      && lower.some(h => /^(booking|confirmation|ref|reservation|cost|price)/.test(h) || /flight|hotel|hostel|airbnb/.test(h));
  },

  columns(lower) {
    const cols = { activity: -1, date: -1, location: -1, booking: -1, cost: -1 };
    cols.activity = lower.findIndex(h => /^(activity|event|item|flight|hotel|what|description|name|attraction|plan)/.test(h));
    if (cols.activity === -1) cols.activity = 0;
    cols.date     = lower.findIndex(h => /^(date|day|when|depart|arrive|check)/.test(h));
    cols.location = lower.findIndex(h => /^(location|where|city|place|destination|from|to|route|address)/.test(h));
    cols.booking  = lower.findIndex(h => /^(booking|confirmation|ref|reservation|code|ticket|record)/.test(h));
    cols.cost     = lower.findIndex(h => /^(cost|price|amount|total|fee|\$|budget|paid)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'activity', label: 'Activity', colIndex: cols.activity, type: 'text',   placeholder: 'Flight, hotel, excursion…', required: true },
      { role: 'date',     label: 'Date',     colIndex: cols.date,     type: 'date' },
      { role: 'location', label: 'Location', colIndex: cols.location, type: 'text',   placeholder: 'City or address' },
      { role: 'booking',  label: 'Booking',  colIndex: cols.booking,  type: 'text',   placeholder: 'Confirmation #' },
      { role: 'cost',     label: 'Cost',     colIndex: cols.cost,     type: 'number', placeholder: 'Amount' },
    ];
  },

  render(container, rows, cols) {
    /* ---------- Compute totals & find first date ---------- */
    let totalCost = 0;
    let firstDate = null;
    for (const row of rows) {
      totalCost += parseCost(cell(row, cols.cost));
      const d = cell(row, cols.date);
      if (d && (!firstDate || d < firstDate)) firstDate = d;
    }

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
    container.append(el('div', { className: 'travel-summary' }, summaryItems));

    /* ---------- Itinerary cards ---------- */
    let prevDate = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const activity = cell(row, cols.activity) || row[0] || '\u2014';
      const date = cell(row, cols.date);
      const location = cell(row, cols.location);
      const booking = cell(row, cols.booking);
      const cost = cell(row, cols.cost);

      if (date && date !== prevDate) {
        container.append(el('div', { className: 'travel-date-header' }, [date]));
        prevDate = date;
      }

      const icon = /flight|fly|plane/i.test(activity) ? '\u2708\uFE0F' :
                   /hotel|hostel|airbnb|accommodation|stay/i.test(activity) ? '\uD83C\uDFE8' :
                   /train|rail/i.test(activity) ? '\uD83D\uDE86' :
                   /museum|gallery|tour/i.test(activity) ? '\uD83C\uDFAD' :
                   /restaurant|food|dine/i.test(activity) ? '\uD83C\uDF7D\uFE0F' : '\uD83D\uDCCD';

      /* Location with optional map link */
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

      container.append(el('div', { className: 'travel-card' }, [
        el('div', { className: 'travel-card-icon' }, [icon]),
        el('div', { className: 'travel-card-content' }, [
          editableCell('div', { className: 'travel-card-title' }, activity, rowIdx, cols.activity),
          locationEl,
          el('div', { className: 'travel-card-meta' }, [
            cols.booking >= 0 ? editableCell('span', { className: 'travel-booking-ref' }, booking, rowIdx, cols.booking) : null,
            cols.cost >= 0    ? editableCell('span', { className: 'travel-cost' }, cost, rowIdx, cols.cost) : null,
          ]),
        ]),
      ]));
    }
  },
};

registerTemplate('travel', definition);
export default definition;
