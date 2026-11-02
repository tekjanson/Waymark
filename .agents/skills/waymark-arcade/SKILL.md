---
name: waymark-arcade
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the Arcade template (Social).
---

# Waymark Arcade Skill

> Specialized skill for **Arcade** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to Arcade domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `arcade` |
| Template Name | Arcade |
| Category | Social |
| Interaction Type | `game-modal` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for Arcade sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. game
2. player1
3. player2
4. score
5. status
6. date
```

**Default headers when creating a new Arcade sheet:**
```
Game, Player 1, Player 2, Result, Mode, Date
```

**Detection signals** — headers that indicate a sheet is a Arcade:
```
arcade, game lobby, game room, multiplayer
```

---

## 2. STATE MACHINE

This template has no state machine. The interaction type is `game-modal` — cells are edited directly without cycling.

---

## 3. DOMAIN KNOWLEDGE — Arcade

# Arcade / Games — Domain Knowledge

## What This Template Is
A game results tracker where each row is a single match or game session. The `game` column names the game (Chess, Ping Pong, Mario Kart, etc.). `player1` and `player2` are the competitors. `score` is the result (e.g., "3-1", "21-18", or a single winner name). `status` marks the match state (Open, In Progress, Complete, or similar).

## Interaction Type: game-modal
The `game-modal` interaction type means entries are opened in a full modal to record or view game details. When adding or editing a match, prepare a complete row — the UI will present it in modal view.

## Smart Operations

### Leaderboard
Compute wins per player across all complete/recorded rows.
Parse the `score` column to determine winner:
- If score is "3-1" format: higher number wins (player1 if first num > second, else player2)
- If score contains a player name: that player wins
- If unclear: count as a draw

Present:
```
  Player       W    L    D   Win%
  {player}     N    N    N   NN%
  ...
  (ranked by Win%)
```

### Game History (single game type)
When asked for history of a specific game:
- Filter rows where `game` = requested name (case-insensitive)
- Show in reverse chronological order (newest first if date exists)
- Include player1 vs player2 + score

### Head-to-Head Stats between Two Players
Filter rows where either order of player1/player2 matches the two requested players.
Show:
```
  {player A} vs {player B}
  {playerA} wins: N
  {playerB} wins: N
  Draws: N
  Last played: {date or "unknown"}
```

### Win Streak
Find the current win streak for a player:
- Scan rows in order, identify the player's most recent consecutive wins

### Recording a Result
- Find a row by `game` + player names (if status is Open/In Progress)
  OR append a new row if no open match exists
- Write `score` = provided result, `status` = "Complete"

### Adding a New Match
Append a row: `game`, `player1`, `player2`. Set `score` = empty or "TBD", `status` = "Open".

### Games Catalog
List distinct values in the `game` column with how many times each has been played.

## Interpretation Rules
- Score format is flexible — preserve it as given, parse for win detection
- Player names are case-insensitive for lookups but preserve original casing when writing
- If only one player name is given in a query, find all rows where they appear in either player column
- "Complete" and "Done" and "Finished" are all terminal statuses — treat them as finished games

---

## 4. MCP TOOL OPERATIONS

### 4.1 Reading a Sheet
Call `waymark_get_sheet(spreadsheetId, sheetTitle?)`
- Returns `templateKey`, `columnRoles{}`, and `rows[]` as objects with role-named keys.
- Always resolve columns by role name, not index.

### 4.2 Updating an Existing Row
Call `waymark_update_entry(spreadsheetId, rowIndex, updates, sheetTitle?)`
- `rowIndex` is 1-based data row index (1 = first row under headers).
- `updates` is `{ roleName: newValue }`.
- For `status-cycle`, only write values from the valid states list (§2).
- For `toggle`, only write `done` or ``.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "arcade", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default Arcade headers and initial rows.
- Created under user account via OAuth, automatically shared with service account and editors.
- Returns `{ spreadsheetId, waymarkUrl, sheetsUrl, title, templateKey }`.

### 4.5 Searching Entries & Files
- Search rows in a sheet: Call `waymark_search_entries({ spreadsheetId, query, column? })`.
- Search files in Google Drive: Call `waymark_list_files({ query?, type?: 'all'|'spreadsheet'|'document'|'folder', parentFolderId? })`.
- Share a sheet: Call `waymark_share_sheet({ spreadsheetId, shareWith?, shareWithAnyone?, role? })`.

### 4.6 Document Operations
- Create Google Doc: Call `waymark_create_doc({ title, body?, parentFolderId?, shareWith? })`.
- Read Google Doc: Call `waymark_get_doc({ documentId })`.
- Append to Google Doc: Call `waymark_append_doc({ documentId, text })`.
