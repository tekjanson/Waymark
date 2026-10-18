// @ts-check
/**
 * unit-ai-router.spec.js — Cost-aware, capability-aware AI router.
 *
 * Exercises the pure routing-decision logic (provider selection, cost tiers,
 * capability matrix, free/paid tiers, fallback ordering) by seeding localStorage
 * and importing the router in the page. No network calls are made.
 */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

function seedKeys(config) {
  // Runs in the page: write provider config into localStorage then return the
  // router's routing decisions for assertion.
  return async (cfg) => {
    const L = window.localStorage;
    L.removeItem('waymark_agent_keys');
    L.removeItem('waymark_agent_claude_keys');
    L.removeItem('waymark_agent_openai_keys');
    L.removeItem('waymark_agent_ollama_base_url');
    L.removeItem('waymark_agent_gemini_tier');
    L.removeItem('waymark_agent_enabled_providers');
    L.removeItem('waymark_agent_provider');

    const ring = (k) => [{ key: k, nickname: 'k', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false }];
    if (cfg.gemini) L.setItem('waymark_agent_keys', JSON.stringify(ring('g-key')));
    if (cfg.claude) L.setItem('waymark_agent_claude_keys', JSON.stringify(ring('c-key')));
    if (cfg.openai) L.setItem('waymark_agent_openai_keys', JSON.stringify(ring('o-key')));
    if (cfg.ollama) L.setItem('waymark_agent_ollama_base_url', JSON.stringify('http://127.0.0.1:11434'));
    if (cfg.geminiTier) L.setItem('waymark_agent_gemini_tier', JSON.stringify(cfg.geminiTier));
    if (cfg.enabled) L.setItem('waymark_agent_enabled_providers', JSON.stringify(cfg.enabled));
    if (cfg.provider) L.setItem('waymark_agent_provider', JSON.stringify(cfg.provider));

    const r = await import('/js/ai-router.js');
    return {
      text: r.providersForCapability(r.CAP.TEXT_BASIC),
      vision: r.providersForCapability(r.CAP.VISION_ANALYSIS),
      audio: r.providersForCapability(r.CAP.AUDIO_ANALYSIS),
      image: r.providersForCapability(r.CAP.IMAGE_GENERATION_PHOTOREAL),
      enabled: r.enabledProviders(),
      agentProvider: r.resolveAgentProvider(),
      geminiTier: r.effectiveTier('gemini'),
      openaiTier: r.effectiveTier('openai'),
      claudeTier: r.effectiveTier('claude'),
      ollamaTier: r.effectiveTier('ollama'),
      badges: {
        gemini: r.tierBadge('gemini'),
        openai: r.tierBadge('openai'),
        claude: r.tierBadge('claude'),
        ollama: r.tierBadge('ollama'),
      },
    };
  };
}

test('only Gemini configured → text routes to Gemini, no image provider', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { gemini: true, geminiTier: 'free' });
  expect(out.text).toEqual(['gemini']);
  expect(out.image).toEqual([]); // Gemini Free Tier cannot generate images
  expect(out.vision).toEqual(['gemini']);
  expect(out.audio).toEqual(['gemini']);
});

test('Gemini free + OpenAI → image generation routes to OpenAI only', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { gemini: true, openai: true, geminiTier: 'free' });
  expect(out.image).toEqual(['openai']);
});

test('text tasks prefer the cheapest provider (Gemini free before OpenAI)', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { gemini: true, openai: true, claude: true, geminiTier: 'free' });
  // Cheapest first: gemini(0) < openai(2) < claude(3)
  expect(out.text).toEqual(['gemini', 'openai', 'claude']);
});

test('vision excludes local Ollama but includes Gemini, OpenAI, Claude', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { gemini: true, openai: true, claude: true, ollama: true, geminiTier: 'free' });
  expect(out.vision).toContain('gemini');
  expect(out.vision).toContain('openai');
  expect(out.vision).toContain('claude');
  expect(out.vision).not.toContain('ollama');
});

test('local Ollama is the cheapest text provider (tier 0, first)', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { ollama: true, openai: true, geminiTier: 'free' });
  expect(out.text[0]).toBe('ollama');
});

test('Gemini paid tier raises its cost tier above free', async ({ page }) => {
  await setupApp(page);
  const free = await page.evaluate(seedKeys(), { gemini: true, geminiTier: 'free' });
  const paid = await page.evaluate(seedKeys(), { gemini: true, geminiTier: 'paid' });
  expect(free.geminiTier).toBe(0);
  expect(paid.geminiTier).toBe(1);
  expect(free.badges.gemini).toBe('FREE TIER');
  expect(paid.badges.gemini).toBe('$');
});

test('cost tier badges reflect provider pricing', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { gemini: true, openai: true, claude: true, ollama: true, geminiTier: 'free' });
  expect(out.badges.ollama).toBe('LOCAL/FREE');
  expect(out.badges.openai).toBe('$$');
  expect(out.badges.claude).toBe('$$$');
});

test('explicit enabled list restricts the providers the router may use', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), {
    gemini: true, openai: true, claude: true, geminiTier: 'free',
    enabled: ['openai'],
  });
  expect(out.enabled).toEqual(['openai']);
  expect(out.text).toEqual(['openai']);
});

test('resolveAgentProvider falls back to cheapest when preferred is not configured', async ({ page }) => {
  await setupApp(page);
  // Preferred = claude, but only gemini is configured → use gemini.
  const out = await page.evaluate(seedKeys(), { gemini: true, provider: 'claude', geminiTier: 'free' });
  expect(out.agentProvider).toBe('gemini');
});

test('resolveAgentProvider honours the preferred provider when configured', async ({ page }) => {
  await setupApp(page);
  const out = await page.evaluate(seedKeys(), { gemini: true, claude: true, provider: 'claude', geminiTier: 'free' });
  expect(out.agentProvider).toBe('claude');
});
