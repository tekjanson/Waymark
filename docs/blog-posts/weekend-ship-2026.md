# What We Shipped This Weekend

*by Jamie Levine · July 2026 · Category: Engineering*

---

It was a productive weekend. We shipped a handful of features that make Waymark significantly more useful as a daily driver — especially for anyone running their life out of Google Sheets.

Here's what landed.

---

## Waymark MCP Integration

The biggest thing we shipped this weekend is the Waymark MCP server — a [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI assistants like GitHub Copilot and Claude a Waymark-native view of your Google Sheets data.

Instead of thinking in terms of spreadsheet IDs, column letters, and cell ranges, an AI agent working with Waymark can now say things like:

> "Find all the kanban cards in the 'Engineering' project that are past due"

or

> "Add a new blog post entry to my Team Blog sheet"

The MCP server exposes seven template-aware tools: list templates, detect which template a sheet uses, read entries, write entries, update a specific row, search across a sheet, and create a new Waymark sheet from a template. Under the hood it reads from `template-registry.json` and translates between Waymark's template layer and raw Sheets API calls.

What this means in practice: your AI coding assistant can reason about your Waymark data without needing to know the spreadsheet internals. It's the connective tissue between "here's my data in Google Sheets" and "here's what I want to do with it."

To use it, point your VS Code MCP config at `mcp/waymark.mjs` with a service account credential. The [setup doc](../ai-workflow.md) has the details.

---

## Blog Template — Write Posts From Within Waymark

We added a Blog template that turns any Google Sheet into a publication platform. The sheet needs a Title column and a Doc column (a Google Doc URL), and Waymark automatically renders a card grid of your blog posts with category filtering, a reader panel, and draft/published state.

This weekend we also shipped the **New Post button** — a "✍️ New Post" button in the blog header that:

1. Opens an inline form (title + optional category)
2. Creates a new blank Google Doc via the Drive API
3. Adds the post as a Draft row in your sheet
4. Opens the doc in a new tab so you can start writing immediately

There's no round-trip to Google Sheets — it's instant. The new post appears in the card grid as a Draft card before you even write the first word.

The workflow is: click New Post → type the title → click Create → a Google Doc opens in a new tab. Write your post, publish the doc, then flip the Status cell to "Published". The card immediately updates in Waymark.

---

## Photos Template — Private Drive Photos Now Load

The Photo Gallery template landed a few days ago, but private Drive photos were broken — instead of rendering the image, the template showed a "🔒 Share the photo to view it" guide.

The root cause was a browser security restriction: when an `<img>` tag points at `drive.google.com/thumbnail?id=...`, the browser won't send your Google auth cookies because of SameSite=Lax cookie policy. So Drive responds with a 403.

The fix is to fetch the photo with an OAuth bearer token instead. The updated template:

1. Extracts the Drive file ID from the URL
2. Calls the Drive Files API with `Authorization: Bearer {token}` to get the `thumbnailLink`
3. The `thumbnailLink` is a `lh3.googleusercontent.com` URL with auth baked into the URL — it loads fine in `<img>` tags from any origin

Private photos in Google Drive now render without needing to change sharing settings.

---

## Push Notifications — Self-Hosted via MQTT

The Waymark MCP server now includes a `waymark_push_notification` tool that publishes a notification to the Waymark Mosquitto broker.

Why MQTT instead of ntfy.sh or Firebase? Because Waymark already runs a Mosquitto broker for the dev worker bridge, and there's no reason to add a third-party service dependency when the infrastructure already exists.

The flow: the MCP tool publishes a JSON payload to topic `waymark/notifications`. On your phone, any MQTT client app (MQTT Dash, IoT MQTT Panel, etc.) subscribed to the same broker/topic receives it immediately.

The payload format is:
```json
{
  "title": "Waymark",
  "message": "...",
  "priority": "default",
  "url": null,
  "tags": [],
  "timestamp": "2026-07-05T..."
}
```

No public cloud, no topic secrecy concerns, no monthly bill. The broker is yours.

---

## What's Next

A few things still on the board:

- Better notifications UX (badge counts on the home screen)
- MCP server for the MQTT debug bridge
- Directory roll-up view for test suite folders

We're building Waymark to be the personal workflow tool that gets out of your way. This weekend was a good step in that direction.

---

*Published with the Waymark Blog template. [Create your own](/js/app.js)*
