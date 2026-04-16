/**
 * priceService.js — fetches current and historical prices, normalizes to USD.
 *
 * Architecture contract:
 *   - All prices returned are in USD.
 *   - Normalization from native currency uses forex rates from CurrencyContext:
 *       priceUSD = nativePrice / rates[nativeCurrency]
 *     (rates = "how many X per 1 USD", so dividing converts to USD)
 *   - This service never reads from CurrencyContext directly. Callers pass `rates`
 *     so the service stays a plain module with no React dependencies.
 *
 * Routing:
 *   - type === 'crypto'              → CoinGecko (prices already in USD)
 *   - ticker matches POLISH_BOND_RE  → stub (null price, isPolishBond: true)
 *                                      bondValueEstimator (Prompt 5) will fill this in
 *   - everything else                → Yahoo Finance (prices in instrument currency)
 *
 * Error handling (non-negotiable):
 *   - Each HTTP call has an 8-second AbortController timeout.
 *   - If any ticker fails, its currentPrice is set to null — never throws.
 *   - All tickers are fetched in parallel via Promise.allSettled.
 *   - Failed tickers are collected in the returned `failedTickers` array so the
 *     UI can show a non-blocking warning badge (not an alert).
 *
 * Progress + 15-second timeout:
 *   - Pass `onProgress(loaded, total)` to track per-ticker completion.
 *   - The calling component (PortfolioView) is responsible for the 15s timeout
 *     and the "Some price data could not be loaded" alert — it has the full
 *     lifecycle context that this pure service lacks.
 */

import { estimateBondPrice } from '../utils/bondValueEstimator.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 8_000;

// Polish treasury bond prefixes — no market price available, handled separately
const POLISH_BOND_RE = /^(EDO|COI|ROS|DOS|TOS)/i;

// ---------------------------------------------------------------------------
// CoinGecko: in-memory symbol → coin ID cache (persists for app lifetime)
// ---------------------------------------------------------------------------
const coinIdCache = new Map();

// ---------------------------------------------------------------------------
// Low-level fetch with per-call timeout
// ---------------------------------------------------------------------------

/**
 * Wraps fetch() with an 8-second AbortController timeout.
 * Throws on non-OK HTTP status so callers can treat it as a failure.
 */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Yahoo Finance helpers
// ---------------------------------------------------------------------------

/**
 * Parse the Yahoo Finance chart response into a normalised PriceResult.
 * Returns { currentPrice, changePercent, instrumentCurrency } or throws.
 */
function parseYahooCurrent(data, rates) {
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo: empty chart result');

  const instrumentCurrency = result.meta?.currency;
  const rawPrice = result.meta?.regularMarketPrice;

  if (rawPrice == null) throw new Error('Yahoo: no regularMarketPrice in response');

  // Prefer the API-provided field; fall back to computing from chartPreviousClose.
  // regularMarketChangePercent is absent for some exchanges / outside market hours.
  const apiChangePercent = result.meta?.regularMarketChangePercent;
  const prevClose = result.meta?.chartPreviousClose;
  const changePercent =
    apiChangePercent != null
      ? apiChangePercent
      : prevClose != null && prevClose !== 0
      ? ((rawPrice - prevClose) / prevClose) * 100
      : null;

  // Yahoo Finance reports London Stock Exchange prices in GBp (pence), not GBP.
  // Divide by 100 to convert to pounds before looking up the forex rate.
  const normalizedCurrency = instrumentCurrency === 'GBp' ? 'GBP' : instrumentCurrency;
  const normalizedPrice    = instrumentCurrency === 'GBp' ? rawPrice / 100 : rawPrice;

  // Convert native currency → USD
  // rates['EUR'] = 0.92 means 1 USD = 0.92 EUR → to get USD: divide by rate
  const rate = rates[normalizedCurrency];
  if (rate == null) {
    console.warn(`[priceService] No forex rate for "${instrumentCurrency}", cannot convert to USD`);
  }
  const currentPrice = rate != null ? normalizedPrice / rate : null;

  return { currentPrice, changePercent, instrumentCurrency: normalizedCurrency, rawPrice: normalizedPrice };
}

/**
 * Parse Yahoo Finance dividend events into [{date, amount, currency}].
 * Amounts are in the instrument's native currency (GBp normalised to GBP).
 * USD conversion is left to chartDataUtils so this stays rate-agnostic.
 */
