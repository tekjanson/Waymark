const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

const FINISH_DETAILS = 'Use matte plaster on the existing walls and a subtle oak grain on the modeled surfaces, with soft shadows and realistic reflections.';

async function configureAI(page, { gemini = true, model = 'gpt-5-mini', imageModel = 'gpt-image-1' } = {}) {
  await setupApp(page);
  await page.evaluate(async ({ gemini, model, imageModel }) => {
    const storage = await import('/js/storage.js');
    const key = value => [{ key: value, requestsToday: 0, lastError: null, isBilled: false }];
    window.__WAYMARK_API_KEY = null;
    window.__WAYMARK_OPENAI_KEY = null;
    window.__WAYMARK_CLAUDE_KEY = null;
    storage.setAgentKeys(gemini ? key('test-gemini-key') : []);
    storage.setOpenAIKeys(key('test-openai-key'));
    storage.setClaudeKeys([]);
    storage.setAgentModel('gemini-3.5-flash-lite');
    storage.setOpenAIModel(model);
    storage.setOpenAIImageModel(imageModel);
    storage.setEnabledProviders(gemini ? ['openai', 'gemini'] : ['openai']);
    storage.setAgentProvider('openai');
  }, { gemini, model, imageModel });
}

// Reject the invalid parameters from the reported requests instead of using
// the renderer's image mock, so these tests exercise the real adapters.
async function interceptAI(page, { geminiFailures = 0, geminiStatus = 503, imageStatus = 200 } = {}) {
  const calls = { gemini: [], chats: [], generations: [], edits: [], unexpected: [] };
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const reply = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const reject = (route, message) => reply(route, 400, { error: { message, code: 'invalid_request_error' } });
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    const request = route.request();
    const body = request.postDataJSON();
    calls.gemini.push({ url: request.url(), body, at: Date.now() });
    if (calls.gemini.length <= geminiFailures) {
      return reply(route, geminiStatus, { error: { message: 'Gemini temporarily unavailable', code: geminiStatus } });
    }
    return reply(route, 200, { candidates: [{ content: { parts: [{ text: FINISH_DETAILS }] } }] });
  });
  await page.route('https://api.openai.com/v1/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/v1/chat/completions') {
      const body = request.postDataJSON();
      calls.chats.push(body);
      const reasoning = /^(?:gpt-[5-9]|o\d)/.test(body.model);
      if (reasoning && ('max_tokens' in body || 'temperature' in body)) {
        return reject(route, 'Unsupported parameter: max_tokens or temperature');
      }
      return reply(route, 200, { choices: [{ message: { content: 'Ready' } }] });
    }
    if (pathname === '/v1/images/generations') {
      const body = request.postDataJSON();
      calls.generations.push(body);
      if ('seed' in body || 'response_format' in body || body.model.startsWith('dall-e-')) {
        return reject(route, 'Unsupported image request parameter or retired model');
      }
      if (!['auto', '1024x1024', '1536x1024', '1024x1536'].includes(body.size)) {
        return reject(route, 'Invalid image size');
      }
      return reply(route, 200, { data: [{ b64_json: png }] });
    }
    if (pathname === '/v1/images/edits') {
      const contentType = request.headers()['content-type'];
      const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': contentType } }).formData();
      const image = form.get('image');
      const fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'));
      const bytes = image && typeof image !== 'string' ? Buffer.from(await image.arrayBuffer()) : null;
      calls.edits.push({ fields, bytes, contentType, mimeType: image?.type });
      if (!bytes || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return reject(route, 'Invalid reference PNG');
      if ('seed' in fields || 'response_format' in fields) return reject(route, 'Unsupported image edit parameter');
      if (imageStatus !== 200) return reply(route, imageStatus, { error: { message: 'Image access not enabled for this project', param: 'model' } });
      return reply(route, 200, { data: [{ b64_json: png }] });
    }
    calls.unexpected.push(pathname);
    return reject(route, 'Unexpected OpenAI endpoint');
  });
  return calls;
}

for (const model of ['gpt-5-mini', 'o3', 'gpt-4o-mini']) {
  test(`OpenAI text generation uses parameters accepted by ${model}`, async ({ page }) => {
    await configureAI(page, { model });
    const calls = await interceptAI(page);
    const result = await page.evaluate(async () => {
      const shared = await import('/js/templates/shared.js');
      return shared.generateText('Be concise.', 'Describe plaster.', { provider: 'openai', maxTokens: 700, temperature: 0.4 });
    });
    expect(result).toBe('Ready');
    expect(calls.chats).toHaveLength(1);
    expect(calls.chats[0].model).toBe(model);
    if (model === 'gpt-4o-mini') {
      expect(calls.chats[0]).toMatchObject({ max_tokens: 700, temperature: 0.4 });
    } else {
      expect(calls.chats[0].max_completion_tokens).toBe(700);
      expect(calls.chats[0]).not.toHaveProperty('temperature');
      expect(calls.chats[0]).not.toHaveProperty('max_tokens');
    }
    expect(calls.gemini).toHaveLength(0);
    const agentBody = await page.evaluate(async model => {
      const config = await import('/js/agent/config.js');
      return config.buildOpenAiRequestBody([{ role: 'user', parts: [{ text: 'Hello' }] }], 'Be concise.', model);
    }, model);
    expect(agentBody[model === 'gpt-4o-mini' ? 'max_tokens' : 'max_completion_tokens']).toBe(4096);
  });
}

