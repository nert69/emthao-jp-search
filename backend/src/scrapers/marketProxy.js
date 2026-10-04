const { paceDomain } = require('../concurrency');
const { toItem } = require('./normalize');
const { logger } = require('../logger');

function buyeeUrl(query, source, page = 1) {
  const url = new URL('https://buyee.jp/item/search');
  url.search = new URLSearchParams({ query, item_type: source === 'paypay' ? 'fleamarket' : 'auction', translationType: '98', lang: 'en', page: String(page) });
  return url.href;
}

function zenUrl(query, source, page = 1) {
  const url = new URL('https://zenmarket.jp/search.aspx');
  url.search = new URLSearchParams({ q: query, browse: source === 'surugaya' ? '8' : '28', p: String(page) });
  return url.href;
}

function auctionLinks(id) {
  return { buyeeUrl: `https://buyee.jp/item/jdirectitems/auction/${id}?lang=en`,
    zenmarketUrl: `https://zenmarket.jp/auction.aspx?itemCode=${id}`, originalUrl: `https://auctions.yahoo.co.jp/jp/auction/${id}` };
}

function extractBuyee(source) {
  const number = text => { const m = (text || '').match(/[\d,]+/); return m ? Number(m[0].replaceAll(',', '')) : null; };
  return [...document.querySelectorAll('li.itemCard')].flatMap(card => {
    const a = card.querySelector('.itemCard__itemName a');
    const href = a?.href || '';
    const match = source === 'paypay' ? href.match(/\/paypayfleamarket\/item\/([a-z]\d+)/) : href.match(/\/item\/(?:jdirectitems|yahoo)\/auction\/([a-z]\d+)/);
    if (!match) return [];
    const prices = [...card.querySelectorAll('.g-priceDetails__item')];
    const current = prices.find(e => /Current Price|現在/.test(e.querySelector('.g-title')?.textContent));
    const buyout = prices.find(e => /Buyout Price|即決/.test(e.querySelector('.g-title')?.textContent));
    const currentPrice = number(current?.querySelector('.g-price')?.textContent);
    const buyoutPrice = number(buyout?.querySelector('.g-price')?.textContent);
    const info = label => [...card.querySelectorAll('.itemCard__infoItem')].find(e => label.test(e.querySelector('.g-title')?.textContent))?.querySelector('.g-text')?.textContent?.trim();
    const img = card.querySelector('img');
    const timeLeft = info(/Time Remaining|残り/);
    return [{ id: match[1], title: a.textContent.trim(), price: currentPrice ?? buyoutPrice ?? number(card.querySelector('.g-price')?.textContent),
      image: img?.getAttribute('data-src') || img?.getAttribute('src'),
      timeLeft, bidCount: number(info(/Number of Bids|入札/)), buyoutPrice,
      mode: source === 'paypay' || currentPrice == null || currentPrice === buyoutPrice ? 'fixed' : 'auction',
      ended: /Ended|終了|Sold Out|売り切れ/i.test(timeLeft || '') }];
  });
}

