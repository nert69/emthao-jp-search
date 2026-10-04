function buildUrl(query) {
  const url = new URL('https://www.suruga-ya.jp/search');
  url.search = new URLSearchParams({ search_word: query });
  return url.href;
}

// Use the public ZenMarket catalogue when the direct site blocks automated access.
async function search(context, query, opts = {}) {
  return require('./marketProxy').search(context, query, opts, 'surugaya');
}

module.exports = { search, buildUrl };
