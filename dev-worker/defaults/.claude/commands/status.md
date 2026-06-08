Show the current workboard status: how many tasks are in each column.

Steps:
1. Fetch the workboard (MCP or shell script)
2. Print a summary:
   - To Do: N tasks (list titles + priorities)
   - In Progress: N tasks (list who has what)
   - QA: N
   - Done: N
3. Highlight any tasks assigned to $AGENT_HUMAN_NAME
