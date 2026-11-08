/* ============================================================
   templates/linker/helpers.js — Pure helpers for the Knowledge
   Graph & Federated Community Linker template
   ============================================================ */

import { cell } from '../shared.js';

/* ---------- Constants & Regexes ---------- */

/** Google Sheets/Drive ID pattern — 20-60 chars of alphanumeric, hyphen, underscore */
export const GOOG_ID_RE = /^[a-zA-Z0-9_-]{20,60}$/;

/** Short Waymark-style ID (e.g. sheet-058) */
export const SHORT_ID_RE = /^sheet-\d{1,5}$/;

/** Default icons by node category */
export const DEFAULT_WAYMARK_ICON = '📄';
export const DEFAULT_LINKER_ICON = '📁';
export const DEFAULT_CONCEPT_ICON = '🧠';
export const DEFAULT_SYNTHESIS_ICON = '💡';
export const DEFAULT_FEDERATED_ICON = '🌐';

/** Node dimensions for SVG graph layout */
export const GRAPH_NODE_W = 180;
export const GRAPH_NODE_H = 58;

/* ---------- Link & Type Parsing ---------- */

/**
 * Extract a Waymark link from a cell value.
 *
 * SECURITY: Only accepts Waymark-internal references:
 *   - Raw Google IDs (20-60 alphanumeric chars)
 *   - Short fixture IDs (sheet-NNN)
 *   - Waymark hash routes (#/sheet/{id}, #/public/{id}, #/folder/{id}, #/folder/{id}/{name})
 *   - Full Waymark URLs with the above hash routes
 *
 * Rejects external URLs without a Waymark hash route,
 * javascript: / data: URIs, and Google Sheets URLs.
 *
 * @param {string} raw
 * @returns {{ id: string, kind: 'sheet'|'folder'|'auto' }|null}
 */
