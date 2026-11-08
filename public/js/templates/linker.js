/* ============================================================
   templates/linker.js — Community Linker & Knowledge Graph:
   interactive knowledge graph, hierarchical linker tree,
   cross-sheet federation, synthetic understanding inspector,
   and navigable source-data card directory
   ============================================================ */

import {
  el, cell, editableCell, registerTemplate,
  delegateEvent, isEditLocked, buildDirSyncBtn,
  getSheetData, svg, showToast,
} from './shared.js';

import {
  GOOG_ID_RE,
  SHORT_ID_RE,
  DEFAULT_WAYMARK_ICON,
  DEFAULT_LINKER_ICON,
  DEFAULT_CONCEPT_ICON,
  DEFAULT_SYNTHESIS_ICON,
  DEFAULT_FEDERATED_ICON,
  GRAPH_NODE_W,
  GRAPH_NODE_H,
  extractLink,
  isLinkerType,
  classifyNodeType,
  normalizeNodeKey,
  defaultIconForKind,
  buildKnowledgeGraph,
  mergeFederatedSheet,
  computeGraphLayout,
  buildLinkerTree,
  findNeighborhood,
} from './linker/helpers.js';

export {
  GOOG_ID_RE,
  SHORT_ID_RE,
  extractLink,
  isLinkerType,
  classifyNodeType,
  normalizeNodeKey,
  defaultIconForKind,
  buildKnowledgeGraph,
  mergeFederatedSheet,
  computeGraphLayout,
  buildLinkerTree,
  findNeighborhood,
};

/* ---------- Navigation Helper ---------- */

/**
 * Navigate to a Waymark sheet or folder, respecting public mode.
 * @param {string} id
 * @param {string} kind
 * @param {string} [name]
 */
