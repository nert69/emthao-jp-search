// Deterministic UI regression test. Run with the frontend dev server on :5173.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sources = ['mercari', 'yahoo', 'paypay', 'rakuma', 'mandarake', 'surugaya'];
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/health', route => route.fulfill({ json: { status: 'ok', browserConnected: true }, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.route('**/search?**', route => {
      const params = new URL(route.request().url()).searchParams;
      const requested = params.get('sources')?.split(',') || sources;
      const number = Number(params.get('page') || 1);
      const results = requested.filter(s => s !== 'surugaya').flatMap(source => Array.from({ length: 20 }, (_, i) => ({
        source, title: `${params.get('q')} ${source} ${number}-${i}`, price: 1320, currency: 'JPY',
        url: `https://example.com/${source}/${number}/${i}`, image: null,
        ...(source === 'yahoo' ? { provider: 'Buyee', buyeeUrl: `https://buyee.jp/item/jdirectitems/auction/a${number}${i}`, zenmarketUrl: `https://zenmarket.jp/auction.aspx?itemCode=a${number}${i}` } : {}),
        ...(source === 'mandarake' ? { shop: '名古屋店', availability: 'stock_confirmation' } : {}),
      })));
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
        results, sourceStatus: Object.fromEntries(requested.map(s => [s, s === 'surugaya'
          ? { status: 'unavailable', hasMore: false, message: 'Surugaya unavailable', searchUrl: 'https://www.suruga-ya.jp/search' }
          : { status: 'ok', hasMore: number < 2 }])),
      } });
    });
    await page.goto(process.env.FRONTEND_URL || 'http://localhost:5173');
    await page.fill('.search-input', 'シムズオンライン');
    await page.click('.search-submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 100);
    assert.equal(await page.locator('.source-tabs .source-tab').count(), 7);
    assert.match(await page.locator('.source-warning').innerText(), /Surugaya/);
    await page.getByRole('tab', { name: /Yahoo Auctions/ }).click();
    const yahooCard = page.locator('.card').first();
    assert.match(await yahooCard.innerText(), /via Buyee/);
    assert.match(await yahooCard.getByRole('link', { name: 'Buyee', exact: true }).getAttribute('href'), /buyee.jp/);
    assert.match(await yahooCard.getByRole('link', { name: 'ZenMarket', exact: true }).getAttribute('href'), /zenmarket.jp/);
    assert.match(await yahooCard.locator('.card-image-link').getAttribute('href'), /buyee.jp/);
    await page.getByRole('tab', { name: /Rakuma/ }).click();
    assert.equal(await page.locator('.card').count(), 20);
    await page.locator('.bookmark-btn').first().click();
    await page.getByRole('tab', { name: /Mandarake/ }).click();
    assert.match(await page.locator('.card').first().innerText(), /Stock confirmation required/);
    await page.getByRole('tab', { name: /^All/ }).click();
    await page.locator('.load-more').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 200);
    await page.locator('.search-refresh').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 100);
    // Persistence check independent of presentation details of the view toggle.
    const saved = await page.evaluate(() => Object.keys(localStorage).filter(k => /bookmark/.test(k)).map(k => localStorage.getItem(k)).join(''));
    assert.match(saved, /rakuma/);
    await page.reload();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => /bookmark/.test(k)).map(k => localStorage.getItem(k)).join('')), saved);
    assert.deepEqual(errors, []);
    console.log('New source tabs, stock metadata, warning, combined pagination, refresh and bookmark persistence passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
