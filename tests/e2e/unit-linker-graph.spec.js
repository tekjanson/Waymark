// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ============================================================
   unit-linker-graph.spec.js — Unit tests for Knowledge Graph
   & Federated Linker pure helper functions
   ============================================================ */

test('helpers: extractLink parses valid Waymark references and rejects unsafe URLs', async ({ page }) => {
  await setupApp(page);
  const res = await page.evaluate(async () => {
    const { extractLink } = await import('/js/templates/linker/helpers.js');
    return {
      shortId: extractLink('sheet-058'),
      hashSheet: extractLink('#/sheet/sheet-027'),
      hashPublic: extractLink('#/public/15ETvvXtYwe1ESwOLJQHt34nh4BHLL2JZvfBjImu8Boo'),
      hashFolder: extractLink('#/folder/1SUmmTO4n2Hyuat_oHbt7nrv_6U-FoniC/Knowledge'),
      fullUrl: extractLink('https://swiftirons.com/waymark/#/sheet/15ETvvXtYwe1ESwOLJQHt34nh4BHLL2JZvfBjImu8Boo'),
      rawGoogId: extractLink('15ETvvXtYwe1ESwOLJQHt34nh4BHLL2JZvfBjImu8Boo'),
      externalUrl: extractLink('https://example.com/blog'),
      jsUri: extractLink('javascript:alert(1)'),
      empty: extractLink(''),
      nullVal: extractLink(null),
    };
  });

  expect(res.shortId).toEqual({ id: 'sheet-058', kind: 'sheet' });
  expect(res.hashSheet).toEqual({ id: 'sheet-027', kind: 'sheet' });
  expect(res.hashPublic).toEqual({ id: '15ETvvXtYwe1ESwOLJQHt34nh4BHLL2JZvfBjImu8Boo', kind: 'sheet' });
  expect(res.hashFolder).toEqual({ id: '1SUmmTO4n2Hyuat_oHbt7nrv_6U-FoniC', kind: 'folder' });
  expect(res.fullUrl).toEqual({ id: '15ETvvXtYwe1ESwOLJQHt34nh4BHLL2JZvfBjImu8Boo', kind: 'sheet' });
  expect(res.rawGoogId).toEqual({ id: '15ETvvXtYwe1ESwOLJQHt34nh4BHLL2JZvfBjImu8Boo', kind: 'auto' });
  expect(res.externalUrl).toBeNull();
  expect(res.jsUri).toBeNull();
  expect(res.empty).toBeNull();
  expect(res.nullVal).toBeNull();
});

test('helpers: isLinkerType and classifyNodeType classify node types accurately', async ({ page }) => {
  await setupApp(page);
  const res = await page.evaluate(async () => {
    const { isLinkerType, classifyNodeType } = await import('/js/templates/linker/helpers.js');
    return {
      isLinker: [
        isLinkerType('linker'),
        isLinkerType('graph'),
        isLinkerType('sub-graph'),
        isLinkerType('directory'),
        isLinkerType('waymark'),
        isLinkerType('concept'),
      ],
      kinds: [
        classifyNodeType('linker'),
        classifyNodeType('sub-graph'),
        classifyNodeType('folder'),
        classifyNodeType('concept'),
        classifyNodeType('synthesis'),
        classifyNodeType('source-record'),
        classifyNodeType('waymark'),
        classifyNodeType(''),
      ],
    };
  });

  expect(res.isLinker).toEqual([true, true, true, true, false, false]);
  expect(res.kinds).toEqual([
    'linker', 'linker', 'folder', 'concept', 'synthesis', 'source-record', 'waymark', 'waymark',
  ]);
});

test('helpers: buildKnowledgeGraph builds explicit edges, continuation rows, and tag-cluster edges', async ({ page }) => {
  await setupApp(page);
  const res = await page.evaluate(async () => {
    const { buildKnowledgeGraph } = await import('/js/templates/linker/helpers.js');
    const cols = {
      name: 0, description: 1, link: 2, type: 3, tags: 4, icon: 5,
      relation: 6, target: 7, targetLink: -1, synthesis: 8,
    };
    const rows = [
      ['Engineering Hub', 'Root engineering graph', 'sheet-081', 'linker', 'tech, agents', '🕸️', 'federates', 'Dev Workboard', 'Synthesizes agent and kanban workflows'],
      ['', '', '', '', '', '', 'governs', 'Architecture Spec', 'Secondary continuation relationship'],
      ['Dev Workboard', 'Kanban board', 'sheet-028', 'waymark', 'tech, kanban', '📋', '', '', 'Tracks daily sprints'],
      ['Independent Tool', 'Standalone tool sharing tech tag', 'sheet-010', 'waymark', 'tech', '🔧', '', '', ''],
    ];
    const graph = buildKnowledgeGraph(rows, cols);
    return {
      entryCount: graph.entries.length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      hubInsights: graph.nodeMap.get('engineering hub')?.insights,
      edgeRelations: graph.edges.map(e => `${e.fromName} --[${e.relation}]--> ${e.toName}`),
    };
  });

  // 3 primary entries, 4 nodes (including virtual 'Architecture Spec' target node)
  expect(res.entryCount).toBe(3);
  expect(res.nodeCount).toBe(4);
  expect(res.hubInsights).toEqual([
    'Synthesizes agent and kanban workflows',
    'Secondary continuation relationship',
  ]);
  expect(res.edgeRelations).toContain('Engineering Hub --[federates]--> Dev Workboard');
  expect(res.edgeRelations).toContain('Engineering Hub --[governs]--> Architecture Spec');
  expect(res.edgeRelations).toContain('Engineering Hub --[topic: tech]--> Independent Tool');
});