function navigateToSource(id, kind, name = '') {
  if (!id) return;
  if (document.body.classList.contains('waymark-public')) {
    window.location.hash = `#/public/${id}`;
  } else if (kind === 'folder') {
    window.location.hash = name ? `#/folder/${id}/${encodeURIComponent(name)}` : `#/folder/${id}`;
  } else {
    window.location.hash = `#/sheet/${id}`;
  }
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Community Linker',
  icon: '🔗',
  color: '#7c3aed',
  priority: 22,
  itemNoun: 'Entry',
  defaultHeaders: ['Name', 'Description', 'Link', 'Type', 'Tags', 'Icon', 'Relation', 'Target', 'Synthesis'],

  migrations: [
    { header: 'Relation',  role: 'relation',  description: 'Relationship verb connecting this entry to a target (e.g. uses, funded by, curates)' },
    { header: 'Target',    role: 'target',    description: 'Target entity name or Waymark sheet ID in the knowledge graph' },
    { header: 'Synthesis', role: 'synthesis', description: 'Synthetic understanding, insights, or context about how this node connects' },
  ],

  detect(lower) {
    if (lower.some(h => /^(flow|workflow|diagram|pipeline|flowchart|trigger|sensor|invoice|student|recipe|calories|workout)/.test(h))) {
      return false;
    }
    const hasLink     = lower.some(h => /^(link|url|sheet|waymark.?link|sheet.?id|public.?link|from.?id|source.?id|source.?sheet)/.test(h));
    const hasType     = lower.some(h => /^(type|kind|entry.?type|node.?type)/.test(h));
    const hasName     = lower.some(h => /^(name|title|community|label|entity|node|concept|from.?title|source.?sheet|subject)/.test(h));
    const hasRelation = lower.some(h => /^(relation|relationship|edge|predicate|link.?type)/.test(h));
    const hasTarget   = lower.some(h => /^(target|to|to.?title|to.?id|target.?sheet)/.test(h));

    return (hasLink && hasType && hasName) || (hasRelation && (hasTarget || hasLink) && (hasName || hasLink));
  },

  columns(lower) {
    const cols = {
      name: -1, description: -1, link: -1, type: -1,
      tags: -1, icon: -1, relation: -1, target: -1,
      targetLink: -1, synthesis: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);

    cols.name        = lower.findIndex(h => /^(name|title|community|label|entity|node|concept|from.?title|source.?sheet|subject)/.test(h));
    cols.link        = lower.findIndex((h, i) => !used().includes(i) && /^(link|url|sheet|waymark.?link|sheet.?id|public.?link|from.?id|source.?id|source.?sheet)/.test(h));
    cols.type        = lower.findIndex((h, i) => !used().includes(i) && /^(type|kind|entry.?type|node.?type)/.test(h));
    cols.description = lower.findIndex((h, i) => !used().includes(i) && /^(description|desc|about|summary|detail|overview)/.test(h));
    cols.tags        = lower.findIndex((h, i) => !used().includes(i) && /^(tags?|categor|topic|label|group|cluster|domain)/.test(h));
    cols.icon        = lower.findIndex((h, i) => !used().includes(i) && /^(icon|emoji|symbol)/.test(h));
    cols.relation    = lower.findIndex((h, i) => !used().includes(i) && /^(relation|relationship|edge|predicate|connects?.?to|verb|link.?type)/.test(h));
    cols.targetLink  = lower.findIndex((h, i) => !used().includes(i) && /^(to.?id|target.?id|target.?link|target.?url|to.?sheet)/.test(h));
    cols.target      = lower.findIndex((h, i) => !used().includes(i) && /^(target|to.?title|to|target.?sheet|parent|child|connects|object|destination)/.test(h));
    cols.synthesis   = lower.findIndex((h, i) => !used().includes(i) && /^(synthesis|insight|understanding|takeaway|notes?|context|rationale|findings)/.test(h));

    if (cols.target === -1 && cols.targetLink >= 0) {
      cols.target = cols.targetLink;
    }
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'name',        label: 'Name / Entity',           colIndex: cols.name,        type: 'text', placeholder: 'Node, community, or sheet name', required: true },
      { role: 'description', label: 'Description',             colIndex: cols.description, type: 'text', placeholder: 'What is this about?' },
      { role: 'link',        label: 'Source Link / Sheet ID',  colIndex: cols.link,        type: 'text', placeholder: 'Sheet ID, folder ID, or Waymark URL' },
      { role: 'type',        label: 'Type',                    colIndex: cols.type,        type: 'text', placeholder: 'waymark, linker, graph, concept, or folder', defaultValue: 'waymark' },
      { role: 'relation',    label: 'Relation (Edge)',         colIndex: cols.relation,    type: 'text', placeholder: 'uses, funded by, depends on, curates...' },
      { role: 'target',      label: 'Target Node / Sheet',     colIndex: cols.target,      type: 'text', placeholder: 'Connected node name or Sheet ID' },
      { role: 'synthesis',   label: 'Synthetic Understanding', colIndex: cols.synthesis,   type: 'textarea', placeholder: 'Key insight or how these sources synthesize together' },
      { role: 'tags',        label: 'Tags',                    colIndex: cols.tags,        type: 'text', placeholder: 'cooking, recipes, architecture...' },
      { role: 'icon',        label: 'Icon',                    colIndex: cols.icon,        type: 'text', placeholder: '📄, 📁, 🧠, or 💡' },
    ];
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    /* ---------- Build Initial Knowledge Graph ---------- */
    const graph = buildKnowledgeGraph(rows, cols);
    const federatedSheetIds = new Set();
    const positionOverrides = new Map();
    let selectedNodeKey = graph.nodes[0]?.key || null;
    let activeViewMode = 'split'; // 'split' | 'graph' | 'tree' | 'cards'
    let activeFilterTag = '';
    let zoomLevel = 1;

    /* ---------- Top Search & Mode Control Bar ---------- */
    const searchInput = el('input', {
      type: 'text',
      className: 'linker-search',
      placeholder: 'Search nodes, relationships, synthetic insights, or tags...',
    });

    const viewBtns = [
      { id: 'split', label: 'Explore All' },
      { id: 'graph', label: 'Knowledge Graph' },
      { id: 'tree',  label: 'Linker Tree' },
      { id: 'cards', label: 'Directory Cards' },
    ].map(m => el('button', {
      type: 'button',
      className: `linker-view-btn${m.id === activeViewMode ? ' linker-view-active' : ''}`,
      dataset: { view: m.id },
    }, [m.label]));

    const viewSwitcher = el('div', { className: 'linker-view-switcher' }, viewBtns);

    const federateAllBtn = el('button', {
      type: 'button',
      className: 'linker-federate-all-btn',
      title: 'Fetch and merge connected sub-graphs and linked Waymark sheets into this Knowledge Graph',
    }, ['🌐 Federate Sub-Graphs']);

    const federationStatus = el('span', { className: 'linker-federation-status' }, ['Local Graph']);

    const searchBar = el('div', { className: 'linker-search-bar' }, [
      el('div', { className: 'linker-search-row' }, [
        searchInput,
        viewSwitcher,
        federateAllBtn,
        federationStatus,
      ]),
    ]);
    container.append(searchBar);

    /* ---------- Graph Summary & Synthesis Metrics Bar ---------- */
    const statsBar = el('div', { className: 'linker-stats-bar' });
    container.append(statsBar);

    /* ---------- Knowledge Graph + Tree + Inspector Explorer ---------- */
    const explorerWrap = el('div', { className: 'linker-explorer' });
    const graphPanel = el('div', { className: 'linker-graph-panel' });
    const treePanel = el('div', { className: 'linker-tree-panel' });
    const inspectorPanel = el('div', { className: 'linker-inspector' });

    explorerWrap.append(graphPanel, treePanel, inspectorPanel);
    container.append(explorerWrap);

    /* ---------- Card Grid ---------- */
    const grid = el('div', { className: 'linker-grid' });
    container.append(grid);

    /* ---------- Federated Nodes Tray (when sheets are federated) ---------- */
    const federatedTray = el('div', { className: 'linker-federated-tray hidden' });
    container.append(federatedTray);

    /* ---------- Build Primary Cards ---------- */
    const cardEntries = [];

    for (const entry of graph.entries) {
      const {
        name, description, synthesis, rawLink, linkId, linkKind,
        isLinker, tagList, icon, relation, target, rowIdx, nodeKey, node,
      } = entry;

      const cardChildren = [
        el('div', { className: 'linker-card-header' }, [
          el('span', { className: 'linker-card-icon' }, [icon]),
          el('span', { className: `linker-card-type ${isLinker ? 'linker-type-directory' : 'linker-type-waymark'}` }, [
            isLinker ? 'Directory' : 'Waymark',
          ]),
          ...(node.nodeKind === 'concept' || node.nodeKind === 'synthesis' ? [
            el('span', { className: `linker-card-kind linker-kind-${node.nodeKind}` }, [
              node.nodeKind === 'synthesis' ? 'Synthesis' : 'Concept',
            ]),
          ] : []),
        ]),
      ];

      // Name — editable in auth mode
      if (isEditLocked() || cols.name < 0) {
        cardChildren.push(el('div', { className: 'linker-card-name' }, [name]));
      } else {
        cardChildren.push(editableCell('div', { className: 'linker-card-name' }, name, rowIdx, cols.name));
      }

      // Description
      if (description || (!isEditLocked() && cols.description >= 0)) {
        if (isEditLocked() || cols.description < 0) {
          if (description) cardChildren.push(el('div', { className: 'linker-card-desc' }, [description]));
        } else {
          cardChildren.push(editableCell('div', { className: 'linker-card-desc' }, description || '', rowIdx, cols.description));
        }
      }

      // Synthetic Understanding Callout
      if (synthesis || (node.insights && node.insights.length > 0)) {
        const synthText = synthesis || node.insights[0];
        const synthContent = (!isEditLocked() && cols.synthesis >= 0)
          ? editableCell('span', { className: 'linker-card-synthesis-text' }, synthText, rowIdx, cols.synthesis)
          : el('span', { className: 'linker-card-synthesis-text' }, [synthText]);
        cardChildren.push(el('div', { className: 'linker-card-synthesis' }, [
          el('span', { className: 'linker-synthesis-icon' }, ['💡']),
          synthContent,
        ]));
      }

      // Explicit Relationship Pills
      const explicitOut = node.relations.filter(r => r.direction === 'out' && !r.inferred);
      if (explicitOut.length > 0) {
        cardChildren.push(el('div', { className: 'linker-card-relations' },
          explicitOut.slice(0, 4).map(r => el('span', {
            className: 'linker-relation-pill',
            dataset: { targetKey: r.targetKey },
          }, [`${r.relation} → ${r.targetName}`]))
        ));
      }

      // Tags
      if (tagList.length > 0) {
        cardChildren.push(el('div', { className: 'linker-card-tags' },
          tagList.map(t => el('span', { className: 'linker-tag' }, [t]))
        ));
      }

      // Invalid link warning — only Waymark references are accepted
      if (!linkId && rawLink) {
        cardChildren.push(el('div', { className: 'linker-card-warning' }, ['⚠ Not a valid Waymark link']));
      }

      // Card Footer Actions (Inspect in Graph + Federate Sub-Graph)
      const actionBtns = [
        el('button', {
          type: 'button',
          className: 'linker-card-action-btn linker-card-inspect-btn',
          dataset: { nodeKey },
          title: 'Inspect connections and synthetic understanding in the Knowledge Graph',
        }, ['🔍 Graph']),
      ];

      if (linkId && linkKind === 'sheet') {
        actionBtns.push(el('button', {
          type: 'button',
          className: 'linker-card-action-btn linker-federate-btn',
          dataset: { nodeKey, sheetId: linkId },
          title: 'Federate this sheet into the active Knowledge Graph',
        }, ['🌐 Federate']));
      }

      cardChildren.push(el('div', { className: 'linker-card-actions' }, actionBtns));

      const card = el('div', {
        className: `linker-card${!linkId && rawLink ? ' linker-card-invalid' : ''}`,
        dataset: {
          sheetId: linkId,
          linkKind,
          isLinker: isLinker ? '1' : '0',
          entryName: name,
          nodeKey,
        },
      }, cardChildren);

      grid.append(card);
      cardEntries.push({
        name,
        description,
        synthesis: (node.insights || []).join(' '),
        relation,
        target,
        tags: entry.tags,
        nodeKey,
        card,
      });
    }

    /* ---------- Empty State ---------- */
    if (cardEntries.length === 0) {
      grid.append(el('p', { className: 'empty-state' }, ['No entries in this directory.']));
    }

    /* ---------- Render Stats Bar ---------- */
    function renderStatsBar() {
      statsBar.innerHTML = '';
      const hubCount = graph.nodes.filter(n => n.isLinker).length;
      const fedNodesCount = graph.nodes.filter(n => n.federated).length;
      const insightCount = graph.nodes.reduce((sum, n) => sum + (n.insights?.length || (n.description ? 1 : 0)), 0);

      // Collect top tags for quick cluster filtering
      const tagCounts = new Map();
      for (const n of graph.nodes) {
        for (const t of (n.tags || [])) {
          const clean = t.trim();
          if (clean) tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
        }
      }
      const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

      const metricsRow = el('div', { className: 'linker-metrics-row' }, [
        el('div', { className: 'linker-stat-item linker-stat-nodes' }, [
          el('span', { className: 'linker-stat-value' }, [String(graph.nodes.length)]),
          el('span', { className: 'linker-stat-label' }, ['Nodes']),
        ]),
        el('div', { className: 'linker-stat-item linker-stat-edges' }, [
          el('span', { className: 'linker-stat-value' }, [String(graph.edges.length)]),
          el('span', { className: 'linker-stat-label' }, ['Relationships']),
        ]),
        el('div', { className: 'linker-stat-item linker-stat-hubs' }, [
          el('span', { className: 'linker-stat-value' }, [String(hubCount)]),
          el('span', { className: 'linker-stat-label' }, ['Hubs / Linkers']),
        ]),
        el('div', { className: 'linker-stat-item linker-stat-federated' }, [
          el('span', { className: 'linker-stat-value' }, [`${federatedSheetIds.size} (${fedNodesCount})`]),
          el('span', { className: 'linker-stat-label' }, ['Federated Sheets']),
        ]),
        el('div', { className: 'linker-stat-item linker-stat-insights' }, [
          el('span', { className: 'linker-stat-value' }, [String(insightCount)]),
          el('span', { className: 'linker-stat-label' }, ['Syntheses']),
        ]),
      ]);

      statsBar.append(metricsRow);

      if (topTags.length > 0) {
        const filterRow = el('div', { className: 'linker-filter-pills' }, [
          el('button', {
            type: 'button',
            className: `linker-filter-pill${!activeFilterTag ? ' linker-filter-pill-active' : ''}`,
            dataset: { tag: '' },
          }, ['All Clusters']),
          ...topTags.map(([tag, cnt]) => el('button', {
            type: 'button',
            className: `linker-filter-pill${activeFilterTag.toLowerCase() === tag.toLowerCase() ? ' linker-filter-pill-active' : ''}`,
            dataset: { tag },
          }, [`#${tag} (${cnt})`])),
        ]);
        statsBar.append(filterRow);
      }
    }

    /* ---------- Render Interactive SVG Knowledge Graph ---------- */
    function renderGraphPanel() {
      graphPanel.innerHTML = '';

      if (graph.nodes.length === 0) {
        graphPanel.append(el('div', { className: 'linker-graph-empty' }, [
          'Add entries or relationships to visualize the Knowledge Graph.',
        ]));
        return;
      }

      const layout = computeGraphLayout(graph.nodes, graph.edges, positionOverrides);
      const neighborhood = findNeighborhood(graph.nodes, graph.edges, selectedNodeKey);

      const zoomOutBtn = el('button', { type: 'button', className: 'linker-hud-btn linker-zoom-out', title: 'Zoom Out' }, ['−']);
      const zoomInBtn = el('button', { type: 'button', className: 'linker-hud-btn linker-zoom-in', title: 'Zoom In' }, ['+']);
      const zoomResetBtn = el('button', { type: 'button', className: 'linker-hud-btn linker-zoom-reset', title: 'Reset Zoom' }, ['Fit']);
      const autoLayoutBtn = el('button', { type: 'button', className: 'linker-hud-btn linker-layout-reset', title: 'Reset Node Positions' }, ['Auto-Align']);

      const header = el('div', { className: 'linker-panel-header' }, [
        el('div', { className: 'linker-panel-title-wrap' }, [
          el('span', { className: 'linker-panel-icon' }, ['🕸️']),
          el('h3', { className: 'linker-panel-title' }, ['Knowledge Graph Canvas']),
          el('span', { className: 'linker-panel-subtitle' }, [
            `${layout.nodes.length} nodes • ${layout.edges.length} edges`,
          ]),
        ]),
        el('div', { className: 'linker-graph-hud' }, [zoomOutBtn, zoomInBtn, zoomResetBtn, autoLayoutBtn]),
      ]);

      const canvasWrap = el('div', {
        className: 'linker-graph-wrap',
        dataset: { zoom: String(zoomLevel.toFixed(2)) },
      });

      const markerId = 'linker-arrow-marker';
      const activeMarkerId = 'linker-arrow-marker-active';
      const svgEl = svg('svg', {
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        class: 'linker-graph-svg',
        width: '100%',
        height: String(Math.min(520, Math.max(280, layout.height))),
      });
      svgEl.style.width = `${zoomLevel * 100}%`;

      const defs = svg('defs');
      const marker = svg('marker', {
        id: markerId,
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
      });
      marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'linker-arrow-path' }));

      const activeMarker = svg('marker', {
        id: activeMarkerId,
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 6,
        markerHeight: 6,
        orient: 'auto-start-reverse',
      });
      activeMarker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'linker-arrow-path-active' }));
      defs.append(marker, activeMarker);
      svgEl.append(defs);

      const edgesGroup = svg('g', { class: 'linker-edges-group' });
      const nodesGroup = svg('g', { class: 'linker-nodes-group' });

      function drawEdges() {
        while (edgesGroup.firstChild) edgesGroup.removeChild(edgesGroup.firstChild);
        const currentLayout = computeGraphLayout(graph.nodes, graph.edges, positionOverrides);
        for (const edge of currentLayout.edges) {
          const isActive = neighborhood.activeEdgeIds.has(edge.id);
          const edgeG = svg('g', {
            class: `linker-graph-edge linker-edge-${edge.kind}${isActive ? ' linker-edge-active' : ''}`,
            'data-edge-id': edge.id,
            'data-from': edge.from,
            'data-to': edge.to,
          });

          const pathEl = svg('path', {
            d: `M ${edge.x1} ${edge.y1} Q ${edge.cx} ${edge.cy} ${edge.x2} ${edge.y2}`,
            fill: 'none',
            class: 'linker-edge-line',
            'marker-end': `url(#${isActive ? activeMarkerId : markerId})`,
          });
          edgeG.append(pathEl);

          if (edge.relation) {
            const labelText = edge.relation.length > 20 ? edge.relation.slice(0, 18) + '…' : edge.relation;
            const textEl = svg('text', {
              x: edge.lx,
              y: edge.ly - 4,
              'text-anchor': 'middle',
              class: 'linker-edge-label',
            });
            textEl.textContent = labelText;
            edgeG.append(textEl);
          }

          edgesGroup.append(edgeG);
        }
      }

      drawEdges();

      const nodeElements = new Map();
      for (const node of layout.nodes) {
        const isSelected = node.key === selectedNodeKey;
        const isNeighbor = neighborhood.activeNodeKeys.has(node.key);
        const nodeG = svg('g', {
          class: [
            'linker-graph-node',
            `linker-node-kind-${node.nodeKind}`,
            node.isLinker ? 'linker-node-hub' : 'linker-node-leaf',
            node.federated ? 'linker-node-federated' : '',
            isSelected ? 'linker-node-selected' : '',
            isNeighbor && !isSelected ? 'linker-node-neighbor' : '',
          ].filter(Boolean).join(' '),
          transform: `translate(${node.x}, ${node.y})`,
          'data-node-key': node.key,
          'data-sheet-id': node.linkId || '',
          'data-link-kind': node.linkKind || '',
        });

        const rect = svg('rect', {
          width: node.w,
          height: node.h,
          rx: 10,
          ry: 10,
          class: 'linker-node-box',
        });

        const titleStr = node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name;
        const label = svg('text', {
          x: 12,
          y: 24,
          class: 'linker-node-title',
        });
        label.textContent = `${node.icon} ${titleStr}`;

        const metaParts = [];
        if (node.federated) metaParts.push('🌐 Federated');
        else if (node.isLinker) metaParts.push('Directory Hub');
        else metaParts.push(node.nodeKind);
        if (node.relations.length > 0) metaParts.push(`${node.relations.length} links`);

        const subLabel = svg('text', {
          x: 12,
          y: 44,
          class: 'linker-node-meta',
        });
        subLabel.textContent = metaParts.join(' • ');

        nodeG.append(rect, label, subLabel);
        nodesGroup.append(nodeG);
        nodeElements.set(node.key, { el: nodeG, node });
      }

      svgEl.append(edgesGroup, nodesGroup);
      canvasWrap.append(svgEl);
      graphPanel.append(header, canvasWrap);

      /* ---------- Graph HUD Controls ---------- */
      zoomOutBtn.addEventListener('click', () => {
        zoomLevel = Math.max(0.6, zoomLevel - 0.15);
        svgEl.style.width = `${zoomLevel * 100}%`;
        canvasWrap.dataset.zoom = String(zoomLevel.toFixed(2));
      });
      zoomInBtn.addEventListener('click', () => {
        zoomLevel = Math.min(1.75, zoomLevel + 0.15);
        svgEl.style.width = `${zoomLevel * 100}%`;
        canvasWrap.dataset.zoom = String(zoomLevel.toFixed(2));
      });
      zoomResetBtn.addEventListener('click', () => {
        zoomLevel = 1;
        svgEl.style.width = '100%';
        canvasWrap.dataset.zoom = '1.00';
      });
      autoLayoutBtn.addEventListener('click', () => {
        positionOverrides.clear();
        renderGraphPanel();
      });

      /* ---------- Node Selection, Dragging & Double-Click Source Navigation ---------- */
      let dragState = null;

      delegateEvent(nodesGroup, 'mousedown', '.linker-graph-node', (e, match) => {
        if (e.button !== 0) return;
        const key = match.getAttribute('data-node-key');
        const info = key ? nodeElements.get(key) : null;
        if (!info) return;
        dragState = {
          key,
          node: info.node,
          el: info.el,
          startClientX: e.clientX,
          startClientY: e.clientY,
          origX: info.node.x,
          origY: info.node.y,
          moved: false,
        };
      });

      svgEl.addEventListener('mousemove', (e) => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startClientX;
        const dy = e.clientY - dragState.startClientY;
        if (!dragState.moved && Math.hypot(dx, dy) > 5) {
          dragState.moved = true;
        }
        if (dragState.moved) {
          const nextX = Math.max(10, Math.round(dragState.origX + dx));
          const nextY = Math.max(10, Math.round(dragState.origY + dy));
          dragState.node.x = nextX;
          dragState.node.y = nextY;
          positionOverrides.set(dragState.key, { x: nextX, y: nextY });
          dragState.el.setAttribute('transform', `translate(${nextX}, ${nextY})`);
          drawEdges();
        }
      });

      function endDrag() {
        if (!dragState) return;
        const wasMoved = dragState.moved;
        const clickedKey = dragState.key;
        dragState = null;
        if (!wasMoved && clickedKey) {
          selectNode(clickedKey);
        }
      }

      svgEl.addEventListener('mouseup', endDrag);
      svgEl.addEventListener('mouseleave', endDrag);

      delegateEvent(nodesGroup, 'dblclick', '.linker-graph-node', (_e, match) => {
        const key = match.getAttribute('data-node-key');
        const node = key ? graph.nodeMap.get(key) : null;
        if (node && node.linkId) {
          navigateToSource(node.linkId, node.linkKind, node.name);
        }
      });
    }

    /* ---------- Render Hierarchical Linker Tree ---------- */
    function renderTreePanel() {
      treePanel.innerHTML = '';
      const treeRoots = buildLinkerTree(graph.nodes, graph.edges);

      const header = el('div', { className: 'linker-panel-header' }, [
        el('div', { className: 'linker-panel-title-wrap' }, [
          el('span', { className: 'linker-panel-icon' }, ['🌲']),
          el('h3', { className: 'linker-panel-title' }, ['Linker Tree & Lineage']),
          el('span', { className: 'linker-panel-subtitle' }, [`${treeRoots.length} root branch${treeRoots.length !== 1 ? 'es' : ''}`]),
        ]),
      ]);

      const treeContainer = el('div', { className: 'linker-tree' });

      function buildTreeBranchDom(branch, depth = 0) {
        const { node, relationFromParent, children, isCycleRef } = branch;
        const hasChildren = children && children.length > 0;
        const isSelected = node.key === selectedNodeKey;

        const branchEl = el('div', {
          className: `linker-tree-branch${node.federated ? ' linker-tree-branch-federated' : ''}`,
          dataset: { depth: String(depth) },
        });

        const toggleBtn = el('button', {
          type: 'button',
          className: `linker-tree-toggle${hasChildren ? '' : ' linker-tree-toggle-leaf'}`,
          title: hasChildren ? 'Collapse / Expand branch' : 'Leaf node',
        }, [hasChildren ? '▾' : '•']);

        const rowChildren = [toggleBtn];

        if (relationFromParent) {
          rowChildren.push(el('span', { className: 'linker-tree-relation' }, [`${relationFromParent} →`]));
        }

        rowChildren.push(
          el('span', { className: 'linker-tree-icon' }, [node.icon]),
          el('span', { className: 'linker-tree-name' }, [node.name]),
          el('span', { className: `linker-tree-badge ${node.isLinker ? 'linker-type-directory' : 'linker-type-waymark'}` }, [
            node.federated ? 'Federated' : (node.isLinker ? 'Directory' : node.nodeKind),
          ]),
        );

        if (isCycleRef) {
          rowChildren.push(el('span', { className: 'linker-tree-cycle-badge' }, ['↻ cycle ref']));
        }

        if (node.linkId && node.linkKind === 'sheet' && !federatedSheetIds.has(node.linkId)) {
          rowChildren.push(el('button', {
            type: 'button',
            className: 'linker-tree-federate-btn',
            dataset: { nodeKey: node.key, sheetId: node.linkId },
            title: 'Federate this sheet inline into the tree and graph',
          }, ['🌐 Federate']));
        }

        if (node.linkId) {
          rowChildren.push(el('button', {
            type: 'button',
            className: 'linker-tree-open-btn',
            dataset: { sheetId: node.linkId, linkKind: node.linkKind || 'sheet', entryName: node.name },
            title: 'Click through to source data',
          }, ['↗ Source']));
        }

        const treeRow = el('div', {
          className: `linker-tree-row${isSelected ? ' linker-tree-row-selected' : ''}`,
          dataset: {
            nodeKey: node.key,
            sheetId: node.linkId || '',
            linkKind: node.linkKind || '',
          },
        }, rowChildren);

        branchEl.append(treeRow);

        if (hasChildren && !isCycleRef) {
          const childrenContainer = el('div', { className: 'linker-tree-children' },
            children.map(c => buildTreeBranchDom(c, depth + 1))
          );
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const collapsed = childrenContainer.classList.toggle('hidden');
            toggleBtn.textContent = collapsed ? '▸' : '▾';
          });
          branchEl.append(childrenContainer);
        }

        return branchEl;
      }

      for (const rootBranch of treeRoots) {
        treeContainer.append(buildTreeBranchDom(rootBranch, 0));
      }

      delegateEvent(treeContainer, 'click', '.linker-tree-federate-btn', (e, btn) => {
        e.stopPropagation();
        const nodeKey = btn.dataset.nodeKey;
        const sheetId = btn.dataset.sheetId;
        if (nodeKey && sheetId) federateSingleNode(nodeKey, sheetId);
      });

      delegateEvent(treeContainer, 'click', '.linker-tree-open-btn', (e, btn) => {
        e.stopPropagation();
        navigateToSource(btn.dataset.sheetId, btn.dataset.linkKind, btn.dataset.entryName);
      });

      delegateEvent(treeContainer, 'click', '.linker-tree-row', (e, rowEl) => {
        if (e.target.closest('button')) return;
        const key = rowEl.dataset.nodeKey;
        if (key) selectNode(key);
      });

      treePanel.append(header, treeContainer);
    }

    /* ---------- Render Synthetic Understanding & Source Inspector ---------- */
    function renderInspectorPanel() {
      inspectorPanel.innerHTML = '';
      const node = selectedNodeKey ? graph.nodeMap.get(selectedNodeKey) : graph.nodes[0];

      if (!node) {
        inspectorPanel.append(el('div', { className: 'linker-inspector-empty' }, [
          'Select any node in the Knowledge Graph, Linker Tree, or Cards to inspect its synthetic understanding and source data links.',
        ]));
        return;
      }

      const neighborhood = findNeighborhood(graph.nodes, graph.edges, node.key);

      const header = el('div', { className: 'linker-inspector-header' }, [
        el('span', { className: 'linker-inspector-icon' }, [node.icon]),
        el('div', { className: 'linker-inspector-heading' }, [
          el('h3', { className: 'linker-inspector-title' }, [node.name]),
          el('div', { className: 'linker-inspector-badges' }, [
            el('span', { className: `linker-card-type ${node.isLinker ? 'linker-type-directory' : 'linker-type-waymark'}` }, [
              node.isLinker ? 'Directory' : 'Waymark',
            ]),
            el('span', { className: 'linker-inspector-provenance' }, [
              node.federated ? `🌐 Federated from ${node.sourceSheetTitle || node.sourceSheetId}` : '📍 Local Graph Node',
            ]),
          ]),
        ]),
      ]);

      /* Synthetic Understanding Section */
      const synthList = node.insights && node.insights.length > 0
        ? node.insights
        : (node.synthesis ? [node.synthesis] : []);

      const synthBoxChildren = [
        el('div', { className: 'linker-inspector-section-title' }, ['💡 Synthetic Understanding']),
      ];

      if (!node.federated && !isEditLocked() && cols.synthesis >= 0 && node.rowIdx >= 1) {
        synthBoxChildren.push(
          editableCell('div', { className: 'linker-inspector-synthesis-edit' }, node.synthesis || node.description || '', node.rowIdx, cols.synthesis, {
            onCommit(newVal) {
              node.synthesis = newVal;
              node.insights = newVal ? [newVal] : [];
            },
          })
        );
      } else if (synthList.length > 0) {
        for (const item of synthList) {
          synthBoxChildren.push(el('p', { className: 'linker-inspector-synthesis-text' }, [item]));
        }
      } else if (node.description) {
        synthBoxChildren.push(el('p', { className: 'linker-inspector-synthesis-text' }, [node.description]));
      } else {
        synthBoxChildren.push(el('p', { className: 'linker-inspector-synthesis-muted' }, [
          'No synthetic notes recorded yet for this node.',
        ]));
      }

      if (node.description && synthList.length > 0 && node.description !== synthList[0]) {
        synthBoxChildren.push(el('p', { className: 'linker-inspector-desc' }, [node.description]));
      }

      const synthSection = el('div', { className: 'linker-inspector-synthesis' }, synthBoxChildren);

      /* Connected Relationships Section */
      const relItems = [];
      for (const edge of neighborhood.outbound) {
        const targetNode = graph.nodeMap.get(edge.to);
        relItems.push(el('div', {
          className: 'linker-inspector-rel-item linker-rel-outbound',
          dataset: { targetKey: edge.to },
        }, [
          el('span', { className: 'linker-rel-direction' }, ['→']),
          el('span', { className: 'linker-rel-verb' }, [edge.relation]),
          el('span', { className: 'linker-rel-target' }, [targetNode ? `${targetNode.icon} ${targetNode.name}` : edge.toName]),
          ...(targetNode?.linkId ? [el('button', {
            type: 'button',
            className: 'linker-rel-source-btn',
            dataset: { sheetId: targetNode.linkId, linkKind: targetNode.linkKind || 'sheet', entryName: targetNode.name },
            title: 'Click through to target source sheet',
          }, ['↗'])] : []),
        ]));
      }
      for (const edge of neighborhood.inbound) {
        const fromNode = graph.nodeMap.get(edge.from);
        relItems.push(el('div', {
          className: 'linker-inspector-rel-item linker-rel-inbound',
          dataset: { targetKey: edge.from },
        }, [
          el('span', { className: 'linker-rel-direction' }, ['←']),
          el('span', { className: 'linker-rel-target' }, [fromNode ? `${fromNode.icon} ${fromNode.name}` : edge.fromName]),
          el('span', { className: 'linker-rel-verb' }, [edge.relation]),
          ...(fromNode?.linkId ? [el('button', {
            type: 'button',
            className: 'linker-rel-source-btn',
            dataset: { sheetId: fromNode.linkId, linkKind: fromNode.linkKind || 'sheet', entryName: fromNode.name },
            title: 'Click through to source sheet',
          }, ['↗'])] : []),
        ]));
      }

      const relSection = el('div', { className: 'linker-inspector-relations' }, [
        el('div', { className: 'linker-inspector-section-title' }, [
          `🔗 Connected Nodes (${relItems.length})`,
        ]),
        ...(relItems.length > 0
          ? [el('div', { className: 'linker-inspector-rel-list' }, relItems)]
          : [el('p', { className: 'linker-inspector-synthesis-muted' }, ['No direct edges connected to this node.'])]),
      ]);

      delegateEvent(relSection, 'click', '.linker-rel-source-btn', (e, btn) => {
        e.stopPropagation();
        navigateToSource(btn.dataset.sheetId, btn.dataset.linkKind, btn.dataset.entryName);
      });

      delegateEvent(relSection, 'click', '.linker-inspector-rel-item', (e, item) => {
        if (e.target.closest('button')) return;
        const targetKey = item.dataset.targetKey;
        if (targetKey && graph.nodeMap.has(targetKey)) {
          selectNode(targetKey);
        }
      });

      /* Tags in Inspector */
      const tagsSection = (node.tags && node.tags.length > 0)
        ? el('div', { className: 'linker-inspector-tags' },
            node.tags.map(t => el('span', { className: 'linker-tag' }, [t]))
          )
        : null;

      /* Source Data Click-Through & Federation Actions */
      const actionButtons = [];
      if (node.linkId) {
        const sourceBtn = el('button', {
          type: 'button',
          className: 'linker-source-link',
          dataset: { sheetId: node.linkId, linkKind: node.linkKind || 'sheet', entryName: node.name },
        }, [
          node.linkKind === 'folder'
            ? `📁 Open Source Folder (${node.linkId}) →`
            : `📄 Open Source Data (${node.linkId}) →`,
        ]);
        sourceBtn.addEventListener('click', () => {
          navigateToSource(node.linkId, node.linkKind, node.name);
        });
        actionButtons.push(sourceBtn);
      }

      if (node.linkId && node.linkKind === 'sheet' && !federatedSheetIds.has(node.linkId)) {
        const fedBtn = el('button', {
          type: 'button',
          className: 'linker-inspector-federate-btn',
          dataset: { nodeKey: node.key, sheetId: node.linkId },
        }, ['🌐 Federate Sheet into Graph']);
        fedBtn.addEventListener('click', () => {
          federateSingleNode(node.key, node.linkId);
        });
        actionButtons.push(fedBtn);
      }

      if (node.federated && node.sourceSheetId && node.sourceSheetId !== node.linkId) {
        const parentBtn = el('button', {
          type: 'button',
          className: 'linker-federated-source-link',
          dataset: { sheetId: node.sourceSheetId },
        }, [`🌐 Open Federated Host (${node.sourceSheetTitle || node.sourceSheetId}) →`]);
        parentBtn.addEventListener('click', () => {
          navigateToSource(node.sourceSheetId, 'sheet', node.sourceSheetTitle);
        });
        actionButtons.push(parentBtn);
      }

      const actionsSection = el('div', { className: 'linker-inspector-actions' }, actionButtons);

      inspectorPanel.append(
        header,
        synthSection,
        relSection,
        ...(tagsSection ? [tagsSection] : []),
        actionsSection,
      );
    }

    /* ---------- Render Federated Nodes Tray ---------- */
    function renderFederatedTray() {
      const fedNodes = graph.nodes.filter(n => n.federated);
      federatedTray.innerHTML = '';
      if (fedNodes.length === 0) {
        federatedTray.classList.add('hidden');
        return;
      }
      federatedTray.classList.remove('hidden');

      const trayGrid = el('div', { className: 'linker-federated-grid' },
        fedNodes.map(fn => el('div', {
          className: `linker-federated-card${fn.key === selectedNodeKey ? ' linker-federated-card-selected' : ''}`,
          dataset: {
            nodeKey: fn.key,
            sheetId: fn.linkId || fn.sourceSheetId || '',
            linkKind: fn.linkKind || 'sheet',
            entryName: fn.name,
          },
        }, [
          el('div', { className: 'linker-federated-card-header' }, [
            el('span', { className: 'linker-card-icon' }, [fn.icon || DEFAULT_FEDERATED_ICON]),
            el('span', { className: 'linker-federated-origin' }, [`🌐 ${fn.sourceSheetTitle || fn.sourceSheetId}`]),
          ]),
          el('div', { className: 'linker-federated-card-name' }, [fn.name]),
          ...(fn.synthesis || fn.description ? [
            el('div', { className: 'linker-federated-card-desc' }, [fn.synthesis || fn.description]),
          ] : []),
          el('div', { className: 'linker-federated-card-actions' }, [
            el('button', {
              type: 'button',
              className: 'linker-federated-open-btn',
              dataset: {
                sheetId: fn.linkId || fn.sourceSheetId || '',
                linkKind: fn.linkKind || 'sheet',
                entryName: fn.name,
              },
            }, ['↗ Open Source Data']),
          ]),
        ]))
      );

      delegateEvent(trayGrid, 'click', '.linker-federated-open-btn', (e, btn) => {
        e.stopPropagation();
        navigateToSource(btn.dataset.sheetId, btn.dataset.linkKind, btn.dataset.entryName);
      });

      delegateEvent(trayGrid, 'click', '.linker-federated-card', (e, card) => {
        if (e.target.closest('button')) return;
        const key = card.dataset.nodeKey;
        if (key) selectNode(key);
      });

      federatedTray.append(
        el('div', { className: 'linker-federated-tray-header' }, [
          el('span', { className: 'linker-federated-tray-title' }, [
            `🌐 Federated Knowledge Graph Nodes (${fedNodes.length} across ${federatedSheetIds.size} sheet${federatedSheetIds.size !== 1 ? 's' : ''})`,
          ]),
        ]),
        trayGrid,
      );
    }

    /* ---------- Select Node & Sync All Panels ---------- */
    function selectNode(nodeKey) {
      if (!graph.nodeMap.has(nodeKey)) return;
      selectedNodeKey = nodeKey;
      renderGraphPanel();
      renderTreePanel();
      renderInspectorPanel();
      renderFederatedTray();

      grid.querySelectorAll('.linker-card').forEach(c => {
        c.classList.toggle('linker-card-selected', c.dataset.nodeKey === nodeKey);
      });
    }

    /* ---------- Cross-Sheet Federation Execution ---------- */
    async function federateSingleNode(nodeKey, sheetId, silent = false) {
      if (!sheetId || federatedSheetIds.has(sheetId)) return 0;
      try {
        const remoteData = await getSheetData(sheetId);
        if (!remoteData) {
          if (!silent) showToast(`Could not load federated sheet ${sheetId}`, 'warn');
          return 0;
        }
        federatedSheetIds.add(sheetId);
        const { addedNodes } = mergeFederatedSheet(
          graph,
          remoteData,
          nodeKey,
          (lower) => definition.detect(lower),
          (lower) => definition.columns(lower),
        );

        // Update card federate button state
        grid.querySelectorAll(`.linker-federate-btn[data-sheet-id="${sheetId}"]`).forEach(btn => {
          btn.textContent = '✓ Federated';
          btn.classList.add('linker-federate-btn-done');
        });

        const totalFedNodes = graph.nodes.filter(n => n.federated).length;
        federationStatus.textContent = `Federated: ${federatedSheetIds.size} sheet${federatedSheetIds.size !== 1 ? 's' : ''} (+${totalFedNodes} nodes)`;
        federationStatus.classList.add('linker-federation-active');

        renderStatsBar();
        renderGraphPanel();
        renderTreePanel();
        renderInspectorPanel();
        renderFederatedTray();

        return addedNodes.length;
      } catch (err) {
        if (!silent) showToast(`Federation error: ${err.message || err}`, 'error');
        return 0;
      }
    }

    async function federateAllSubGraphs() {
      const candidates = graph.nodes.filter(
        n => n.linkId && n.linkKind === 'sheet' && (n.isLinker || n.nodeKind === 'linker' || !federatedSheetIds.has(n.linkId))
      );
      // Prioritize linker/directory sub-graphs first; if none, federate all linked sheets
      const linkerCandidates = candidates.filter(n => n.isLinker && !federatedSheetIds.has(n.linkId));
      const targets = linkerCandidates.length > 0
        ? linkerCandidates
        : candidates.filter(n => !federatedSheetIds.has(n.linkId));

      if (targets.length === 0) {
        showToast('All linked sub-graphs are already federated', 'info');
        return;
      }

      federateAllBtn.disabled = true;
      federateAllBtn.textContent = '🌐 Federating...';

      for (const node of targets) {
        await federateSingleNode(node.key, node.linkId, true);
      }

      federateAllBtn.disabled = false;
      federateAllBtn.textContent = `✓ Federated (${federatedSheetIds.size})`;
    }

    federateAllBtn.addEventListener('click', () => {
      federateAllSubGraphs();
    });

    /* ---------- View Mode Switching ---------- */
    function applyViewMode(mode) {
      activeViewMode = mode;
      viewBtns.forEach(btn => {
        btn.classList.toggle('linker-view-active', btn.dataset.view === mode);
      });
      explorerWrap.dataset.viewMode = mode;

      if (mode === 'cards') {
        explorerWrap.classList.add('hidden');
        grid.classList.remove('hidden');
      } else if (mode === 'graph') {
        explorerWrap.classList.remove('hidden');
        graphPanel.classList.remove('hidden');
        treePanel.classList.add('hidden');
        grid.classList.add('hidden');
      } else if (mode === 'tree') {
        explorerWrap.classList.remove('hidden');
        graphPanel.classList.add('hidden');
        treePanel.classList.remove('hidden');
        grid.classList.add('hidden');
      } else {
        // 'split' (Explore All)
        explorerWrap.classList.remove('hidden');
        graphPanel.classList.remove('hidden');
        treePanel.classList.remove('hidden');
        grid.classList.remove('hidden');
      }
    }

    delegateEvent(viewSwitcher, 'click', '.linker-view-btn', (_e, btn) => {
      const mode = btn.dataset.view;
      if (mode) applyViewMode(mode);
    });

    /* ---------- Search & Tag Cluster Filter ---------- */
    function applyFilters() {
      const query = searchInput.value.toLowerCase().trim();
      const tagFilter = activeFilterTag.toLowerCase().trim();
      let visible = 0;

      for (const entry of cardEntries) {
        const text = `${entry.name} ${entry.description} ${entry.synthesis} ${entry.relation} ${entry.target} ${entry.tags}`.toLowerCase();
        const matchesQuery = !query || text.includes(query);
        const matchesTag = !tagFilter || entry.tags.toLowerCase().split(/[,;]+/).some(t => t.trim() === tagFilter);
        const show = matchesQuery && matchesTag;
        entry.card.classList.toggle('hidden', !show);
        if (show) visible++;
      }

      // Highlight matching nodes in the SVG graph & tree
      graphPanel.querySelectorAll('.linker-graph-node').forEach(nodeEl => {
        const key = nodeEl.getAttribute('data-node-key');
        const n = key ? graph.nodeMap.get(key) : null;
        if (!n) return;
        const nText = `${n.name} ${n.description} ${n.synthesis} ${(n.tags || []).join(' ')}`.toLowerCase();
        const matchQ = !query || nText.includes(query);
        const matchT = !tagFilter || (n.tags || []).some(t => t.toLowerCase() === tagFilter);
        nodeEl.classList.toggle('linker-node-dimmed', !(matchQ && matchT));
      });

      const emptyEl = grid.querySelector('.linker-empty-filter');
      if (visible === 0 && (query || tagFilter)) {
        if (!emptyEl) {
          grid.append(el('p', { className: 'empty-state linker-empty-filter' }, [
            `No entries matching "${query || activeFilterTag}".`,
          ]));
        } else {
          emptyEl.textContent = `No entries matching "${query || activeFilterTag}".`;
        }
      } else if (emptyEl) {
        emptyEl.remove();
      }
    }

    searchInput.addEventListener('input', applyFilters);

    delegateEvent(statsBar, 'click', '.linker-filter-pill', (_e, pill) => {
      activeFilterTag = pill.dataset.tag || '';
      renderStatsBar();
      applyFilters();
    });

    /* ---------- Card Actions & Click Navigation ---------- */
    delegateEvent(grid, 'click', '.linker-card-inspect-btn', (e, btn) => {
      e.stopPropagation();
      const key = btn.dataset.nodeKey;
      if (key) selectNode(key);
    });

    delegateEvent(grid, 'click', '.linker-federate-btn', (e, btn) => {
      e.stopPropagation();
      const nodeKey = btn.dataset.nodeKey;
      const sheetId = btn.dataset.sheetId;
      if (nodeKey && sheetId) federateSingleNode(nodeKey, sheetId);
    });

    delegateEvent(grid, 'click', '.linker-card', (e, card) => {
      // Don't navigate if user clicked an editable cell or card action button
      if (e.target.closest('[contenteditable], .editable-cell-input, .editable-cell-textarea, .linker-card-action-btn')) {
        return;
      }
      const id   = card.dataset.sheetId;
      const kind = card.dataset.linkKind;
      if (!id) return;
      navigateToSource(id, kind, card.dataset.entryName || '');
    });

    /* ---------- Initial Render of Explorer Panels ---------- */
    renderStatsBar();
    renderGraphPanel();
    renderTreePanel();
    renderInspectorPanel();
    applyViewMode('split');
  },
};

