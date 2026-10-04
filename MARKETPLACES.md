# Marketplace extensions

The Express + Playwright scraper architecture, React search UI, JPY/VND pricing, Yahoo mode filters, bookmarks, history, and client filters are retained. Yahoo and PayPay keep their native parsers and now fall back to public proxy-service searches when direct access fails.

| Source | Integration | Availability |
| --- | --- | --- |
| Mercari | Existing intercepted JSON search | Existing on-sale filtering |
| Yahoo Auctions | Native DOM search → Buyee → ZenMarket | Active listings, ended cards excluded; auction/fixed modes verified from prices |
| PayPay Flea Market | Native DOM search → Buyee | Separate `item_type=fleamarket` search; fixed-price listings |
| Rakuma | New server-rendered `.item-box` adapter | `transaction=selling`; sold cards excluded defensively |
| Mandarake | New `.block[data-itemidx]` adapter after session warmup | `soldOut=1` hides sold-out products; requires cart control; flags stock confirmation |
| Surugaya | ZenMarket store 8 catalogue search | Prices and listing links; stock needs confirmation on the item page |

Rakuma and Mandarake return direct listing URLs, Japanese titles, source, JPY price, image, and availability. Mandarake uses tax-inclusive prices and includes shop names. Condition is left unknown when not present on result cards. Stock confirmation is not a guarantee of stock. Availability can change after search.

The combined route accepts legacy array adapters and new `{ results, status, hasMore }` adapters. `sourceStatus` is additive API metadata. A failed/timed-out source does not discard other results. Refresh retries failed sources. Six source tabs also work in bookmarks.

Proxy results keep the original marketplace/source label and include a `provider` field. Yahoo results include original listing URLs plus Buyee and ZenMarket links; PayPay includes Buyee links, and Surugaya includes ZenMarket links. Cards show the provider and open the proxy listing rather than the region-blocked Yahoo page. ZenMarket item pages may ask for browser security verification. Buyee item pages were verified from the UK in an initialized session.

Prices are the source JPY amounts, not conversions back from GBP: Buyee `.g-price` and ZenMarket `data-jpy`. Proxy buying fees and shipping are not included. Auction cards with a separate buyout price remain auctions; fixed-price mode only includes fixed listings. These filters operate on each returned page, so a filtered page can contain fewer than 20 results while more pages remain available.

## Queries and pagination

Queries pass unchanged through URL encoding: `シムズオンライン`, `EOL-7026`, `EOL-7019`, `シムピープル`, `非売品`, and other general marketplace keywords. There are no Sims-specific categories or hard-coded matches.

Rakuma's native search can broaden queries and return loosely related titles, especially product codes. These are the source's actual results, not confirmed exact-code matches. Mandarake returned no on-sale results for the four Sims terms during verification on 2026-10-04; `非売品` returned purchasable cards with stock-confirmation metadata.

The adapters translate the API page/limit into native Rakuma 40-card and Mandarake 48-card pages, including a second native page when a requested range crosses the boundary. Direct Mandarake URLs remove search/ref parameters so deduplication remains stable. Changing page size midway through browsing changes offsets; the UI keeps a fixed limit of 20.

Buyee uses native 100-card pages; ZenMarket uses 20-card pages. API windows crossing a native boundary are combined before slicing. Buyee's 404 "No Results Found" page is treated as a verified empty search, not a blocked source. ZenMarket sessions are isolated so its search state does not carry between queries or marketplaces.

In the All tab, Load more requests only unfinished marketplaces, at most two at a time, and displays each response as it arrives. Relevance order keeps existing cards in place and appends new listings below them; explicit price/date sorts still sort the full loaded list. Each source resumes at its own next unloaded page, including pages loaded in individual source tabs. Duplicate URLs are excluded. Failed page requests keep existing results and do not advance the source's page; Refresh retries unavailable sources.

Live verification on 2026-10-04 found 20 Yahoo, 13 PayPay and 7 Surugaya matches for `シムピープル` through the actual combined backend. Yahoo and PayPay also returned matches for `シムズオンライン`; the two `EOL` codes returned legitimate empty searches. These counts are a snapshot and can change.

## Run locally

Use Node 20+ (Node 22.12+ or 24 recommended for the locked Vite version):

```sh
npm install
npm run setup
npm run dev
```

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. Open http://localhost:5173. Backend defaults to http://localhost:8787. The existing `.env.example` files describe settings.

## Verify

```sh
npm --prefix backend test
npm --prefix frontend run build
npm --prefix frontend run lint
```

With both local servers running:

```sh
node backend/scripts/smoke-frontend.js
node backend/scripts/smoke-marketplaces.js
node backend/scripts/smoke-pagination.js
```

The backend tests cover query encoding, price/image extraction, proxy selection/fallback, original and proxy listing links, auction classification, zero bid counts, sold and cart signals, native pagination, failure/page cleanup, combined failures/timeouts, URL deduplication, source selection, and caching. The deterministic UI test covers source tabs, warnings, stock metadata, combined pagination, refresh, and bookmark persistence. The existing live browser smoke covers search, pricing, filters, home reset, pagination, history, bookmark and refresh.

The frontend build and new tests pass. Full lint currently reports four pre-existing errors in `SearchBar.jsx`, `WeightInput.jsx`, `useHealth.js` (`set-state-in-effect`) and `SortControls.jsx` (`only-export-components`). Changed frontend files pass lint. These unrelated components were left intact.

## Deploy

Use the existing backend Docker/Fly.io or Render deployment configuration. No new credentials or services are needed. Keep Playwright Chromium installed in the backend image. Keep `SCRAPE_CONCURRENCY` at 2 on small hosts: adding sources adds queue time, so allow enough request time at the frontend/proxy. Yahoo, PayPay and Surugaya have a minimum 45-second source budget to allow fallback and native-page boundary requests; other sources retain `SCRAPER_TIMEOUT_MS`. Japan hosting is no longer required to get Yahoo and PayPay results through the public proxies.

Deploy the frontend on Vercel with root directory `frontend`, build `npm run build`, output `dist`, and `VITE_API_BASE_URL` set to the deployed backend URL. Set the backend's `ALLOWED_ORIGIN` to the frontend URL. Existing README deployment commands still apply. This change does not deploy the app or change hosting accounts.

Surugaya results are catalogue listings with stock confirmation required, not independently confirmed in-stock copies. Regional blocking, security checks, provider coverage, and markup changes can affect sources; warnings preserve other combined results when every available provider fails.
