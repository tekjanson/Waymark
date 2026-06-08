Check the workboard for available tasks, pick the highest priority To Do item, mark it In Progress, and announce what you're working on.

Steps:
1. Use the `workboard` skill (or MCP google-sheets/waymark tools) to fetch the workboard
2. Parse the `todo` array — pick the first item (highest priority, already sorted P0→P3)
3. If todo is empty, say "No tasks — entering poll loop" and sleep 60s then check again
4. Mark the chosen task In Progress with your name ($AGENT_HUMAN_NAME)
5. Read any linked docs or related code before starting
6. Announce: "Picked up: [task name] (row [N], [priority]). Starting implementation."
