const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const proxy = require('../src/scrapers/marketProxy');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('proxy queries preserve Japanese and separate Yahoo and PayPay', () => {
  for (const q of ['シムズオンライン', 'EOL-7026', 'EOL-7019', 'シムピープル', '非売品']) {
    assert.equal(new URL(proxy.buyeeUrl(q, 'yahoo')).searchParams.get('query'), q);
    assert.equal(new URL(proxy.zenUrl(q, 'surugaya')).searchParams.get('q'), q);
  }
  assert.equal(new URL(proxy.buyeeUrl('x', 'paypay')).searchParams.get('item_type'), 'fleamarket');
  assert.equal(new URL(proxy.buyeeUrl('x', 'yahoo')).searchParams.get('item_type'), 'auction');
  assert.equal(new URL(proxy.zenUrl('x', 'surugaya')).searchParams.get('browse'), '8');
});

test('Buyee parser uses JPY, preserves zero bids and distinguishes auctions with buyout', async () => {
  const p = await browser.newPage();
  await p.setContent(`<ul><li class="itemCard"><div class="itemCard__itemName"><a href="https://buyee.jp/item/jdirectitems/auction/a123">シムピープル</a></div><img data-src="https://cdn.buyee.jp/product.jpg"><ul><li class="g-priceDetails__item"><span class="g-title">Current Price</span><span class="g-price">500 YEN</span><span>£2.50</span></li><li class="g-priceDetails__item"><span class="g-title">Buyout Price</span><span class="g-price">700 YEN</span></li><li class="itemCard__infoItem"><span class="g-title">Number of Bids</span><span class="g-text">0</span></li></ul></li></ul>`);
  const [item] = await p.evaluate(proxy.extractBuyee, 'yahoo');
  assert.equal(item.price, 500); assert.equal(item.buyoutPrice, 700); assert.equal(item.mode, 'auction');
  assert.equal(item.bidCount, 0); assert.equal(item.image, 'https://cdn.buyee.jp/product.jpg');
  assert.deepEqual(await p.evaluate(proxy.extractBuyee, 'paypay'), []);
  await p.close();
});

test('ZenMarket parser reads data-jpy and rejects ended auctions and other stores', async () => {
  const p = await browser.newPage();
  await p.setContent(`<div id="productsContainer"><a class="product-item" href="https://zenmarket.jp/auction.aspx?itemCode=a123"><h3 class="item-title">日本語</h3><div class="price"><span class="amount" data-jpy="¥1,234">£6.00</span></div><div class="product-pricing-endtime">Auction Ended</div></a><a class="product-item" href="https://zenmarket.jp/product.aspx?shop=othershop&u=https%3A%2F%2Fwww.suruga-ya.jp%2Fproduct%2Fdetail%2F123"><h3 class="item-title">非売品</h3><span class="amount" data-jpy="¥500">£2.50</span></a></div>`);
  const [item] = await p.evaluate(proxy.extractZen, 'yahoo');
  assert.equal(item.price, 1234); assert.equal(item.ended, true);
  const [catalogue] = await p.evaluate(proxy.extractZen, 'surugaya');
  assert.equal(catalogue.price, 500); assert.equal(catalogue.originalUrl, 'https://www.suruga-ya.jp/product/detail/123');
  await p.close();
});

test('fallback tries ZenMarket when Buyee fails and retains both usable listing links', async () => {
  let closed = 0, current;
  const context = { newPage: async () => ({
    route: async () => {}, goto: async url => { current = url; return { status: () => url.includes('buyee') ? 403 : 200 }; },
    waitForFunction: async () => {}, close: async () => { closed++; },
    evaluate: async () => [{ id: 'a123', title: '非売品', price: 500, mode: 'auction' }],
  }) };
  const result = await proxy.search(context, '非売品', {}, 'yahoo');
  assert.equal(result.provider, 'ZenMarket'); assert.equal(result.results.length, 1); assert.equal(closed, 2);
  assert.match(current, /zenmarket/); assert.match(result.results[0].buyeeUrl, /auction\/a123/);
  assert.match(result.results[0].zenmarketUrl, /itemCode=a123/);
});

test('Buyee pagination crosses native 100-item boundaries without losing items', async () => {
  let current;
  const context = { newPage: async () => ({ route: async () => {},
    goto: async url => { current = url; return { status: () => 200 }; }, waitForFunction: async () => {}, close: async () => {},
    evaluate: async () => Array.from({ length: 100 }, (_, i) => {
      const n = (Number(new URL(current).searchParams.get('page')) - 1) * 100 + i;
      return { id: `a${n}`, title: `item ${n}`, price: 500, mode: 'auction' };
    }),
  }) };
  const result = await proxy.searchProvider(context, '非売品', { page: 3, limit: 40 }, 'yahoo', 'Buyee');
  assert.equal(result.results.length, 40); assert.equal(result.results[0].title, 'item 80');
  assert.equal(result.results[39].title, 'item 119'); assert.equal(result.hasMore, true);
});

test('Buyee explicit 404 no-results page is a successful empty search', async () => {
  let closed = false;
  const context = { newPage: async () => ({ route: async () => {},
    goto: async () => ({ status: () => 404 }),
    locator: () => ({ innerText: async () => 'No Results Found. Could not find any results for EOL-7026.' }),
    close: async () => { closed = true; },
  }) };
  const result = await proxy.searchProvider(context, 'EOL-7026', {}, 'yahoo', 'Buyee');
  assert.equal(result.status, 'ok'); assert.deepEqual(result.results, []);
  assert.equal(result.hasMore, false); assert.equal(closed, true);
});
