# Marketplace extensions

The original Express + Playwright scraper architecture, React search UI, JPY/VND pricing, Yahoo mode filters, bookmarks, history, and client filters are retained. Original adapters are unchanged.

| Source | Integration | Availability |
| --- | --- | --- |
| Mercari | Existing intercepted JSON search | Existing on-sale filtering |
| Yahoo Auctions | Existing DOM search | Existing active search and auction/fixed filters |
| PayPay Flea Market | Existing DOM search | Existing geographic-block detection |
| Rakuma | New server-rendered `.item-box` adapter | `transaction=selling`; sold cards excluded defensively |
| Mandarake | New `.block[data-itemidx]` adapter after session warmup | `soldOut=1` hides sold-out products; requires cart control; flags stock confirmation |
| Surugaya | Manual source search link only | Public search returned a 403 challenge; no reliable automated parser is claimed |

Rakuma and Mandarake return direct listing URLs, Japanese titles, source, JPY price, image, and availability. Mandarake uses tax-inclusive prices and includes shop names. Condition is left unknown when not present on result cards. Stock confirmation is not a guarantee of stock. Availability can change after search.

The combined route accepts legacy array adapters and new `{ results, status, hasMore }` adapters. `sourceStatus` is additive API metadata. A failed/timed-out source does not discard other results. Legacy adapters swallow some errors internally, so an empty legacy response is marked `unknown` rather than falsely confirmed as zero stock. Refresh retries failed sources; unavailable Surugaya shows a direct search link. Six source tabs also work in bookmarks.

## Queries and pagination

Queries pass unchanged through URL encoding: `シムズオンライン`, `EOL-7026`, `EOL-7019`, `シムピープル`, `非売品`, and other general marketplace keywords. There are no Sims-specific categories or hard-coded matches.

Rakuma's native search can broaden queries and return loosely related titles, especially product codes. These are the source's actual results, not confirmed exact-code matches. Mandarake returned no on-sale results for the four Sims terms during verification on 2026-10-04; `非売品` returned purchasable cards with stock-confirmation metadata.

The adapters translate the API page/limit into native Rakuma 40-card and Mandarake 48-card pages, including a second native page when a requested range crosses the boundary. Direct Mandarake URLs remove search/ref parameters so deduplication remains stable. Changing page size midway through browsing changes offsets; the UI keeps a fixed limit of 20.

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
```

The new backend tests cover query encoding, price/image extraction, sold and cart signals, native pagination, failure/page cleanup, combined failures/timeouts, URL deduplication, source selection, and caching. The deterministic UI test covers source tabs, warnings, stock metadata, combined pagination, refresh, and bookmark persistence. The existing live browser smoke passed search, pricing, filters, home reset, pagination, history, bookmark and refresh without JavaScript errors.

The frontend build and new tests pass. Full lint currently reports four pre-existing errors in `SearchBar.jsx`, `WeightInput.jsx`, `useHealth.js` (`set-state-in-effect`) and `SortControls.jsx` (`only-export-components`). Changed frontend files pass lint. These unrelated components were left intact.

## Deploy

Use the existing backend Docker/Fly.io or Render deployment configuration. No new credentials or services are needed. Keep Playwright Chromium installed in the backend image. Keep `SCRAPE_CONCURRENCY` at 2 on small hosts: adding sources adds queue time, so allow enough request time at the frontend/proxy. Mandarake's warmup plus search fits the default 20-second source budget under normal conditions; slower hosts may need `SCRAPER_TIMEOUT_MS=25000` or more.

Deploy the frontend on Vercel with root directory `frontend`, build `npm run build`, output `dist`, and `VITE_API_BASE_URL` set to the deployed backend URL. Set the backend's `ALLOWED_ORIGIN` to the frontend URL. Existing README deployment commands still apply. This change does not deploy the app or change hosting accounts.

Surugaya needs future verification from a permitted environment before a real automated adapter can be enabled. Regional blocking and markup changes can also affect other sources; warnings preserve usable combined results.
