import { useCallback, useMemo, useRef, useState } from 'react';
import { searchAll } from '../api/search';

const PAGE_SIZE = 20;
const SOURCES = ['mercari', 'yahoo', 'paypay', 'rakuma', 'mandarake', 'surugaya'];
const sourceMap = value => Object.fromEntries(SOURCES.map(s => [s, typeof value === 'function' ? value(s) : value]));
const EMPTY_BUCKETS = sourceMap(() => []);

// A "bucket" for a source is an array of pages, where each page is the dedup'd item list
// returned for that (source, page) tuple. So buckets.mercari[2] = items on Mercari page 3.
// The All view renders the concatenation of all buckets; single-source views render the
// selected page from one bucket. Single-source [+] fetches with ?sources=<src>&page=N+1;
// All-view Load More fetches all sources at page allViewPage+1. Both flows write into
// the same buckets, so switching tabs never loses fetched data.

function splitBySource(items) {
  const out = sourceMap(() => []);
  for (const it of items || []) {
    if (out[it.source]) out[it.source].push(it);
  }
  return out;
}

export function useSearch() {
  const [query, setQuery] = useState('');
  const [yahooMode, setYahooMode] = useState('all');
  const [buckets, setBuckets] = useState(EMPTY_BUCKETS);
  const [exhausted, setExhausted] = useState(sourceMap(false));
  const [allViewPage, setAllViewPage] = useState(0);
  const [pricing, setPricing] = useState(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [sourceStatus, setSourceStatus] = useState({});

  const inflightRef = useRef(null);

  const flatResults = useMemo(() => {
    const out = [];
    for (const src of SOURCES) for (const page of buckets[src]) for (const it of page) out.push(it);
    return out;
  }, [buckets]);

  const counts = useMemo(
    () => sourceMap(s => buckets[s].reduce((n, p) => n + p.length, 0)),
    [buckets]
  );

  const loadedPages = useMemo(
    () => sourceMap(s => buckets[s].length),
    [buckets]
  );

  const hasMoreAny = useMemo(
    () => SOURCES.some((s) => !exhausted[s]),
    [exhausted]
  );

  // Run a fetch and feed the result into per-source buckets.
  // sourcesToFetch: array of source ids (e.g. ['mercari']) or null/undefined for all sources.
  // mode: 'init' resets buckets to just this page; 'append' pushes onto each affected source.
  const runFetch = useCallback(
    async ({ q, ym, sourcesToFetch, pageToFetch, mode, nocache }) => {
      if (inflightRef.current) inflightRef.current.abort();
      const ac = new AbortController();
      inflightRef.current = ac;

      if (nocache) setRefreshing(true);
      else setLoading(true);
      setError(null);
      if (mode === 'init') setSourceStatus({});

      try {
        const res = await searchAll({
          q,
          sources: sourcesToFetch && sourcesToFetch.length ? sourcesToFetch : undefined,
          yahooMode: ym,
          limit: PAGE_SIZE,
          page: pageToFetch,
          nocache,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;

        const bySrc = splitBySource(res?.results);
        const affected = sourcesToFetch && sourcesToFetch.length ? sourcesToFetch : SOURCES;

        if (mode === 'init') {
          // Fresh search: seed every source bucket with this page's items.
          setBuckets(sourceMap(s => [bySrc[s]]));
          setExhausted(sourceMap(s => res?.sourceStatus?.[s]?.hasMore != null
            ? !res.sourceStatus[s].hasMore : bySrc[s].length === 0));
          setAllViewPage(1);
        } else {
          // Append: push to each affected source's bucket. Dedup across pages by URL.
          setBuckets((prev) => {
            const next = { ...prev };
            for (const src of affected) {
              const seen = new Set(prev[src].flat().map((r) => r.url));
              const fresh = bySrc[src].filter((r) => r.url && !seen.has(r.url));
              next[src] = [...prev[src], fresh];
            }
            return next;
          });
          setExhausted((prev) => {
            const next = { ...prev };
            // Heuristic from old code: < PAGE_SIZE/2 items returned = source has no more.
            for (const src of affected) {
              next[src] = res?.sourceStatus?.[src]?.hasMore != null
                ? !res.sourceStatus[src].hasMore : bySrc[src].length < PAGE_SIZE / 2;
            }
            return next;
          });
        }

        setSourceStatus(prev => ({ ...prev, ...res?.sourceStatus }));
        setQuery(q);
        setYahooMode(ym);
        setPricing(res?.pricing || null);
        setCached(!!res?.cached);

        if (res?.pricing) {
          try {
            localStorage.setItem('emthao.pricing', JSON.stringify(res.pricing));
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Search failed');
        if (mode === 'init') {
          setBuckets(EMPTY_BUCKETS);
          setExhausted(sourceMap(false));
          setAllViewPage(0);
        }
      } finally {
        if (inflightRef.current === ac) {
          setLoading(false);
          setRefreshing(false);
          inflightRef.current = null;
        }
      }
    },
    []
  );

  const search = useCallback(
    (q, ym = 'all') => {
      const trimmed = (q || '').trim();
      if (!trimmed) {
        setQuery('');
        setBuckets(EMPTY_BUCKETS);
        setExhausted(sourceMap(false));
        setAllViewPage(0);
        setError(null);
        setSourceStatus({});
        return;
      }
      return runFetch({ q: trimmed, ym, sourcesToFetch: null, pageToFetch: 1, mode: 'init' });
    },
    [runFetch]
  );

  const setMode = useCallback(
    (ym) => {
      if (query) runFetch({ q: query, ym, sourcesToFetch: null, pageToFetch: 1, mode: 'init' });
      else setYahooMode(ym);
    },
    [runFetch, query]
  );

  // All-view "Load More": advances global page, fetches all sources, fills every bucket.
  const loadMore = useCallback(() => {
    if (!query || !hasMoreAny) return;
    const next = allViewPage + 1;
    return runFetch({
      q: query,
      ym: yahooMode,
      sourcesToFetch: null,
      pageToFetch: next,
    }).then(() => setAllViewPage(next));
  }, [runFetch, query, yahooMode, allViewPage, hasMoreAny]);

  // Single-view [+]: fetches the next page for one source only. Pushes onto that bucket.
  const loadNextSource = useCallback(
    (source) => {
      if (!query || exhausted[source]) return;
      const next = loadedPages[source] + 1;
      return runFetch({
        q: query,
        ym: yahooMode,
        sourcesToFetch: [source],
        pageToFetch: next,
      });
    },
    [runFetch, query, yahooMode, exhausted, loadedPages]
  );

  const refresh = useCallback(
    () => runFetch({ q: query, ym: yahooMode, sourcesToFetch: null, pageToFetch: 1, mode: 'init', nocache: true }),
    [runFetch, query, yahooMode]
  );

  const cancel = useCallback(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
    setLoading(false);
    setRefreshing(false);
  }, []);

  const reset = useCallback(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
    setQuery('');
    setYahooMode('all');
    setBuckets(EMPTY_BUCKETS);
    setExhausted(sourceMap(false));
    setAllViewPage(0);
    setCached(false);
    setLoading(false);
    setRefreshing(false);
    setError(null);
    setSourceStatus({});
  }, []);

  return {
    query,
    yahooMode,
    buckets,
    flatResults,
    counts,
    loadedPages,
    exhausted,
    hasMoreAny,
    allViewPage,
    pricing,
    cached,
    loading,
    refreshing,
    error,
    sourceStatus,
    search,
    setMode,
    loadMore,
    loadNextSource,
    refresh,
    cancel,
    reset,
  };
}
