// GBP default, decimal filters, legacy pricing and saved currency regression check.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Simulate a user with the old VND-only cached pricing from before this change.
    await page.addInitScript(() => localStorage.setItem('emthao.pricing', JSON.stringify({ rate: 185, markupPct: 20, shipVndPerKg: 175000, defaultWeightKg: 0.2 })));
    await page.route('**/health', r => r.fulfill({ json: { status: 'ok', browserConnected: true }, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await page.route('**/search?**', r => r.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
      results: [1000, 2000, 3000].map(price => ({ source: 'mercari', title: `Item ${price}`, price, url: `https://example.com/${price}` })),
      sourceStatus: Object.fromEntries(['mercari', 'yahoo', 'paypay', 'rakuma', 'mandarake', 'surugaya'].map(s => [s, { status: 'ok', hasMore: false }])),
    } }));
    await page.goto(process.env.FRONTEND_URL || 'http://localhost:5173');
    assert.equal(await page.getByLabel('Estimate currency').inputValue(), 'gbp');
    assert.equal(await page.locator('.weight-input').count(), 0);
    await page.fill('.search-input', 'テスト');
    await page.click('.search-submit');
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 3);
    assert.deepEqual((await page.locator('.price-vnd').allTextContents()).map(s => s.trim()), ['≈ £4.80', '≈ £9.61', '≈ £14.41']);
    assert.match(await page.locator('.app-footer').innerText(), /item price only; fees, shipping and taxes extra/);
    await page.getByRole('tab', { name: 'GBP', exact: true }).click();
    const max = page.getByPlaceholder('Max £');
    await max.fill('9.');
    assert.equal(await max.inputValue(), '9.');
    await max.press('6');
    await max.press('1');
    assert.equal(await max.inputValue(), '9.61');
    assert.equal(await page.locator('.card').count(), 2);
    // A displayed price exactly on the pence boundary stays included.
    assert.match(await page.locator('.card').last().innerText(), /Item 2000/);
    await page.getByPlaceholder('Min £').fill('9.61');
    assert.equal(await page.locator('.card').count(), 1);
    await page.locator('.filter-reset').click();
    assert.equal(await page.locator('.card').count(), 3);
    await page.locator('.bookmark-btn').first().click();
    await page.getByRole('tab', { name: /Bookmarks/ }).click();
    assert.match(await page.locator('.price-vnd').innerText(), /£4\.80/);
    await page.getByLabel('Estimate currency').selectOption('vnd');
    assert.match(await page.locator('.price-vnd').innerText(), /257\.000 đ/);
    assert.equal(await page.locator('.weight-input').count(), 1);
    await page.reload();
    assert.equal(await page.getByLabel('Estimate currency').inputValue(), 'vnd');
    await page.getByLabel('Estimate currency').selectOption('gbp');
    await page.reload();
    assert.equal(await page.getByLabel('Estimate currency').inputValue(), 'gbp');
    await page.getByRole('tab', { name: /Bookmarks/ }).click();
    assert.match(await page.locator('.price-vnd').innerText(), /£4\.80/);
    assert.deepEqual(errors, []);
    console.log('GBP default, old cached pricing, decimal/pence filters, bookmarks, VND compatibility and saved currency passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
