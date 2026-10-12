/* ============================================================
   floorplan/ai-render.js — AI visual concept renderer

   Generates a styled "space concept" from current floorplan geometry.
   ============================================================ */

import { el, generateText, showToast } from '../shared.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SYSTEM_PROMPT =
  'You are an interior visualization assistant. ' +
  'Given floor plan geometry, produce strict JSON only with this schema: ' +
  '{"spaceTitle":"string","overallMood":"string","palette":["#hex"],' +
  '"lighting":"string","rooms":[{"name":"string","styleNotes":"string","color":"#hex"}],' +
  '"renderPrompt":"string","designActions":["string"]}. ' +
  'Use 4-6 designActions max.';

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    node.setAttribute(key, String(val));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function parseJson(text) {
  if (!text) return null;
  let raw = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fallbackSpec() {
  return {
    spaceTitle: 'AI Space Concept',
    overallMood: 'Balanced, practical family living',
    palette: ['#dbeafe', '#c7d2fe', '#fde68a', '#bbf7d0'],
    lighting: 'Layered ambient and task lighting',
    rooms: [],
    renderPrompt: 'Warm family-oriented interior with practical storage and clear circulation.',
    designActions: ['Define main circulation route', 'Add layered lighting by zone', 'Anchor each room with one focal point'],
  };
}

function roomSummary(items) {
  return items
    .filter(item => item.kind === 'room')
    .map((room, idx) => ({
      name: room.label || `Room ${idx + 1}`,
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height,
    }));
}

async function generateRenderSpec(items) {
  const mock = typeof window !== 'undefined' ? window.__WAYMARK_FLOORPLAN_RENDER_MOCK : null;
  if (mock) return typeof mock === 'function' ? mock(items) : mock;

  const rooms = roomSummary(items);
  if (!rooms.length) throw new Error('Draw at least one room before generating an AI render.');

  const userMessage =
    'Create an interior concept render spec from this plan: ' +
    JSON.stringify({
      roomCount: rooms.length,
      rooms,
      walls: items.filter(item => item.kind === 'wall').length,
      electrical: items.filter(item => item.kind === 'electrical').length,
      plumbing: items.filter(item => item.kind === 'plumbing').length,
    });

  const text = await generateText(SYSTEM_PROMPT, userMessage, { temperature: 0.45, maxTokens: 1200 });
  return parseJson(text) || fallbackSpec();
}

function renderConceptSvg(container, items, spec) {
  container.innerHTML = '';
  const svg = svgEl('svg', {
    viewBox: '0 0 900 480',
    class: 'floorplan-ai-render-svg',
    role: 'img',
    'aria-label': 'AI interior concept render',
  });

  svg.append(
    svgEl('defs', {}, [
      svgEl('linearGradient', { id: 'wm-ai-bg', x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, [
        svgEl('stop', { offset: '0%', 'stop-color': '#f8fafc' }),
        svgEl('stop', { offset: '100%', 'stop-color': '#e2e8f0' }),
      ]),
      svgEl('filter', { id: 'wm-ai-shadow', x: '-20%', y: '-20%', width: '140%', height: '140%' }, [
        svgEl('feDropShadow', { dx: '0', dy: '3', stdDeviation: '4', 'flood-color': '#334155', 'flood-opacity': '0.25' }),
      ]),
    ]),
  );

  svg.append(svgEl('rect', { x: 0, y: 0, width: 900, height: 480, fill: 'url(#wm-ai-bg)' }));

  const rooms = items.filter(item => item.kind === 'room');
  const palette = Array.isArray(spec?.palette) && spec.palette.length ? spec.palette : fallbackSpec().palette;
  const styleRooms = Array.isArray(spec?.rooms) ? spec.rooms : [];

  rooms.forEach((room, idx) => {
    const color = styleRooms[idx]?.color || palette[idx % palette.length];
    const x = 60 + (((room.x || 20) - 20) / 920) * 760;
    const y = 40 + (((room.y || 20) - 20) / 560) * 320;
    const width = Math.max(42, ((room.width || 100) / 920) * 760);
    const height = Math.max(34, ((room.height || 80) / 560) * 320);

    const skewTop = 14;
    const skewRight = 10;
    svg.append(
      svgEl('polygon', {
        points: `${x},${y} ${x + width},${y} ${x + width + skewRight},${y + skewTop} ${x + skewRight},${y + skewTop}`,
        fill: '#cbd5e1',
        opacity: '0.75',
      }),
      svgEl('polygon', {
        points: `${x + width},${y} ${x + width + skewRight},${y + skewTop} ${x + width + skewRight},${y + height + skewTop} ${x + width},${y + height}`,
        fill: '#94a3b8',
        opacity: '0.45',
      }),
      svgEl('rect', {
        x,
        y,
        width,
        height,
        rx: 6,
        fill: color,
        stroke: '#334155',
        'stroke-width': 2,
        filter: 'url(#wm-ai-shadow)',
      }),
      svgEl('text', {
        x: x + (width / 2),
        y: y + (height / 2) + 4,
        'text-anchor': 'middle',
        'font-size': 12,
        'font-weight': 700,
        fill: '#0f172a',
      }, [room.label || styleRooms[idx]?.name || `Room ${idx + 1}`]),
    );
  });

  container.appendChild(svg);
}

export function openFloorplanAiRenderModal({ items }) {
  const overlay = el('div', { className: 'floorplan-ai-overlay' });
  const modal = el('div', { className: 'floorplan-ai-modal floorplan-ai-render-modal' });
  const close = () => overlay.remove();

  const header = el('div', { className: 'floorplan-ai-header' }, [
    el('div', { className: 'floorplan-ai-title' }, ['AI Space Render']),
    el('button', { className: 'floorplan-ai-close', type: 'button', 'aria-label': 'Close' }, ['x']),
  ]);
  header.querySelector('.floorplan-ai-close').addEventListener('click', close);

  const status = el('div', { className: 'floorplan-ai-status' }, ['Generate a visual concept from your current floor plan geometry.']);
  const renderHost = el('div', { className: 'floorplan-ai-render-host' });
  const details = el('div', { className: 'floorplan-ai-render-details' });

  const generateBtn = el('button', { className: 'floorplan-ai-btn floorplan-ai-btn-primary', type: 'button' }, ['Generate Visual']);
  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    status.textContent = 'Generating AI concept render...';
    try {
      const spec = await generateRenderSpec(items || []);
      renderConceptSvg(renderHost, items || [], spec);
      details.innerHTML = '';
      details.append(
        el('h4', {}, [spec.spaceTitle || 'AI Space Concept']),
        el('p', {}, [spec.overallMood || '']),
        el('p', {}, [`Lighting: ${spec.lighting || 'Not specified'}`]),
        el('p', { className: 'floorplan-ai-render-prompt' }, [spec.renderPrompt || '']),
        el('ul', {}, (spec.designActions || []).map(action => el('li', {}, [String(action)]))),
      );
      status.textContent = 'AI visual concept ready.';
      showToast('AI visual generated', 'success');
    } catch (err) {
      status.textContent = err.message || 'Could not generate render.';
      showToast(err.message || 'Could not generate render', 'error');
    } finally {
      generateBtn.disabled = false;
    }
  });

  const copyPromptBtn = el('button', { className: 'floorplan-ai-btn', type: 'button' }, ['Copy Render Prompt']);
  copyPromptBtn.addEventListener('click', async () => {
    const prompt = details.querySelector('.floorplan-ai-render-prompt')?.textContent?.trim();
    if (!prompt) {
      showToast('Generate a render first', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      showToast('Render prompt copied', 'success');
    } catch {
      showToast('Could not copy prompt', 'error');
    }
  });

  const actions = el('div', { className: 'floorplan-ai-actions' }, [generateBtn, copyPromptBtn]);
  modal.append(header, status, renderHost, details, actions);
  overlay.append(modal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.appendChild(overlay);
}
