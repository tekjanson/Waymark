---
name: waymark-files
description: >-
  Use this skill to search, list, organize, create, read, and append Google Drive files, Waymark spreadsheets, and Google Docs.
---

# Waymark Files & Documents Skill

> Authoritative guide for file discovery, creation, permission sharing, and document editing in Waymark using MCP tools.

---

## 1. File Discovery & Search

### Listing and Searching Files in Google Drive
Call `waymark_list_files({ query?, type?, parentFolderId?, pageSize? })`
- `query`: Text or title keyword to search for (e.g. `'Workout'`, `'Budget'`).
- `type`: Filter by type: `'all'`, `'spreadsheet'`, `'document'`, or `'folder'` (default `'all'`).
- `parentFolderId`: Target folder (defaults to configured Waymark parent folder).
- `pageSize`: Number of results (default 25, max 100).

Returns file objects with:
- `id`: Google Drive file ID.
- `name`: File title.
- `type`: `'spreadsheet'`, `'document'`, `'folder'`, or `'file'`.
- `waymarkUrl`: Ready-to-use viewer link (`https://swiftirons.com/waymark/#/sheet/<id>`).
- `webViewLink`: Google Drive / Sheets link.

---

## 2. Spreadsheet Creation & Sharing

### Creating a New Waymark Spreadsheet
Call `waymark_create_sheet({ templateKey, title, seedRows?, parentFolderId?, shareWith? })`
- Creates a new Google Sheet pre-configured with headers and roles for `templateKey`.
- Automatically created under user's Google account via OAuth quota.
- Automatically shared with Waymark service account as editor.
- Always output the link format: `[Title](#/sheet/<spreadsheetId>)`.

### Sharing a Spreadsheet
Call `waymark_share_sheet({ spreadsheetId, shareWith?, shareWithAnyone?, role? })`
- `shareWith`: Array of email addresses.
- `shareWithAnyone`: Set to `true` to make the sheet accessible to anyone with the link.
- `role`: `'writer'` (default), `'reader'`, or `'commenter'`.

---

## 3. Google Docs Operations

### Creating a Google Doc
Call `waymark_create_doc({ title, body?, parentFolderId?, shareWith? })`
- Creates a new Google Doc with optional initial body text.
- Automatically places it in the Waymark folder and shares with the service account.
- Returns `{ documentId, title, docsUrl }`.

### Reading a Google Doc
Call `waymark_get_doc({ documentId })`
- Fetches full document structure and extracts plain text content.
- Returns `{ documentId, title, text, wordCount, characterCount, docsUrl }`.

### Appending to a Google Doc
Call `waymark_append_doc({ documentId, text })`
- Appends text to the end of the document body.
- Returns `{ success: true, documentId, appendedLength, docsUrl }`.
