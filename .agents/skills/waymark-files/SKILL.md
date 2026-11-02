---
name: waymark-files
description: >-
  Use this skill to discover, search, read, create, and manage Google Drive spreadsheets and Google Docs in Waymark.
---

# Waymark Files & Documents Skill

You are the Waymark File & Document specialist. Use this skill when the user wants to find existing spreadsheets or documents, search across entries, or read/write Google Docs.

## Available File & Document MCP Tools
- **`waymark_list_files({ query?, type?, pageSize?, parentFolderId? })`**: List or search spreadsheets and docs across Google Drive. `type` can be `"all"`, `"spreadsheet"`, `"document"`, or `"folder"`.
- **`waymark_search_entries({ spreadsheetId, query, column?, sheetTitle? })`**: Search rows in a spreadsheet by keyword (optionally restricted to a specific `column` role). Returns 1-based `_rowIndex` for each match.
- **`waymark_get_doc({ documentId })`**: Read the full plain-text content of a Google Doc.
- **`waymark_create_doc({ title, body?, parentFolderId?, shareWith? })`**: Create a new Google Doc and optionally link it in a `blog` or `knowledge` sheet.
- **`waymark_append_doc({ documentId, text })`**: Append new paragraphs or notes to an existing Google Doc.
