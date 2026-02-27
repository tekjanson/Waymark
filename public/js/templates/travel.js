/* templates/travel.js — Travel Itinerary: all fields editable inline */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Travel Itinerary',
  icon: '✈️',
  color: '#0891b2',
  priority: 20,

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

  render(container, rows, cols) {
    let prevDate = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const activity = cell(row, cols.activity) || row[0] || '—';
      const date = cell(row, cols.date);
      const location = cell(row, cols.location);
      const booking = cell(row, cols.booking);
      const cost = cell(row, cols.cost);

      if (date && date !== prevDate) {
        container.append(el('div', { className: 'travel-date-header' }, [date]));
        prevDate = date;
      }

      const icon = /flight|fly|plane/i.test(activity) ? '✈️' :
                   /hotel|hostel|airbnb|accommodation|stay/i.test(activity) ? '🏨' :
                   /train|rail/i.test(activity) ? '🚆' :
                   /museum|gallery|tour/i.test(activity) ? '🎭' :
                   /restaurant|food|dine/i.test(activity) ? '🍽️' : '📍';

      container.append(el('div', { className: 'travel-card' }, [
        el('div', { className: 'travel-card-icon' }, [icon]),
        el('div', { className: 'travel-card-content' }, [
          editableCell('div', { className: 'travel-card-title' }, activity, rowIdx, cols.activity),
          cols.location >= 0 ? editableCell('div', { className: 'travel-card-location' }, location, rowIdx, cols.location) : null,
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