function parseYahooDividends(data) {
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const instrumentCurrency = result.meta?.currency;
  const currency  = instrumentCurrency === 'GBp' ? 'GBP' : (instrumentCurrency ?? 'USD');
  const penceDiv  = instrumentCurrency === 'GBp' ? 100 : 1;

  const dividendsMap = result.events?.dividends ?? {};
  return Object.values(dividendsMap)
    .map(({ amount, date }) => ({
      date:     new Date(date * 1000),
      amount:   amount / penceDiv,
      currency,
    }))
    .sort((a, b) => a.date - b.date);
}

/**
 * Parse Yahoo Finance historical (1mo / 10y) into [{date, priceUSD}].
 * Silently skips null closing prices (market holidays, missing data).
 */
function parseYahooHistory(data, rates) {
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const instrumentCurrency = result.meta?.currency;
  // Yahoo Finance reports London Stock Exchange prices in GBp (pence), not GBP.
  const normalizedCurrency = instrumentCurrency === 'GBp' ? 'GBP' : instrumentCurrency;
  const penceMultiplier    = instrumentCurrency === 'GBp' ? 100 : 1;
  const rate = rates[normalizedCurrency] ?? 1;
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    points.push({
      date: new Date(timestamps[i] * 1000),
      priceUSD: (closes[i] / penceMultiplier) / rate,
    });
  }
  return points;
}

async function fetchYahooData(ticker, rates) {
  const encoded = encodeURIComponent(ticker);

  // Fetch current price and 10-year monthly history in parallel.
  // Each call has its own 8-second timeout so a slow history fetch
  // can't block the current price (and vice versa).
  const [currentResult, historyResult] = await Promise.allSettled([
    fetchWithTimeout(`/api/yahoo/v8/finance/chart/${encoded}?interval=1d&range=1d`),
    fetchWithTimeout(`/api/yahoo/v8/finance/chart/${encoded}?interval=1mo&range=10y&events=dividends`),
  ]);

  let currentData = {};
  if (currentResult.status === 'fulfilled') {
    try {
      currentData = parseYahooCurrent(currentResult.value, rates);
    } catch (err) {
      console.warn(`[priceService] Yahoo: could not parse current price for ${ticker}:`, err.message);
    }
  } else {
    // History may have succeeded — still return it alongside a null price
    console.warn(`[priceService] Yahoo current price failed for ${ticker}:`, currentResult.reason);
  }

  const historicalData =
    historyResult.status === 'fulfilled'
      ? parseYahooHistory(historyResult.value, rates)
      : [];

  const dividends =
    historyResult.status === 'fulfilled'
      ? parseYahooDividends(historyResult.value)
      : [];

  return {
    currentPrice: currentData.currentPrice ?? null,
    changePercent: currentData.changePercent ?? null,
    instrumentCurrency: currentData.instrumentCurrency ?? null,
    historicalData,
    dividends,
  };
}

// ---------------------------------------------------------------------------
// CoinGecko helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a CSV ticker (e.g. "BTC-USD") to a CoinGecko coin ID (e.g. "bitcoin").
 * Result is cached so the search endpoint is only called once per symbol.
 */
async function resolveCoinId(ticker) {
  // Strip the quote currency suffix: BTC-USD → btc
  const symbol = ticker.replace(/-[A-Z]+$/i, '').toLowerCase();

  if (coinIdCache.has(symbol)) return coinIdCache.get(symbol);

  const data = await fetchWithTimeout(`/api/coingecko/search?query=${symbol}`);
  // Find the first coin whose symbol exactly matches — avoid partial-match noise
  const coin = data?.coins?.find((c) => c.symbol.toLowerCase() === symbol);
  if (!coin) throw new Error(`CoinGecko: no coin found for symbol "${symbol}"`);

  coinIdCache.set(symbol, coin.id);
  return coin.id;
}

