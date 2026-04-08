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
