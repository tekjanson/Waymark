# Workboard Monitoring

Use this flow when you need to inspect or validate a live sheet by ID instead of the default Waymark workboard.

## 1. Point the checker at the sheet

Set the target spreadsheet ID, then run the workboard checker through `make` so it executes inside the dev-worker container:

```bash
WAYMARK_WORKBOARD_ID=<sheet-id> make workboard
```

The checker now uses the repo's built-in service-account JWT flow, so it does not require `google-auth-library` in the root install. The container already receives `GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json` through the dev-worker compose file.

## 2. Confirm the sheet shape

The root workboard scripts read through column J by default (`Sheet1!A:J`). That keeps any trailing metadata column visible without affecting the standard workboard fields in columns A:I.

If a sheet looks unusual, fetch the header row directly with the Sheets API and confirm which columns are present before changing any parser logic.

## 3. Read the result before changing code

If the checker returns an empty summary such as `{"todo":[],"inProgress":[],"qa":0,"done":0}`, the probe succeeded and the sheet likely has no task rows yet.

If the checker fails, fix the auth or range handling first. Do not assume the sheet data is wrong until the script can read the header row cleanly.

## 4. Related scripts

- `make workboard` reads the live task summary inside the container.
- `make workboard-notes ROW=42` polls for new sub-row notes on row 42 inside the container.
- `scripts/watch-workboard.js` is the long-running watcher.
- `scripts/update-workboard.js` claims rows and writes notes.