function extractZen(source) {
  const number = text => { const m = (text || '').match(/[\d,]+/); return m ? Number(m[0].replaceAll(',', '')) : null; };
  return [...document.querySelectorAll('#productsContainer a.product-item')].flatMap(a => {
    const url = new URL(a.href);
    let id, originalUrl;
    if (source === 'yahoo') {
      if (!url.pathname.endsWith('/auction.aspx')) return [];
      id = url.searchParams.get('itemCode');
      if (!/^[a-z]\d+$/.test(id)) return [];
    } else {
      originalUrl = url.searchParams.get('u');
      if (!originalUrl || !/^https:\/\/www\.suruga-ya\.jp\/product\//.test(originalUrl)) return [];
      id = originalUrl;
    }
    const currentPrice = number(a.querySelector('.price .amount')?.getAttribute('data-jpy'));
    const buyoutPrice = number(a.querySelector('.buyout-price .amount')?.getAttribute('data-jpy'));
    const price = currentPrice ?? number(a.querySelector('[data-jpy]')?.getAttribute('data-jpy'));
    const timeLeft = a.querySelector('.product-pricing-endtime')?.textContent?.trim();
    return [{ id, originalUrl, title: a.querySelector('.item-title')?.textContent?.trim(), price,
      image: a.querySelector('img')?.getAttribute('src'), timeLeft, buyoutPrice,
      condition: a.querySelector('[class*="product-badge-condition"]')?.textContent?.trim(),
      mode: source === 'surugaya' ? null : currentPrice == null || currentPrice === buyoutPrice ? 'fixed' : 'auction',
      ended: /Auction Ended|Sold Out|売り切れ|終了/i.test(a.textContent) }];
  });
}

async function searchProvider(context, query, opts, source, provider) {
  const limit = opts.limit ?? 20;
  const size = provider === 'Buyee' ? 100 : 20;
  const offset = ((opts.page || 1) - 1) * limit;
  const first = Math.floor(offset / size) + 1;
  const local = offset % size;
  // ZenMarket keeps search state in its session; isolate it from other providers.
  const isolated = provider === 'ZenMarket' && typeof context.browser === 'function'
    ? await require('../browser').newContext() : null;
  const page = await (isolated || context).newPage();
  const raws = [];
  let lastCount = 0;
  try {
    // Keep source image URLs intact when the shared browser blocks image downloads.
    await page.route('**/*', route => route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
      : route.fallback());
    for (let native = first; native <= Math.floor((offset + limit - 1) / size) + 1; native++) {
      await paceDomain(provider === 'Buyee' ? 'buyee.jp' : 'zenmarket.jp');
      const response = await page.goto(provider === 'Buyee' ? buyeeUrl(query, source, native) : zenUrl(query, source, native), { timeout: 10000, waitUntil: 'domcontentloaded' });
      // Buyee can return 202 while its normal loading page finishes navigation.
      if (response?.status() === 404 && /No Results Found|Could not find any results/i.test(await page.locator('body').innerText())) {
        lastCount = 0;
        break;
      }
      if (!response || response.status() >= 400) throw new Error(`${provider} unavailable`);
      await page.waitForFunction(provider === 'Buyee'
        ? () => document.querySelector('li.itemCard') || /0 hits|No items|No results|商品が見つかりません/i.test(document.body.innerText)
        : () => document.querySelector('#productsContainer a.product-item') || /No products found|No results|No search results|Nothing found/i.test(document.body.innerText), null, { timeout: 8000 });
      const cards = await page.evaluate(provider === 'Buyee' ? extractBuyee : extractZen, source);
      lastCount = cards.length;
      raws.push(...cards);
      if (lastCount < size) break;
    }
    const results = raws.slice(local, local + limit).filter(r => !r.ended && r.title && r.price != null &&
      (source !== 'yahoo' || !opts.yahooMode || opts.yahooMode === 'all' || opts.yahooMode === r.mode)).map(r => {
      const links = source === 'yahoo' ? auctionLinks(r.id) : source === 'paypay'
        ? { buyeeUrl: `https://buyee.jp/paypayfleamarket/item/${r.id}?lang=en`, originalUrl: `https://paypayfleamarket.yahoo.co.jp/item/${r.id}` }
        : { zenmarketUrl: `https://zenmarket.jp/product.aspx?${new URLSearchParams({ shop: 'othershop', u: r.originalUrl })}`, originalUrl: r.originalUrl };
      return { ...toItem({ ...r, source, url: links.originalUrl }),
        ...links, provider, buyoutPrice: r.buyoutPrice, availability: source === 'surugaya' ? 'stock_confirmation' : 'on_sale' };
    });
    return { results, status: 'ok', provider, hasMore: raws.length > local + limit || lastCount >= size };
  } finally {
    await page.close().catch(() => {});
    await isolated?.close().catch(() => {});
  }
}

async function search(context, query, opts = {}, source = 'yahoo') {
  const providers = source === 'surugaya' ? ['ZenMarket'] : source === 'paypay' ? ['Buyee'] : ['Buyee', 'ZenMarket'];
  for (const provider of providers) {
    try { return await searchProvider(context, query, opts, source, provider); }
    catch (err) { logger.warn({ source, provider, error: err.message }, 'proxy search failed'); }
  }
  return { results: [], status: 'unavailable', hasMore: false,
    message: `${source} search providers are temporarily unavailable. Try refreshing.`, searchUrl: source === 'surugaya' ? zenUrl(query, source) : buyeeUrl(query, source) };
}

module.exports = { search, searchProvider, buyeeUrl, zenUrl, auctionLinks, extractBuyee, extractZen };
