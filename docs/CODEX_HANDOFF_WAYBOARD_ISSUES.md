# Codex Handoff: Wayboard & Wayside Core Issues

**Target Branch:** `fix/wayboard-bugs-20261026`  
**Tracking Sheet:** [wayboard bugs](https://swiftirons.com/waymark/#/sheet/1zV4PcgttUbRp3OR-QxpByhGygvmAdE9hzHHwLFa91ZI) (`1zV4PcgttUbRp3OR-QxpByhGygvmAdE9hzHHwLFa91ZI`)  
**Status Date:** 2026-10-26

---

## 1. Executive Summary & Status Matrix

Of 8 reported issues on the **wayboard bugs** sheet, 4 were previously verified and marked **Done** by user QA. The remaining 4 backlog items have now been addressed on this branch and are ready for user QA:

| Issue | Status | Root Cause Summary | Target Files |
| :--- | :---: | :--- | :--- |
| **1. Wayboard notification button issues** | **Done** | Fixed in `e189c7b`: disabled button state, deduplicated share entries, prevented reload spam. | `notifications.js`, `storage.js` |
| **2. Links in wayside chat aren't clickable** | **Done** | Fixed in `e189c7b`: `appendLinkified()` regex parser with safe DOM node creation. | `wayboard.js` |
| **3. Wayside chat is small and hard to use** | **Done** | Fixed in `e189c7b`: widened panel to 320px, font 12px, `clamp(240px, 42vh, 560px)` height. | `home-modes.css` |
| **4. Accepting share does not open google picker** | **Done** | Fixed in `e189c7b`: integrated `api.picker.pickSpreadsheetForInvite()` in `acceptSharedWaymark()`. | `collab.js` |
| **5. The wayside chat seems to be through sheets not webRTC** | **Done** | Target selection starts a WebRTC data mesh; chat appears over P2P immediately and is saved to the ledger with a shared message ID. | `public/js/wayboard.js`, `public/js/collab.js`, `public/js/webrtc.js` |
| **6. Wayboard social issues (Chat, Calls & Shared Files View)** | **Done** | Wayside now lists all shared ledger files, provides an empty state and share picker, and keeps chat rows stable across refreshes. | `public/js/wayboard.js`, `public/js/collab.js` |
| **7. When ending a wayside call mic and camera stay open** | **Done** | Hangup ends local media while keeping the chat mesh; call state is heartbeated and remote hangup or peer departure invokes call teardown. Wayside wires remote audio output. | `public/js/webrtc.js`, `public/js/wayboard.js`, `public/js/templates/social/chat.js` |
| **8. Waymark updates seem to be slow / stuttering** | **Done** | Background polling pauses in hidden tabs and during active typing; collaborator sync is serialized, unchanged sheets skip full reads and renders, and presence updates are batched. | `public/js/app.js`, `public/js/checklist.js`, `public/js/collab.js`, `public/js/storage.js`, `public/js/wayboard.js`, `public/js/webrtc.js`, `public/js/sheets.js` |

---

## 2. Technical Breakdown of the Remaining Issues

### Item 1 & 2: Wayside Real-Time WebRTC Chat & Shared Files (`_rowIndex: 3, 6`)

#### The Problem
In `public/js/wayboard.js`:
1. `selectTarget(target, host)` discovers the ledger sheet via `collab.findExistingShareLedger(target)`, updates the header, and calls `refreshWaysideSocial(host)`.
2. **Missing WebRTC Connection:** It does **not** start a `WaymarkConnect` mesh for that ledger. `_waysideConnect` remains `null`.
3. In `sendWaysideChat()`:
   ```javascript
   if (_waysideConnect) {
     try { _waysideConnect.send(text); } catch { /* ignore */ }
   }
   ```
   Because `_waysideConnect` is `null`, this branch is bypassed. The code falls back entirely to `collab.sendChat(_activeTarget, text)`, appending a row to the Google Sheet.
4. On the receiving side, incoming messages are only fetched when `ensureWaysidePolling()` fires every 15 seconds.
5. **Shared Files Display:** The user requested: *"I also want to have the wayside be used to allow uses to see all the files shared between the users."*
   The `Shared_Docs` tab in the bilateral ledger sheet records all shared documents between the pair or crew, but it is currently not displayed prominently or interactively in The Wayside.

#### Codex Implementation Steps
1. **Always-On P2P Data Mesh on Target Selection:**
   - In `public/js/wayboard.js`, when a crew or contact is selected in `selectTarget()`:
     - Check if `_waysideConnect` exists for the target's `sheetId`. If target changed, cleanly switch `_waysideConnect` to the new ledger.
     - Instantiate `new WaymarkConnect(ledger.sheetId, { displayName, signal: collab.createLedgerSignal(ledger.sheetId), onMessage, onPeersChanged, onCallActive, onCallEnded, onRemoteStream })`.
     - Call `wc.start()`.
   - In `sendWaysideChat()`:
     - Deliver message immediately to local `#wayside-chat-log` (optimistic).
     - Broadcast immediately via `_waysideConnect.send(text)` (WebRTC DataChannel / BroadcastChannel).
     - Write to Google Sheet asynchronously via `collab.sendChat()` as the durable history.
   - When a peer receives a message via `onMessage`:
     - Render immediately into `#wayside-chat-log` and scroll down.
2. **Dedicated Shared Files Explorer in The Wayside:**
   - In `public/js/collab.js`, `readSocialSnapshot()` already parses `Shared_Docs` entries.
   - In `public/js/wayboard.js`, render a dedicated `#wayside-files` section in `renderWayside()` placed between the Online Waymarkers and Chat Box:
     - List all documents shared with that crew or contact (`📄 <Title> · <Type> · <Permission>`).
     - Clicking a document navigates to `#/sheet/:docId`.
     - Provide an empty state ("No shared files yet") and a quick "Share current sheet" or picker trigger.

---

### Item 3: Mic & Camera Remaining Active After Call End (`_rowIndex: 8`)

#### The Problem
In `public/js/webrtc.js` and `public/js/wayboard.js`:
1. When User A clicks `📴 End Call`, `endWaysideCall()` runs:
   ```javascript
   export function endWaysideCall(opts = {}) {
     if (_waysideConnect) {
       try { _waysideConnect.endCall(); } catch { /* ignore */ }
       try { _waysideConnect.destroy(); } catch { /* ignore */ }
       _waysideConnect = null;
     }
   }
   ```
2. **Raced Teardown:** `_waysideConnect.endCall()` broadcasts `{ type: 'call-end' }` over `this._dcBroadcast()`. But `_waysideConnect.destroy()` is called in the exact same synchronous execution tick, immediately invoking `pc.close()` and `dc.close()`. The outbound SCTP packet is frequently terminated before reaching the network socket.
3. **No Signaling Fallback for Remote Callee:**
   - On User B's side, User B never gets the `{ type: 'call-end' }` message.
   - When User A destroys their connection, User A's row in the `WebRTC_Signaling` tab expires or is cleared.
   - User B's `_poll()` loop in `webrtc.js` notices `!aliveIds.has(id)`:
     ```javascript
     if ((p.channel === 'sig' || p.channel === 'rtc') && !aliveIds.has(id)) {
       this._peers.delete(id);
       this._closeOne(id);
       this._remoteNonces.delete(id);
       peerChanged = true;
     }
     ```
     **Critical bug:** `_poll()` deletes the peer and closes the connection without ever invoking `this.onCallEnded(id)`!
   - As a result, User B's media streams (`_rawStream`, `_localStream`, camera track, microphone track) remain open indefinitely.
4. **Missing Remote Audio Output Element in Wayside:**
   `wayboard.js` did not wire an `<audio id="wayside-remote-audio" autoplay playsinline>` element or pass `onRemoteStream`.

#### Codex Implementation Steps
1. **Graceful Call End with Flushed Signaling:**
   - In `webrtc.js`:
     - When `endCall()` is invoked:
       - Stop all local tracks on `this._rawStream` and `this._localStream`.
       - Update presence heartbeat immediately to `{ inCall: false }` (`await this._heartbeat()`).
       - Broadcast `{ type: 'call-end' }`.
       - Do **not** destroy the entire connection immediately if the user is still chatting. Only terminate media tracks and senders.
   - In `webrtc.js` `_poll()`:
     - Check if `p.inCall` transitioned from `true` to `false`. If so, fire `this.onCallEnded(p.peerId)`.
     - When an active peer disconnects or leaves (`!aliveIds.has(id)`), if `this._inCall` was active with that peer, invoke `this.onCallEnded(id)`.
2. **Universal Hardware Teardown:**
   - Ensure `onCallEnded` in `wayboard.js` and `templates/social/chat.js`:
     - Stops all tracks on `localStream` and `rawStream`.
     - Clears `srcObject` on all `<video>` and `<audio>` elements (`remoteVideo`, `localVideo`, `remoteAudio`).
     - Toggles UI buttons back to `📹 Call`.

---

### Item 4: Performance Audit & Elimination of Stuttering (`_rowIndex: 7`)

#### The Problem
Multiple independent background loops poll Google Sheets API concurrently:
1. `public/js/app.js` (lines 235-239): `setInterval(..., 60_000)`:
   - `collab.checkSharedSheetDiffs()` loops through *every single accepted document* and executes `api.sheets.getSpreadsheet(docId)`. For a user with 5-10 shared sheets, this triggers 5-10 full network requests per minute.
   - `collab.publishPresenceEverywhere()` writes to every ledger sheet.
2. `public/js/wayboard.js`: `setInterval(..., 15_000)` executes `refreshWaysideSocial()` regardless of user activity.
3. `public/js/checklist.js`: `setInterval(..., 60_000)` executes `loadSheet(currentSheetId)`, triggering full DOM destruction and reconstruction of the main worksheet canvas.
4. `public/js/webrtc.js`: `POLL_MS = 5000` (every 5 seconds) queries `WebRTC_Signaling` tab via Sheets REST API.
5. **DOM Jitter:** When `loadSheet()` or `refreshWaysideSocial()` completes, the DOM nodes are replaced entirely (`innerHTML = ''`), causing reflow, focus loss, and scroll stutter while typing.

#### Codex Implementation Steps
1. **Tab Inactivity & Idle Throttling:**
   - Ensure all polling timers (`app.js`, `wayboard.js`, `checklist.js`, `webrtc.js`) are suspended when `document.hidden` is true (Page Visibility API).
   - If a user is actively typing in any `input`, `textarea`, or `contenteditable` element, delay background refreshes.
2. **Differential / Targeted Updates instead of Full DOM Destruction:**
   - In `refreshWaysideSocial()`, do not wipe `chat-log.innerHTML = ''` on every poll if the message IDs haven't changed. Check message count and timestamps before replacing elements.
   - In `checkSharedSheetDiffs()`, check Drive file modified timestamps (`metadata.modifiedTime`) via a lightweight search rather than fetching the entire grid contents of all sheets.
3. **Consolidate Polling:**
   - Share a single tick dispatcher for social presence and ledger updates rather than having 4 independent `setInterval` timers competing for browser network connections.

---

## 3. Recommended QA Plan

1. **Wayside P2P Chat Verification:**
   - Test two instances in separate browser contexts communicating on a shared ledger.
   - Verify typing and sending a message in Context A appears in Context B in < 500ms without relying on the 15-second Google Sheets poll.
2. **Camera & Microphone Release Verification:**
   - Mock or start a call between User A and User B.
   - User A clicks "End Call".
   - Verify `getAudioTracks().every(t => t.readyState === 'ended')` and `getVideoTracks().every(t => t.readyState === 'ended')` on **both** User A and User B.
3. **Performance & Stuttering Audit:**
   - Profile with Chrome DevTools Performance tab.
   - Verify that when idle on Wayboard or in a sheet, idle CPU usage drops to ~0% and no continuous DOM recreation occurs.
4. **Shared Files List:**
   - Ensure that when a crew or contact is selected, all shared documents from `Shared_Docs` are listed, and clicking one routes to `#/sheet/:id`.
