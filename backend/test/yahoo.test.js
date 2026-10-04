const { test } = require('node:test');
const assert = require('node:assert/strict');
const yahoo = require('../src/scrapers/yahoo');

test('Yahoo regional block is unavailable rather than an empty successful search', async () => {
  let closed = false;
  const page = {
    goto: async () => ({ ok: () => false, status: () => 403 }),
    locator: () => ({ innerText: async () => 'Yahoo! JAPAN is no longer available in the EEA and the United Kingdom' }),
    close: async () => { closed = true; },
    waitForSelector: async () => { throw new Error('Should not wait on a blocked response'); },
  };
  const result = await yahoo.search({ newPage: async () => page }, 'シムピープル');
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.results, []);
  assert.match(result.message, /UK\/EEA/);
  assert.equal(result.hasMore, false);
  assert.equal(closed, true);
});
