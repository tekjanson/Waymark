/* ============================================================
   party/cards.js — Party Planning Dashboard: DOM builders

   Pure-ish builders that turn parsed state into DOM via el(). All user
   actions are delegated back through the `ctx.handlers` callbacks so this
   module never touches the network or module state directly.
   ============================================================ */

import { el } from '../shared.js';
import {
  META_FIELDS, barClass, isYes, linkIcon, normalizeUrl,
} from './helpers.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------- Progress bits ---------- */

/** A labeled horizontal progress bar. */
export function progressBar(p) {
  return el('div', { className: 'party-bar-track' }, [
    el('div', { className: `party-bar-fill ${barClass(p)}`, style: `width:${p}%` }),
  ]);
}

/** A circular SVG progress ring for the hero. */
function progressRing(p) {
  const size = 92, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - p / 100);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'party-ring-svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));

  const bg = document.createElementNS(SVG_NS, 'circle');
  bg.setAttribute('class', 'party-ring-bg');
  bg.setAttribute('cx', String(size / 2));
  bg.setAttribute('cy', String(size / 2));
  bg.setAttribute('r', String(r));
  bg.setAttribute('stroke-width', String(stroke));

  const fg = document.createElementNS(SVG_NS, 'circle');
  fg.setAttribute('class', `party-ring-fg ${barClass(p)}`);
  fg.setAttribute('cx', String(size / 2));
  fg.setAttribute('cy', String(size / 2));
  fg.setAttribute('r', String(r));
  fg.setAttribute('stroke-width', String(stroke));
  fg.setAttribute('stroke-dasharray', String(c));
  fg.setAttribute('stroke-dashoffset', String(off));
  fg.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);

  svg.append(bg, fg);
  return el('div', { className: 'party-ring' }, [
    svg,
    el('div', { className: 'party-ring-label' }, [
      el('span', { className: 'party-ring-num' }, [`${p}%`]),
      el('span', { className: 'party-ring-cap' }, ['ready']),
    ]),
  ]);
}

/* ---------- Hero ---------- */

/**
 * Build the hero header: guest of honor, date, theme + overall readiness.
 * @param {Object} ctx
 */
export function buildHero(ctx) {
  const { meta, overall, handlers } = ctx;

  const chip = (label, value, cls) =>
    el('div', { className: `party-hero-chip ${cls}` }, [
      el('span', { className: 'party-hero-chip-label' }, [label]),
      el('span', { className: 'party-hero-chip-value' }, [value || '—']),
    ]);

  const headline = el('div', { className: 'party-hero-main' }, [
    el('div', { className: 'party-hero-title' }, [meta.party || 'Untitled Party']),
    el('div', { className: 'party-hero-chips' }, [
      chip('Guest of Honor', meta.guestOfHonor, 'party-hero-guest'),
      chip('Date', meta.date, 'party-hero-date'),
      chip('Theme', meta.theme, 'party-hero-theme'),
      meta.venue ? chip('Venue', meta.venue, 'party-hero-venue') : null,
      meta.host ? chip('Host', meta.host, 'party-hero-host') : null,
    ]),
  ]);

  const edit = el('button', {
    className: 'party-hero-edit',
    type: 'button',
    'aria-label': 'Edit party details',
    on: { click: () => handlers.editMeta() },
  }, ['✎ Edit details']);

  return el('div', { className: 'party-hero' }, [
    el('div', { className: 'party-hero-left' }, [headline, edit]),
    progressRing(overall.pct),
  ]);
}

/* ---------- Category card ---------- */

