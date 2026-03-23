import { useState, useEffect } from 'react';
import { useCurrency } from '../context/CurrencyContext';
import { aggregatePortfolio } from '../utils/portfolioAggregator';
import { fetchAllPrices } from '../services/priceService';
import { formatCurrency, formatPercent } from '../utils/formatCurrency';
import PortfolioSummary from './PortfolioSummary';
import ChartsSection from './ChartsSection';
import HistoryModal from './HistoryModal';
import './PortfolioView.css';

// ---------------------------------------------------------------------------
// Action icons
// ---------------------------------------------------------------------------
const HistoryIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const DividendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

// ---------------------------------------------------------------------------
// Days held helpers
// ---------------------------------------------------------------------------
function calcDaysHeld(firstBuyDate) {
  return Math.floor((Date.now() - new Date(firstBuyDate)) / 86_400_000);
}

function formatDaysTooltip(firstBuyDate) {
  const start = new Date(firstBuyDate);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const p = (n, w) => `${n} ${w}${n !== 1 ? 's' : ''}`;
  return `${p(years, 'year')}, ${p(months, 'month')}, ${p(days, 'day')}`;
}

// ---------------------------------------------------------------------------
// Enrichment — pure functions, no React
// ---------------------------------------------------------------------------

/**
 * Enrich one position with USD-normalised values and the single gainSign
 * that drives both the Return % and Gain/Loss colour — never re-derived.
 *
 * Currency flow: original currency → USD (here) → displayCurrency (render only).
 */
function enrichPosition(pos, prices, rates, txRows) {
  // Convert aggregator amounts from original currency to USD
  const rate = rates[pos.currency] ?? 1;
  const buyAmountUSD = pos.buyAmount / rate;
  const sellAmountUSD = pos.sellAmount / rate;
  const minBuyUSD = pos.minBuyPrice != null ? pos.minBuyPrice / rate : null;
  const maxBuyUSD = pos.maxBuyPrice != null ? pos.maxBuyPrice / rate : null;

  const priceResult = prices.get(pos.ticker);
  const currentPrice = priceResult?.currentPrice ?? null; // USD
  const currentValue = currentPrice != null ? currentPrice * pos.units : null; // USD

  // Gain/loss formula — positive = made money, negative = lost money.
  // NEVER invert this sign.
  const unrealizedGain =
    currentValue != null ? currentValue + sellAmountUSD - buyAmountUSD : null;
  const returnRate =
    unrealizedGain != null && buyAmountUSD > 0
      ? (unrealizedGain / buyAmountUSD) * 100
      : null;

  // Single source of truth for colour — both Return % and Gain/Loss read gainSign.
  // portfolioPercent is filled in a second pass once the portfolio total is known.
  const gainSign =
    unrealizedGain == null
      ? null
      : unrealizedGain > 0
      ? 'gain'
      : unrealizedGain < 0
      ? 'loss'
      : 'neutral';

  return {
    ...pos,
    buyAmountUSD,
    sellAmountUSD,
    minBuyUSD,
    maxBuyUSD,
    currentPrice,
    currentValue,    // USD
    unrealizedGain,  // USD
    returnRate,      // %
    gainSign,        // 'gain' | 'loss' | 'neutral' | null
    portfolioPercent: null, // filled below
    changePercent: priceResult?.changePercent ?? null,
    historicalData: priceResult?.historicalData ?? [], // [{date, priceUSD}] — used by charts
    dividends:      priceResult?.dividends      ?? [], // [{date, amount, currency}] — from Yahoo
    // Per-transaction history for chart timeline reconstruction.
    // amountUSD is the buy cost (0 for sells); unitsDelta is +qty for buys, -qty for sells.
    txHistory: (txRows ?? [])
      .filter((r) => r.action === 'buy' || r.action === 'sell')
      .map((r) => {
        const qty   = Number(r.quantity);
        const isBuy = r.action === 'buy';
        return {
          date:       new Date(r.date),
          amountUSD:  isBuy ? (qty * Number(r.price)) / rate : 0,
          unitsDelta: isBuy ? qty : -qty,
        };
      }),
  };
}

