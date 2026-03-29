# Kanban Board Template — Manual QA & UX Test Report

**Sheet:** Product Roadmap  
**Template:** Kanban Board (📋)  
**URL:** `https://swiftirons.com/waymark/#/sheet/1Kls7SH20tCVBpO5hG7DmD7EAVT0yoxa-WapoDnzmDUQ`  
**Viewport:** 1920 × 1047  
**Themes tested:** Dark (primary), Light (verified)  
**Session:** `ec905b73-2019-4a0a-85b3-b14817c2ad8c`  
**Date:** 2025-06-26

---

## Summary

The Kanban board is **solid and functional** — the 6-lane layout, card expand/collapse, focus modal, stage transitions, inline editing, filter pills, lane visibility, and theme toggle all work correctly. The template handles real-world use cases well. However, there are several bugs related to **live-update consistency** (subtask counters, modal refresh) and **missing UX feedback** (empty form submission, generic toast messages) that degrade the experience.

**8 cards tested** across all 6 lanes. Full lifecycle tested: create → edit → change state → add subtasks → add notes → filter → sort → navigate away → return → verify persistence.

---

## Findings

### 🐛 Bugs

#### 1. Done column shows overdue badge for completed tasks
- **Severity:** Medium
- **What I did:** Viewed the Done lane. "SSO integration" card shows "41d overdue" in red text.
- **What I saw:** A red overdue indicator on a card in the Done column — a task that's been completed.
- **Expected:** Completed tasks in Done should NOT show overdue warnings. The due date may have passed, but the work is done. At most, show "Completed [date]" or hide the due badge entirely.

#### 2. Subtask progress counter doesn't update after checkbox toggle
- **Severity:** Medium
- **What I did:** Opened the focus modal for "Mobile app v2 — Redesign". Toggled a subtask checkbox from unchecked to checked.
- **What I saw:** The checkbox visual state updated, but the progress text (e.g. "1/2 → 50%") did NOT refresh to reflect the new completion count. The progress bar and text showed stale data until the modal was closed and the card was re-rendered.
- **Expected:** Progress counter and bar should update immediately when any subtask checkbox is toggled.

#### 3. Focus modal doesn't live-update after adding a subtask
- **Severity:** Medium
- **What I did:** Inside the focus modal, used "+ Sub-task" to add a new subtask. Toast said "Added".
- **What I saw:** The subtask list in the modal still showed the old count (2 subtasks). Only after closing and re-opening the modal did the new subtask appear. The board card DID show "☑ 2/3" correctly after close.
- **Expected:** The subtask list inside the modal should append the new subtask immediately, without requiring close/reopen.

#### 4. Subtask toggle doesn't reliably persist off→on→off
- **Severity:** Low–Medium
- **What I did:** Toggled a subtask checkbox on, then off, then on again in the focus modal.
- **What I saw:** The final "on" state persisted, but toggling back "off" appeared to fail silently. The subtask ended up marked completed despite being toggled back.
- **Expected:** Each toggle should persist independently. Off→on→off should result in "off".

#### 5. `mqtt_submit_form` doesn't trigger internal submit handler
- **Severity:** Low (tooling, not user-facing)
- **What I did:** Used the MQTT bridge `submit_form` command on the `.add-row-form`.
- **What I saw:** The form appeared to submit (no error) but no card was created. The form stayed open with data. Clicking the `.add-row-submit` button directly DID work and triggered the "Task added" toast.
- **Note:** This is a test-tooling issue, not a user-facing bug. The add form's submit handler is likely attached to the button click, not the form's `submit` event.

---

### 😕 UX Friction

#### 6. Empty add-form submission gives zero feedback
- **Severity:** High
- **What I did:** Opened the "+ Add Task" form and immediately clicked "Add Task" with all fields empty.
- **What I saw:** Nothing happened. No error message, no toast, no field highlighting, no shake animation. The form just sat there. A user would click repeatedly, confused about why nothing is happening.
- **Expected:** Either (a) show validation messages on required fields ("Task title is required"), (b) show an error toast, or (c) prevent the submit button from being clickable when the title is empty (disable state + tooltip).