test('text-only GPT Image requests omit seed and translate legacy landscape sizes', async ({ page }) => {
  await configureAI(page);
  const calls = await interceptAI(page);
  const result = await page.evaluate(async () => {
    const { routeAI, CAP } = await import('/js/ai-router.js');
    return routeAI(CAP.IMAGE_GENERATION_PHOTOREAL, { prompt: 'Existing room.', size: '1792x1024', seed: 123 });
  });
  expect(result).toMatch(/^data:image\/png;base64,/);
  expect(calls.generations).toEqual([{ model: 'gpt-image-1', prompt: 'Existing room.', n: 1, size: '1536x1024' }]);
});

test('a saved retired DALL-E selection uses the configured GPT Image default', async ({ page }) => {
  await configureAI(page, { imageModel: 'dall-e-3' });
  const calls = await interceptAI(page);
  await page.evaluate(async () => {
    const { generateImage } = await import('/js/templates/shared.js');
    await generateImage('Existing room.');
  });
  expect(calls.generations[0].model).toBe('gpt-image-1');
  expect(calls.generations[0]).not.toHaveProperty('response_format');
});

test('unsupported GPT Image dimensions fail before an API request', async ({ page }) => {
  await configureAI(page);
  const calls = await interceptAI(page);
  const error = await page.evaluate(async () => {
    const { generateImage } = await import('/js/templates/shared.js');
    try { await generateImage('Existing room.', { size: '900x500' }); }
    catch (error) { return error.message; }
  });
  expect(error).toContain('supports auto, 1024x1024');
  expect(calls.generations).toHaveLength(0);
});

async function renderPhoto(page) {
  await navigateToSheet(page, 'sheet-075');
  await page.locator('.floorplan-ai-render-btn').click();
  await page.locator('.floorplan-ai-photoreal-btn').click();
}

test('Gemini enrichment retries a 503 and OpenAI edits exactly the same 3D reference', async ({ page }) => {
  await configureAI(page);
  const calls = await interceptAI(page, { geminiFailures: 1 });
  await renderPhoto(page);
  await expect(page.locator('.floorplan-ai-photoreal-img')).toBeVisible({ timeout: 15_000 });
  expect(calls.gemini).toHaveLength(2);
  expect(calls.gemini[1].at - calls.gemini[0].at).toBeGreaterThanOrEqual(900);
  expect(calls.gemini[0].url).toContain('gemini-3.5-flash-lite:generateContent');
  expect(calls.gemini[0].body.generationConfig).not.toHaveProperty('temperature');
  const image = calls.gemini[0].body.contents[0].parts.find(part => part.inlineData).inlineData;
  expect(image.mimeType).toBe('image/png');
  expect(calls.edits).toHaveLength(1);
  expect(calls.edits[0].bytes.equals(Buffer.from(image.data, 'base64'))).toBe(true);
  expect(calls.edits[0].fields).toMatchObject({ model: 'gpt-image-1', input_fidelity: 'high', size: 'auto', n: '1' });
  expect(calls.edits[0].fields.prompt).toContain(FINISH_DETAILS);
  expect(calls.edits[0].fields.prompt).toContain('including awkward, incomplete, or imperfect parts');
  expect(calls.edits[0].contentType).toContain('multipart/form-data; boundary=');
  expect(calls.chats).toHaveLength(0);
  expect(calls.generations).toHaveLength(0);
  await expect(page.locator('.floorplan-ai-enrichment-status')).toContainText('Gemini refined');
});

test('persistent Gemini overload is bounded and still produces the OpenAI render', async ({ page }) => {
  await configureAI(page);
  const calls = await interceptAI(page, { geminiFailures: Infinity });
  await renderPhoto(page);
  await expect(page.locator('.floorplan-ai-photoreal-img')).toBeVisible({ timeout: 15_000 });
  expect(calls.gemini).toHaveLength(3);
  expect(calls.edits).toHaveLength(1);
  expect(calls.edits[0].fields.prompt).toContain('Treat the reference image as the source of truth');
  expect(calls.chats).toHaveLength(0);
  await expect(page.locator('.floorplan-ai-enrichment-status')).toContainText('original scene instructions');
  await expect(page.locator('.floorplan-ai-photoreal-btn')).toBeEnabled();
});

test('a Gemini permission error is not retried and cannot block the image render', async ({ page }) => {
  await configureAI(page);
  const calls = await interceptAI(page, { geminiFailures: Infinity, geminiStatus: 403 });
  await renderPhoto(page);
  await expect(page.locator('.floorplan-ai-photoreal-img')).toBeVisible({ timeout: 15_000 });
  expect(calls.gemini).toHaveLength(1);
  expect(calls.edits).toHaveLength(1);
  expect(calls.chats).toHaveLength(0);
});

test('OpenAI-only setups can render without a Gemini request', async ({ page }) => {
  await configureAI(page, { gemini: false });
  const calls = await interceptAI(page);
  await renderPhoto(page);
  await expect(page.locator('.floorplan-ai-photoreal-img')).toBeVisible({ timeout: 15_000 });
  expect(calls.gemini).toHaveLength(0);
  expect(calls.edits).toHaveLength(1);
});

test('OpenAI edit errors show the provider message and leave the render button usable', async ({ page }) => {
  await configureAI(page);
  const calls = await interceptAI(page, { imageStatus: 400 });
  await renderPhoto(page);
  await expect(page.locator('.floorplan-ai-status')).toContainText('Image access not enabled for this project');
  await expect(page.locator('.floorplan-ai-status')).toContainText('gpt-image-1');
  await expect(page.locator('.floorplan-ai-photoreal-btn')).toBeEnabled();
  await expect(page.locator('.floorplan-ai-photoreal-img')).toHaveCount(0);
  expect(calls.edits).toHaveLength(1);
  expect(calls.generations).toHaveLength(0);
});