/* ---------- Directory View ---------- */

definition.directoryView = function(container, sheets, navigateFn) {
  const wrapper = el('div', { className: 'linker-directory tmpl-directory' });
  wrapper.append(el('div', { className: 'linker-dir-title-bar tmpl-dir-title-bar' }, [
    el('span', { className: 'linker-dir-icon tmpl-dir-icon' }, ['🔗']),
    el('span', { className: 'linker-dir-title tmpl-dir-title' }, ['Community Linkers']),
    el('span', { className: 'linker-dir-count tmpl-dir-count' }, [
      `${sheets.length} linker${sheets.length !== 1 ? 's' : ''}`,
    ]),
    buildDirSyncBtn(wrapper),
  ]));

  const grid = el('div', { className: 'linker-dir-grid tmpl-dir-grid' });
  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    grid.append(el('div', {
      className: 'linker-dir-card tmpl-dir-card',
      dataset: { entryId: sheet.id, entryName: sheet.name },
    }, [
      el('div', { className: 'linker-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
      el('div', { className: 'linker-dir-card-stat tmpl-dir-card-stat' }, [
        `${rows.length} entr${rows.length !== 1 ? 'ies' : 'y'}`,
      ]),
    ]));
  }

  delegateEvent(grid, 'click', '.linker-dir-card', (_e, card) => {
    navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
  });

  wrapper.append(grid);
  container.append(wrapper);
};

registerTemplate('linker', definition);
export default definition;
