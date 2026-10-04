function buildUrl(query) {
  const url = new URL('https://www.suruga-ya.jp/search');
  url.search = new URLSearchParams({ search_word: query });
  return url.href;
}

// Public search returned a 403 challenge during verification. Do not advertise
// unverified selectors or bypass the challenge; expose an honest manual fallback.
async function search(_context, query) {
  return { results: [], status: 'unavailable', hasMore: false,
    message: 'Surugaya automated search is unavailable. Search the source directly.', searchUrl: buildUrl(query) };
}

module.exports = { search, buildUrl };
