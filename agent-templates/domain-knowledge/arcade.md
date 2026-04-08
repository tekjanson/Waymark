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
