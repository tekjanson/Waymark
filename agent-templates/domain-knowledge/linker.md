# Community Linker & Knowledge Graph — Domain Knowledge

## What This Template Is
A Knowledge Graph, Linker Tree, and curated Waymark directory where each row represents an entity/node, a Waymark resource, or a federated sub-graph, along with its directed relationships and synthetic understanding.
- `name`: Entity, hub, or resource title.
- `description`: Overview of what the node or resource represents.
- `link`: Waymark Sheet ID, Folder ID, or `#/sheet/{id}` route for direct source-data click-through.
- `type`: Categorizes the node (`waymark`, `linker`, `graph`, `sub-graph`, `concept`, `synthesis`, `folder`).
- `tags`: Comma-separated keywords/clusters used for filtering and semantic hub grouping.
- `icon`: Emoji or symbol identifier.
- `relation`: Directed relationship verb/predicate (e.g. `funded by`, `uses`, `federates`, `curates`, `informs`, `depends on`).
- `target`: Target entity name or target Waymark Sheet ID connected by `relation`.
- `synthesis`: Synthetic understanding, insights, or cross-sheet takeaway explaining how and why these sources connect.

## Smart Operations

### Knowledge Graph & Linker Tree Construction
- **Primary Node Rows**: Populate `name`, `description`, `link`, `type`, `tags`, `icon`, and optionally `relation`, `target`, and `synthesis`.
- **Multi-Edge / Multi-Insight Continuation Rows (§4.7)**: To attach multiple relationships or synthetic insights to the same entity without packing cells with delimiters, leave `name` blank on the following row(s) and populate `relation`, `target`, and/or `synthesis`.
- **Cross-Sheet Federation**: Entries with `type: "linker"` or `type: "graph"` and a `link` pointing to another Waymark spreadsheet act as federated sub-graph hubs that expand inline in the Waymark UI.

### Link Directory
Group all entries by `type`. For each type:
```
{Type} ({N} nodes)
  • {name} — {description}
    Link: {link} | {relation} → {target}
    Synthesis: {synthesis}
```

### Find a Node or Relationship
When asked "find a link for {topic}" or "how does {A} relate to {B}":
- Search `name` (exact then partial)
- Search `description` and `synthesis` (keyword match)
- Search `relation` and `target` (edge traversal)
- Search `tags` (split by comma, match individual tags)
- Return: name, description, link, type, relation, target, synthesis, tags

### Tag Search
Find all entries tagged with {tag}:
- Split `tags` by comma, strip whitespace, match case-insensitively
- Return matching entries with their links and relationships

### Adding a Node or Relationship
Append a row. Required: `name` (or continuation row under an existing node). Optional: `description`, `link`, `type`, `tags`, `icon`, `relation`, `target`, `synthesis`.
Before adding: check for an existing entry with the same `name` or `link` — if adding a new relationship to an existing node, either update the node or append a continuation row.

### Exporting
When asked to export the directory or knowledge graph:
Format as markdown:
```markdown
## {type}
- [{name}]({link}) — {description} (`{relation} → {target}`)
  - 💡 Synthesis: {synthesis}
```

## Interpretation Rules
- `link` should be a valid Waymark reference (`sheet-NNN`, Google Sheet/Folder ID, or `#/sheet/{id}` / `#/folder/{id}`) for direct source click-through
- `tags` is free text — normalize to lowercase for comparison, preserve original case for storage
- `icon` is optional decoration — an emoji (`📄`, `📁`, `🧠`, `💡`, `🌐`)
- `synthesis` stores higher-order synthetic understanding across linked sheets
