/**
 * chartDataUtils.js — pure functions that transform enriched portfolio positions
 * into Recharts-ready data structures.
 *
 * Rules:
 *   - All monetary values stored in USD; display conversion happens at render time.
 *   - Charts source their data from the same enriched positions as the tables.
 *   - The rightmost point of Chart 2 (area) equals Chart 1 (pie) by construction
 *     because both use pos.currentValue directly for the current period.
 *   - The rightmost points of Chart 3 (line) are pinned to portfolioTotals so they
 *     match the PortfolioSummary bar exactly.
 */

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

export const TYPE_COLORS = {
  stock:          '#4a9eff',
  etf:            '#a55eea',
  crypto:         '#ff6348',
  bond:           '#20bf6b',
  precious_metal: '#f9ca24',
  cash:           '#74b9ff',
  other:          '#636e72',
};

export const TYPE_LABELS = {
  stock:          'Stocks',
  etf:            'ETFs',
  crypto:         'Crypto',
  bond:           'Bonds',
  precious_metal: 'Precious Metals',
  cash:           'Cash',
  other:          'Other',
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function monthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function generateMonths(fromDate, toDate) {
  const months = [];
  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  const end    = new Date(toDate.getFullYear(),   toDate.getMonth(),   1);
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function earliestDate(allPositions) {
  return allPositions
    .map((p) => p.firstBuyDate)
    .filter(Boolean)
    .reduce((min, d) => {
      const t = d instanceof Date ? d : new Date(d);
      return min === null || t < min ? t : min;
    }, null);
}

/**
 * Return the most-recent priceUSD from historicalData whose date falls
 * on or before monthEnd.  Returns null when no qualifying point exists.
 *
 * historicalData entries may have date as Date or ISO string.
 */
function priceAtOrBefore(historicalData, monthEnd) {
  if (!historicalData || historicalData.length === 0) return null;
  let bestTime = -1;
  let bestPrice = null;
  const endMs = monthEnd.getTime();
  for (const pt of historicalData) {
    const t = (pt.date instanceof Date ? pt.date : new Date(pt.date)).getTime();
    if (t <= endMs && t > bestTime) {
      bestTime  = t;
      bestPrice = pt.priceUSD;
    }
  }
  return bestPrice;
}

// ---------------------------------------------------------------------------
// Chart 1 — Current Allocation pie
// ---------------------------------------------------------------------------

/**
 * @param {EnrichedPosition[]} allPositions
 * @returns {{ type, label, valueUSD, percent, color }[]}
 */
export function buildPieData(allPositions) {
  const byType = {};
  for (const pos of allPositions) {
    if (pos.currentValue == null || pos.currentValue === 0) continue;
    const type = pos.type || 'other';
    byType[type] = (byType[type] ?? 0) + pos.currentValue;
  }

  const total = Object.values(byType).reduce((s, v) => s + v, 0);
  if (total === 0) return [];

  return Object.entries(byType).map(([type, valueUSD]) => ({
    type,
    label: TYPE_LABELS[type] ?? type,
    valueUSD,
    percent: valueUSD / total,
    color: TYPE_COLORS[type] ?? TYPE_COLORS.other,
  }));
}

// ---------------------------------------------------------------------------
// Chart 2 — Allocation over time (stacked area, by type)
// ---------------------------------------------------------------------------

/**
 * Builds monthly data points stacked by asset type.
 *
 * Rightmost point uses pos.currentValue for each position — this guarantees
 * it equals the pie chart exactly (same data source, same grouping).
 *
 * For historical months: priceAtOrBefore(historicalData, monthEnd) × units.
 * Missing price data → 0 contribution for that position in that month.
 * This is honest (we don't know the price) and doesn't distort the stack.
 *
 * @returns {{ data: object[], types: string[] }}
 */
export function buildAreaData(allPositions) {
  if (allPositions.length === 0) return { data: [], types: [] };

  const earliest = earliestDate(allPositions);
  if (!earliest) return { data: [], types: [] };

  const now    = new Date();
  const months = generateMonths(earliest, now);
  const types  = [...new Set(allPositions.map((p) => p.type || 'other'))];

  const data = months.map((monthStart, idx) => {
    const isLast   = idx === months.length - 1;
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
    const point    = { month: monthKey(monthStart) };
    for (const t of types) point[t] = 0;

    for (const pos of allPositions) {
      const type = pos.type || 'other';

      if (isLast) {
        point[type] += pos.currentValue ?? 0;
      } else {
        // Compute units held and cost at this month from real transaction dates.
        let unitsAtMonth    = 0;
        let investedAtMonth = 0;
        for (const tx of pos.txHistory ?? []) {
          const txDate = tx.date instanceof Date ? tx.date : new Date(tx.date);
          if (txDate <= monthEnd) {
            unitsAtMonth    += tx.unitsDelta;
            investedAtMonth += tx.amountUSD;
          }
        }
        if (unitsAtMonth > 0) {
          const price = priceAtOrBefore(pos.historicalData ?? [], monthEnd);
          if (price != null) {
            point[type] += price * unitsAtMonth;
          } else if (investedAtMonth > 0) {
            // No price history (e.g. Polish bonds) — use cost at this month as proxy.
            point[type] += investedAtMonth;
          }
        }
      }
    }

    return point;
  });

  // Normalise each month to percentages (0–100) so the chart shows
  // relative allocation ratios rather than absolute USD values.
  for (const point of data) {
    const total = types.reduce((s, t) => s + (point[t] ?? 0), 0);
    if (total > 0) {
      for (const t of types) {
        point[t] = ((point[t] ?? 0) / total) * 100;
      }
    }
  }

  // Drop leading all-zero months (before any position existed)
  let start = 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (types.every((t) => data[i][t] === 0)) start = i + 1;
    else break;
  }

  return { data: data.slice(start), types };
}

// ---------------------------------------------------------------------------
// Chart 3 — Gain/Loss vs Invested (two-line chart)
// ---------------------------------------------------------------------------

/**
 * Returns monthly { month, invested, value } points.
 *
 * invested: cumulative buy amounts in USD across all positions, using actual
 *   transaction dates from pos.txHistory — each buy is placed at its real date.
 *   The rightmost point is pinned to portfolioTotals.totalBuyAmountUSD.
 *
 * value: sum of (historicalPrice × units) across all open positions.
 *   For months with no price data the value is null (chart skips, not 0).
 *   The rightmost point is pinned to portfolioTotals.totalCurrentValue.
 *
 * @param {EnrichedPosition[]} allPositions
 * @param {PortfolioTotals}    portfolioTotals
 * @returns {{ month: string, invested: number|null, value: number|null }[]}
 */
export function buildGainLossData(allPositions, portfolioTotals) {
  if (allPositions.length === 0) return [];

  const earliest = earliestDate(allPositions);
  if (!earliest) return [];

  const now    = new Date();
  const months = generateMonths(earliest, now);

  return months.map((monthStart, idx) => {
    const isLast   = idx === months.length - 1;
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);

    let invested    = 0;
    let value       = 0;
    let hasAnyPrice = false;

    for (const pos of allPositions) {
      if (!pos.firstBuyDate) continue;
      const buyDate = pos.firstBuyDate instanceof Date ? pos.firstBuyDate : new Date(pos.firstBuyDate);
      if (buyDate > monthEnd) continue;

      // Compute units held and buy cost at this month from real transaction dates.
      let unitsAtMonth    = 0;
      let investedAtMonth = 0;
      for (const tx of pos.txHistory ?? []) {
        const txDate = tx.date instanceof Date ? tx.date : new Date(tx.date);
        if (txDate <= monthEnd) {
          unitsAtMonth    += tx.unitsDelta;
          investedAtMonth += tx.amountUSD; // 0 for sells
        }
      }
      invested += investedAtMonth;

      if (isLast) {
        if (pos.currentValue != null) {
          value       += pos.currentValue;
          hasAnyPrice  = true;
        }
      } else if (unitsAtMonth > 0) {
        const price = priceAtOrBefore(pos.historicalData ?? [], monthEnd);
        if (price != null) {
          value       += price * unitsAtMonth;
          hasAnyPrice  = true;
        } else if (investedAtMonth > 0) {
          // No price history (e.g. Polish bonds) — use cost at this month as proxy.
          value       += investedAtMonth;
          hasAnyPrice  = true;
        }
      }
    }

    // Pin rightmost point to portfolio summary totals
    if (isLast && portfolioTotals) {
      invested    = portfolioTotals.totalBuyAmountUSD ?? invested;
      value       = portfolioTotals.totalCurrentValue ?? (hasAnyPrice ? value : null);
      hasAnyPrice = portfolioTotals.totalCurrentValue != null;
    }

    return {
      month:    monthKey(monthStart),
      invested: invested > 0 ? invested : null,
      // null (not 0) when no price data — Recharts will create a gap, not a zero dip
      value:    hasAnyPrice ? value : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Chart 4 — Dividends per year (bar chart with breakdown tooltip)
// ---------------------------------------------------------------------------

/**
 * @param {EnrichedPosition[]} allPositions
 * @param {Object}             rates  — forex rates from CurrencyContext { USD:1, EUR:x, … }
 * @returns {{ year, totalUSD, breakdown: [{ticker, month, amountUSD}] }[]}
 */
export function buildDividendData(allPositions, rates) {
  const byYear = {};

  for (const pos of allPositions) {
    for (const div of pos.dividends ?? []) {
      if (div.amount == null || !div.date) continue;
      const date = div.date instanceof Date ? div.date : new Date(div.date);

      // Units held at the ex-dividend date — same logic as the dividends modal.
      let unitsAtDiv = 0;
      for (const tx of pos.txHistory ?? []) {
        const txDate = tx.date instanceof Date ? tx.date : new Date(tx.date);
        if (txDate <= date) unitsAtDiv += tx.unitsDelta;
      }
      if (unitsAtDiv <= 0) continue; // didn't hold at this dividend date

      const divRate   = rates[div.currency] ?? 1;
      const amountUSD = (div.amount * unitsAtDiv) / divRate;
      const year      = date.getFullYear();
      const month     = date.getMonth() + 1;

      if (!byYear[year]) byYear[year] = { year, totalUSD: 0, breakdown: [] };
      byYear[year].totalUSD += amountUSD;
      byYear[year].breakdown.push({ ticker: pos.ticker, month, amountUSD });
    }
  }

  return Object.values(byYear).sort((a, b) => a.year - b.year);
}
