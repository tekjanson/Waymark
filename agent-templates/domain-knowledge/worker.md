# Worker Jobs — Domain Knowledge

## What This Template Is
A background job / task runner registry. Each row is a defined job or automated task. The `job` column is the job name or ID. `handler` is the function, script, or service that processes it. `config` stores configuration (JSON, a key=value string, or a path). `status` is the current state. `schedule` is the trigger (a cron expression, interval like "every 15m", or "manual").

## Status Values (common — not a fixed cycle)
```
pending → running → done
          running → failed
pending → skipped
done    → pending  (re-queued)
```
Status is not a formal cycle — write exact text as found in the sheet.

## Smart Operations

### Job Queue View
Show all rows where `status` is "pending" or "running":
```
PENDING JOBS
  {job} | handler: {handler} | schedule: {schedule}
RUNNING JOBS
  {job} | handler: {handler} | config: {config}
```

### Failed Job Triage
Filter rows where `status` = "failed":
```
  Job: {job}
  Handler: {handler}
  Config: {config}
  Schedule: {schedule}
```
If asked to re-queue: set `status` back to "pending".

### Schedule Summary
Group all jobs by their `schedule` value. Show:
```
  {schedule}: {job1}, {job2}, ...
```
Identify jobs with `schedule` = "manual" — these only run on demand.

### Adding a Job
Append a row. Required: `job` (unique name), `handler`. Optional: `config` (empty if not needed), `schedule` (defaults to "manual"), `status` (defaults to "pending").

### Config Inspection
When asked to show config for a specific job:
- Find by `job` name
- Return the `config` column value verbatim (do not parse or expand it)

### Updating a Job
When told to change the handler, config, or schedule for a job:
- Find by `job` name
- Write only the changed column(s)

### Status Summary
Count rows by status value:
```
  pending: N
  running: N
  done:    N
  failed:  N
  skipped: N
```

## Interpretation Rules
- `config` is opaque — treat it as a string, never invent or modify its content unless explicitly told to
- `handler` may be a function name, a URL, a script path, or a service name — always preserve as-is
- A job with `schedule` = blank should be treated as "manual"
- Never mark a job as "running" unless explicitly instructed — it may already be tracked by an external system
