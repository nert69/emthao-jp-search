// Deterministic pagination regression test. Requires the frontend on :5173.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sources = ['mercari', 'yahoo', 'paypay', 'rakuma', 'mandarake', 'surugaya'];
const active = ['mercari', 'yahoo', 'paypay'];

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests = [];
    const errors = [];
    let releaseYahoo;
    let yahooGate = new Promise(resolve => { releaseYahoo = resolve; });
    let failure = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/health', route => route.fulfill({ json: { status: 'ok', browserConnected: true }, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.route('**/search?**', async route => {
      const params = new URL(route.request().url()).searchParams;
      const requested = params.get('sources')?.split(',') || sources;
      const number = Number(params.get('page') || 1);
      const q = params.get('q');
      requests.push({ requested, number, q });
      if (number === 2 && requested.includes('yahoo')) await yahooGate;
      const results = requested.filter(s => active.includes(s) && !(failure && s === 'yahoo')).flatMap(source => Array.from({ length: 20 }, (_, i) => {
        // A repeated card on page 2 must not move or duplicate the page 1 card.
        const itemPage = source === 'mercari' && number === 2 && i === 0 ? 1 : number;
        return { source, title: `${q} ${source} ${itemPage}-${i}`, price: 5000 - number * 100 - i,
          url: `https://example.com/${q}/${source}/${itemPage}/${i}`, currency: 'JPY' };
      }));
      await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
        results, sourceStatus: Object.fromEntries(requested.map(s => [s, {
          status: failure && s === 'yahoo' ? 'unavailable' : 'ok',
          hasMore: active.includes(s) && !(failure && s === 'yahoo') && (s === 'yahoo' ? number < 4 : number < 3),
          ...(failure && s === 'yahoo' ? { message: 'Temporary Yahoo failure' } : {}),
        }])),
      } }).catch(() => {}); // Aborted old searches may no longer have a live request.
    });
    const titles = () => page.locator('.card-title').allTextContents();
    await page.goto(process.env.FRONTEND_URL || 'http://localhost:5173');
    await page.fill('.search-input', 'シムピープル');
    await page.click('.search-submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 60);
    await page.getByRole('tab', { name: /Mercari/ }).click();
    await page.getByRole('button', { name: 'Load next page' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 19);
    await page.getByRole('tab', { name: /^All \d/ }).click();
    const earlier = await titles();
    assert.equal(earlier.length, 79);
    const requestStart = requests.length;
    await page.locator('.load-more').click();
    // Yahoo is deliberately held open; the other sources must already be visible.
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 119);
    assert.deepEqual((await titles()).slice(0, earlier.length), earlier);
    assert.match(await page.locator('.load-more-progress [role=status]').innerText(), /Yahoo Auctions/);
    assert.equal(await page.locator('.load-more').isDisabled(), true);
    assert.deepEqual(requests.slice(requestStart).map(r => [r.requested.join(','), r.number]).sort(), [
      ['mercari', 3], ['paypay', 2], ['yahoo', 2],
    ]);
    releaseYahoo();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 139 && !document.querySelector('.load-more')?.disabled);
    assert.deepEqual((await titles()).slice(0, earlier.length), earlier);
    // Explicit price sorting retains its existing global meaning.
    await page.locator('.sort-select').selectOption('price-asc');
    assert.match((await titles())[0], /mercari 3-19/);
    await page.locator('.sort-select').selectOption('relevance');
    assert.deepEqual((await titles()).slice(0, earlier.length), earlier);
    // Exhausted sources stop being requested independently of other sources.
    const nextStart = requests.length;
    await page.locator('.load-more').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 179 && !document.querySelector('.load-more')?.disabled);
    assert.deepEqual(requests.slice(nextStart).map(r => [r.requested.join(','), r.number]).sort(), [['paypay', 3], ['yahoo', 3]]);
    failure = true;
    await page.locator('.load-more').click();
    await page.waitForSelector('.source-warning');
    assert.equal((await titles()).length, 179);
    await page.getByRole('tab', { name: /Yahoo Auctions/ }).click();
    assert.equal(await page.locator('.pager-page').count(), 3);
    failure = false;
    await page.locator('.search-refresh').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 20 && !document.querySelector('.search-refresh')?.disabled);
    await page.getByRole('tab', { name: /^All \d/ }).click();
    assert.equal((await titles()).length, 60);
    // Cancel an in-progress append by going home and starting a new query.
    yahooGate = new Promise(resolve => { releaseYahoo = resolve; });
    await page.locator('.load-more').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length > 60);
    await page.getByRole('button', { name: 'Go to home' }).click();
    await page.fill('.search-input', '新しい検索');
    await page.click('.search-submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 60);
    releaseYahoo();
    await page.waitForFunction(() => !document.querySelector('.search-submit')?.disabled);
    assert.ok((await titles()).every(title => title.includes('新しい検索')));
    // Yahoo mode still resets all pages without retaining old appended cards.
    await page.getByRole('tab', { name: 'Auction', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.search-submit')?.disabled);
    assert.equal((await titles()).length, 60);
    assert.deepEqual(errors, []);
    console.log('Stable append, progressive results, exhausted sources, per-source cursors, deduplication, failure, refresh, sorting, cancellation and Yahoo mode passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
