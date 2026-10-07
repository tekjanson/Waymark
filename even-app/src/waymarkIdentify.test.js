/**
 * waymarkIdentify.test.js — unit tests for the Gemini point-and-identify path.
 * Run with: node --test src/waymarkIdentify.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIdentifyRequest,
  parseIdentifyResponse,
  identifyPointedObject,
  DEFAULT_VISION_MODEL,
} from './waymarkIdentify.js';

test('buildIdentifyRequest embeds the question and the inline image', () => {
  const req = buildIdentifyRequest({ imageBase64: 'QUJD', question: 'what is this?' });
  assert.match(req.url, /generativelanguage\.googleapis\.com/);
  assert.match(req.url, /:generateContent$/);
  const parts = req.body.contents[0].parts;
  assert.equal(parts[0].text, 'what is this?');
  assert.equal(parts[1].inlineData.data, 'QUJD');
  assert.equal(parts[1].inlineData.mimeType, 'image/jpeg');
  assert.ok(req.body.systemInstruction.parts[0].text.length > 0);
});

test('buildIdentifyRequest defaults the question and model', () => {
  const req = buildIdentifyRequest({ imageBase64: 'x' });
  assert.equal(req.body.contents[0].parts[0].text, 'What am I pointing at?');
  assert.match(req.url, new RegExp(DEFAULT_VISION_MODEL));
});

test('parseIdentifyResponse extracts the answer text', () => {
  const data = { candidates: [{ content: { parts: [{ text: 'A red coffee mug.' }] } }] };
  assert.equal(parseIdentifyResponse(data), 'A red coffee mug.');
});

test('parseIdentifyResponse throws when the prompt is blocked', () => {
  assert.throws(
    () => parseIdentifyResponse({ promptFeedback: { blockReason: 'SAFETY' } }),
    /blocked/i,
  );
});

test('identifyPointedObject posts to Gemini and returns the answer', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'A laptop.' }] } }] }),
    };
  };

  const out = await identifyPointedObject({
    imageBase64: 'QUJD',
    question: 'what?',
    apiKey: 'test-key',
    model: 'gemini-2.0-flash',
    fetchImpl: fakeFetch,
  });

  assert.equal(out, 'A laptop.');
  assert.equal(captured.opts.headers['X-goog-api-key'], 'test-key');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.contents[0].parts[1].inlineData.data, 'QUJD');
});

test('identifyPointedObject rejects without an API key', async () => {
  await assert.rejects(
    () => identifyPointedObject({ imageBase64: 'x', apiKey: '' }),
    /API key/i,
  );
});

test('identifyPointedObject surfaces Gemini HTTP errors', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { message: 'API key not valid' } }),
  });
  await assert.rejects(
    () => identifyPointedObject({ imageBase64: 'x', apiKey: 'bad', fetchImpl: fakeFetch }),
    /API key not valid/,
  );
});