#### 7. Toast says "Added" for ALL stage transitions
- **Severity:** Medium
- **What I did:** Changed a card's stage from Backlog → In Progress, then In Progress → Done, then Done → Backlog.
- **What I saw:** Every stage change produced a toast that simply said "Added". Not "Moved to In Progress", not "Stage changed", just "Added".
- **Expected:** Toast should say "Moved to [Stage Name]" for stage changes. "Added" implies a new item was created, which is misleading.

#### 8. No toast confirmation for add-form submission
- **Severity:** Low
- **What I did:** Filled out the add form completely and submitted via the button click.
- **What I saw:** The first submission attempt (via `submit_form`) produced no toast. The second attempt (via direct button click) DID show "Task added" — so there IS a toast, but only when the submit handler fires correctly.
- **Note on inconsistency:** Subtask addition shows "Added" toast. Note addition shows no toast. Stage change shows "Added" toast. Task addition shows "Task added" toast (when it works). The feedback system is inconsistent.

#### 9. Long card titles have no truncation or max height
- **Severity:** Low–Medium
- **What I did:** Added a task with a 275-character title via the add form.
- **What I saw:** The card rendered with title height of 245px (card total 357px), nearly twice the size of normal cards. The title text wraps freely with `overflow: visible` and `white-space: normal`, no truncation, no "show more" link, no max-height.
- **Expected:** Card titles should truncate after 2-3 lines with an ellipsis or "…" indicator. Full title visible in expanded card or focus modal.

---

### ✅ Works Well

#### 10. Six-lane Kanban layout with distinct colors
Each lane (Backlog/gray, To Do/blue, In Progress/amber, QA/purple, Done/green, Rejected/red) has a unique header color. The layout is clean, well-spaced, and immediately readable. Lanes redistribute width evenly when hidden/shown.

#### 11. Card expand/collapse toggle
The ▾/▴ toggle on each card works reliably. Expanded cards show description, stage button, priority cycling, reject button, subtasks, and notes. The toggle is stable — no flickering, no lost state.

#### 12. Focus modal (⛶)
The modal is 720×840px, well-structured with header (title, stage, metadata), body (description, due date, label, project, notes), and subtask section. Title is editable inline. Close via ✕ button, Escape key, or overlay click all work.

#### 13. Priority cycling
Clicking the priority dot on a card cycles through P0 (red) → P1 (orange) → P2 (amber) → P3 (green) → P0. Each level has a distinct color. Works on both board cards and in focus modal.

#### 14. Filter pills
All project filters work: "All", "Data", "Frontend", "Mobile", "Platform". Active pill highlighted in blue. Cards filter correctly by project. Filter state is instantaneous.

#### 15. Sort options (Priority, Due Date, Default)
All three sort modes work. Priority sort orders by P0→P3 within each lane. Due date sort orders chronologically. Default restores original row order.

#### 16. Lane visibility controls
The ⚙ Lanes panel shows checkboxes for all 6 lanes. Unchecking hides lanes and remaining lanes redistribute width evenly (e.g., 4 lanes × 385px). Re-checking restores hidden lanes.

#### 17. Stage transition via dropdown
Clicking the stage button on an expanded card opens a 6-option dropdown (Backlog, To Do, In Progress, QA, Done, Rejected). Selecting an option moves the card to the correct lane immediately.

#### 18. Reject button
The "🚫 Reject" button on expanded cards moves them directly to the Rejected lane. Quick shorthand for the full stage dropdown.

#### 19. Theme toggle (dark ↔ light)
Dark mode: slate-dark lanes (rgb(15,23,42)), dark card backgrounds (rgb(30,41,59)), light text. Light mode: off-white lanes (rgb(248,250,252)), white cards, dark text. Clean contrast in both modes. All interactive states survive the toggle.