test('helpers: mergeFederatedSheet merges both remote Linker graphs and generic Waymark sheets', async ({ page }) => {
  await setupApp(page);
  const res = await page.evaluate(async () => {
    const linkerDef = (await import('/js/templates/linker.js')).default;
    const { buildKnowledgeGraph, mergeFederatedSheet } = await import('/js/templates/linker/helpers.js');

    const cols = linkerDef.columns(['name', 'description', 'link', 'type', 'tags', 'icon', 'relation', 'target', 'synthesis']);
    const baseGraph = buildKnowledgeGraph([
      ['Sub-Graph Hub', 'Links to remote graph', 'sheet-081', 'linker', 'agents', '🕸️', '', '', ''],
      ['Recipe Sheet', 'Links to recipe waymark', 'sheet-027', 'waymark', 'cooking', '🍳', '', '', ''],
    ], cols);

    // 1. Merge remote Linker sheet
    const remoteLinker = {
      id: 'sheet-081',
      title: 'Remote Sub-Graph',
      values: [
        ['Name', 'Description', 'Link', 'Type', 'Tags', 'Icon', 'Relation', 'Target', 'Synthesis'],
        ['Remote Node A', 'First remote node', 'sheet-057', 'waymark', 'agents', '🤖', 'monitors', 'Remote Node B', 'Remote insight'],
        ['Remote Node B', 'Second remote node', 'sheet-047', 'waymark', 'iot', '📡', '', '', ''],
      ],
    };
    const m1 = mergeFederatedSheet(baseGraph, remoteLinker, 'sub-graph hub', h => linkerDef.detect(h), h => linkerDef.columns(h));

    // 2. Merge generic source sheet (e.g. Recipe or Kanban)
    const remoteGeneric = {
      id: 'sheet-027',
      title: 'Family Recipes',
      values: [
        ['Recipe', 'Category', 'Servings'],
        ['GF Pancakes', 'Breakfast', '4'],
        ['DF Lasagna', 'Dinner', '6'],
      ],
    };
    const m2 = mergeFederatedSheet(baseGraph, remoteGeneric, 'recipe sheet', h => linkerDef.detect(h), h => linkerDef.columns(h));

    return {
      m1AddedNodes: m1.addedNodes.length,
      m2AddedNodes: m2.addedNodes.length,
      totalNodes: baseGraph.nodes.length,
      federatedCount: baseGraph.nodes.filter(n => n.federated).length,
    };
  });

  expect(res.m1AddedNodes).toBe(2);
  expect(res.m2AddedNodes).toBe(2);
  expect(res.totalNodes).toBe(6);
  expect(res.federatedCount).toBe(4);
});

test('helpers: computeGraphLayout, buildLinkerTree, and findNeighborhood handle cycles and overrides', async ({ page }) => {
  await setupApp(page);
  const res = await page.evaluate(async () => {
    const {
      buildKnowledgeGraph,
      computeGraphLayout,
      buildLinkerTree,
      findNeighborhood,
    } = await import('/js/templates/linker/helpers.js');

    const cols = {
      name: 0, description: 1, link: 2, type: 3, tags: 4, icon: 5,
      relation: 6, target: 7, targetLink: -1, synthesis: 8,
    };
    // Cyclic graph: Node A -> Node B -> Node A
    const graph = buildKnowledgeGraph([
      ['Node A', 'Root', 'sheet-001', 'linker', '', '📁', 'calls', 'Node B', 'A calls B'],
      ['Node B', 'Child', 'sheet-002', 'waymark', '', '📄', 'callbacks', 'Node A', 'B callbacks A'],
    ], cols);

    const overrides = new Map([['node a', { x: 120, y: 80 }]]);
    const layout = computeGraphLayout(graph.nodes, graph.edges, overrides);
    const tree = buildLinkerTree(graph.nodes, graph.edges);
    const hood = findNeighborhood(graph.nodes, graph.edges, 'node a');

    const nodeAPos = layout.nodes.find(n => n.key === 'node a');
    const cycleChild = tree[0]?.children?.[0]?.children?.[0];

    return {
      layoutWidth: layout.width,
      nodeAX: nodeAPos?.x,
      nodeAY: nodeAPos?.y,
      edgeCount: layout.edges.length,
      treeRootName: tree[0]?.node?.name,
      hasCycleGuard: Boolean(cycleChild?.isCycleRef),
      inboundCount: hood.inbound.length,
      outboundCount: hood.outbound.length,
    };
  });

  expect(res.layoutWidth).toBeGreaterThanOrEqual(760);
  expect(res.nodeAX).toBe(120);
  expect(res.nodeAY).toBe(80);
  expect(res.edgeCount).toBe(2);
  expect(res.treeRootName).toBe('Node A');
  expect(res.hasCycleGuard).toBe(true);
  expect(res.inboundCount).toBe(1);
  expect(res.outboundCount).toBe(1);
});
