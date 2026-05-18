---
target: src/utils/dateUtils.mjs
test: src/utils/dateUtils.test.mjs
status: active
---
Write a pure ESM JavaScript module that exports three date utility functions:

1. `formatRelativeTime(input)` — accepts a timestamp (number) or Date object and returns a human-readable relative time string such as "just now", "5 minutes ago", "2 hours ago", "3 days ago", "1 week ago", "2 months ago", or "1 year ago". Use these thresholds:
   - < 60 seconds → "just now"
   - < 60 minutes → "N minute(s) ago"
   - < 24 hours   → "N hour(s) ago"
   - < 7 days     → "N day(s) ago"
   - < 30 days    → "N week(s) ago"
   - < 365 days   → "N month(s) ago"
   - else         → "N year(s) ago"
   Singular/plural must be correct ("1 minute ago", not "1 minutes ago").
   Throw a TypeError if the input is null, undefined, a non-numeric string, or NaN.

2. `formatShortDate(input)` — accepts a timestamp (number) or Date object and returns a locale-aware short date string using `Intl.DateTimeFormat` with options `{ year: 'numeric', month: 'short', day: 'numeric' }`. Throw a TypeError if the input is invalid (null, undefined, NaN, non-date-parseable).

3. `isToday(input)` — accepts a timestamp (number) or Date object and returns true if the date falls on today's calendar date (same year, month, day in local time), false otherwise. Throw a TypeError if the input is null, undefined, a non-numeric string, or NaN.

All three functions must validate their input and throw a descriptive TypeError for bad values. No external dependencies. No side effects. Pure functions only.
