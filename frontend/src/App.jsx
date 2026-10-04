import { useMemo, useState } from 'react';
import { useSearch } from './hooks/useSearch';
import { useBookmarks } from './hooks/useBookmarks';
import { usePersistentState } from './hooks/usePersistentState';
import { useHistory } from './hooks/useHistory';
import { useHealth } from './hooks/useHealth';
import { applyClientFilters } from './lib/filters';
import { GBP_RATE, GBP_RATE_DATE, GBP_RATE_SOURCE } from './lib/pricing';
import { SearchBar } from './components/SearchBar';
import { WeightInput } from './components/WeightInput';
import { SourceTabs } from './components/SourceTabs';
import { YahooModeFilter } from './components/YahooModeFilter';
import { SortControls, applySort } from './components/SortControls';
import { ResultCard } from './components/ResultCard';
import { SkeletonCard } from './components/SkeletonCard';
import { BookmarksView } from './components/BookmarksView';
import { ImageSearchTab } from './components/ImageSearchTab';
import { ViewToggle } from './components/ViewToggle';
import { FilterPanel } from './components/FilterPanel';
import { HealthDot } from './components/HealthDot';
import { Pager } from './components/Pager';
import './App.css';

const DEFAULT_PRICING = { rate: 185, markupPct: 20, shipVndPerKg: 175000, defaultWeightKg: 0.2, gbpRate: GBP_RATE };
const SOURCE_LABELS = { mercari: 'Mercari', yahoo: 'Yahoo Auctions', paypay: 'PayPay Flea', rakuma: 'Rakuma', mandarake: 'Mandarake', surugaya: 'Surugaya' };
const EMPTY_FILTERS = {
  currency: 'jpy',
  priceMin: null,
  priceMax: null,
  vndMin: null,
  vndMax: null,
  gbpMin: null,
  gbpMax: null,
  conditionBuckets: [],
};

