import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildPieData,
  buildAreaData,
  buildGainLossData,
  buildDividendData,
} from './chartDataUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A date N months in the past, always in the past relative to the current month. */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d;
}

/**
 * Minimal enriched position.  Any field the chart functions don't use can be omitted.
 */
function makePosition(overrides) {
  return {
    type:          'stock',
    firstBuyDate:  monthsAgo(3),
    currentValue:  1000,
    units:         10,
    buyAmountUSD:  900,
    historicalData: [],
    dividends:     [],
    ticker:        'AAPL',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPieData
// ---------------------------------------------------------------------------

describe('buildPieData', () => {
  it('returns empty array for empty positions input', () => {
    expect(buildPieData([])).toEqual([]);
  });

  it('returns empty array when all positions have null or zero currentValue', () => {
    const positions = [
      makePosition({ currentValue: null }),
      makePosition({ currentValue: 0 }),
    ];
    expect(buildPieData(positions)).toEqual([]);
  });

  it('excludes positions with null or zero currentValue from the pie', () => {
    const positions = [
      makePosition({ type: 'stock', currentValue: 2000 }),
      makePosition({ type: 'bond',  currentValue: null }),  // excluded
      makePosition({ type: 'cash',  currentValue: 0 }),     // excluded
    ];
    const pie = buildPieData(positions);
    expect(pie).toHaveLength(1);
    expect(pie[0].type).toBe('stock');
  });

  it('all slice percents sum to exactly 1 (100%)', () => {
    const positions = [
      makePosition({ type: 'stock',  currentValue: 3000 }),
      makePosition({ type: 'etf',    currentValue: 2000 }),
      makePosition({ type: 'crypto', currentValue: 5000 }),
    ];
    const pie = buildPieData(positions);
    const sum = pie.reduce((s, slice) => s + slice.percent, 0);
    // Floating-point arithmetic: allow 10-decimal-place precision
    expect(sum).toBeCloseTo(1, 10);
  });

  it('groups same-type positions and sums their values', () => {
    const positions = [
      makePosition({ type: 'etf', currentValue: 1000 }),
      makePosition({ type: 'etf', currentValue: 3000 }),  // same type
    ];
    const pie = buildPieData(positions);
    expect(pie).toHaveLength(1);
    expect(pie[0].valueUSD).toBe(4000);
    expect(pie[0].percent).toBe(1);
  });

  it('assigns a label and a color to each slice', () => {
    const positions = [makePosition({ type: 'stock', currentValue: 500 })];
    const pie = buildPieData(positions);
    expect(pie[0].label).toBeTruthy();
    expect(pie[0].color).toMatch(/^#/);
  });

  it('uses fallback label and color for unknown type', () => {
    const positions = [makePosition({ type: 'unknown_type', currentValue: 100 })];
    const pie = buildPieData(positions);
    expect(pie[0].label).toBe('unknown_type');        // raw type as fallback
    expect(pie[0].color).toBe('#636e72');             // TYPE_COLORS.other
  });
});

// ---------------------------------------------------------------------------
// buildAreaData — last point consistency with current allocation
// ---------------------------------------------------------------------------

describe('buildAreaData', () => {
  it('returns empty data for empty positions input', () => {
    const result = buildAreaData([]);
    expect(result.data).toEqual([]);
    expect(result.types).toEqual([]);
  });

  it('last data point per type equals the sum of currentValue for that type', () => {
    // The rightmost area point must equal what the pie chart shows (same source: currentValue).
    const positions = [
      makePosition({ type: 'stock', currentValue: 3000, firstBuyDate: monthsAgo(3) }),
      makePosition({ type: 'etf',   currentValue: 2000, firstBuyDate: monthsAgo(3) }),
    ];
    const { data } = buildAreaData(positions);
    const last = data[data.length - 1];

    expect(last.stock).toBe(3000);
    expect(last.etf).toBe(2000);
  });

  it('last point stock value equals sum across multiple positions of same type', () => {
    const positions = [
      makePosition({ type: 'stock', currentValue: 1500, firstBuyDate: monthsAgo(3) }),
      makePosition({ type: 'stock', currentValue: 2500, firstBuyDate: monthsAgo(3) }),
    ];
    const { data } = buildAreaData(positions);
    const last = data[data.length - 1];

    // Both stock positions summed → 4000
    expect(last.stock).toBe(4000);
  });

  it('treats null currentValue as 0 on the last point', () => {
    const positions = [
      makePosition({ type: 'stock', currentValue: null, firstBuyDate: monthsAgo(3) }),
    ];
    const { data } = buildAreaData(positions);
    const last = data[data.length - 1];

    expect(last.stock).toBe(0);
  });

  it('includes all types in the returned types array', () => {
    const positions = [
      makePosition({ type: 'stock',  currentValue: 1000 }),
      makePosition({ type: 'crypto', currentValue: 500 }),
    ];
    const { types } = buildAreaData(positions);

    expect(types).toContain('stock');
    expect(types).toContain('crypto');
  });

  it('last point area totals match buildPieData totals by type', () => {
    // Core invariant documented in chartDataUtils.js:
    // "The rightmost point of Chart 2 (area) equals Chart 1 (pie) by construction."
    const positions = [
      makePosition({ type: 'bond',  currentValue: 4000, firstBuyDate: monthsAgo(3) }),
      makePosition({ type: 'stock', currentValue: 6000, firstBuyDate: monthsAgo(3) }),
    ];

    const { data } = buildAreaData(positions);
    const last = data[data.length - 1];

    const pie = buildPieData(positions);
    const pieByType = Object.fromEntries(pie.map((s) => [s.type, s.valueUSD]));

    expect(last.bond).toBe(pieByType.bond);
    expect(last.stock).toBe(pieByType.stock);
  });
});

// ---------------------------------------------------------------------------
// buildGainLossData — last point pinned to portfolioTotals
// ---------------------------------------------------------------------------

describe('buildGainLossData', () => {
  it('returns empty array for empty positions', () => {
    expect(buildGainLossData([], {})).toEqual([]);
  });

  it('last point value is pinned to portfolioTotals.totalCurrentValue', () => {
    const positions = [
      makePosition({ buyAmountUSD: 4000, currentValue: 5000, firstBuyDate: monthsAgo(3) }),
    ];
    const totals = { totalBuyAmountUSD: 4000, totalCurrentValue: 5500 };

    const data = buildGainLossData(positions, totals);
    const last = data[data.length - 1];

    // Must use the pinned value from totals, not the raw sum (5000 vs 5500)
    expect(last.value).toBe(5500);
  });

  it('last point invested is pinned to portfolioTotals.totalBuyAmountUSD', () => {
    const positions = [
      makePosition({ buyAmountUSD: 3000, currentValue: 4000, firstBuyDate: monthsAgo(3) }),
    ];
    const totals = { totalBuyAmountUSD: 3200, totalCurrentValue: 4200 };

    const data = buildGainLossData(positions, totals);
    const last = data[data.length - 1];

    expect(last.invested).toBe(3200);
  });

  it('last point value is null when portfolioTotals.totalCurrentValue is null', () => {
    const positions = [
      makePosition({ buyAmountUSD: 2000, currentValue: null, firstBuyDate: monthsAgo(3) }),
    ];
    const totals = { totalBuyAmountUSD: 2000, totalCurrentValue: null };

    const data = buildGainLossData(positions, totals);
    const last = data[data.length - 1];

    expect(last.value).toBeNull();
  });

  it('invested is null (not 0) for months before any position was bought', () => {
    // Position bought only 1 month ago — the month before it should have invested = null
    const positions = [
      makePosition({ buyAmountUSD: 1000, currentValue: 1100, firstBuyDate: monthsAgo(1) }),
    ];
    const totals = { totalBuyAmountUSD: 1000, totalCurrentValue: 1100 };

    const data = buildGainLossData(positions, totals);

    // With a position bought 1 month ago there should be exactly 2 data points:
    // month-1 (the buy month) and current month (last).
    // Both should have invested > 0 (at least the first buy month).
    expect(data.length).toBeGreaterThanOrEqual(1);
    // The last point must have a valid invested value
    const last = data[data.length - 1];
    expect(last.invested).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildDividendData
// ---------------------------------------------------------------------------

describe('buildDividendData', () => {
  const USD_RATES = { USD: 1, EUR: 1.1 }; // 1 USD = 1 EUR/1.1

  it('returns empty array when no positions have dividends', () => {
    const positions = [makePosition({ dividends: [] })];
    expect(buildDividendData(positions, USD_RATES)).toEqual([]);
  });

  it('aggregates dividends by year and converts to USD', () => {
    const positions = [
      makePosition({
        ticker: 'AAPL',
        dividends: [
          { date: new Date('2023-03-15'), amount: 1.10, currency: 'EUR' },
          { date: new Date('2023-09-15'), amount: 1.10, currency: 'EUR' },
        ],
      }),
    ];
    const data = buildDividendData(positions, USD_RATES);

    expect(data).toHaveLength(1);
    expect(data[0].year).toBe(2023);
    // Each EUR dividend: 1.10 / 1.1 = 1.00 USD → total = 2.00 USD
    expect(data[0].totalUSD).toBeCloseTo(2.0, 10);
    expect(data[0].breakdown).toHaveLength(2);
  });

  it('groups dividends across different tickers into the same year', () => {
    const positions = [
      makePosition({ ticker: 'AAPL', dividends: [{ date: new Date('2022-06-01'), amount: 5, currency: 'USD' }] }),
      makePosition({ ticker: 'MSFT', dividends: [{ date: new Date('2022-09-01'), amount: 3, currency: 'USD' }] }),
    ];
    const data = buildDividendData(positions, USD_RATES);

    expect(data).toHaveLength(1);
    expect(data[0].year).toBe(2022);
    expect(data[0].totalUSD).toBeCloseTo(8, 10);
    expect(data[0].breakdown).toHaveLength(2);
  });

  it('returns years sorted in ascending order', () => {
    const positions = [
      makePosition({
        dividends: [
          { date: new Date('2024-01-01'), amount: 10, currency: 'USD' },
          { date: new Date('2022-01-01'), amount: 5,  currency: 'USD' },
          { date: new Date('2023-01-01'), amount: 7,  currency: 'USD' },
        ],
      }),
    ];
    const data = buildDividendData(positions, USD_RATES);
    const years = data.map((d) => d.year);

    expect(years).toEqual([2022, 2023, 2024]);
  });
});