export function extractLink(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept short Waymark fixture IDs (always sheets)
  if (SHORT_ID_RE.test(trimmed)) return { id: trimmed, kind: 'sheet' };
  // Accept bare Waymark hash-route references — detect kind from the route
  const bareSheet = trimmed.match(/^#\/(?:public|sheet)\/([a-zA-Z0-9_-]{3,60})$/);
  if (bareSheet) return { id: bareSheet[1], kind: 'sheet' };
  const bareFolder = trimmed.match(/^#\/folder\/([a-zA-Z0-9_-]{3,60})(?:\/.*)?$/);
  if (bareFolder) return { id: bareFolder[1], kind: 'folder' };
  // Accept full Waymark URLs that contain a hash route — only allow http(s):
  if (/^https?:\/\//i.test(trimmed)) {
    const hashSheet = trimmed.match(/#\/(?:public|sheet)\/([a-zA-Z0-9_-]{3,60})(?:[?#]|$)/);
    if (hashSheet) return { id: hashSheet[1], kind: 'sheet' };
    const hashFolder = trimmed.match(/#\/folder\/([a-zA-Z0-9_-]{3,60})(?:\/[^?#]*)?(?:[?#]|$)/);
    if (hashFolder) return { id: hashFolder[1], kind: 'folder' };
  }
  // Accept raw Google IDs (kind is ambiguous — caller uses the type column)
  if (GOOG_ID_RE.test(trimmed)) return { id: trimmed, kind: 'auto' };
  return null;
}

/**
 * Determine if a type cell indicates a linker / directory / sub-graph hub.
 * @param {string} val
 * @returns {boolean}
 */
export function isLinkerType(val) {
  return /^(linker|directory|hub|group|sub|folder|community|graph|sub-?graph|knowledge-?graph|federated)$/i.test((val || '').trim());
}

/**
 * Classify a raw type string into a semantic knowledge graph node category.
 * @param {string} val
 * @returns {'linker'|'folder'|'concept'|'synthesis'|'source-record'|'waymark'}
 */
export function classifyNodeType(val) {
  const clean = (val || '').trim().toLowerCase();
  if (/^(folder)$/.test(clean)) return 'folder';
  if (/^(linker|directory|hub|group|sub|community|graph|sub-?graph|knowledge-?graph|federated)$/.test(clean)) return 'linker';
  if (/^(concept|topic|idea|theme|domain|cluster|entity)$/.test(clean)) return 'concept';
  if (/^(synthesis|insight|summary|conclusion|finding|understanding)$/.test(clean)) return 'synthesis';
  if (/^(source-?record|record|row|item)$/.test(clean)) return 'source-record';
  return 'waymark';
}

/**
 * Normalize a node name or identifier into a canonical lookup key.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeNodeKey(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Pick a default icon for a node category when none is specified in the sheet.
 * @param {string} nodeKind
 * @param {boolean} isLinker
 * @returns {string}
 */
export function defaultIconForKind(nodeKind, isLinker) {
  if (isLinker || nodeKind === 'linker' || nodeKind === 'folder') return DEFAULT_LINKER_ICON;
  if (nodeKind === 'concept') return DEFAULT_CONCEPT_ICON;
  if (nodeKind === 'synthesis') return DEFAULT_SYNTHESIS_ICON;
  if (nodeKind === 'source-record') return '📌';
  return DEFAULT_WAYMARK_ICON;
}

/* ---------- Knowledge Graph Builder ---------- */

/**
 * Build a Knowledge Graph (nodes, edges, and primary card entries) from sheet rows.
 * Supports:
 *   1. Classic Linker rows (Name, Description, Link, Type, Tags, Icon)
 *   2. Extended Knowledge Graph rows (+ Relation, Target, TargetLink, Synthesis)
 *   3. Row-per-item continuation rows (§4.7): empty Name with Relation/Target/Synthesis
 *      adds edges and synthetic insights to the preceding entity node
 *   4. Semantic tag-cluster edges linking Directory/Hub nodes to matching Waymark nodes
 *
 * @param {string[][]} rows
 * @param {Object} cols
 * @param {Object} [opts]
 * @param {string|null} [opts.sourceSheetId]
 * @param {string} [opts.sourceSheetTitle]
 * @param {boolean} [opts.federated]
 * @returns {{
 *   entries: Array<Object>,
 *   nodes: Array<Object>,
 *   edges: Array<Object>,
 *   nodeMap: Map<string, Object>
 * }}
 */
export function buildKnowledgeGraph(rows, cols, opts = {}) {
  const sourceSheetId = opts.sourceSheetId || null;
  const sourceSheetTitle = opts.sourceSheetTitle || '';
  const isFederated = Boolean(opts.federated);

  const entries = [];
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const linkIdToNode = new Map();

  let currentPrimaryNode = null;
  const pendingRelations = [];

  for (let i = 0; i < (rows || []).length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const rawName       = cell(row, cols.name).trim();
    const rawLink       = cell(row, cols.link).trim();
    const rawType       = cell(row, cols.type).trim();
    const description   = cell(row, cols.description).trim();
    const tagsRaw       = cell(row, cols.tags).trim();
    const iconVal       = cell(row, cols.icon).trim();
    const relation      = cols.relation >= 0 ? cell(row, cols.relation).trim() : '';
    const target        = cols.target >= 0 ? cell(row, cols.target).trim() : '';
    const targetLinkRaw = cols.targetLink >= 0 ? cell(row, cols.targetLink).trim() : '';
    const synthesis     = cols.synthesis >= 0 ? cell(row, cols.synthesis).trim() : '';
    const rowIdx        = i + 1;

    // Fallback name for MCP triple sheets where From_Title might be blank but From_ID is present
    const effectiveName = rawName || (cols.relation >= 0 && rawLink ? rawLink : '');

    if (!effectiveName) {
      // §4.7 Continuation row: attach additional relation or synthetic insight to currentPrimaryNode
      if (currentPrimaryNode && (relation || target || synthesis)) {
        if (synthesis && !currentPrimaryNode.insights.includes(synthesis)) {
          currentPrimaryNode.insights.push(synthesis);
          if (!currentPrimaryNode.synthesis) currentPrimaryNode.synthesis = synthesis;
        }
        if (target || targetLinkRaw) {
          pendingRelations.push({
            fromNode: currentPrimaryNode,
            relation: relation || 'relates to',
            targetName: target || targetLinkRaw,
            targetLinkRaw,
            synthesis,
            rowIdx,
          });
        }
      }
      continue;
    }

    const link = extractLink(rawLink);
    const isLinker = isLinkerType(rawType);
    const nodeKind = classifyNodeType(rawType);
    const linkId = link ? link.id : '';
    const linkKind = link
      ? (link.kind === 'auto' ? (nodeKind === 'folder' || isLinker ? (rawType.toLowerCase() === 'folder' ? 'folder' : 'sheet') : 'sheet') : link.kind)
      : '';
    const icon = iconVal || defaultIconForKind(nodeKind, isLinker);
    const tagList = tagsRaw ? tagsRaw.split(/[,;]+/).map(t => t.trim()).filter(Boolean) : [];

    const baseKey = normalizeNodeKey(effectiveName);
    const nodeKey = isFederated && sourceSheetId ? `${sourceSheetId}::${baseKey}` : baseKey;

    let node = nodeMap.get(nodeKey);
    if (!node) {
      node = {
        key: nodeKey,
        baseKey,
        name: effectiveName,
        description,
        synthesis: synthesis || '',
        insights: synthesis ? [synthesis] : [],
        rawLink,
        linkId,
        linkKind,
        isValidLink: Boolean(linkId || !rawLink),
        type: rawType || 'waymark',
        nodeKind,
        isLinker,
        tags: tagList,
        icon,
        rowIdx,
        sourceSheetId,
        sourceSheetTitle,
        federated: isFederated,
        relations: [],
      };
      nodeMap.set(nodeKey, node);
      nodes.push(node);
      if (linkId && !linkIdToNode.has(linkId)) {
        linkIdToNode.set(linkId, node);
      }
    } else {
      // Enrich existing node if multiple rows share the same subject entity
      if (!node.description && description) node.description = description;
      if (synthesis && !node.insights.includes(synthesis)) {
        node.insights.push(synthesis);
        if (!node.synthesis) node.synthesis = synthesis;
      }
      if (!node.linkId && linkId) {
        node.linkId = linkId;
        node.linkKind = linkKind;
        node.rawLink = rawLink;
        linkIdToNode.set(linkId, node);
      }
      for (const t of tagList) {
        if (!node.tags.includes(t)) node.tags.push(t);
      }
    }

    currentPrimaryNode = node;

    const entryRecord = {
      name: effectiveName,
      description,
      synthesis,
      rawLink,
      linkId,
      linkKind,
      type: rawType,
      nodeKind,
      isLinker,
      tags: tagsRaw,
      tagList,
      icon,
      relation,
      target,
      targetLinkRaw,
      rowIdx,
      nodeKey: node.key,
      node,
    };
    entries.push(entryRecord);

    if (target || targetLinkRaw) {
      pendingRelations.push({
        fromNode: node,
        relation: relation || 'links to',
        targetName: target || targetLinkRaw,
        targetLinkRaw,
        synthesis: synthesis || description,
        rowIdx,
      });
    }
  }

  /* ---------- Resolve Explicit Directed Edges ---------- */
  for (const rel of pendingRelations) {
    const targetLinkParsed = extractLink(rel.targetLinkRaw || rel.targetName);
    const targetLinkId = targetLinkParsed ? targetLinkParsed.id : '';
    const targetLinkKind = targetLinkParsed
      ? (targetLinkParsed.kind === 'auto' ? 'sheet' : targetLinkParsed.kind)
      : '';

    const rawTargetKey = normalizeNodeKey(rel.targetName);
    const scopedTargetKey = isFederated && sourceSheetId ? `${sourceSheetId}::${rawTargetKey}` : rawTargetKey;

    let targetNode = nodeMap.get(scopedTargetKey)
      || nodeMap.get(rawTargetKey)
      || (targetLinkId ? linkIdToNode.get(targetLinkId) : null);

    if (!targetNode) {
      // Create a target node so the graph renders the full relationship and allows click-through
      const displayTarget = rel.targetName || targetLinkId || 'Linked Entity';
      const newKey = scopedTargetKey || `target::${edges.length}`;
      targetNode = {
        key: newKey,
        baseKey: rawTargetKey || newKey,
        name: displayTarget,
        description: rel.synthesis || '',
        synthesis: rel.synthesis || '',
        insights: rel.synthesis ? [rel.synthesis] : [],
        rawLink: rel.targetLinkRaw || (targetLinkId ? `#/sheet/${targetLinkId}` : ''),
        linkId: targetLinkId,
        linkKind: targetLinkKind,
        isValidLink: true,
        type: targetLinkId ? 'waymark' : 'concept',
        nodeKind: targetLinkId ? 'waymark' : 'concept',
        isLinker: false,
        tags: [],
        icon: targetLinkId ? DEFAULT_WAYMARK_ICON : DEFAULT_CONCEPT_ICON,
        rowIdx: rel.rowIdx,
        sourceSheetId,
        sourceSheetTitle,
        federated: isFederated,
        relations: [],
      };
      nodeMap.set(newKey, targetNode);
      nodes.push(targetNode);
      if (targetLinkId && !linkIdToNode.has(targetLinkId)) {
        linkIdToNode.set(targetLinkId, targetNode);
      }
    }

    if (targetNode.key === rel.fromNode.key) continue;

    const edgeId = `${rel.fromNode.key}--${rel.relation}-->${targetNode.key}`;
    if (!edges.some(e => e.id === edgeId)) {
      const edgeObj = {
        id: edgeId,
        from: rel.fromNode.key,
        to: targetNode.key,
        fromName: rel.fromNode.name,
        toName: targetNode.name,
        relation: rel.relation || 'links to',
        synthesis: rel.synthesis || '',
        kind: 'explicit',
        rowIdx: rel.rowIdx,
      };
      edges.push(edgeObj);
      rel.fromNode.relations.push({
        direction: 'out',
        relation: edgeObj.relation,
        targetKey: targetNode.key,
        targetName: targetNode.name,
        targetLinkId: targetNode.linkId,
        targetLinkKind: targetNode.linkKind,
      });
      targetNode.relations.push({
        direction: 'in',
        relation: edgeObj.relation,
        targetKey: rel.fromNode.key,
        targetName: rel.fromNode.name,
        targetLinkId: rel.fromNode.linkId,
        targetLinkKind: rel.fromNode.linkKind,
      });
    }
  }

  /* ---------- Infer Semantic Hub -> Member Edges by Shared Tags ---------- */
  const hubNodes = nodes.filter(n => n.isLinker && n.tags.length > 0);
  const nonHubNodes = nodes.filter(n => !n.isLinker && n.tags.length > 0);

  for (const hub of hubNodes) {
    const hubTagsLower = new Set(hub.tags.map(t => t.toLowerCase()));
    for (const item of nonHubNodes) {
      // Skip if an explicit edge already connects them
      const alreadyConnected = edges.some(
        e => (e.from === hub.key && e.to === item.key) || (e.from === item.key && e.to === hub.key)
      );
      if (alreadyConnected) continue;

      const sharedTag = item.tags.find(t => hubTagsLower.has(t.toLowerCase()));
      if (sharedTag) {
        const edgeId = `${hub.key}--curates:${sharedTag.toLowerCase()}-->${item.key}`;
        edges.push({
          id: edgeId,
          from: hub.key,
          to: item.key,
          fromName: hub.name,
          toName: item.name,
          relation: `topic: ${sharedTag}`,
          synthesis: `Connected via shared '${sharedTag}' domain cluster`,
          kind: 'tag-cluster',
          rowIdx: item.rowIdx,
        });
        hub.relations.push({
          direction: 'out',
          relation: `topic: ${sharedTag}`,
          targetKey: item.key,
          targetName: item.name,
          targetLinkId: item.linkId,
          targetLinkKind: item.linkKind,
          inferred: true,
        });
        item.relations.push({
          direction: 'in',
          relation: `topic: ${sharedTag}`,
          targetKey: hub.key,
          targetName: hub.name,
          targetLinkId: hub.linkId,
          targetLinkKind: hub.linkKind,
          inferred: true,
        });
      }
    }
  }

  return { entries, nodes, edges, nodeMap };
}

/* ---------- Cross-Sheet Knowledge Graph Federation ---------- */

/**
 * Merge a remote sheet's data into an existing Knowledge Graph under `parentNodeKey`.
 * Supports federating both:
 *   - Remote Linker / Knowledge Graph sheets (recursive graph & synthetic understanding merge)
 *   - Source Waymark sheets of any template type (extracting live source entities as child nodes)
 *
 * @param {{ nodes: Array<Object>, edges: Array<Object>, nodeMap: Map<string, Object> }} baseGraph
 * @param {{ id: string, title?: string, values?: string[][], tabs?: Array<{title:string, values:string[][]}> }} remoteData
 * @param {string} parentNodeKey
 * @param {(lower: string[]) => boolean} detectLinkerFn
 * @param {(lower: string[]) => Object} columnsLinkerFn
 * @returns {{ addedNodes: Array<Object>, addedEdges: Array<Object>, sheetId: string, sheetTitle: string }}
 */
export function mergeFederatedSheet(baseGraph, remoteData, parentNodeKey, detectLinkerFn, columnsLinkerFn) {
  const addedNodes = [];
  const addedEdges = [];
  if (!baseGraph || !remoteData) {
    return { addedNodes, addedEdges, sheetId: '', sheetTitle: '' };
  }

  const parentNode = baseGraph.nodeMap.get(parentNodeKey);
  if (!parentNode) {
    return { addedNodes, addedEdges, sheetId: remoteData.id || '', sheetTitle: remoteData.title || '' };
  }

  const sheetId = remoteData.id || parentNode.linkId || 'federated-sheet';
  const sheetTitle = remoteData.title || parentNode.name || sheetId;
  const rawValues = (Array.isArray(remoteData.values) && remoteData.values.length > 0)
    ? remoteData.values
    : (remoteData.tabs?.[0]?.values || []);

  if (rawValues.length < 2) {
    return { addedNodes, addedEdges, sheetId, sheetTitle };
  }

  const headers = rawValues[0].map(h => String(h || '').toLowerCase().trim());
  const dataRows = rawValues.slice(1);
  const isRemoteLinker = typeof detectLinkerFn === 'function' && detectLinkerFn(headers);

  if (isRemoteLinker && typeof columnsLinkerFn === 'function') {
    const remoteCols = columnsLinkerFn(headers);
    const subGraph = buildKnowledgeGraph(dataRows, remoteCols, {
      sourceSheetId: sheetId,
      sourceSheetTitle: sheetTitle,
      federated: true,
    });

    const subTargets = new Set(subGraph.edges.map(e => e.to));

    for (const subNode of subGraph.nodes) {
      if (!baseGraph.nodeMap.has(subNode.key)) {
        baseGraph.nodeMap.set(subNode.key, subNode);
        baseGraph.nodes.push(subNode);
        addedNodes.push(subNode);
      }
      // Connect top-level nodes of the federated sub-graph to the parent linker node
      if (!subTargets.has(subNode.key)) {
        const fedEdgeId = `${parentNode.key}--federates-->${subNode.key}`;
        if (!baseGraph.edges.some(e => e.id === fedEdgeId)) {
          const edgeObj = {
            id: fedEdgeId,
            from: parentNode.key,
            to: subNode.key,
            fromName: parentNode.name,
            toName: subNode.name,
            relation: 'federates',
            synthesis: `Federated from ${sheetTitle}`,
            kind: 'federated',
            rowIdx: subNode.rowIdx,
          };
          baseGraph.edges.push(edgeObj);
          addedEdges.push(edgeObj);
          parentNode.relations.push({
            direction: 'out',
            relation: 'federates',
            targetKey: subNode.key,
            targetName: subNode.name,
            targetLinkId: subNode.linkId || sheetId,
            targetLinkKind: subNode.linkKind || 'sheet',
          });
          subNode.relations.push({
            direction: 'in',
            relation: 'federates',
            targetKey: parentNode.key,
            targetName: parentNode.name,
            targetLinkId: parentNode.linkId,
            targetLinkKind: parentNode.linkKind,
          });
        }
      }
    }

    for (const subEdge of subGraph.edges) {
      if (!baseGraph.edges.some(e => e.id === subEdge.id)) {
        baseGraph.edges.push(subEdge);
        addedEdges.push(subEdge);
      }
    }
  } else {
    // Source Waymark sheet of another template type: extract primary entities as federated source nodes
    const titleColIdx = headers.findIndex(h => /^(name|title|recipe|task|item|post|game|job|goal|objective|company|sensor|step|entry|student|activity|habit|site)/.test(h));
    const primaryIdx = titleColIdx >= 0 ? titleColIdx : 0;
    const descIdx = headers.findIndex((h, i) => i !== primaryIdx && /^(description|desc|category|stage|status|topic|platform|notes?|takeaway|summary|role|type)/.test(h));

    let count = 0;
    const maxEntities = 8;
    for (let r = 0; r < dataRows.length && count < maxEntities; r++) {
      const row = dataRows[r];
      const entityName = cell(row, primaryIdx).trim();
      if (!entityName) continue;
      const entityDesc = descIdx >= 0 ? cell(row, descIdx).trim() : '';
      const nodeKey = `${sheetId}::row-${r + 1}::${normalizeNodeKey(entityName)}`;
      if (baseGraph.nodeMap.has(nodeKey)) continue;

      const sourceNode = {
        key: nodeKey,
        baseKey: normalizeNodeKey(entityName),
        name: entityName,
        description: entityDesc ? `${entityDesc} (in ${sheetTitle})` : `Source record in ${sheetTitle}`,
        synthesis: entityDesc ? `Source data (${ headers[descIdx] || 'detail' }: ${entityDesc}) from ${sheetTitle}` : `Source record in ${sheetTitle}`,
        insights: entityDesc ? [`${headers[descIdx] || 'Detail'}: ${entityDesc}`] : [],
        rawLink: `#/sheet/${sheetId}`,
        linkId: sheetId,
        linkKind: 'sheet',
        isValidLink: true,
        type: 'source-record',
        nodeKind: 'source-record',
        isLinker: false,
        tags: [sheetTitle],
        icon: '📌',
        rowIdx: r + 1,
        sourceSheetId: sheetId,
        sourceSheetTitle: sheetTitle,
        federated: true,
        relations: [],
      };
      baseGraph.nodeMap.set(nodeKey, sourceNode);
      baseGraph.nodes.push(sourceNode);
      addedNodes.push(sourceNode);

      const edgeId = `${parentNode.key}--source-->${sourceNode.key}`;
      const edgeObj = {
        id: edgeId,
        from: parentNode.key,
        to: sourceNode.key,
        fromName: parentNode.name,
        toName: sourceNode.name,
        relation: 'contains',
        synthesis: `Source record in ${sheetTitle}`,
        kind: 'federated',
        rowIdx: r + 1,
      };
      baseGraph.edges.push(edgeObj);
      addedEdges.push(edgeObj);

      parentNode.relations.push({
        direction: 'out',
        relation: 'contains',
        targetKey: sourceNode.key,
        targetName: sourceNode.name,
        targetLinkId: sheetId,
        targetLinkKind: 'sheet',
      });
      sourceNode.relations.push({
        direction: 'in',
        relation: 'contains',
        targetKey: parentNode.key,
        targetName: parentNode.name,
        targetLinkId: parentNode.linkId,
        targetLinkKind: parentNode.linkKind,
      });
      count++;
    }
  }

  return { addedNodes, addedEdges, sheetId, sheetTitle };
}

/* ---------- Graph Layout & Tree Builders ---------- */

/**
 * Compute deterministic 2D coordinates for rendering the Knowledge Graph SVG.
 * Organizes nodes into semantic tiers (Hubs/Roots -> Primary Entities -> Federated/Leaf Nodes)
 * while respecting any user-dragged position overrides.
 *
 * @param {Array<Object>} nodes
 * @param {Array<Object>} edges
 * @param {Map<string, {x: number, y: number}>} [positionOverrides]
 * @returns {{ width: number, height: number, nodes: Array<Object>, edges: Array<Object> }}
 */
export function computeGraphLayout(nodes, edges, positionOverrides = new Map()) {
  if (!nodes || nodes.length === 0) {
    return { width: 800, height: 320, nodes: [], edges: [] };
  }

  const inDegree = new Map();
  const outDegree = new Map();
  for (const n of nodes) {
    inDegree.set(n.key, 0);
    outDegree.set(n.key, 0);
  }
  for (const e of edges) {
    outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  // Partition nodes into 3 horizontal tiers:
  // Tier 0: Linker hubs or root subjects (inDegree === 0 and outDegree > 0)
  // Tier 1: Connected primary entities & waymarks (non-federated)
  // Tier 2: Federated nodes or pure leaf targets
  const tier0 = [];
  const tier1 = [];
  const tier2 = [];

  for (const n of nodes) {
    if (n.federated) {
      tier2.push(n);
    } else if (n.isLinker || (inDegree.get(n.key) === 0 && (outDegree.get(n.key) || 0) > 0)) {
      tier0.push(n);
    } else if ((inDegree.get(n.key) || 0) > 0 && (outDegree.get(n.key) || 0) === 0 && tier0.length > 0) {
      tier1.push(n);
    } else {
      tier1.push(n);
    }
  }

  // If tier0 is empty, promote first half of tier1 so graph has multi-row depth
  if (tier0.length === 0 && tier1.length > 1) {
    const split = Math.ceil(tier1.length / 2);
    tier0.push(...tier1.splice(0, split));
  }

  const activeTiers = [tier0, tier1, tier2].filter(t => t.length > 0);
  const maxColsPerRow = 5;
  const colGap = 220;
  const rowGap = 115;
  const padX = 40;
  const padY = 36;

  // Sub-wrap long tiers into visual rows
  const visualRows = [];
  for (const tier of activeTiers) {
    for (let i = 0; i < tier.length; i += maxColsPerRow) {
      visualRows.push(tier.slice(i, i + maxColsPerRow));
    }
  }

  const maxRowCols = Math.max(1, ...visualRows.map(r => r.length));
  const width = Math.max(760, padX * 2 + maxRowCols * colGap);
  const height = Math.max(280, padY * 2 + visualRows.length * rowGap);

  const positionedByKey = new Map();
  const positionedNodes = [];

  visualRows.forEach((rowNodes, rIdx) => {
    const rowWidth = rowNodes.length * colGap;
    const startX = Math.max(padX, Math.round((width - rowWidth) / 2) + 20);
    const y = padY + rIdx * rowGap;

    rowNodes.forEach((node, cIdx) => {
      const override = positionOverrides.get(node.key);
      const x = override ? override.x : startX + cIdx * colGap;
      const ny = override ? override.y : y;
      const positioned = {
        ...node,
        x,
        y: ny,
        w: GRAPH_NODE_W,
        h: GRAPH_NODE_H,
        inCount: inDegree.get(node.key) || 0,
        outCount: outDegree.get(node.key) || 0,
      };
      positionedByKey.set(node.key, positioned);
      positionedNodes.push(positioned);
    });
  });

  const positionedEdges = [];
  for (const edge of edges) {
    const fromNode = positionedByKey.get(edge.from);
    const toNode = positionedByKey.get(edge.to);
    if (!fromNode || !toNode) continue;

    const x1 = fromNode.x + fromNode.w / 2;
    const y1 = fromNode.y + fromNode.h / 2;
    const x2 = toNode.x + toNode.w / 2;
    const y2 = toNode.y + toNode.h / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const cx = (x1 + x2) / 2 - dy * 0.12;
    const cy = (y1 + y2) / 2 + dx * 0.08;

    positionedEdges.push({
      ...edge,
      x1,
      y1,
      x2,
      y2,
      cx: Math.round(cx),
      cy: Math.round(cy),
      lx: Math.round(0.25 * x1 + 0.5 * cx + 0.25 * x2),
      ly: Math.round(0.25 * y1 + 0.5 * cy + 0.25 * y2),
    });
  }

  return { width, height, nodes: positionedNodes, edges: positionedEdges };
}

/**
 * Build a hierarchical Linker Tree structure from Knowledge Graph nodes and edges.
 * Cycle-safe: tracks visited nodes along each ancestor path.
 *
 * @param {Array<Object>} nodes
 * @param {Array<Object>} edges
 * @returns {Array<{ node: Object, relationFromParent: string, children: Array<Object>, isCycleRef?: boolean }>}
 */
export function buildLinkerTree(nodes, edges) {
  if (!nodes || nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map(n => [n.key, n]));
  const outMap = new Map();
  const inCount = new Map(nodes.map(n => [n.key, 0]));

  for (const e of edges) {
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from).push(e);
    inCount.set(e.to, (inCount.get(e.to) || 0) + 1);
  }

  // Root candidates: hubs (`isLinker` without incoming explicit/federated edges) or nodes with inCount === 0
  let roots = nodes.filter(n => !n.federated && (inCount.get(n.key) === 0 || (n.isLinker && !edges.some(e => e.to === n.key && e.kind !== 'tag-cluster'))));
  if (roots.length === 0) {
    roots = [nodes[0]];
  }

  const globallyVisited = new Set();

  function buildBranch(node, relationFromParent, ancestorPath) {
    globallyVisited.add(node.key);
    const outEdges = outMap.get(node.key) || [];
    const children = [];

    for (const edge of outEdges) {
      const childNode = nodeMap.get(edge.to);
      if (!childNode) continue;
      if (ancestorPath.has(childNode.key)) {
        children.push({
          node: childNode,
          relationFromParent: edge.relation,
          edgeKind: edge.kind,
          children: [],
          isCycleRef: true,
        });
        continue;
      }
      const nextAncestors = new Set(ancestorPath);
      nextAncestors.add(childNode.key);
      children.push(buildBranch(childNode, edge.relation, nextAncestors));
    }

    return {
      node,
      relationFromParent,
      children,
      isCycleRef: false,
    };
  }

  const tree = [];
  for (const r of roots) {
    if (globallyVisited.has(r.key) && roots.length > 1) continue;
    tree.push(buildBranch(r, '', new Set([r.key])));
  }

  // Ensure any disconnected components are still included in the tree
  for (const n of nodes) {
    if (!globallyVisited.has(n.key)) {
      tree.push(buildBranch(n, '', new Set([n.key])));
    }
  }

  return tree;
}

/**
 * Find the connected neighborhood (nodes and edges) around a focal node key.
 * @param {Array<Object>} nodes
 * @param {Array<Object>} edges
 * @param {string} focalKey
 * @returns {{ activeNodeKeys: Set<string>, activeEdgeIds: Set<string>, inbound: Array<Object>, outbound: Array<Object> }}
 */
export function findNeighborhood(nodes, edges, focalKey) {
  const activeNodeKeys = new Set();
  const activeEdgeIds = new Set();
  const inbound = [];
  const outbound = [];

  if (!focalKey) return { activeNodeKeys, activeEdgeIds, inbound, outbound };
  activeNodeKeys.add(focalKey);

  for (const edge of edges) {
    if (edge.from === focalKey) {
      activeEdgeIds.add(edge.id);
      activeNodeKeys.add(edge.to);
      outbound.push(edge);
    } else if (edge.to === focalKey) {
      activeEdgeIds.add(edge.id);
      activeNodeKeys.add(edge.from);
      inbound.push(edge);
    }
  }

  return { activeNodeKeys, activeEdgeIds, inbound, outbound };
}