export default function App() {
  const [view, setView] = useState('search');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('relevance');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [weightKg, setWeightKg] = usePersistentState('emthao.weightKg', 0.2);
  const [cachedPricing] = usePersistentState('emthao.pricing', DEFAULT_PRICING);
  const [displayCurrency, setDisplayCurrency] = usePersistentState('emthao.displayCurrency', 'gbp');

  const {
    query,
    yahooMode,
    buckets,
    flatResults,
    counts,
    loadedPages,
    exhausted,
    hasMoreAny,
    pricing: livePricing,
    cached,
    loading,
    refreshing,
    error,
    sourceStatus,
    pendingSources,
    search,
    setMode,
    loadMore,
    loadNextSource,
    refresh,
    reset,
  } = useSearch();

  // Single-source view tracks which page is selected within the active source's bucket.
  // Reset to 1 whenever query or active source changes (handled inline in the relevant setters
  // — not via useEffect, to avoid cascading renders).
  const [singleViewPage, setSingleViewPage] = useState(1);

  const onSourceChange = (s) => {
    setSourceFilter(s);
    setSingleViewPage(1);
  };

  const { bookmarks, count, isBookmarked, toggle, clear } = useBookmarks();
  const { history, push: pushHistory, remove: removeHistory, clear: clearHistory } = useHistory();
  const health = useHealth();

  const goHome = () => {
    setView('search');
    setSourceFilter('all');
    setSortBy('relevance');
    setFilters(EMPTY_FILTERS);
    setSingleViewPage(1);
    reset();
  };

  const pricing = useMemo(() => ({ ...DEFAULT_PRICING, ...(livePricing || cachedPricing), displayCurrency }), [livePricing, cachedPricing, displayCurrency]);

  const onSearch = (q) => {
    setSingleViewPage(1);
    if (q) {
      search(q, yahooMode);
      pushHistory({ q, yahooMode });
    } else {
      search('');
    }
  };

  // Items currently shown before filters/sort. In All view = everything fetched so far.
  // In single-source view = the items on the selected page of that source's bucket.
  const viewItems = useMemo(() => {
    if (sourceFilter === 'all') return flatResults;
    const pageItems = buckets[sourceFilter]?.[singleViewPage - 1];
    return pageItems || [];
  }, [sourceFilter, flatResults, buckets, singleViewPage]);

  const visible = useMemo(() => {
    const filtered = applyClientFilters(viewItems, filters, { pricing, weightKg });
    return applySort(filtered, sortBy);
  }, [viewItems, filters, sortBy, pricing, weightKg]);

  const totalForFilter = viewItems.length;
  const hasResults = flatResults.length > 0;

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="brand"
          onClick={goHome}
          aria-label="Go to home"
        >
          <h1>EmThao<span className="brand-accent">JP</span></h1>
          <span className="brand-tag">Japanese marketplace search</span>
        </button>
        <div className="header-right">
          <HealthDot
            status={health.status}
            lastChecked={health.lastChecked}
            details={health.details}
            onClick={health.check}
          />
          <ViewToggle active={view} onChange={setView} bookmarkCount={count} />
        </div>
      </header>

      <div className="control-row">
        {view === 'search' && (
          <SearchBar
            value={query}
            onSearch={onSearch}
            onRefresh={refresh}
            loading={loading}
            refreshing={refreshing}
            canRefresh={!!query && !loading}
            history={history}
            onHistoryPick={(q) => onSearch(q)}
            onHistoryRemove={removeHistory}
            onHistoryClear={clearHistory}
          />
        )}
        <label className="sort-controls">
          <span className="sort-label">Estimate</span>
          <select aria-label="Estimate currency" className="estimate-select" value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>
            <option value="gbp">GBP (£)</option>
            <option value="vnd">VND (đ)</option>
          </select>
        </label>
        {displayCurrency === 'vnd' && <WeightInput value={weightKg} onChange={setWeightKg} />}
      </div>

      {view === 'search' && (
        <main className="main">
          {error && <div className="error-banner">⚠ {error}</div>}
          {Object.entries(sourceStatus).filter(([, info]) => info.status !== 'ok').map(([source, info]) => (
            <div className="source-warning" role="status" key={source}>
              <strong>{source}: </strong>{info.message}
              {info.searchUrl && <a href={info.searchUrl} target="_blank" rel="noopener noreferrer"> Open source search</a>}
            </div>
          ))}

          {(query || hasResults) && (
            <div className="filters-row">
              <SourceTabs active={sourceFilter} onChange={onSourceChange} counts={counts} />
              {(sourceFilter === 'all' || sourceFilter === 'yahoo') && (
                <YahooModeFilter value={yahooMode} onChange={setMode} />
              )}
              <SortControls value={sortBy} onChange={setSortBy} />
              {cached && !refreshing && <span className="cached-badge">cached</span>}
            </div>
          )}

          {(query || hasResults) && (
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(EMPTY_FILTERS)}
              totalCount={totalForFilter}
              filteredCount={visible.length}
            />
          )}

          {loading && !hasResults && (
            <div className="card-grid">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!loading && viewItems.length > 0 && visible.length === 0 && (
            <div className="empty-state">
              <h2>No matches</h2>
              <p>Adjust the price or condition filters above.</p>
            </div>
          )}

          {!loading && !hasResults && query && !error && (
            <div className="empty-state">
              <h2>No results</h2>
              <p>Try a different keyword.</p>
            </div>
          )}

          {visible.length > 0 && (
            <div className="card-grid">
              {visible.map((item) => (
                <ResultCard
                  key={`${item.source}:${item.url}`}
                  item={item}
                  weightKg={weightKg}
                  pricing={pricing}
                  isBookmarked={isBookmarked(item.url)}
                  onToggleBookmark={() => toggle(item)}
                />
              ))}
            </div>
          )}

          {hasResults && sourceFilter === 'all' && hasMoreAny && (
            <div className="load-more-wrap load-more-progress">
              {pendingSources.length > 0 && (
                <p role="status">Loading more from {pendingSources.map(s => SOURCE_LABELS[s]).join(', ')}. New listings appear below.</p>
              )}
              <button
                type="button"
                className="btn btn-secondary load-more"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          {hasResults && sourceFilter !== 'all' && (
            <div className="load-more-wrap">
              <Pager
                currentPage={singleViewPage}
                loadedPages={loadedPages[sourceFilter]}
                onSelect={setSingleViewPage}
                onLoadNext={async () => {
                  const nextPage = loadedPages[sourceFilter] + 1;
                  const loaded = await loadNextSource(sourceFilter);
                  if (loaded) setSingleViewPage(nextPage);
                }}
                exhausted={exhausted[sourceFilter]}
                loading={loading}
              />
            </div>
          )}

          {!loading && !hasResults && !query && (
            <div className="empty-state landing">
              <h2>Search Japanese marketplaces at once</h2>
              <p>Mercari, Yahoo Auctions, PayPay, Rakuma, Mandarake, and Surugaya — one keyword, yen prices with pound estimates.</p>
            </div>
          )}
        </main>
      )}

      {view === 'image' && <ImageSearchTab />}

      {view === 'bookmarks' && (
        <BookmarksView
          bookmarks={bookmarks}
          weightKg={weightKg}
          pricing={pricing}
          isBookmarked={isBookmarked}
          onToggleBookmark={toggle}
          onClear={clear}
        />
      )}

      <footer className="app-footer">
        {displayCurrency === 'gbp' ? <span>
          GBP estimates: item price only; fees, shipping and taxes extra. ¥1 ≈ £{pricing.gbpRate.toFixed(5)} · <a href={GBP_RATE_SOURCE} target="_blank" rel="noopener noreferrer">ECB reference, {GBP_RATE_DATE}</a>
        </span> : <span>
          Pricing: ¥1 ≈ {pricing.rate} đ · markup {pricing.markupPct}% · shipping{' '}
          {pricing.shipVndPerKg.toLocaleString('vi-VN')} đ/kg
        </span>}
      </footer>
    </div>
  );
}