/** Build an inline editable control for a field in an expanded row. */
function fieldControl(ctx, cat, rowIdx, field, value) {
  if (field.type === 'status') {
    const opts = field.options;
    const badge = el('button', {
      className: `party-badge party-badge-${slug(value)}`,
      type: 'button',
      title: 'Click to change',
      on: {
        click: () => {
          const i = opts.indexOf(value);
          const next = opts[(i + 1) % opts.length];
          ctx.handlers.inlineEdit(cat.key, rowIdx, field.col, next);
        },
      },
    }, [value || '—']);
    return badge;
  }
  if (field.type === 'yesno') {
    const on = isYes(value);
    return el('button', {
      className: `party-toggle${on ? ' party-toggle-on' : ''}`,
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      on: {
        click: () => ctx.handlers.inlineEdit(cat.key, rowIdx, field.col, on ? 'No' : 'Yes'),
      },
    }, [on ? '✓' : '']);
  }
  // text / money
  const input = el('input', {
    className: 'party-cell-input',
    type: 'text',
    value: value || '',
    placeholder: field.placeholder || '',
  });
  const commit = () => {
    if (input.value.trim() !== (value || '')) {
      ctx.handlers.inlineEdit(cat.key, rowIdx, field.col, input.value.trim());
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = value || ''; input.blur(); }
  });
  return input;
}

/** Build one expandable item row. */
function buildItemRow(ctx, cat, row, rowIdx) {
  const cells = cat.fields.map((f) =>
    el('div', { className: `party-cell party-cell-${f.role}` }, [
      el('span', { className: 'party-cell-label' }, [f.label]),
      fieldControl(ctx, cat, rowIdx, f, row[f.col] || ''),
    ]),
  );
  const del = el('button', {
    className: 'party-row-del',
    type: 'button',
    'aria-label': `Delete ${cat.noun}`,
    on: { click: () => ctx.handlers.deleteItem(cat.key, rowIdx) },
  }, ['🗑']);
  return el('div', { className: 'party-item', dataset: { row: String(rowIdx) } }, [
    el('div', { className: 'party-item-cells' }, cells),
    del,
  ]);
}

/**
 * Build a category card (guests, menu, budget, decorations).
 * @param {Object} ctx
 * @param {Object} cat  category definition
 * @param {string[][]} rows
 */
export function buildCategoryCard(ctx, cat, rows) {
  const { collapsed, handlers } = ctx;
  const isCollapsed = collapsed.has(cat.key);
  const prog = cat.progress(rows);

  const card = el('div', {
    className: `party-card party-card-${cat.key}${isCollapsed ? ' party-collapsed' : ''}`,
    dataset: { key: cat.key },
    style: `--party-accent:${cat.accent}`,
    draggable: 'true',
  });

  const header = buildCardHeader(ctx, cat, {
    title: cat.title,
    icon: cat.icon,
    pct: prog.pct,
    metaText: `${prog.done}/${prog.total} · ${cat.summary(rows)}`,
    isCollapsed,
  });

  const bodyChildren = rows.length
    ? rows.map((row, i) => buildItemRow(ctx, cat, row, i))
    : [el('div', { className: 'party-empty' }, [`No ${cat.noun}s yet — add your first.`])];

  const addBtn = el('button', {
    className: 'party-add',
    type: 'button',
    on: { click: () => handlers.addItem(cat.key) },
  }, [`+ Add ${cat.noun}`]);

  const body = el('div', { className: `party-card-body${isCollapsed ? ' hidden' : ''}` }, [
    el('div', { className: 'party-items' }, bodyChildren),
    addBtn,
  ]);

  card.append(header, body);
  wireDrag(ctx, card, cat.key);
  return card;
}

/* ---------- Links card ---------- */

/**
 * Build the external tools / links card (Amazon registry, Pinterest, etc.).
 * @param {Object} ctx
 * @param {{label:string,url:string,type:string}[]} links
 */
