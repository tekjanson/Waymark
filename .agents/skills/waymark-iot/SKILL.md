---
name: waymark-iot
description: >-
  Use this skill to read, create, update, or manipulate Google Sheets for the IoT Sensor Log template (Monitoring).
---

# Waymark IoT Sensor Log Skill

> Specialized skill for **IoT Sensor Log** sheets in Waymark. Uses Waymark and Google Sheets MCP tools to perform operations according to IoT Sensor Log domain rules.

---

## 0. IDENTITY

| Field | Value |
|---|---|
| Template Key | `iot` |
| Template Name | IoT Sensor Log |
| Category | Monitoring |
| Interaction Type | `status-cycle` |

---

## 1. COLUMN ROLES

This is the authoritative column mapping for IoT Sensor Log sheets. When reading or writing, use these role names to identify the correct column regardless of exact header text.

```
1. sensor
2. timestamp
3. reading
4. unit
5. min
6. max
7. alert
```

**Default headers when creating a new IoT Sensor Log sheet:**
```
Sensor, Timestamp, Reading, Unit, Min, Max, Alert
```

**Detection signals** — headers that indicate a sheet is a IoT Sensor Log:
```
sensor, device, probe, reading, measurement, min, max, threshold, alert
```

---

## 2. STATE MACHINE

Interaction type: `status-cycle`

Valid states (in order):
- `Normal`
- `Watch`
- `Alert`
- `Offline`

Flow: `Normal → Watch → Alert → Offline`

After the last state, cycling wraps back to the first. Only write values from this list to the stage/status column.

---

## 3. DOMAIN KNOWLEDGE — IoT Sensor Log

# IoT Sensor Log — Domain Knowledge

## What This Template Is
A sensor data log where each row is a reading from a sensor. The `sensor` column identifies the device. The `timestamp` column is when the reading was taken. The `reading` column is the numeric value. The `unit` column is the measurement unit (°C, %, psi, lux, etc.). The `min` and `max` columns define the acceptable range. Status cycles: Normal → Watch → Alert → Offline.

## Valid Status States
```
Normal → Watch   (reading approaching threshold)
       → Alert   (reading out of acceptable range)
       → Offline (sensor not reporting)
Alert  → Normal  (reading returned to range)
Offline → Normal (sensor reconnected)
```

## Smart Operations

### Sensor Dashboard
Group latest reading per sensor. For each:
```
{sensor} [{status}]
  Last reading: {reading} {unit} at {timestamp}
  Range: {min}–{max}
```
🔴 Alert sensors first, then ⚠️ Watch, then ✅ Normal, then ⬛ Offline.

### Threshold Evaluation
For a given reading value against a sensor's min/max:
- `reading < min` OR `reading > max` → Alert
- `reading` within 10% of min or max → Watch
- Otherwise → Normal
Write the evaluated status to the `status` column.

### Alert Summary
Find all rows with `status = "Alert"`:
```
🔴 ALERT: {sensor} — {reading} {unit} (range: {min}–{max}) at {timestamp}
```
Count: `{N} active alerts`

### Offline Sensors
Find sensors with `status = "Offline"` or no reading within the expected reporting interval.
Report: `⬛ Offline: {sensor} — last seen {timestamp}`

### Historical Trend
For a given sensor, return all readings sorted by timestamp.
Calculate: min, max, average over the full dataset.
Flag any readings that triggered Alert status.

### Adding a Reading
Append a row. Required: `sensor`, `timestamp`, `reading`, `unit`.
Auto-evaluate status based on `min`/`max` if those columns have values for this sensor (read from other rows).
If no range data available, default status to "Normal".

### Out-of-Range Count
Count the number of Alert readings per sensor over the last N readings.
Report: `{sensor}: {N} alerts in last {M} readings`

### Range Update
When told to update the acceptable range for a sensor:
- Find all rows for that sensor
- Update `min` and `max` on all rows (or just the latest row if range is stored per-reading)
- Re-evaluate status for recent readings

## Interpretation Rules
- `reading` must be numeric — non-numeric values indicate a sensor error, flag them
- Multiple rows per sensor = time-series history, not duplicates — never deduplicate
- `timestamp` should be preserved in the format already used
- A sensor with no readings in the last expected interval is Offline — the absence of rows is data
- `unit` is authoritative — never convert units automatically unless explicitly asked

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
- For `toggle`, only write `Normal` or `Watch`.

### 4.3 Appending a Row
Call `waymark_add_entry(spreadsheetId, entry, sheetTitle?)`
- `entry` is `{ roleName: value }`.

### 4.4 Creating a New Sheet
Call `waymark_create_sheet({ templateKey: "iot", title, seedRows? })`
- Creates a new Google Sheet pre-formatted with default IoT Sensor Log headers and initial rows.
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
