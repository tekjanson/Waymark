// @ts-check
const { test } = require('@playwright/test');

/*
 * .waymarkIgnore tests — SKIPPED after Google Picker migration.
 *
 * The folder-tree explorer that displayed folder contents (with expand/
 * collapse) and applied .waymarkIgnore filtering has been replaced by a
 * Google Picker + recent/pinned sheets UI. The .waymarkIgnore feature
 * no longer has a user-facing surface in the explorer view.
 *
 * The applyWaymarkIgnore() function still exists as a stub for potential
 * future folder-view usage but is not currently exercised in the UI.
 */

test.skip('expanding a folder with .waymarkIgnore filters matching items', async () => {});
test.skip('.waymarkIgnore file itself is hidden from the listing', async () => {});
test.skip('.waymarkIgnore supports comments and blank lines', async () => {});
test.skip('.waymarkIgnore with no matching patterns shows all items', async () => {});
test.skip('empty .waymarkIgnore shows all items', async () => {});
test.skip('.waymarkIgnore supports glob wildcard patterns', async () => {});
test.skip('clicking ignore button creates .waymarkIgnore and hides item', async () => {});
test.skip('clicking ignore button appends to existing .waymarkIgnore', async () => {});
test.skip('ignored items stay hidden after collapsing and re-expanding folder', async () => {});
test.skip('newly ignored item stays hidden after re-expanding folder', async () => {});
test.skip('root .waymarkIgnore filters matching root-level folders', async () => {});
test.skip('root .waymarkIgnore with glob hides matching folders', async () => {});
test.skip('root .waymarkIgnore with no matches shows all root folders', async () => {});
test.skip('clicking ignore on root folder creates root .waymarkIgnore', async () => {});