#### 20. Data persistence through navigation
Navigation to Home and back preserves all data. Cards, stage changes, and newly added items all survive the round-trip.

---

### 💡 Suggestions

#### 21. Add "jump to card" after stage change
When a card moves from Backlog to Done, it physically moves across the board. The user loses track of where it went, especially on a wide screen. A brief highlight animation or toast with "Moved to Done — [click to scroll]" would help.

#### 22. Keyboard navigation for card management
There's no way to navigate between cards with arrow keys, or open focus modal with Enter. Power users would benefit from keyboard shortcuts (J/K to move between cards, Enter to open, Escape to close — similar to Trello).

#### 23. Subtask add inline should refresh the modal
Since adding a subtask already writes to the sheet (toast confirms), the modal should re-fetch and display the updated subtask list immediately rather than requiring a close/reopen cycle.

---

## Test Coverage Matrix

| Area | Tested? | Result |
|------|---------|--------|
| First load / layout | ✅ | 6 lanes, toolbar, cards render correctly |
| Card expand/collapse | ✅ | Works reliably |
| Focus modal open/close | ✅ | ✕, Escape, overlay click all work |
| Focus modal — title edit | ✅ | Editable, persists to sheet |
| Focus modal — priority | ✅ | Cycles P0-P3 correctly |
| Focus modal — subtasks | ✅ | Toggle works, progress counter stale (🐛) |
| Focus modal — add subtask | ✅ | Persists but modal doesn't refresh (🐛) |
| Focus modal — notes | ✅ | Note added with author/timestamp |
| Add form — full submit | ✅ | Works via button click |
| Add form — empty submit | ✅ | No validation feedback (😕) |
| Add form — long text | ✅ | Title has no truncation (😕) |
| Stage transitions | ✅ | All 6 stages work, card moves correctly |
| Priority cycling (board) | ✅ | P0→P3 cycle works |
| Filter pills | ✅ | All project filters work |
| Sort options | ✅ | Priority, due date, default all work |
| Lane visibility | ✅ | Hide/show with even redistribution |
| Archive toggle | ✅ | Toggles, but no archived items in dataset |
| Theme toggle | ✅ | Dark ↔ Light clean transition |
| Navigation round-trip | ✅ | Data persists through Home → Sheet cycle |
| Escape key (modal) | ✅ | Closes modal correctly |
| Overlay click (modal) | ✅ | Closes modal correctly |
| Reject button | ✅ | Moves card to Rejected lane |
| Inline cell editing | ✅ | Click to edit, Enter saves, Escape cancels |
| Network errors | ✅ | Zero app network errors throughout |
| JS errors | ✅ | Only MQTT bridge baseline error (non-app) |

---

## Severity Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🐛 Bug — Medium | 3 | #1 overdue on Done, #2 subtask counter, #3 modal refresh |
| 🐛 Bug — Low | 2 | #4 toggle persistence, #5 submit_form tooling |
| 😕 UX — High | 1 | #6 empty form no feedback |
| 😕 UX — Medium | 2 | #7 generic toast, #9 long title no truncation |
| 😕 UX — Low | 1 | #8 inconsistent toast feedback |
| ✅ Works Well | 11 | #10–#20 |
| 💡 Suggestion | 3 | #21–#23 |

---
---

# Flow Diagram Template — Manual QA & UX Test Report

**Sheet:** Order Processing  
**Template:** Flow Diagram (🔀)  
**URL:** `https://swiftirons.com/waymark/#/sheet/1y90vonjEZ3BbVuJ_F5BOVzoCDhhvjQJJ1Q-0iD1ur14`  
**Viewport:** 1920 × 1047  
**Themes tested:** Dark (primary), Light (verified round-trip)  
**Session:** `c5c26f37-9adb-49ad-a369-fe1bf16f2b43`  
**Date:** 2025-06-26

---

## Summary