function enrichPortfolio(byBroker, prices, rates, rows) {
  const enrichedByBroker = {};
  const allEnriched = [];

  for (const [broker, posMap] of Object.entries(byBroker)) {
    const positions = Object.values(posMap).map((pos) => {
      const txRows = (rows ?? []).filter(
        (r) => r.broker === broker && r.ticker === pos.ticker,
      );
      return enrichPosition(pos, prices, rates, txRows);
    });
    enrichedByBroker[broker] = positions;
    allEnriched.push(...positions);
  }

  // Total only counts positions where a price was available
  const portfolioTotalValue = allEnriched.reduce(
    (sum, p) => sum + (p.currentValue ?? 0),
    0,
  );

  // Second pass: assign portfolioPercent now that the total is known
  for (const positions of Object.values(enrichedByBroker)) {
    for (const p of positions) {
      p.portfolioPercent =
        p.currentValue != null && portfolioTotalValue > 0
          ? (p.currentValue / portfolioTotalValue) * 100
          : null;
    }
  }

  // Portfolio-wide totals are computed here — once — from the same flat array
  // that broker headers will also sum subsets of. Single source of truth.
  const portfolioTotals = calcPortfolioTotals(allEnriched);

  return { enrichedByBroker, portfolioTotalValue, portfolioTotals, allPositions: allEnriched };
}

/**
 * Compute portfolio-wide summary stats from all enriched positions.
 *
 * This is the single source of truth for the numbers shown in PortfolioSummary.
 * The broker section header totals are derived from the same enriched positions
 * by summing subsets of this same flat array — they are guaranteed to reconcile.
 *
 * @param {EnrichedPosition[]} allPositions — flat array across all brokers
 * @returns {PortfolioTotals}
 */
export function calcPortfolioTotals(allPositions) {
  const totalBuyAmountUSD = allPositions.reduce((s, p) => s + p.buyAmountUSD, 0);
  const totalCurrentValue = allPositions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  const totalUnrealizedGain = allPositions.reduce((s, p) => s + (p.unrealizedGain ?? 0), 0);
  const hasPrices = allPositions.some((p) => p.currentPrice != null);

  const totalReturnRate =
    hasPrices && totalBuyAmountUSD > 0
      ? (totalUnrealizedGain / totalBuyAmountUSD) * 100
      : null;

  // Daily change: weight each position's regularMarketChangePercent by its current value.
  // Positions without changePercent data (bonds, crypto) contribute 0 and don't distort
  // the percentage — the denominator is the full portfolio value, not just covered value.
  let dailyChangeValueUSD = 0;
  let hasDailyData = false;
  for (const p of allPositions) {
    if (p.changePercent != null && p.currentValue != null) {
      dailyChangeValueUSD += (p.changePercent / 100) * p.currentValue;
      hasDailyData = true;
    }
  }
  const dailyChangePercent =
    hasDailyData && totalCurrentValue > 0
      ? (dailyChangeValueUSD / totalCurrentValue) * 100
      : null;

  // Annualized return (CAGR): (1 + totalReturn)^(1/years) - 1
  // Measured from the earliest firstBuyDate across all positions.
  const earliestBuyDate = allPositions
    .map((p) => p.firstBuyDate)
    .filter(Boolean)
    .reduce((min, d) => (min === null || d < min ? d : min), null);

  let annualizedReturn = null;
  if (earliestBuyDate != null && hasPrices && totalBuyAmountUSD > 0) {
    const yearsHeld =
      (Date.now() - new Date(earliestBuyDate).getTime()) / (365.25 * 86_400_000);
    if (yearsHeld >= 0.1) {
      // Guard against near-zero division when portfolio is very new
      const totalReturnFraction = totalUnrealizedGain / totalBuyAmountUSD;
      // (1 + negative) raised to 1/years is only real when base > 0
      const base = 1 + totalReturnFraction;
      if (base > 0) {
        annualizedReturn = (Math.pow(base, 1 / yearsHeld) - 1) * 100;
      }
    }
  }

  // Each metric has its own independent sign — daily and all-time can diverge
  const sign = (v) =>
    v == null ? null : v > 0 ? 'gain' : v < 0 ? 'loss' : 'neutral';

  return {
    totalBuyAmountUSD,
    totalCurrentValue: hasPrices ? totalCurrentValue : null,
    totalUnrealizedGain: hasPrices ? totalUnrealizedGain : null,
    totalReturnRate,
    dailyChangeValueUSD: hasDailyData ? dailyChangeValueUSD : null,
    dailyChangePercent,
    annualizedReturn,
    returnSign: sign(totalReturnRate),
    dailySign: sign(dailyChangePercent),
    annualSign: sign(annualizedReturn),
  };
}

/**
 * Derive broker header totals by summing the already-enriched positions.
 * NEVER recalculate from raw position fields — the header must always
 * match the sum of what is shown in the table rows.
 */
