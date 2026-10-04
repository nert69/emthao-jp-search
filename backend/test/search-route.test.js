const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Exercise the real route/cache/timeout boundary without depending on marketplaces.
process.env.SCRAPER_TIMEOUT_MS = '30';
let closes = 0;
const browserPath = require.resolve('../src/browser');
require.cache[browserPath] = { exports: { newContext: async () => ({ close: async () => { closes++; } }) } };
const queries = [];
for (const name of ['mercari', 'yahoo', 'paypay', 'rakuma', 'mandarake', 'surugaya']) {
  const path = require.resolve(`../src/scrapers/${name}`);
  require.cache[path] = { exports: { search: async (_c, q, opts) => {
    queries.push({ name, q, opts });
    if (name === 'mandarake') throw new Error('blocked');
    if (name === 'mercari') return new Promise(() => {});
    if (name === 'surugaya') return { results: [], status: 'unavailable', hasMore: false, searchUrl: 'https://www.suruga-ya.jp/search', message: 'Unavailable' };
    const item = { title: q, source: name, price: 123, url: `https://example.com/${name}` };
    return name === 'rakuma' ? { results: [item], status: 'ok', hasMore: true } : [item, item];
  } } };
}
const app = express();
app.use(require('../src/routes/search'));

test('combined search isolates failure/timeout, deduplicates, caches and preserves JP queries', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const url = `${base}/search?${new URLSearchParams({ q: 'シムズオンライン', page: '2' })}`;
    const result = await (await fetch(url)).json();
    assert.equal(result.count, 3); assert.equal(result.sources.length, 6);
    assert.equal(result.sourceStatus.mandarake.status, 'unavailable');
    assert.equal(result.sourceStatus.mercari.status, 'unavailable');
    assert.equal(result.sourceStatus.rakuma.hasMore, true);
    assert.ok(queries.every(call => call.q === 'シムズオンライン' && call.opts.page === 2));
    assert.equal(closes, 1);
    assert.equal((await (await fetch(url)).json()).cached, true);
    assert.equal(closes, 1);
    assert.equal((await fetch(`${base}/search?q=test&sources=invalid`)).status, 400);
    const single = await (await fetch(`${base}/search?q=EOL-7019&sources=rakuma`)).json();
    assert.deepEqual(single.sources, ['rakuma']); assert.equal(single.count, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