export function buildLinksCard(ctx, links) {
  const { collapsed, handlers } = ctx;
  const key = 'links';
  const isCollapsed = collapsed.has(key);

  const card = el('div', {
    className: `party-card party-card-links${isCollapsed ? ' party-collapsed' : ''}`,
    dataset: { key },
    style: '--party-accent:#0ea5e9',
    draggable: 'true',
  });

  const header = buildCardHeader(ctx, { key, icon: '🔗' }, {
    title: 'External Tools & Links',
    icon: '🔗',
    pct: null,
    metaText: `${links.length} linked`,
    isCollapsed,
  });

  const chips = links.length
    ? links.map((link, i) =>
      el('div', { className: 'party-link' }, [
        el('a', {
          className: 'party-link-open',
          href: normalizeUrl(link.url),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [
          el('span', { className: 'party-link-icon' }, [linkIcon(link.type)]),
          el('span', { className: 'party-link-text' }, [
            el('span', { className: 'party-link-label' }, [link.label || link.url]),
            el('span', { className: 'party-link-type' }, [link.type || 'Other']),
          ]),
        ]),
        el('button', {
          className: 'party-link-edit',
          type: 'button',
          'aria-label': 'Edit link',
          on: { click: () => handlers.openLink(i) },
        }, ['✎']),
      ]),
    )
    : [el('div', { className: 'party-empty' }, ['No links yet — add a registry, Pinterest board, or playlist.'])];

  const addBtn = el('button', {
    className: 'party-add',
    type: 'button',
    on: { click: () => handlers.addLink() },
  }, ['+ Add link']);

  const body = el('div', { className: `party-card-body${isCollapsed ? ' hidden' : ''}` }, [
    el('div', { className: 'party-links' }, chips),
    addBtn,
  ]);

  card.append(header, body);
  wireDrag(ctx, card, key);
  return card;
}

/* ---------- Shared card header ---------- */

/**
 * Build the clickable card header with title, progress and reorder controls.
 */
function buildCardHeader(ctx, cat, opts) {
  const { handlers } = ctx;
  const { title, icon, pct: p, metaText, isCollapsed } = opts;

  const moveUp = el('button', {
    className: 'party-move', type: 'button', 'aria-label': 'Move section up',
    on: { click: (e) => { e.stopPropagation(); handlers.moveSection(cat.key, -1); } },
  }, ['▲']);
  const moveDown = el('button', {
    className: 'party-move', type: 'button', 'aria-label': 'Move section down',
    on: { click: (e) => { e.stopPropagation(); handlers.moveSection(cat.key, 1); } },
  }, ['▼']);

  const pctBadge = p == null
    ? null
    : el('span', { className: 'party-card-pct' }, [`${p}%`]);

  const left = el('div', { className: 'party-card-head-left' }, [
    el('span', { className: 'party-card-caret' }, [isCollapsed ? '▸' : '▾']),
    el('span', { className: 'party-card-icon' }, [icon]),
    el('div', { className: 'party-card-titles' }, [
      el('span', { className: 'party-card-title' }, [title]),
      el('span', { className: 'party-card-meta' }, [metaText]),
    ]),
  ]);

  const right = el('div', { className: 'party-card-head-right' }, [
    pctBadge,
    el('div', { className: 'party-move-group' }, [moveUp, moveDown]),
  ]);

  const header = el('div', {
    className: 'party-card-head',
    on: { click: () => handlers.toggleCollapse(cat.key) },
  }, [left, right]);

  const barRow = p == null ? null : progressBar(p);
  return el('div', { className: 'party-card-header' }, [header, barRow]);
}

/* ---------- Drag & drop reorder ---------- */

function wireDrag(ctx, card, key) {
  card.addEventListener('dragstart', (e) => {
    card.classList.add('party-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  });
  card.addEventListener('dragend', () => card.classList.remove('party-dragging'));
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('party-dragover'); });
  card.addEventListener('dragleave', () => card.classList.remove('party-dragover'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('party-dragover');
    const from = e.dataTransfer.getData('text/plain');
    if (from && from !== key) ctx.handlers.reorder(from, key);
  });
}

/* ---------- utils ---------- */

function slug(v) {
  return (v || 'none').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export { META_FIELDS };