The Flow Diagram template renders a beautiful SVG-based flowchart with 8 distinct node types, interactive drag-to-reposition, click-to-inspect, port-to-connect, and double-click-for-details. The visual design is strong — nodes have unique shapes (diamonds for decisions, parallelograms for I/O, rounded rects for start/end) with distinct colors. Layout auto-alignment, canvas zoom, and the hint bar are all excellent.

However, the template has **two critical data-corruption bugs** that can silently destroy the Type column across ALL rows. The inspector panel's interaction with auto-refresh creates a dangerous race condition. These are data-loss bugs that require immediate attention.

**14 nodes tested** (13 original + 1 added). Inspector editing, type changes, add form, table toggle, node dragging, auto-align, detail modal, theme toggle, and navigation round-trip all exercised.

---

## Findings

### 🐛 Bug — CRITICAL: Inspector Type Change Corrupts All Node Types (#F1)

**What I did:** Selected "Check Inventory" (process node) via mousedown+mouseup. The inspector opened. Changed the Type dropdown from its displayed value to "decision".

**What happened:** The select showed `before: "start"` even though the node is class `flow-node-process`. After the change, the page re-rendered and ALL 14 nodes became `flow-node-process`. Every node — Start, Decision, End, Delay, Sub-process, Output — all turned into identical blue Process rectangles. The entire visual diversity of the flowchart was destroyed.

**Evidence:** Step table confirmed all 14 rows show "⬜ Process" for Type. SVG inspection showed all nodes use identical `rect rx=6 fill=#2563eb18`. Zero JS errors or network errors — the corruption was completely silent.

**Root cause:** The inspector's `_cur` reference can become stale during auto-refresh cycles. When the DOM is rebuilt by a refresh, blur events from the old DOM fire `commit()` or the type select handler against a desynchronized `_cur.rowIdx`. The null guard fix (`if (!_cur.node) return`) prevents header row corruption but doesn't prevent cross-row type overwriting.

**Severity:** CRITICAL — silent data loss affecting all rows

---

### 🐛 Bug — HIGH: Add Step Form Missing Type Field (#F2)

**What I did:** Clicked "+ Add Step", which opened a form with 4 fields: Step, Next, Condition, Notes.

**What happened:** The Type field is defined in `addRowFields()` as a select with 8 node type options, but it does not appear in the rendered form. New nodes default to "process" type with no way for the user to choose.

**Evidence:** The `addRowFields()` method at line 64 of `flow/index.js` returns a Type field with `type: 'select', options: Object.keys(NODE_SHAPES)`. The `buildAddRowForm()` in `shared.js` filters fields by `f.colIndex >= 0` — so either `cols.type` is -1 (Type column not detected) or the field is being filtered out. The rendered form showed only 4 `input[type=text]` elements, no `<select>`.

**Impact:** Users cannot set node type when adding new steps. All new nodes are generic Process rectangles.

**Severity:** HIGH — feature gap, users can't create properly typed nodes

---

### 🐛 Bug — MEDIUM: Newly Added Node Has Empty Inspector Fields (#F3)

**What I did:** Added "Generate Invoice" via the Add Step form (all 4 fields filled with realistic data). Then selected the new node.

**What happened:** The inspector opened showing the node title "Generate Invoice" in the header, but ALL field inputs were empty — Step Name, Next, Condition, Notes all blank. Original nodes like "Ship Order" showed correct data when selected.

**Evidence:** Inspector fields for "Generate Invoice": `{stepName: "", next: "", condition: "", notes: ""}`. In contrast, "Ship Order" fields: `{stepName: "Ship Order", next: "Send Confirmation", notes: "Generate shipping label"}`. The step table correctly showed "Generate Invoice" data in all columns.

**Possible cause:** The `node.idx` property for the newly appended row may not align with the data row index. The inspector reads data from `_cur.node` properties (e.g., `node.step`, `node.next`) rather than from the DOM, so if the node object was created with empty properties during auto-refresh desync, the fields show blank.