async function fetchCoinGeckoData(ticker) {
  // Resolve ID first, then parallelise current + history
  const coinId = await resolveCoinId(ticker);

  const [currentResult, historyResult] = await Promise.allSettled([
    fetchWithTimeout(`/api/coingecko/simple/price?ids=${coinId}&vs_currencies=usd`),
    fetchWithTimeout(
      `/api/coingecko/coins/${coinId}/market_chart?vs_currency=usd&days=365`,
    ),
  ]);

  const currentPrice =
    currentResult.status === 'fulfilled'
      ? (currentResult.value?.[coinId]?.usd ?? null)
      : null;

  const historicalData =
    historyResult.status === 'fulfilled'
      ? (historyResult.value?.prices ?? []).map(([timestamp, price]) => ({
          date: new Date(timestamp),
          priceUSD: price,
        }))
      : [];

  if (currentResult.status === 'rejected') {
    console.warn(
      `[priceService] CoinGecko current price failed for ${ticker}:`,
      currentResult.reason,
    );
  }

  return { currentPrice, changePercent: null, instrumentCurrency: 'USD', historicalData, dividends: [] };
}

// ---------------------------------------------------------------------------
// Single-ticker router
// ---------------------------------------------------------------------------

/**
 * Fetch price data for one ticker, routed to the appropriate API.
 *
 * @param {string} ticker
 * @param {string} type  — from CSV: stock | etf | bond | crypto | precious_metal | cash
 * @param {Object} rates — forex rates from CurrencyContext { USD: 1, EUR: x, PLN: y, ... }
 * @returns {Promise<PriceResult>}  — never rejects; returns null currentPrice on any error
 *
 * PriceResult: {
 *   currentPrice:       number | null  — USD
 *   changePercent:      number | null  — day change %
 *   instrumentCurrency: string | null  — native currency reported by the API
 *   historicalData:     Array<{ date: Date, priceUSD: number }>
 *   isPolishBond:       boolean        — true when handled by bondValueEstimator
 * }
 */
async function fetchTickerData(ticker, type, rates, firstBuyDate) {
  // Polish treasury bonds have no market price API — estimate from coupon structure.
  // pricePerUnit is in PLN; divide by rates['PLN'] to normalise to USD,
  // consistent with how Yahoo Finance non-USD prices are handled.
  if (POLISH_BOND_RE.test(ticker)) {
    const estimate = firstBuyDate ? estimateBondPrice(ticker, firstBuyDate) : null;
    const pricePLN = estimate?.pricePerUnit ?? null;
    const currentPrice =
      pricePLN != null && rates['PLN'] != null ? pricePLN / rates['PLN'] : null;
    return {
      currentPrice,
      changePercent: null,
      instrumentCurrency: 'PLN',
      historicalData: [],
      dividends: [],
      isPolishBond: true,
    };
  }

  try {
    if (type === 'crypto') {
      return await fetchCoinGeckoData(ticker);
    }
    return await fetchYahooData(ticker, rates);
  } catch (err) {
    console.warn(`[priceService] Failed to fetch price for "${ticker}":`, err.message);
    return {
      currentPrice: null,
      changePercent: null,
      instrumentCurrency: null,
      historicalData: [],
      dividends: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch current and historical prices for every unique ticker in `positions`.
 *
 * All tickers are fetched in parallel. A failure on one ticker never blocks
 * the others. Polish bond stubs are returned immediately (no network call).
 *
 * UI responsibilities (NOT handled here):
 *   - Show a warning badge when failedTickers.length > 0
 *   - Show "Some price data could not be loaded" alert if total time > 15 s
 *     (start a setTimeout(15000) before calling this function, clear it when
 *     the returned promise resolves)
 *
 * @param {Array<{ ticker: string, type: string, firstBuyDate: Date }>} positions
 * @param {Object} options
 * @param {Object} options.rates       — forex rates from CurrencyContext
 * @param {Function} [options.onProgress] — called as (loaded: number, total: number)
 *                                          after each ticker resolves (success or fail)
 * @returns {Promise<{ prices: Map<string, PriceResult>, failedTickers: string[] }>}
 */
export async function fetchAllPrices(positions, { rates, onProgress } = {}) {
  // Deduplicate: same ticker in two brokers needs only one network call
  const uniquePositions = [
    ...new Map(positions.map((p) => [p.ticker, p])).values(),
  ];

  const total = uniquePositions.length;
  let loaded = 0;

  const prices = new Map();
  const failedTickers = [];

  await Promise.allSettled(
    uniquePositions.map(async ({ ticker, type, firstBuyDate }) => {
      const result = await fetchTickerData(ticker, type, rates, firstBuyDate);
      prices.set(ticker, result);

      if (result.currentPrice === null && !result.isPolishBond) {
        failedTickers.push(ticker);
      }

      loaded += 1;
      onProgress?.(loaded, total);
    }),
  );

  return { prices, failedTickers };
}
