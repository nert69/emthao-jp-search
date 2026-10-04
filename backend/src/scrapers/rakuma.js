const { paceDomain } = require('../concurrency');
const { toItem } = require('./normalize');

function buildUrl(query, page = 1) {
  const url = new URL('https://fril.jp/s');
  url.search = new URLSearchParams({ query, transaction: 'selling', page: String(page) });
  return url.href;
}

// Uses Rakuma's server-rendered result cards and analytics price/title attributes.
function extractCards() {
  return [...document.querySelectorAll('.item-box')].map(card => {
    const a = card.querySelector('a.link_search_title');
    const img = card.querySelector('img');
    return {
      title: a?.getAttribute('data-rat-item_name') || a?.textContent?.trim(),
      price: Number(a?.getAttribute('data-rat-price')) || null,
      url: a?.href,
      image: img?.getAttribute('data-original') || img?.getAttribute('src'),
      sold: !!card.querySelector('.item-box__soldout, .soldout') || /SOLD\s*OUT|売り切れ/i.test(card.textContent),
    };
  });
}

async function search(context, query, opts = {}) {
  const limit = opts.limit ?? 20;
  const offset = ((opts.page || 1) - 1) * limit;
  const firstPage = Math.floor(offset / 40) + 1;
  const localOffset = offset % 40;
  const page = await context.newPage();
  try {
    await paceDomain('fril.jp');
    const response = await page.goto(buildUrl(query, firstPage), { timeout: 12000, waitUntil: 'domcontentloaded' });
    if (!response?.ok() || new URL(page.url()).hostname !== 'fril.jp') throw new Error('Rakuma search unavailable');
    await page.waitForSelector('.item-box, #searchForm', { timeout: 3000, state: 'attached' });
    const raws = await page.evaluate(extractCards);
    let lastCount = raws.length;
    if (localOffset + limit > 40 && lastCount >= 40) {
      const nextResponse = await page.goto(buildUrl(query, firstPage + 1), { timeout: 6000, waitUntil: 'domcontentloaded' });
      if (!nextResponse?.ok()) throw new Error('rakuma next page unavailable');
      const next = await page.evaluate(extractCards);
      lastCount = next.length;
      raws.push(...next);
    }
    const text = await page.locator('body').innerText();
    if (!raws.length && !/0件|見つかりません|該当する商品|商品がありません/.test(text)) throw new Error('Rakuma search layout unavailable');
    const results = raws.slice(localOffset, localOffset + limit).filter(r => !r.sold && r.title && /^https:\/\/item\.fril\.jp\/[a-f\d]{32}$/.test(r.url) && r.price > 0)
      .map(r => ({ ...toItem({ ...r, source: 'rakuma' }), availability: 'on_sale' }));
    return { results, status: 'ok', hasMore: raws.length > localOffset + limit || lastCount >= 40 };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { search, buildUrl, extractCards };