**Severity:** MEDIUM — data exists but inspector can't display or edit it

---

### 😕 UX Friction — HIGH: Empty Add Step Form Submits Silently (#F4)

**What I did:** Opened the Add Step form and clicked "Add Step" with all fields empty.

**What happened:** Nothing happened. No validation error, no toast notification, no field highlighting, no visual feedback of any kind. The form stayed open. A user would repeatedly click the button wondering why it's not working.

**Expected:** Required field highlighting on the Step field, or a toast saying "Step name is required", or the Step field defined with `required: true` (it IS marked required in `addRowFields()` but the rendered form apparently didn't enforce it).

**Severity:** HIGH — confusing UX with no feedback

---

### 😕 UX Friction — MEDIUM: Detail Modal Not Closable via Escape (#F5)

**What I did:** Double-clicked "Receive Order" to open the detail modal. Pressed Escape.

**What happened:** The modal stayed open. Had to click the ✕ button to close it.

**Expected:** Escape should dismiss the modal, matching standard UI conventions. The inspector panel's text fields DO handle Escape (they cancel edits), so the expectation is set.

**Severity:** MEDIUM — minor friction, inconsistent keyboard handling

---

### 😕 UX Friction — MEDIUM: Click vs Double-Click Interaction Confusion (#F6)

**What I did:** Explored the two click-based interactions on nodes.

**Observation:** Single-click opens the inspector (editable panel at bottom). Double-click opens the detail modal (read-only overlay). This is counterintuitive — most applications use double-click for "open/edit" and single-click for "select/preview". Here it's reversed: single-click = edit, double-click = view-only. The detail modal has zero editable elements.

**Suggestion:** Consider making the detail modal editable (replacing or supplementing the inspector), or removing the detail modal and using only the inspector for all node interactions.

**Severity:** MEDIUM — confusing interaction pattern

---

### 😕 UX Friction — LOW: Step Table Is Read-Only (#F7)

**What I did:** Expanded the step table via "▸ Show Step Table" toggle. Examined all cells.

**What happened:** All cells are non-editable (`editable: false`). The table is view-only — a reference view of the underlying data.

**Expected:** For a flow diagramming tool, inline table editing would be a much faster workflow for bulk changes than clicking individual nodes and waiting for the inspector panel. The table has the data structure (Step, Type, Next, Condition, Notes) — making cells editable would add significant utility.

**Severity:** LOW — missing feature, not a bug

---

### ✅ Works Well: SVG Node Rendering (#F8)

**Observation:** The flow diagram renders 8 distinct node types with unique SVG shapes and colors:
- **Start** (▶): green #16a34a, rounded rect rx=28
- **End** (⏹): red #dc2626, rounded rect rx=28
- **Process** (⬜): blue #2563eb, rect rx=6
- **Decision** (◆): amber #d97706, diamond polygon
- **Input/Output** (▱): cyan #0891b2, parallelogram polygon
- **Delay** (⏳): slate #94a3b8, flat rect
- **Sub-process** (⊞): indigo #4f46e5, rect rx=4

Each type is immediately visually distinguishable. The color palette works well in both dark and light themes.

---

### ✅ Works Well: Canvas Hint Bar (#F9)

**Observation:** A hint bar at the bottom of the canvas reads: "Drag nodes to reposition • Click to inspect • Drag from ● port to connect • Double-click for details". This concisely explains all 4 interaction patterns. Excellent onboarding for new users.

---

### ✅ Works Well: Node Dragging & Auto-Align (#F10)

**What I did:** Dragged "Backorder" node 110px to the right. Then clicked "⭐ Auto-Align".

**What happened:** The drag moved the node in real-time. Auto-Align snapped it back into the layout grid, re-centering it (x:1057 → x:947) and adjusting the entire tree's vertical spacing. Response was instant.

---

### ✅ Works Well: Add Step Form — Happy Path (#F11)

**What I did:** Filled Add Step form with realistic data: Step="Generate Invoice", Next="Send Confirmation", Condition="Payment verified", Notes="Create PDF invoice with order details and payment receipt". Submitted.

**What happened:** Toast said "Step added". The new node appeared in the diagram. Form collapsed and fields cleared. 14th node was properly integrated into the layout.

---

### ✅ Works Well: Inspector Panel Design (#F12)

**Observation:** The inspector panel (1575×315px) at the bottom of the page is well-designed. It shows a type badge with icon and color, the node title, and 5 clearly labeled fields (Step Name, Type, Next, Condition, Notes). The Next field has a combo dropdown listing other step names. Close button (✕) works. The visual design matches the template's indigo accent.

---

### ✅ Works Well: Theme Toggle Round-Trip (#F13)

**What I did:** Toggled Dark → Light → Dark.

**What happened:** Canvas background changed correctly (dark: rgb(15,23,42), light: rgb(250,251,252)). Node labels switched color appropriately. Edge colors remained consistent. All 14 nodes survived the round-trip. No errors.

---

### ✅ Works Well: Navigation Round-Trip (#F14)

**What I did:** Navigated Home → reopened the Order Processing sheet.

**What happened:** Flow diagram reloaded with all 14 nodes, 16 edges, correct template badge "🔀 Flow Diagram". Data persisted.

---

### ✅ Works Well: Canvas Zoom (#F15)

**Observation:** Scroll wheel zooms the canvas (viewBox changes from "0 0 780 1098" to "0 0 680 1234" on scroll in). The zoom is smooth and centered.

---

### ✅ Works Well: Edge Labels & Connections (#F16)

**Observation:** Condition-based edges display labels ("Valid", "Invalid", "Yes", "No", "Payment verified") along the edge paths. The labels use slate color (#64748b) which is readable but doesn't compete with node labels. 16 connections render as smooth bezier curves with proper arrowheads.

---

### ✅ Works Well: Output Ports (#F17)

**Observation:** Each node has an indigo (#6366f1) output port circle (r=6) at the bottom, with crosshair cursor indicating it's draggable for creating new connections. The port interaction is discoverable via the canvas hint text.

---

### 💡 Suggestion: Add Type Selector to Add Step Form (#F18)

The `addRowFields()` method defines the Type field but it's not rendering. Once the rendering bug is fixed, new nodes should support all 8 types: Start, End, Process, Decision, Input, Output, Delay, Sub-process.

---

### 💡 Suggestion: Make Step Table Editable (#F19)

The step table view (toggled via "▸ Show Step Table") currently shows a read-only grid. Making cells inline-editable (like the Kanban template's editable cells) would provide a much faster workflow for bulk editing — especially useful for renaming steps, changing types, or re-routing connections.

---

### 💡 Suggestion: Improve Inspector Resilience During Auto-Refresh (#F20)

The inspector panel interacts dangerously with the app's auto-refresh cycle. When the DOM is rebuilt, the inspector's `_cur` reference goes stale. Solutions:
1. Close the inspector before re-render and re-open it afterwards with fresh data
2. Use a stable row identifier (not DOM index) to match the current node across re-renders
3. Mark the inspector as "dirty" during re-render and skip commits

---

## Severity Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🐛 Bug — CRITICAL | 1 | #F1 inspector type change corrupts all types |
| 🐛 Bug — HIGH | 1 | #F2 add form missing Type field |
| 🐛 Bug — MEDIUM | 1 | #F3 new node empty inspector fields |
| 😕 UX — HIGH | 1 | #F4 empty form silent submit |
| 😕 UX — MEDIUM | 2 | #F5 Escape doesn't close modal, #F6 click vs dblclick confusion |
| 😕 UX — LOW | 1 | #F7 step table read-only |
| ✅ Works Well | 10 | #F8–#F17 |
| 💡 Suggestion | 3 | #F18–#F20 |
