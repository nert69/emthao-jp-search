const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { browserEnvironment } = require('../../scripts/browser-environment.cjs');

test('Windows launcher uses installed cache when LOCALAPPDATA points to a temporary folder', () => {
  const home = path.resolve('test-user');
  const expected = path.join(home, 'AppData', 'Local', 'ms-playwright');
  const env = { LOCALAPPDATA: path.join(home, 'temporary-container'), CUSTOM_SETTING: 'preserved' };
  const selected = browserEnvironment(env, { platform: 'win32', home, exists: cache => cache === expected });
  assert.equal(selected.PLAYWRIGHT_BROWSERS_PATH, expected);
  assert.equal(selected.LOCALAPPDATA, env.LOCALAPPDATA);
  assert.equal(selected.CUSTOM_SETTING, 'preserved');
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, undefined);
});

test('Explicit custom and hermetic Playwright paths are preserved', () => {
  for (const configured of ['D:\\custom-browsers', '0']) {
    const env = { PLAYWRIGHT_BROWSERS_PATH: configured };
    assert.equal(browserEnvironment(env, { platform: 'win32', exists: () => true }), env);
  }
});

test('A missing user cache and non-Windows launchers retain the original environment', () => {
  const env = { LOCALAPPDATA: 'temporary' };
  assert.equal(browserEnvironment(env, { platform: 'win32', exists: () => false }), env);
  assert.equal(browserEnvironment(env, { platform: 'linux', exists: () => true }), env);
});
