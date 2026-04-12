/**
 * historicalRatesService.js — fetches historical forex rates for cost-basis calculation.
 *
 * Why this exists:
 *   The current forex rate is wrong for calculating how much was spent on past transactions.
 *   A buy made in PLN in 2021 should be converted to USD at the 2021 rate, not today's rate.
 *
 * How it works:
 *   - Scans all CSV rows to find unique non-USD currencies and the full date range.
 *   - Fetches a single Frankfurter time-series request covering that range.
 *   - Returns a getRate(currency, date) function that looks up the nearest available
 *     business day on or before the requested date (Frankfurter skips weekends/holidays).
 *   - The full response is cached in sessionStorage for 24 hours.
 *
 * Fallback:
 *   If the fetch fails, getRate returns null — callers should fall back to the current
 *   spot rate from CurrencyContext so the app still shows something rather than nothing.
 */

import { cacheGet, cacheSet } from './cacheService.js';

const TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours — historical rates don't change
const TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object[]} rows — validated CSV rows from CsvDropZone
 * @returns {Promise<(currency: string, date: Date) => number | null>}
 *   getRate(currency, date) — returns the USD rate for that currency on that date,
 *   or null if unavailable (caller should fall back to current spot rate).
 */
export async function fetchHistoricalRates(rows) {
  // Collect unique non-USD currencies present in the transactions
  const currencies = [
    ...new Set(
      rows
        .filter((r) => r.currency && r.currency.toUpperCase() !== 'USD')
        .map((r) => r.currency.toUpperCase()),
    ),
  ];

  if (currencies.length === 0) {
    // All transactions are in USD — no conversion needed
    return (_currency, _date) => 1;
  }

  const txDates = rows.map((r) => new Date(r.date)).filter((d) => !isNaN(d));
  if (txDates.length === 0) return (_currency, _date) => null;

  const startDate = new Date(Math.min(...txDates)).toISOString().slice(0, 10);
  const endDate   = new Date().toISOString().slice(0, 10);
  const symbols   = currencies.join(',');
  const url       = `/api/frankfurter/${startDate}..${endDate}?base=USD&symbols=${symbols}`;

  let ratesMap = {};
  try {
    const cached = cacheGet(url);
    if (cached) {
      ratesMap = cached.rates ?? {};
    } else {
      const data = await fetchWithTimeout(url);
      cacheSet(url, data, TTL_MS);
      ratesMap = data.rates ?? {};
    }
  } catch (err) {
    console.warn('[historicalRatesService] Failed to fetch historical rates:', err.message);
  }

  // Pre-sort date keys once so lookups are fast
  const dateKeys = Object.keys(ratesMap).sort();

  return function getRate(currency, date) {
    const upper = (currency ?? '').toUpperCase();
    if (upper === 'USD') return 1;

    const dateStr = new Date(date).toISOString().slice(0, 10);

    // Walk backwards to find the nearest available date <= requested date.
    // Frankfurter omits weekends and public holidays — this handles those gaps.
    for (let i = dateKeys.length - 1; i >= 0; i--) {
      if (dateKeys[i] <= dateStr) {
        return ratesMap[dateKeys[i]]?.[upper] ?? null;
      }
    }

    return null; // date is before our earliest data point
  };
}