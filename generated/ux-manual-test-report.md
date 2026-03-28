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
