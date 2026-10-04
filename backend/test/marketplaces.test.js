const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const rakuma = require('../src/scrapers/rakuma');
const mandarake = require('../src/scrapers/mandarake');
const surugaya = require('../src/scrapers/surugaya');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('all requested queries round-trip unchanged, with source stock filters', () => {
  for (const q of ['シムズオンライン', 'EOL-7026', 'EOL-7019', 'シムピープル', '非売品', '時計 & バッグ']) {
    assert.equal(new URL(rakuma.buildUrl(q, 2)).searchParams.get('query'), q);
    assert.equal(new URL(mandarake.buildUrl(q, 2)).searchParams.get('keyword'), q);
    assert.equal(new URL(surugaya.buildUrl(q)).searchParams.get('search_word'), q);
  }
  assert.equal(new URL(rakuma.buildUrl('時計')).searchParams.get('transaction'), 'selling');
  assert.equal(new URL(mandarake.buildUrl('時計')).searchParams.get('soldOut'), '1');
});

test('Rakuma extracts canonical listing, JPY price and lazy image', async () => {
  const p = await browser.newPage();
  await p.setContent(`<div class="item-box"><a class="link_search_title" href="https://item.fril.jp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" data-rat-item_name="シムピープル" data-rat-price="4746">wrong title</a><img src="placeholder" data-original="https://img.fril.jp/test.jpg"></div>`);
  const [item] = await p.evaluate(rakuma.extractCards);
  assert.equal(item.title, 'シムピープル'); assert.equal(item.price, 4746);
  assert.equal(item.image, 'https://img.fril.jp/test.jpg'); assert.equal(item.sold, false);
  await p.setContent('<div class="item-box"><span class="soldout">SOLD OUT</span></div>');
  assert.equal((await p.evaluate(rakuma.extractCards))[0].sold, true);
  await p.close();
});

test('Mandarake uses tax-inclusive price, shop and purchase/stock signals', async () => {
  const p = await browser.newPage();
  await p.setContent(`<div class="block" data-itemidx="123"><div class="title"><a href="https://order.mandarake.co.jp/order/detailPage/item?itemCode=123">非売品</a></div><div class="price">1,200円 (税込 1,320円)</div><div class="thum"><img data-src="https://img.mandarake.co.jp/test.jpg"></div><p class="shop">名古屋店</p><p class="stock">在庫確認します</p><a class="addbasket">カート</a></div>`);
  const [item] = await p.evaluate(mandarake.extractCards);
  assert.equal(item.price, 1320); assert.equal(item.shop, '名古屋店');
  assert.equal(item.purchasable, true); assert.equal(item.sold, false);
  await p.locator('.stock').evaluate(e => { e.textContent = '売り切れ'; });
  assert.equal((await p.evaluate(mandarake.extractCards))[0].sold, true);
  await p.close();
});

test('blocked sources and redirects reject and always close their page', async () => {
  for (const adapter of [rakuma, mandarake]) {
    let closed = false;
    const page = { goto: async () => ({ ok: () => false }), url: () => 'https://www.mandarake.co.jp/', close: async () => { closed = true; } };
    await assert.rejects(adapter.search({ newPage: async () => page }, '非売品'), /unavailable/);
    assert.equal(closed, true);
  }
  const result = await surugaya.search(null, '非売品');
  assert.equal(result.status, 'unavailable'); assert.deepEqual(result.results, []);
  assert.equal(new URL(result.searchUrl).searchParams.get('search_word'), '非売品');
});

test('adapter pagination keeps native-page items and handles a crossing limit', async () => {
  for (const [adapter, size, source] of [[rakuma, 40, 'rakuma'], [mandarake, 48, 'mandarake']]) {
    let current;
    const page = {
      goto: async url => { current = url; return { ok: () => true }; }, url: () => current,
      waitForSelector: async () => {}, close: async () => {},
      locator: () => ({ innerText: async () => '' }),
      evaluate: async () => Array.from({ length: size }, (_, i) => {
        const id = (Number(new URL(current).searchParams.get('page')) - 1) * size + i;
        return { title: `item ${id}`, price: 123, purchasable: true, stock: '在庫あり',
          url: source === 'rakuma' ? `https://item.fril.jp/${id.toString(16).padStart(32, '0')}` : `https://order.mandarake.co.jp/order/detailPage/item?itemCode=${id}` };
      }),
    };
    const context = { newPage: async () => page };
    const second = await adapter.search(context, '非売品', { limit: 20, page: 2 });
    assert.equal(second.results[0].title, 'item 20');
    assert.equal(second.results.length, 20);
    // 7 does not divide either source's native page size.
    const number = Math.floor(size / 7) + 1;
    const crossing = await adapter.search(context, '非売品', { limit: 7, page: number });
    assert.equal(crossing.results.length, 7);
    assert.equal(crossing.results[6].title, `item ${(number - 1) * 7 + 6}`);
  }
});