function calcBrokerTotals(positions, portfolioTotalValue) {
  const totalBuyAmountUSD = positions.reduce((s, p) => s + p.buyAmountUSD, 0);
  const totalCurrentValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  const totalUnrealizedGain = positions.reduce(
    (s, p) => s + (p.unrealizedGain ?? 0),
    0,
  );

  // Only show return / portfolio % when at least one position has a live price
  const hasPrices = positions.some((p) => p.currentPrice != null);

  const returnRate =
    hasPrices && totalBuyAmountUSD > 0
      ? (totalUnrealizedGain / totalBuyAmountUSD) * 100
      : null;

  const portfolioPercent =
    hasPrices && portfolioTotalValue > 0
      ? (totalCurrentValue / portfolioTotalValue) * 100
      : null;

  const gainSign =
    !hasPrices
      ? null
      : totalUnrealizedGain > 0
      ? 'gain'
      : totalUnrealizedGain < 0
      ? 'loss'
      : 'neutral';

  return {
    totalBuyAmountUSD,
    totalCurrentValue: hasPrices ? totalCurrentValue : null,
    returnRate,
    portfolioPercent,
    gainSign,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingBar({ loaded, total }) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return (
    <div className="pv-loading">
      <p className="pv-loading__label">
        Fetching prices… ({loaded} / {total})
      </p>
      <div className="pv-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="pv-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FailedBadge({ tickers }) {
  if (tickers.length === 0) return null;
  return (
    <div
      className="pv-warning-badge"
      title={`Price data unavailable for: ${tickers.join(', ')}`}
    >
      ⚠ Could not load prices for: {tickers.join(', ')}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dividends modal
// ---------------------------------------------------------------------------
/** Returns how many units the user held at a given date, based on buy/sell rows. */
function unitsAtDate(txRows, date) {
  let units = 0;
  for (const row of txRows) {
    if (new Date(row.date) <= date) {
      if (row.action === 'buy')  units += Number(row.quantity);
      if (row.action === 'sell') units -= Number(row.quantity);
    }
  }
  return units;
}

function DividendsModal({ position, rows, onClose }) {
  const { convertToDisplay, displayCurrency, rates } = useCurrency();
  const handleBackdropClick = (e) => { if (e.target === e.currentTarget) onClose(); };

  const toUSD = (amount, currency) => amount / (rates[currency] ?? 1);
  const fc    = (usd) => formatCurrency(usd, convertToDisplay, displayCurrency);

  const txRows = rows ?? [];

  // For each Yahoo dividend, compute how many units were held on that date.
  // Skip dividends where units = 0 (paid before the user bought, or after full exit).
  const received = (position.dividends ?? [])
    .map((d) => {
      const units = unitsAtDate(txRows, new Date(d.date));
      return units > 0 ? { ...d, units, totalAmount: d.amount * units } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Group by calendar month
  const groups = [];
  const groupMap = {};
  for (const d of received) {
    const date  = new Date(d.date);
    const key   = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (!groupMap[key]) {
      groupMap[key] = { key, label, items: [], totalUSD: 0 };
      groups.push(groupMap[key]);
    }
    groupMap[key].items.push(d);
    groupMap[key].totalUSD += toUSD(d.totalAmount, d.currency);
  }

  return (
    <div className="pv-modal-backdrop" onClick={handleBackdropClick}>
      <div className="pv-modal-dialog" role="dialog" aria-modal="true">
        <header className="pv-modal-header">
          <div>
            <span className="pv-modal-ticker">{position.ticker}</span>
            <span className="pv-modal-name">{position.name}</span>
          </div>
          <button className="pv-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="pv-modal-body">
          {groups.length === 0 ? (
            <p className="pv-modal-empty">No dividends received for this position.</p>
          ) : (
            <div className="pv-div-list">
              {groups.map((group) => (
                <div key={group.key} className="pv-div-group">
                  <div className="pv-div-group__header">
                    <span>{group.label}</span>
                    <span>{fc(group.totalUSD)}</span>
                  </div>
                  {group.items.map((d, i) => (
                    <div key={i} className="pv-div-group__row">
                      <span className="pv-div-group__date">
                        {new Date(d.date).toISOString().slice(0, 10)}
                      </span>
                      <span className="pv-div-group__units">{d.units} units</span>
                      <span>{fc(toUSD(d.totalAmount, d.currency))}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PositionRow({ pos, onHistoryClick, onDividendsClick, convertToDisplay, displayCurrency }) {
  const daysHeld = pos.firstBuyDate ? calcDaysHeld(pos.firstBuyDate) : null;
  const tooltip = pos.firstBuyDate ? formatDaysTooltip(pos.firstBuyDate) : '';

  const fc = (usd) => formatCurrency(usd, convertToDisplay, displayCurrency);

  return (
    <tr className={pos.isClosed ? 'pv-row--closed' : ''}>
      <td>
        <span className="pv-asset-ticker">{pos.ticker}</span>
        <span className="pv-asset-name">{pos.name}</span>
      </td>
      <td className="pv-num">
        {Number(pos.units).toLocaleString('en-US', { maximumFractionDigits: 8 })}
        {pos.isClosed && <span className="pv-closed-badge">Closed</span>}
      </td>
      <td className="pv-num">{fc(pos.minBuyUSD)}</td>
      <td className="pv-num">{fc(pos.maxBuyUSD)}</td>
      <td className="pv-num">{pos.currentPrice != null ? fc(pos.currentPrice) : '—'}</td>
      <td className="pv-num" title={tooltip}>
        {daysHeld != null ? daysHeld.toLocaleString() : '—'}
      </td>
      <td className="pv-num">{fc(pos.buyAmountUSD)}</td>
      <td className="pv-num">
        {pos.currentValue != null ? fc(pos.currentValue) : '—'}
      </td>

      {/* Return % and Gain/Loss share gainSign — single colour source */}
      <td className={`pv-num${pos.gainSign ? ` value--${pos.gainSign}` : ''}`}>
        {formatPercent(pos.returnRate)}
      </td>
      <td className={`pv-num${pos.gainSign ? ` value--${pos.gainSign}` : ''}`}>
        {pos.unrealizedGain != null ? fc(pos.unrealizedGain) : '—'}
      </td>

      <td className="pv-num">
        {pos.portfolioPercent != null
          ? `${pos.portfolioPercent.toFixed(1)}%`
          : '—'}
      </td>
      <td className="pv-actions-cell">
        <button
          className="pv-icon-btn"
          onClick={() => onHistoryClick(pos)}
          title="Transaction history"
        >
          <HistoryIcon />
        </button>
        <button
          className={`pv-icon-btn${!pos.dividends?.length ? ' pv-icon-btn--disabled' : ''}`}
          onClick={() => pos.dividends?.length && onDividendsClick(pos)}
          title={pos.dividends?.length ? 'Dividends received' : 'No dividends for this position'}
          aria-disabled={!pos.dividends?.length}
        >
          <DividendIcon />
        </button>
      </td>
    </tr>
  );
}

function BrokerSection({
  broker,
  positions,
  portfolioTotalValue,
  isOpen,
  onToggle,
  onHistoryClick,
  onDividendsClick,
  convertToDisplay,
  displayCurrency,
}) {
  const totals = calcBrokerTotals(positions, portfolioTotalValue);
  const fc = (usd) => formatCurrency(usd, convertToDisplay, displayCurrency);

  return (
    <div className="pv-broker-section">
      <button
        className="pv-broker-header"
        onClick={() => onToggle(broker)}
        aria-expanded={isOpen}
      >
        <span className="pv-broker-header__name">{broker}</span>
        <span className="pv-broker-header__stats">
          <span>
            <span className="pv-stat-label">Invested</span>
            {fc(totals.totalBuyAmountUSD)}
          </span>
          <span>
            <span className="pv-stat-label">Value</span>
            {totals.totalCurrentValue != null ? fc(totals.totalCurrentValue) : '—'}
          </span>
          <span className={totals.gainSign ? `value--${totals.gainSign}` : ''}>
            <span className="pv-stat-label">Return</span>
            {formatPercent(totals.returnRate)}
          </span>
          <span>
            <span className="pv-stat-label">Portfolio</span>
            {totals.portfolioPercent != null
              ? `${totals.portfolioPercent.toFixed(1)}%`
              : '—'}
          </span>
        </span>
        <span className="pv-broker-header__chevron" aria-hidden="true">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {isOpen && (
        <div className="pv-broker-body">
          <div className="pv-table-wrap">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="pv-num">Units</th>
                  <th className="pv-num">Min Buy</th>
                  <th className="pv-num">Max Buy</th>
                  <th className="pv-num">Current Price</th>
                  <th className="pv-num">Days Held</th>
                  <th className="pv-num">Invested</th>
                  <th className="pv-num">Current Value</th>
                  <th className="pv-num">Return %</th>
                  <th className="pv-num">Gain / Loss</th>
                  <th className="pv-num">Portfolio %</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <PositionRow
                    key={`${pos.broker}::${pos.ticker}`}
                    pos={pos}
                    onHistoryClick={onHistoryClick}
                    onDividendsClick={onDividendsClick}
                    convertToDisplay={convertToDisplay}
                    displayCurrency={displayCurrency}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * PortfolioView — aggregates, enriches and renders the portfolio.
 *
 * Props:
 *   rows {object[]} — parsed, validated CSV rows from CsvDropZone.
 *
 * Lifecycle:
 *   1. Wait for forex rates to be ready (ratesLoading === false)
 *   2. Aggregate CSV rows → byBroker map
 *   3. Fetch live prices in parallel, update progress bar
 *      — 15-second total timeout triggers an alert (non-dismissible)
 *      — individual failures → null currentPrice → warning badge
 *   4. Enrich positions with USD-normalised values
 *   5. Render broker sections (collapsed by default)
 */
export default function PortfolioView({ rows: rowsProp }) {
  const { rates, ratesLoading, convertToDisplay, displayCurrency } = useCurrency();

  const [csvRows, setCsvRows] = useState(null);
  const [enriched, setEnriched] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });
  const [failedTickers, setFailedTickers] = useState([]);
  const [openBrokers, setOpenBrokers] = useState(new Set()); // all collapsed on mount
  const [historyPos, setHistoryPos] = useState(null);
  const [dividendsPos, setDividendsPos] = useState(null);

  // Step 1 — Sync incoming rows prop into local state
  useEffect(() => {
    setCsvRows(rowsProp ?? []);
  }, [rowsProp]);

  // Step 2 — Aggregate + fetch prices
  // Waits for csvRows AND for forex rates to finish loading.
  // rates is stable by the time ratesLoading flips to false, so including
  // both in deps is safe and lint-clean.
  useEffect(() => {
    if (!csvRows || ratesLoading) return;

    const byBroker = aggregatePortfolio(csvRows);
    const allPositions = Object.values(byBroker).flatMap((bp) =>
      Object.values(bp),
    );

    if (allPositions.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadProgress({ loaded: 0, total: allPositions.length });

    // 15-second total-fetch timeout
    let alertFired = false;
    const timeoutId = setTimeout(() => {
      alertFired = true;
      // eslint-disable-next-line no-alert
      alert('Some price data could not be loaded. Displayed values may be incomplete.');
    }, 15_000);

    fetchAllPrices(allPositions, {
      rates,
      onProgress: (loaded, total) => setLoadProgress({ loaded, total }),
    }).then(({ prices, failedTickers: failed }) => {
      if (!alertFired) clearTimeout(timeoutId);
      setFailedTickers(failed);
      setEnriched(enrichPortfolio(byBroker, prices, rates, csvRows));
      setLoading(false);
    });

    return () => clearTimeout(timeoutId);
  }, [csvRows, ratesLoading, rates]);

  const toggleBroker = (broker) =>
    setOpenBrokers((prev) => {
      const next = new Set(prev);
      next.has(broker) ? next.delete(broker) : next.add(broker);
      return next;
    });

  // ---- Render ----

  if (loading) {
    return <LoadingBar loaded={loadProgress.loaded} total={loadProgress.total} />;
  }

  if (!enriched) {
    return <p className="pv-empty">No portfolio data available.</p>;
  }

  const { enrichedByBroker, portfolioTotalValue, portfolioTotals, allPositions } = enriched;

  return (
    <div className="pv-root">
      <PortfolioSummary totals={portfolioTotals} />

      <FailedBadge tickers={failedTickers} />

      {Object.entries(enrichedByBroker)
        .sort(([, posA], [, posB]) => {
          const pctA = calcBrokerTotals(posA, portfolioTotalValue).portfolioPercent ?? -Infinity;
          const pctB = calcBrokerTotals(posB, portfolioTotalValue).portfolioPercent ?? -Infinity;
          return pctB - pctA;
        })
        .map(([broker, positions]) => (
        <BrokerSection
          key={broker}
          broker={broker}
          positions={positions}
          portfolioTotalValue={portfolioTotalValue}
          isOpen={openBrokers.has(broker)}
          onToggle={toggleBroker}
          onHistoryClick={setHistoryPos}
          onDividendsClick={setDividendsPos}
          convertToDisplay={convertToDisplay}
          displayCurrency={displayCurrency}
        />
      ))}

      <ChartsSection allPositions={allPositions} portfolioTotals={portfolioTotals} />

      {dividendsPos && (
        <DividendsModal
          position={dividendsPos}
          rows={csvRows?.filter(
            (r) => r.ticker === dividendsPos.ticker && r.broker === dividendsPos.broker,
          )}
          onClose={() => setDividendsPos(null)}
        />
      )}

      {historyPos && (
        <HistoryModal
          position={historyPos}
          rows={csvRows?.filter(
            (r) => r.ticker === historyPos.ticker && r.broker === historyPos.broker,
          )}
          onClose={() => setHistoryPos(null)}
        />
      )}
    </div>
  );
}
