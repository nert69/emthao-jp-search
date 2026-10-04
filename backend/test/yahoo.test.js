const { test } = require('node:test');
const assert = require('node:assert/strict');
const yahoo = require('../src/scrapers/yahoo');
const proxy = require('../src/scrapers/marketProxy');

test('Yahoo regional block triggers a real-result provider fallback', async () => {
  let closed = false;
  const page = {
    goto: async () => ({ ok: () => false, status: () => 403 }),
    locator: () => ({ innerText: async () => 'Yahoo! JAPAN is no longer available in the EEA and the United Kingdom' }),
    close: async () => { closed = true; },
    waitForSelector: async () => { throw new Error('Should not wait on a blocked response'); },
  };
  const original = proxy.search;
  proxy.search = async (_context, query, opts, source) => {
    assert.equal(query, 'シムピープル'); assert.equal(source, 'yahoo'); assert.equal(opts.page, 2);
    return { results: [{ source: 'yahoo', title: query, price: 500 }], status: 'ok', hasMore: false };
  };
  try {
    const result = await yahoo.search({ newPage: async () => page }, 'シムピープル', { page: 2 });
    assert.equal(result.status, 'ok'); assert.equal(result.results.length, 1); assert.equal(closed, true);
  } finally { proxy.search = original; }
});
