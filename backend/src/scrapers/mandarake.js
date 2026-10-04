const { paceDomain } = require('../concurrency');
const { toItem } = require('./normalize');

function buildUrl(query, page = 1) {
  const url = new URL('https://order.mandarake.co.jp/order/listPage/list');
  url.search = new URLSearchParams({ keyword: query, deviceId: '1', soldOut: '1', page: String(page) });
  return url.href;
}

function extractCards() {
  return [...document.querySelectorAll('.block[data-itemidx]')].map(card => {
    const a = card.querySelector('.title a');
    const img = card.querySelector('.thum img');
    const priceText = card.querySelector('.price')?.textContent || '';
    const price = priceText.match(/税込\s*([\d,]+)円/) || priceText.match(/([\d,]+)円/);
    const stock = card.querySelector('.stock')?.textContent?.trim() || '';
    return {
      title: a?.textContent?.trim(), url: a?.href,
      image: img?.getAttribute('data-src') || img?.getAttribute('src'),
      price: price ? Number(price[1].replaceAll(',', '')) : null,
      shop: card.querySelector('.shop')?.textContent?.trim(),
      stock, sold: /売り切れ|品切れ|SOLD\s*OUT/i.test(stock),
      purchasable: !!card.querySelector('.addbasket'),
    };
  });
}

async function search(context, query, opts = {}) {
  const limit = opts.limit ?? 20;
  const offset = ((opts.page || 1) - 1) * limit;
  const firstPage = Math.floor(offset / 48) + 1;
  const localOffset = offset % 48;
  const page = await context.newPage();
  try {
    await paceDomain('order.mandarake.co.jp');
    // First request may redirect to the corporate homepage while setting the session.
    await page.goto('https://order.mandarake.co.jp/order/?deviceId=1', { timeout: 8000, waitUntil: 'domcontentloaded' });
    const response = await page.goto(buildUrl(query, firstPage), { timeout: 10000, waitUntil: 'domcontentloaded' });
    if (!response?.ok() || !page.url().startsWith('https://order.mandarake.co.jp/order/listPage/')) throw new Error('Mandarake search unavailable');
    const raws = await page.evaluate(extractCards);
    let lastCount = raws.length;
    if (localOffset + limit > 48 && lastCount >= 48) {
      const nextResponse = await page.goto(buildUrl(query, firstPage + 1), { timeout: 6000, waitUntil: 'domcontentloaded' });
      if (!nextResponse?.ok()) throw new Error('mandarake next page unavailable');
      const next = await page.evaluate(extractCards);
      lastCount = next.length;
      raws.push(...next);
    }
    const text = await page.locator('body').innerText();
    if (!raws.length && !/検索結果\s*0|該当する商品|見つかりません/.test(text)) throw new Error('Mandarake search layout unavailable');
    const results = raws.slice(localOffset, localOffset + limit).filter(r => !r.sold && r.purchasable && r.title && r.price > 0 && r.url?.startsWith('https://order.mandarake.co.jp/order/detailPage/item?'))
      .map(r => {
        const url = new URL(r.url);
        const canonical = `https://order.mandarake.co.jp/order/detailPage/item?itemCode=${url.searchParams.get('itemCode')}&deviceId=1`;
        return { ...toItem({ ...r, url: canonical, source: 'mandarake' }), shop: r.shop,
          availability: /確認/.test(r.stock) ? 'stock_confirmation' : 'on_sale' };
      });
    return { results, status: 'ok', hasMore: raws.length > localOffset + limit || lastCount >= 48 };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { search, buildUrl, extractCards };
