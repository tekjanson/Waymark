/* ============================================================
   flow/index.js — Interactive Flow Diagram Template (barrel)

   Features: draggable SVG nodes, click-to-edit inspector,
   edge reconnection via port dragging, type badges,
   conditional branches, collapsible step table.
   Each row represents a step; the Flow column groups steps
   into separate diagrams (§4.7 row-per-item grouping).

   Performance: delegated events on SVG and step-table
   containers replace per-element listeners; position cache
   avoids relayout on re-render.
   ============================================================ */

import {
  el, cell, editableCell, emitEdit,
  registerTemplate, buildAddRowForm, delegateEvent,
  buildDirSyncBtn,
} from '../shared.js';
import {
  NODE_SHAPES, DEFAULT_TYPE, DRAG_THRESHOLD, NODE_W, NODE_H,
  parseFlowGroups, svg, clientToSVG, isPointInNode,
  setNodePos, getNodePos, clearGroupPositions,
} from './helpers.js';
import { computeLayout, renderNodeGroup, renderEdge } from './nodes.js';
import { initInspector } from './inspector.js';

/* ---------- Constants ---------- */

const GRID_SIZE = 20;
const MINIMAP_THRESHOLD = 15;

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Flow Diagram',
  icon: '🔀',
  color: '#6366f1',
  priority: 20,
  itemNoun: 'Step',
  defaultHeaders: ['Flow', 'Step', 'Type', 'Next', 'Condition', 'Notes'],

  detect(lower) {
    const hasFlow = lower.some(h => /^(flow|diagram|process|workflow|pipeline|flowchart)/.test(h));
    const hasStep = lower.some(h => /^(step|node|block|stage|action|task|activity)/.test(h));
    const hasType = lower.some(h => /^(type|shape|kind|node.?type)/.test(h));
    const hasNext = lower.some(h => /^(next|to|target|connects?.?to|goto|arrow|transition|leads?.?to)/.test(h));
    return hasFlow && hasStep && (hasType || hasNext);
  },

  columns(lower) {
    const cols = { flow: -1, step: -1, type: -1, next: -1, condition: -1, notes: -1 };
    const used = () => Object.values(cols).filter(v => v >= 0);
    cols.flow = lower.findIndex(h => /^(flow|diagram|process|workflow|pipeline|flowchart)/.test(h));
    cols.step = lower.findIndex((h, i) => i !== cols.flow && /^(step|node|block|stage|action|task|activity)/.test(h));
    cols.type = lower.findIndex((h, i) => !used().includes(i) && /^(type|shape|kind|node.?type)/.test(h));
    cols.next = lower.findIndex((h, i) => !used().includes(i) && /^(next|to|target|connects?.?to|goto|arrow|transition|leads?.?to)/.test(h));
    cols.condition = lower.findIndex((h, i) => !used().includes(i) && /^(condition|label|branch|when|if|edge.?label)/.test(h));
    cols.notes = lower.findIndex((h, i) => !used().includes(i) && /^(notes?|comment|detail|description|info)/.test(h));
    if (cols.step === -1 && cols.flow >= 0) cols.step = cols.flow;
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'step',      label: 'Step',      colIndex: cols.step,      type: 'text',   placeholder: 'Step label',  required: true },
      { role: 'type',      label: 'Type',      colIndex: cols.type,      type: 'select', options: Object.keys(NODE_SHAPES) },
      { role: 'next',      label: 'Next',      colIndex: cols.next,      type: 'text',   placeholder: 'Next step(s), comma-separated' },
      { role: 'condition', label: 'Condition',  colIndex: cols.condition, type: 'text',   placeholder: 'Edge label (e.g. Yes, No)' },
      { role: 'notes',     label: 'Notes',      colIndex: cols.notes,     type: 'text',   placeholder: 'Additional notes' },
    ];
  },

  /* --------------------------------------------------------
     render() — Interactive flow diagram canvas
     -------------------------------------------------------- */
  render(container, rows, cols) {
    while (container.firstChild) container.removeChild(container.firstChild);
    const groups = parseFlowGroups(rows, cols);

    if (groups.length === 0) {
      container.append(el('div', { className: 'flow-empty' }, [
        'No flow steps found. Add steps with Step, Type, and Next columns.',
      ]));
      return;
    }

    const tabs = el('div', { className: 'flow-tabs' });
    const groupSections = [];
    const tabButtons = [];
    container.append(tabs);

    function activateGroup(index) {
      groupSections.forEach((section, i) => section.classList.toggle('hidden', i !== index));
      tabButtons.forEach((button, i) => button.classList.toggle('flow-tab-active', i === index));
    }

    groups.forEach((group, index) => {
      const tab = el('button', {
        className: `flow-tab${index === 0 ? ' flow-tab-active' : ''}`,
        on: { click: () => activateGroup(index) },
      }, [`${group.name} (${group.steps.length})`]);
      tabButtons.push(tab);
      tabs.append(tab);
    });
    tabs.append(el('button', { className: 'flow-tab flow-tab-new', title: 'New flow' }, ['+ New Flow']));

    for (const [groupIndex, group] of groups.entries()) {
      const groupKey = group.name;
      const section = el('div', { className: `flow-group${groupIndex === 0 ? '' : ' hidden'}` });
      groupSections.push(section);

      /* ---------- Group header ---------- */
      const realignBtn = el('button', { className: 'flow-realign-btn', title: 'Auto-align nodes' }, ['\u2B50 Auto-Align']);
      const viewToggle = el('div', { className: 'flow-view-toggle' }, [
        el('button', { className: 'flow-view-btn flow-view-active', dataset: { view: 'canvas' } }, ['Canvas']),
        el('button', { className: 'flow-view-btn', dataset: { view: 'split' } }, ['Split View']),
        el('button', { className: 'flow-view-btn', dataset: { view: 'table' } }, ['Table']),
      ]);
      section.append(el('div', { className: 'flow-group-header' }, [
        el('span', { className: 'flow-group-icon' }, ['\uD83D\uDD00']),
        el('h3', { className: 'flow-group-title' }, [group.name]),
        el('span', { className: 'flow-group-count' }, [`${group.steps.length} steps`]),
        viewToggle,
        realignBtn,
      ]));

      /* ---------- Tooltip container ---------- */
      const tooltip = el('div', { className: 'flow-tooltip hidden' });

      /* ---------- Detail modal ---------- */
      const detailModal = el('div', { className: 'flow-detail-modal hidden' });

      function showTooltip(node, clientX, clientY, wrap) {
        const shape = NODE_SHAPES[node.type] || NODE_SHAPES.process;
        const conns = node.next ? node.next.split(',').length : 0;
        tooltip.innerHTML = '';
        tooltip.append(
          el('div', { className: 'flow-tooltip-type', style: `color:${shape.color}` }, [`${shape.icon} ${shape.label}`]),
          el('div', { className: 'flow-tooltip-name' }, [node.step]),
        );
        if (node.notes) tooltip.append(el('div', { className: 'flow-tooltip-notes' }, [node.notes]));
        if (conns) tooltip.append(el('div', { className: 'flow-tooltip-conns' }, [`\u2192 ${conns} connection${conns > 1 ? 's' : ''}`]));
        tooltip.classList.remove('hidden');
        const wrapRect = wrap.getBoundingClientRect();
        tooltip.style.left = (clientX - wrapRect.left + 12) + 'px';
        tooltip.style.top = (clientY - wrapRect.top - 8) + 'px';
      }

      function hideTooltip() { tooltip.classList.add('hidden'); }

      function openDetailModal(node) {
        const shape = NODE_SHAPES[node.type] || NODE_SHAPES.process;
        detailModal.innerHTML = '';

        const inbound = layout.edges.filter(e => e.to === node).map(e => e.from.step);
        const outbound = layout.edges.filter(e => e.from === node);

        detailModal.append(
          el('div', { className: 'flow-detail-header' }, [
            el('span', { className: `flow-type-badge flow-type-${node.type}`, style: `--flow-type-color:${shape.color}` }, [`${shape.icon} ${shape.label}`]),
            el('h3', { className: 'flow-detail-title' }, [node.step]),
            el('button', { className: 'flow-detail-close', on: { click: () => detailModal.classList.add('hidden') } }, ['\u2715']),
          ]),
          el('div', { className: 'flow-detail-body' }, [
            ...(node.notes ? [el('div', { className: 'flow-detail-section' }, [
              el('h4', {}, ['Notes']),
              el('p', {}, [node.notes]),
            ])] : []),
            el('div', { className: 'flow-detail-section' }, [
              el('h4', {}, ['Connections']),
              el('div', { className: 'flow-detail-conns' }, [
                ...(inbound.length ? [el('div', { className: 'flow-detail-conn-group' }, [
                  el('span', { className: 'flow-detail-conn-label' }, ['\u2190 From:']),
                  ...inbound.map(s => el('span', { className: 'flow-detail-conn-item' }, [s])),
                ])] : []),
                ...(outbound.length ? [el('div', { className: 'flow-detail-conn-group' }, [
                  el('span', { className: 'flow-detail-conn-label' }, ['\u2192 To:']),
                  ...outbound.map(e => el('span', { className: 'flow-detail-conn-item' }, [
                    e.to.step + (e.label ? ` (${e.label})` : ''),
                  ])),
                ])] : []),
                ...(!inbound.length && !outbound.length ? [el('p', { className: 'flow-detail-empty' }, ['No connections'])] : []),
              ]),
            ]),
            el('div', { className: 'flow-detail-section' }, [
              el('h4', {}, ['Properties']),
              el('table', { className: 'flow-detail-props' }, [
                el('tr', {}, [el('td', {}, ['Type']), el('td', {}, [shape.label])]),
                el('tr', {}, [el('td', {}, ['Condition']), el('td', {}, [node.condition || '\u2014'])]),
              ]),
            ]),
          ]),
        );
        detailModal.classList.remove('hidden');
      }

      /* ---------- Layout ---------- */
      const layout = computeLayout(group.steps, groupKey);

      /* ---------- Build interactive SVG ---------- */
      const markerId = `flow-arrow-${Math.random().toString(36).slice(2, 8)}`;
      const diagramWrap = el('div', { className: 'flow-diagram-wrap flow-canvas' });
      let selectedNode = null;
      let dragState = null;
      let connectState = null;
      let _quickAddCount = 0;

      const svgEl = svg('svg', {
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        class: 'flow-svg',
        width: '100%',
        height: layout.height,
      });

      /* Defs — arrowhead markers */
      const defs = svg('defs');
      const marker = svg('marker', {
        id: markerId, viewBox: '0 0 10 10',
        refX: 9, refY: 5, markerWidth: 6, markerHeight: 6,
        orient: 'auto-start-reverse',
      });
      marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'flow-arrow-fill' }));
      defs.append(marker);

      const markerDash = svg('marker', {
        id: markerId + '-dash', viewBox: '0 0 10 10',
        refX: 9, refY: 5, markerWidth: 6, markerHeight: 6,
        orient: 'auto-start-reverse',
      });
      markerDash.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#6366f1' }));
      defs.append(markerDash);

      /* Grid background */
      const gridId = markerId + '-grid';
      const gridPat = svg('pattern', { id: gridId, width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
      gridPat.append(svg('path', { d: 'M 20 0 L 0 0 0 20', fill: 'none', class: 'flow-grid-line', 'stroke-width': 0.5 }));
      defs.append(gridPat);

      svgEl.append(defs);
      svgEl.append(svg('rect', { width: '100%', height: '100%', fill: `url(#${gridId})`, class: 'flow-grid-bg' }));

      /* Edges container */
      const edgesGroup = svg('g', { class: 'flow-edges-group' });
      svgEl.append(edgesGroup);

      /* RAF-batched edge re-rendering — coalesces rapid calls (e.g. during drag) */
      let _rafEdgeId = null;
      function rerenderEdgesNow() {
        _rafEdgeId = null;
        while (edgesGroup.firstChild) edgesGroup.removeChild(edgesGroup.firstChild);
        for (const edge of layout.edges) {
          edgesGroup.append(renderEdge(edge, markerId));
        }
        updateEdgeHighlights();
      }
      function rerenderEdges() {
        if (_rafEdgeId) return;
        _rafEdgeId = requestAnimationFrame(rerenderEdgesNow);
      }
      /* Synchronous initial render (before first paint) */
      rerenderEdgesNow();

      /* Nodes container */
      const nodesGroup = svg('g', { class: 'flow-nodes-group' });
      const nodeElMap = new Map();

      for (const node of layout.nodes) {
        const nodeG = renderNodeGroup(node);
        nodeElMap.set(node.key, nodeG);
        nodesGroup.append(nodeG);
      }
      svgEl.append(nodesGroup);

      /* Temporary edge (shown during port drag) */
      const tempEdge = svg('line', {
        class: 'flow-temp-edge',
        visibility: 'hidden',
        stroke: '#6366f1', 'stroke-width': 2,
        'stroke-dasharray': '6,4',
        'marker-end': `url(#${markerId}-dash)`,
      });
      svgEl.append(tempEdge);

      /* Ghost edge label — visible hint during connect drag */
      const ghostLabel = svg('text', {
        class: 'flow-ghost-label',
        visibility: 'hidden',
        'text-anchor': 'middle',
        fill: '#6366f1',
      });
      ghostLabel.textContent = 'Release on target';
      svgEl.append(ghostLabel);

      diagramWrap.append(svgEl);

      /* ---------- Floating HUD ---------- */
      let zoomLevel = 1;
      function setZoom(nextZoom) {
        zoomLevel = Math.max(0.5, Math.min(1.75, nextZoom));
        svgEl.style.width = `${zoomLevel * 100}%`;
        diagramWrap.dataset.zoom = String(zoomLevel.toFixed(2));
      }
      const hud = el('div', { className: 'flow-hud' }, [
        el('button', { className: 'flow-hud-btn flow-zoom-out', title: 'Zoom out', on: { click: () => setZoom(zoomLevel - 0.1) } }, ['−']),
        el('button', { className: 'flow-hud-btn flow-zoom-in', title: 'Zoom in', on: { click: () => setZoom(zoomLevel + 0.1) } }, ['+']),
        el('button', { className: 'flow-hud-btn flow-fit-btn', title: 'Fit to screen', on: { click: () => setZoom(1) } }, ['Fit']),
        el('button', { className: 'flow-hud-btn flow-lock-btn', title: 'Lock canvas', on: { click: (e) => {
          diagramWrap.classList.toggle('flow-canvas-locked');
          e.currentTarget.classList.toggle('flow-hud-active');
        } } }, ['Lock']),
        el('button', { className: 'flow-hud-btn flow-minimap-btn', title: 'Minimap' }, ['Map']),
      ]);
      diagramWrap.append(hud);

      const traceToggle = el('button', {
        className: 'flow-trace-toggle',
        on: { click: () => {
          diagramWrap.classList.toggle('flow-trace-active');
          traceToggle.classList.toggle('flow-trace-on');
          traceToggle.textContent = diagramWrap.classList.contains('flow-trace-active') ? 'Trace On' : 'Trace Flow';
        } },
      }, ['Trace Flow']);
      diagramWrap.append(traceToggle);

      const contextToolbar = el('div', { className: 'flow-context-toolbar hidden' }, [
        el('button', { className: 'flow-context-type', dataset: { type: 'process' } }, ['Process']),
        el('button', { className: 'flow-context-type', dataset: { type: 'decision' } }, ['Decision']),
        el('button', { className: 'flow-context-type', dataset: { type: 'input' } }, ['Input']),
        el('button', { className: 'flow-context-type', dataset: { type: 'end' } }, ['End']),
        el('input', { className: 'flow-context-label', type: 'text', ariaLabel: 'Edit node label' }),
        el('button', { className: 'flow-context-delete' }, ['Delete']),
      ]);
      diagramWrap.append(contextToolbar);

      /* Canvas hint */
      diagramWrap.append(el('div', { className: 'flow-canvas-hint' }, [
        'Drag nodes to reposition \u2022 Click to inspect \u2022 Drag from \u25CF port to connect \u2022 Double-click for details',
      ]));

      /* Tooltip + detail modal live inside diagramWrap for positioning */
      diagramWrap.append(tooltip);
      diagramWrap.append(detailModal);

      section.append(diagramWrap);

      /* Re-align button — clears cached positions and re-renders */
      realignBtn.addEventListener('click', () => {
        clearGroupPositions(groupKey);
        /* Re-run full render for this group */
        definition.render(container, rows, cols);
      });

      /* ---------- Inspector panel ---------- */
      const inspector = el('div', { className: 'flow-inspector hidden' });
      section.append(inspector);

      /* ---------- Interaction state ---------- */

      /* ---------- Inspector (update-in-place) ---------- */
      function deselectNode() {
        if (selectedNode) {
          nodeElMap.get(selectedNode.key)?.classList.remove('flow-node-selected');
          selectedNode = null;
        }
        updateEdgeHighlights();
        contextToolbar.classList.add('hidden');
        inspectorAPI.hide();
      }

      const inspectorAPI = initInspector(inspector, {
        cols,
        group,
        layout,
        rerenderEdges,
        deselectNode,
      });

      /* ---------- Node selection ---------- */

      function selectNode(node) {
        if (selectedNode) {
          nodeElMap.get(selectedNode.key)?.classList.remove('flow-node-selected');
        }
        selectedNode = node;
        nodeElMap.get(node.key)?.classList.add('flow-node-selected');
        updateEdgeHighlights();
        showContextToolbar(node);
        inspectorAPI.show(node);
      }

      function updateEdgeHighlights() {
        if (!edgesGroup) return;
        edgesGroup.querySelectorAll('.flow-edge').forEach(edgeEl => {
          const active = selectedNode &&
            (edgeEl.getAttribute('data-from') === selectedNode.key || edgeEl.getAttribute('data-to') === selectedNode.key);
          edgeEl.classList.toggle('flow-edge-highlight', Boolean(active));
        });
      }

      function showContextToolbar(node) {
        const left = Math.max(8, node.x + node.w + 18);
        const top = Math.max(8, node.y - 8);
        contextToolbar.style.left = `${left}px`;
        contextToolbar.style.top = `${top}px`;
        const input = contextToolbar.querySelector('.flow-context-label');
        input.value = node.step;
        contextToolbar.classList.remove('hidden');
      }

      function addConnectedChild(node, type = 'process') {
        _quickAddCount++;
        const childStep = `${node.step} Child ${_quickAddCount}`;
        const childKey = childStep.toLowerCase();
        const nextValue = node.next ? `${node.next},${childStep}` : childStep;
        emitEdit(node.idx + 1, cols.next, nextValue);
        node.next = nextValue;
        const child = {
          ...node,
          step: childStep,
          key: childKey,
          type,
          next: '',
          condition: '',
          notes: '',
          x: Math.round((node.x + node.w + 120) / GRID_SIZE) * GRID_SIZE,
          y: Math.round(node.y / GRID_SIZE) * GRID_SIZE,
          idx: node.idx,
          index: layout.nodes.length,
        };
        layout.nodes.push(child);
        layout.edges.push({ from: node, to: child, label: 'new' });
        const childEl = renderNodeGroup(child);
        nodeElMap.set(child.key, childEl);
        nodesGroup.append(childEl);
        rerenderEdges();
        selectNode(child);
      }

      delegateEvent(contextToolbar, 'click', '.flow-context-type', (_e, button) => {
        if (!selectedNode || cols.type < 0) return;
        selectedNode.type = button.dataset.type;
        emitEdit(selectedNode.idx + 1, cols.type, selectedNode.type);
        const old = nodeElMap.get(selectedNode.key);
        const fresh = renderNodeGroup(selectedNode);
        old?.replaceWith(fresh);
        nodeElMap.set(selectedNode.key, fresh);
        fresh.classList.add('flow-node-selected');
        inspectorAPI.show(selectedNode);
      });

      delegateEvent(contextToolbar, 'click', '.flow-context-delete', () => {
        if (!selectedNode) return;
        emitEdit(selectedNode.idx + 1, cols.next, '');
        selectedNode.next = '';
        layout.edges = layout.edges.filter(edge => edge.from !== selectedNode && edge.to !== selectedNode);
        nodeElMap.get(selectedNode.key)?.classList.add('flow-node-muted');
        rerenderEdges();
        inspectorAPI.show(selectedNode);
      });

      const toolbarInput = contextToolbar.querySelector('.flow-context-label');
      toolbarInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !selectedNode) return;
        e.preventDefault();
        const value = toolbarInput.value.trim();
        if (!value) return;
        emitEdit(selectedNode.idx + 1, cols.step, value);
        selectedNode.step = value;
        inspectorAPI.show(selectedNode);
      });

      /* ---------- Resolve node from DOM element ---------- */

      function nodeFromKey(key) {
        return layout.nodes.find(n => n.key === key);
      }

      /* ---------- Node drag ---------- */

      function onNodeMouseDown(e, node) {
        if (e.button !== 0) return;
        if (e.target.closest('.flow-port') || e.target.closest('.flow-quick-add') || diagramWrap.classList.contains('flow-canvas-locked')) return;
        const pt = clientToSVG(svgEl, e.clientX, e.clientY);
        dragState = { node, startX: pt.x, startY: pt.y, origX: node.x, origY: node.y, moved: false };
        e.preventDefault();
      }

      /* ---------- Port drag (edge reconnection) ---------- */

      function onPortMouseDown(e, node) {
        e.stopPropagation();
        e.preventDefault();
        connectState = { sourceNode: node };
        const portX = node.x + node.w / 2;
        const portY = node.y + node.h + 8;
        tempEdge.setAttribute('x1', portX);
        tempEdge.setAttribute('y1', portY);
        tempEdge.setAttribute('x2', portX);
        tempEdge.setAttribute('y2', portY);
        tempEdge.setAttribute('visibility', 'visible');
        ghostLabel.setAttribute('x', portX);
        ghostLabel.setAttribute('y', portY + 24);
        ghostLabel.setAttribute('visibility', 'visible');
        svgEl.classList.add('flow-svg-connecting');
      }

      /* ---------- Delegated node & port mousedown ---------- */

      delegateEvent(nodesGroup, 'mousedown', '.flow-port-out', (e, match) => {
        const nodeEl = match.closest('.flow-node');
        const key = nodeEl?.getAttribute('data-key');
        const node = key && nodeFromKey(key);
        if (node) onPortMouseDown(e, node);
      });

      delegateEvent(nodesGroup, 'mousedown', '.flow-node', (e, match) => {
        if (e.target.closest('.flow-port') || e.target.closest('.flow-quick-add')) return;
        const key = match.getAttribute('data-key');
        const node = key && nodeFromKey(key);
        if (node) onNodeMouseDown(e, node);
      });

      delegateEvent(nodesGroup, 'click', '.flow-quick-add', (e, match) => {
        e.stopPropagation();
        const nodeEl = match.closest('.flow-node');
        const key = nodeEl?.getAttribute('data-key');
        const node = key && nodeFromKey(key);
        if (node) addConnectedChild(node, 'process');
      });

      /* ---------- SVG-level mouse handling ---------- */

      function onSVGMouseMove(e) {
        const pt = clientToSVG(svgEl, e.clientX, e.clientY);

        if (dragState) {
          hideTooltip();
          const ddx = pt.x - dragState.startX;
          const ddy = pt.y - dragState.startY;
          if (!dragState.moved && Math.hypot(ddx, ddy) > DRAG_THRESHOLD) {
            dragState.moved = true;
            nodeElMap.get(dragState.node.key)?.classList.add('flow-node-dragging');
            svgEl.classList.add('flow-svg-dragging');
          }
          if (dragState.moved) {
            const n = dragState.node;
            n.x = dragState.origX + ddx;
            n.y = dragState.origY + ddy;
            nodeElMap.get(n.key)?.setAttribute('transform', `translate(${n.x}, ${n.y})`);
            rerenderEdges();
          }
        }

        if (connectState) {
          tempEdge.setAttribute('x2', pt.x);
          tempEdge.setAttribute('y2', pt.y);
          ghostLabel.setAttribute('x', pt.x);
          ghostLabel.setAttribute('y', pt.y + 18);
          let overTarget = false;
          for (const n of layout.nodes) {
            const nEl = nodeElMap.get(n.key);
            if (n !== connectState.sourceNode && isPointInNode(pt, n)) {
              nEl?.classList.add('flow-node-drop-target');
              overTarget = true;
            } else {
              nEl?.classList.remove('flow-node-drop-target');
            }
          }
          ghostLabel.textContent = overTarget ? 'Release to connect' : 'Release on target';
        }
      }

      function onSVGMouseUp(e) {
        if (dragState) {
          const n = dragState.node;
          nodeElMap.get(n.key)?.classList.remove('flow-node-dragging');
          svgEl.classList.remove('flow-svg-dragging');
          if (!dragState.moved) {
            selectNode(n);
          } else {
            /* Snap to grid */
            n.x = Math.round(n.x / GRID_SIZE) * GRID_SIZE;
            n.y = Math.round(n.y / GRID_SIZE) * GRID_SIZE;
            nodeElMap.get(n.key)?.setAttribute('transform', `translate(${n.x}, ${n.y})`);
            rerenderEdges();
            setNodePos(`${groupKey}:${n.key}`, { x: n.x, y: n.y });
          }
          dragState = null;
        }

        if (connectState) {
          tempEdge.setAttribute('visibility', 'hidden');
          ghostLabel.setAttribute('visibility', 'hidden');
          svgEl.classList.remove('flow-svg-connecting');
          const pt = clientToSVG(svgEl, e.clientX, e.clientY);
          let target = null;
          for (const n of layout.nodes) {
            nodeElMap.get(n.key)?.classList.remove('flow-node-drop-target');
            if (n !== connectState.sourceNode && isPointInNode(pt, n)) target = n;
          }
          if (target) {
            const src = connectState.sourceNode;
            const rowIdx = src.idx + 1;
            const existing = src.next;
            const newNext = (src.type === 'decision' && existing)
              ? existing + ',' + target.step
              : target.step;
            emitEdit(rowIdx, cols.next, newNext);
            src.next = newNext;
            layout.edges.push({ from: src, to: target, label: '' });
            rerenderEdges();
            if (selectedNode === src) inspectorAPI.show(src);
          }
          connectState = null;
        }
      }

      /* Touch support */
      function onTouchStart(e) {
        const touch = e.touches[0];
        const pt = clientToSVG(svgEl, touch.clientX, touch.clientY);
        for (const node of layout.nodes) {
          if (isPointInNode(pt, node)) {
            dragState = { node, startX: pt.x, startY: pt.y, origX: node.x, origY: node.y, moved: false };
            e.preventDefault();
            return;
          }
        }
      }

      function onTouchMove(e) {
        if (!dragState) return;
        e.preventDefault();
        const touch = e.touches[0];
        const pt = clientToSVG(svgEl, touch.clientX, touch.clientY);
        const ddx = pt.x - dragState.startX;
        const ddy = pt.y - dragState.startY;
        if (!dragState.moved && Math.hypot(ddx, ddy) > DRAG_THRESHOLD) {
          dragState.moved = true;
          nodeElMap.get(dragState.node.key)?.classList.add('flow-node-dragging');
        }
        if (dragState.moved) {
          const n = dragState.node;
          n.x = dragState.origX + ddx;
          n.y = dragState.origY + ddy;
          nodeElMap.get(n.key)?.setAttribute('transform', `translate(${n.x}, ${n.y})`);
          rerenderEdges();
        }
      }

      function onTouchEnd() {
        if (!dragState) return;
        const n = dragState.node;
        nodeElMap.get(n.key)?.classList.remove('flow-node-dragging');
        if (!dragState.moved) {
          selectNode(n);
        } else {
          /* Snap to grid */
          n.x = Math.round(n.x / GRID_SIZE) * GRID_SIZE;
          n.y = Math.round(n.y / GRID_SIZE) * GRID_SIZE;
          nodeElMap.get(n.key)?.setAttribute('transform', `translate(${n.x}, ${n.y})`);
          rerenderEdges();
          setNodePos(`${groupKey}:${n.key}`, { x: n.x, y: n.y });
        }
        dragState = null;
      }

      /* Wire SVG-level events (container-level — not per-element) */
      svgEl.addEventListener('mousemove', onSVGMouseMove);
      svgEl.addEventListener('mouseup', onSVGMouseUp);
      svgEl.addEventListener('mouseleave', onSVGMouseUp);
      svgEl.addEventListener('touchstart', onTouchStart, { passive: false });
      svgEl.addEventListener('touchmove', onTouchMove, { passive: false });
      svgEl.addEventListener('touchend', onTouchEnd);

      /* Click canvas background to deselect */
      svgEl.addEventListener('mousedown', (e) => {
        if (e.target === svgEl || (e.target.tagName === 'rect' && !e.target.closest('.flow-node'))) {
          deselectNode();
          hideTooltip();
        }
      });

      /* Hover tooltip — show on mouseover nodes */
      let _hoverNode = null;
      svgEl.addEventListener('mouseover', (e) => {
        if (dragState || connectState) return;
        const nodeEl = e.target.closest('.flow-node');
        if (nodeEl) {
          const key = nodeEl.getAttribute('data-key');
          const node = key && nodeFromKey(key);
          if (node && node !== _hoverNode) {
            _hoverNode = node;
            showTooltip(node, e.clientX, e.clientY, diagramWrap);
          }
        } else {
          _hoverNode = null;
          hideTooltip();
        }
      });

      svgEl.addEventListener('mouseout', (e) => {
        const related = e.relatedTarget;
        if (!related || !related.closest?.('.flow-node')) {
          _hoverNode = null;
          hideTooltip();
        }
      });

      /* Double-click — open detail modal */
      svgEl.addEventListener('dblclick', (e) => {
        const nodeEl = e.target.closest('.flow-node');
        if (nodeEl) {
          const key = nodeEl.getAttribute('data-key');
          const node = key && nodeFromKey(key);
          if (node) {
            hideTooltip();
            openDetailModal(node);
          }
        }
      });

      /* ---------- Keyboard shortcuts ---------- */
      const undoStack = [];

      function onKeyDown(e) {
        /* Ignore if focus is in an input/select/textarea */
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        /* Escape — close detail modal / deselect node */
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!detailModal.classList.contains('hidden')) {
            detailModal.classList.add('hidden');
          } else {
            deselectNode();
          }
          return;
        }

        /* Delete — remove selected node's connections */
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode) {
          e.preventDefault();
          const node = selectedNode;
          const prevNext = node.next;
          undoStack.push({ type: 'disconnect', node, prevNext });
          emitEdit(node.idx + 1, cols.next, '');
          node.next = '';
          layout.edges = layout.edges.filter(edge => edge.from !== node);
          rerenderEdges();
          inspectorAPI.show(node);
        }

        if (selectedNode && e.key === 'Tab') {
          e.preventDefault();
          addConnectedChild(selectedNode, e.shiftKey ? 'decision' : 'process');
          return;
        }

        if (selectedNode && ['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          const types = ['start', 'process', 'decision', 'end'];
          const type = types[Number(e.key) - 1];
          selectedNode.type = type;
          emitEdit(selectedNode.idx + 1, cols.type, type);
          const old = nodeElMap.get(selectedNode.key);
          const fresh = renderNodeGroup(selectedNode);
          old?.replaceWith(fresh);
          nodeElMap.set(selectedNode.key, fresh);
          fresh.classList.add('flow-node-selected');
          inspectorAPI.show(selectedNode);
        }

        /* Ctrl+Z — undo last action */
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && undoStack.length) {
          e.preventDefault();
          const action = undoStack.pop();
          if (action.type === 'disconnect') {
            const node = action.node;
            emitEdit(node.idx + 1, cols.next, action.prevNext);
            node.next = action.prevNext;
            /* Rebuild edges for this node */
            const targets = action.prevNext.split(',').map(t => t.trim().toLowerCase());
            for (const t of targets) {
              const targetNode = layout.nodes.find(n => n.key === t);
              if (targetNode) layout.edges.push({ from: node, to: targetNode, label: '' });
            }
            rerenderEdges();
            if (selectedNode === node) inspectorAPI.show(node);
          }
        }
      }

      diagramWrap.setAttribute('tabindex', '0');
      diagramWrap.addEventListener('keydown', onKeyDown);

      /* ---------- Minimap (for large diagrams) ---------- */
      if (layout.nodes.length >= MINIMAP_THRESHOLD) {
        const minimap = el('div', { className: 'flow-minimap' });
        const mmScale = 0.12;
        const mmW = layout.width * mmScale;
        const mmH = layout.height * mmScale;
        const mmSvg = svg('svg', {
          class: 'flow-minimap-svg',
          viewBox: `0 0 ${layout.width} ${layout.height}`,
          width: mmW,
          height: mmH,
        });

        /* Render minimap nodes as small rectangles */
        for (const node of layout.nodes) {
          const shape = NODE_SHAPES[node.type] || NODE_SHAPES.process;
          mmSvg.append(svg('rect', {
            x: node.x, y: node.y,
            width: node.w, height: node.h,
            rx: 3, ry: 3,
            fill: shape.color + '40',
            stroke: shape.color,
            'stroke-width': 3,
          }));
        }

        /* Render minimap edges as simple lines */
        for (const edge of layout.edges) {
          const fx = edge.from.x + edge.from.w / 2;
          const fy = edge.from.y + edge.from.h;
          const tx = edge.to.x + edge.to.w / 2;
          const ty = edge.to.y;
          mmSvg.append(svg('line', {
            x1: fx, y1: fy, x2: tx, y2: ty,
            class: 'flow-minimap-edge', 'stroke-width': 3,
          }));
        }

        /* Viewport indicator */
        const viewport = svg('rect', {
          class: 'flow-minimap-viewport',
          x: 0, y: 0,
          width: layout.width, height: Math.min(400, layout.height),
          fill: 'rgba(99,102,241,0.08)',
          stroke: '#6366f1',
          'stroke-width': 4,
          rx: 4,
        });
        mmSvg.append(viewport);

        minimap.append(mmSvg);
        diagramWrap.append(minimap);

        /* Update viewport indicator on scroll */
        diagramWrap.addEventListener('scroll', () => {
          const wrapRect = diagramWrap.getBoundingClientRect();
          const svgRect = svgEl.getBoundingClientRect();
          const scaleX = layout.width / svgRect.width;
          const scaleY = layout.height / svgRect.height;
          viewport.setAttribute('x', String(diagramWrap.scrollLeft * scaleX));
          viewport.setAttribute('y', String(diagramWrap.scrollTop * scaleY));
          viewport.setAttribute('width', String(wrapRect.width * scaleX));
          viewport.setAttribute('height', String(wrapRect.height * scaleY));
        });
      }

      /* ---------- Collapsible step table ---------- */
      const tableSection = el('div', { className: 'flow-table-section' });
      const tableToggle = el('button', { className: 'flow-table-toggle' }, ['\u25B8 Show Step Table']);
      const table = el('div', { className: 'flow-step-table hidden' });

      const tableHeader = el('div', { className: 'flow-step-row flow-step-header-row' }, [
        el('span', { className: 'flow-step-cell flow-step-cell-drag' }),
        el('span', { className: 'flow-step-cell flow-step-cell-step' }, ['Step']),
        el('span', { className: 'flow-step-cell flow-step-cell-type' }, ['Type']),
        el('span', { className: 'flow-step-cell flow-step-cell-next' }, ['Next']),
        el('span', { className: 'flow-step-cell flow-step-cell-cond' }, ['Condition']),
        el('span', { className: 'flow-step-cell flow-step-cell-notes' }, ['Notes']),
      ]);
      table.append(tableHeader);

      let _tblDragEl = null;

      for (const s of group.steps) {
        const rowIdx = s.idx + 1;
        const shape = NODE_SHAPES[s.type] || NODE_SHAPES.process;

        const typeEl = el('span', {
          className: `flow-type-badge flow-type-${s.type}`,
          style: `--flow-type-color: ${shape.color}`,
        }, [`${shape.icon} ${shape.label}`]);

        const dragHandle = el('span', { className: 'flow-drag-handle', title: 'Drag to reorder' }, ['\u283F']);

        const stepRow = el('div', {
          className: 'flow-step-row',
          draggable: 'true',
          dataset: { rowIdx: String(rowIdx) },
        }, [
          el('span', { className: 'flow-step-cell flow-step-cell-drag' }, [dragHandle]),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-step' }, s.step, rowIdx, cols.step),
          el('span', { className: 'flow-step-cell flow-step-cell-type' }, [typeEl]),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-next' }, s.next, rowIdx, cols.next),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-cond' }, s.condition, rowIdx, cols.condition),
          editableCell('span', { className: 'flow-step-cell flow-step-cell-notes' }, s.notes, rowIdx, cols.notes),
        ]);

        table.append(stepRow);
      }

      /* Delegated step-table drag events (replaces 5 listeners per row) */
      delegateEvent(table, 'dragstart', '.flow-step-row:not(.flow-step-header-row)', (e, match) => {
        _tblDragEl = match;
        match.classList.add('flow-step-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', match.dataset.rowIdx);
      });

      delegateEvent(table, 'dragend', '.flow-step-row:not(.flow-step-header-row)', (e, match) => {
        match.classList.remove('flow-step-dragging');
        table.querySelectorAll('.flow-step-dragover').forEach(r => r.classList.remove('flow-step-dragover'));
        _tblDragEl = null;
      });

      delegateEvent(table, 'dragover', '.flow-step-row:not(.flow-step-header-row)', (e, match) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (_tblDragEl && _tblDragEl !== match) match.classList.add('flow-step-dragover');
      });

      delegateEvent(table, 'dragleave', '.flow-step-row:not(.flow-step-header-row)', (e, match) => {
        match.classList.remove('flow-step-dragover');
      });

      delegateEvent(table, 'drop', '.flow-step-row:not(.flow-step-header-row)', (e, match) => {
        e.preventDefault();
        match.classList.remove('flow-step-dragover');
        if (_tblDragEl && _tblDragEl !== match) {
          const rect = match.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) {
            match.parentNode.insertBefore(_tblDragEl, match);
          } else {
            match.parentNode.insertBefore(_tblDragEl, match.nextSibling);
          }
        }
        _tblDragEl = null;
      });

      /* Delegated table toggle */
      delegateEvent(tableSection, 'click', '.flow-table-toggle', () => {
        const nowHidden = table.classList.toggle('hidden');
        tableToggle.textContent = nowHidden ? '\u25B8 Show Step Table' : '\u25BE Hide Step Table';
      });

      tableSection.append(tableToggle, table);
      section.append(tableSection);

      delegateEvent(viewToggle, 'click', '.flow-view-btn', (_e, button) => {
        viewToggle.querySelectorAll('.flow-view-btn').forEach(btn => btn.classList.remove('flow-view-active'));
        button.classList.add('flow-view-active');
        const view = button.dataset.view;
        section.classList.toggle('flow-view-table', view === 'table');
        section.classList.toggle('flow-view-split', view === 'split');
        table.classList.toggle('hidden', view === 'canvas');
        tableToggle.textContent = table.classList.contains('hidden') ? '\u25B8 Show Step Table' : '\u25BE Hide Step Table';
      });

      container.append(section);
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'flow-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'flow-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'flow-dir-icon tmpl-dir-icon' }, ['\uD83D\uDD00']),
      el('span', { className: 'flow-dir-title tmpl-dir-title' }, ['Flow Diagrams']),
      el('span', { className: 'flow-dir-count tmpl-dir-count' }, [
        `${sheets.length} diagram${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'flow-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'flow-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'flow-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'flow-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} step${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.flow-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('flow', definition);
export default definition;
