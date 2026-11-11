// @ts-check
const { test, expect } = require('@playwright/test');

// The Wayside AI agent runs on werift (Node.js). Its WebRTC *offerer* path with a
// browser answerer is unreliable — the DataChannel opens then drops within seconds,
// looping forever (seen in production as the browser stuck on "Pairing"/"Listening").
// The fix pins the handshake to the stable direction: a browser/native client always
// OFFERS to the agent, and the agent (peerId prefixed `ai-`) always ANSWERS. Both
// sides must compute this identically. These tests lock that invariant in.

function makePeer(peerId) {
  // Constructed lazily; _shouldInitiateHandshake only reads peerId/block/_initiatorRule.
  return import('../../mcp/sheet-webrtc-peer.mjs').then(({ SheetWebRtcPeer }) => {
    const p = new SheetWebRtcPeer({ sheetId: 'x', peerId, tabName: 'WebRTC_Signaling', blockStart: 2, initiatorRule: 'peerId' });
    p.block = 2;
    return p;
  });
}

test('agent always answers a browser peer regardless of peerId ordering', async () => {
  // fefdda96 sorts AFTER ai-* (so the old peerId rule made the agent the offerer → flap).
  const agent = await makePeer('ai-84ea14');
  expect(agent._shouldInitiateHandshake('fefdda96', 3)).toBe(false);
  // 89894bfe sorts BEFORE ai-* — agent still answers, never offers.
  expect(agent._shouldInitiateHandshake('89894bfe', 3)).toBe(false);
  // Even an 'a'-prefixed browser id (not the literal `ai-` prefix) is a browser.
  expect(agent._shouldInitiateHandshake('a1b2c3d4', 3)).toBe(false);
});

test('browser always offers to the agent regardless of peerId ordering', async () => {
  const browserHigh = await makePeer('fefdda96');
  expect(browserHigh._shouldInitiateHandshake('ai-84ea14', 2)).toBe(true);
  const browserLow = await makePeer('89894bfe');
  expect(browserLow._shouldInitiateHandshake('ai-84ea14', 2)).toBe(true);
});

test('exactly one peer initiates for every browser↔agent pair (no deadlock, no glare)', async () => {
  const pairs = [['fefdda96', 'ai-84ea14'], ['89894bfe', 'ai-5f96d8'], ['a1b2c3d4', 'ai-5f96d8']];
  for (const [browserId, agentId] of pairs) {
    const browser = await makePeer(browserId);
    const agent = await makePeer(agentId);
    const browserInit = browser._shouldInitiateHandshake(agentId, 2);
    const agentInit = agent._shouldInitiateHandshake(browserId, 2);
    expect(browserInit).toBe(true);
    expect(agentInit).toBe(false);
    expect(browserInit).not.toBe(agentInit);
  }
});

test('same-type peers fall back to deterministic peerId ordering', async () => {
  // Two browsers.
  const b1 = await makePeer('3fa2b1c9');
  const b2 = await makePeer('b2c3d4e5');
  expect(b1._shouldInitiateHandshake('b2c3d4e5', 7)).toBe(true);
  expect(b2._shouldInitiateHandshake('3fa2b1c9', 2)).toBe(false);
  // Two agents.
  const a1 = await makePeer('ai-111111');
  const a2 = await makePeer('ai-222222');
  expect(a1._shouldInitiateHandshake('ai-222222', 7)).toBe(true);
  expect(a2._shouldInitiateHandshake('ai-111111', 2)).toBe(false);
});
