import { el, showToast, registerTemplate, drawLineChart } from './shared.js';
const weightTemplate = {
  key: 'weight',
  name: 'Weight Tracker',
  icon: '⚖️',
  color: '#06b6d4',
  priority: 28,
  category: 'Health & Fitness',
  detectSignals: ['weight', 'body fat', 'lbs', 'kg', 'bmi', 'weigh-in'],
  columnRoles: ['date', 'weight', 'unit', 'body fat', 'notes'],
  interactive: true,
  render(container, { cols, rows, onUpdate, onDelete, onAddRow }) {
    container.innerHTML = '';
    container.className = 'tmpl-weight-container';
    const colMap = {};
    cols.forEach((c, idx) => {
      const lower = (c || '').toLowerCase().trim();
      if (lower.includes('date')) colMap.date = idx;
      else if (lower.includes('weight') || lower.includes('lbs') || lower.includes('kg')) colMap.weight = idx;
      else if (lower.includes('unit')) colMap.unit = idx;
      else if (lower.includes('fat') || lower.includes('body fat')) colMap.bodyFat = idx;
      else if (lower.includes('note') || lower.includes('comment')) colMap.notes = idx;
    });
    if (colMap.date === undefined) colMap.date = 0;
    if (colMap.weight === undefined) colMap.weight = 1;
    const entries = rows.map((r, rIdx) => {
      return {
        rowIndex: rIdx + 1,
        date: r[colMap.date] || '',
        weight: parseFloat(r[colMap.weight]) || 0,
        unit: colMap.unit !== undefined ? (r[colMap.unit] || 'lbs') : 'lbs',
        notes: colMap.notes !== undefined ? (r[colMap.notes] || '') : ''
      };
    }).filter(e => e.weight > 0 || e.date);
    const sorted = [...entries].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const latest = sorted.length > 0 ? sorted[sorted.length - 1] : { weight: 0, unit: 'lbs' };
    const initial = sorted.length > 0 ? sorted[0] : { weight: 0 };
    const diff = latest.weight && initial.weight ? (latest.weight - initial.weight) : 0;
    const hero = el('div', { style: 'background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); color: #fff; padding: 24px; border-radius: 16px; margin-bottom: 20px;' }, [
      el('h2', { style: 'margin: 0 0 4px; font-size: 1.75rem; font-weight: 800;' }, '⚖️ Weight Progress Tracker'),
      el('p', { style: 'margin: 0; opacity: 0.9;' }, 'Consistency is key. Watch your health journey unfold!')
    ]);
    container.appendChild(hero);
  }
};
registerTemplate(weightTemplate.key, weightTemplate);
