import { useState, useEffect, useRef } from 'react';
import { useCurrency } from '../context/CurrencyContext';
import './HistoryModal.css';

// ---------------------------------------------------------------------------
// OHLC validation status constants
// ---------------------------------------------------------------------------
const VALID   = 'valid';   // transaction price within day's low–high
const INVALID = 'invalid'; // price outside range — possible data entry error
const UNKNOWN = 'unknown'; // OHLC unavailable

const SANITY_NOTE =
  'Passive data-entry sanity check — NOT a trading signal or investment advice.';

// ---------------------------------------------------------------------------
// OHLC fetch helpers
// ---------------------------------------------------------------------------

async function fetchYahooOHLC(ticker, dateStr) {
  const period1 = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
  const period2 = Math.floor(new Date(dateStr + 'T23:59:59Z').getTime() / 1000);
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    if (!quote) return null;
    const low  = quote.low?.[0]  ?? null;
    const high = quote.high?.[0] ?? null;
    if (low == null || high == null) return null;
    return { low, high, currency: result?.meta?.currency ?? null };
  } catch {
    clearTimeout(tid);
    return null;
  }
}

// Simple cache: resolved coin ID per base symbol (e.g. 'BTC' → 'bitcoin')
const coinIdCache = new Map();

async function resolveCoinId(ticker) {
  const base = ticker.replace(/-USD$/i, '').toLowerCase();
  if (coinIdCache.has(base)) return coinIdCache.get(base);
  try {
    const res = await fetch(`/api/coingecko/search?query=${encodeURIComponent(base)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const id = json?.coins?.[0]?.id ?? null;
    if (id) coinIdCache.set(base, id);
    return id;
  } catch {
    return null;
  }
}

async function fetchCoinGeckoOHLC(ticker, dateStr) {
  const coinId = await resolveCoinId(ticker);
  if (!coinId) return null;
  const period1 = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
  const period2 = Math.floor(new Date(dateStr + 'T23:59:59Z').getTime() / 1000);
  const url = `/api/coingecko/coins/${coinId}/market_chart/range` +
    `?vs_currency=usd&from=${period1}&to=${period2}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const prices = json?.prices ?? [];
    if (prices.length === 0) return null;
    const vals = prices.map(([, p]) => p);
    return { low: Math.min(...vals), high: Math.max(...vals), currency: 'USD' };
  } catch {
    return null;
  }
}

async function fetchOHLC(ticker, type, dateStr) {
  // Polish savings bonds have no market OHLC
  if (/^(EDO|COI|ROS|DOS|TOS)/i.test(ticker)) return null;
  if (type === 'crypto') return fetchCoinGeckoOHLC(ticker, dateStr);
  return fetchYahooOHLC(ticker, dateStr);
}

// ---------------------------------------------------------------------------
// OHLC normalisation
// ---------------------------------------------------------------------------

/**
 * Convert an OHLC range to the same currency unit as the CSV row price.
 *
 * rates = "how many X per 1 USD" (from CurrencyContext).
 * GBp (pence) is normalised to GBP before the rate lookup because Frankfurter
 * only carries GBP, not GBp.
 */
function convertOhlcToRowCurrency(ohlc, rowCurrency, rates) {
  if (!ohlc || !ohlc.currency || !rowCurrency) return ohlc;

  // Normalise GBp → GBP (100 pence = 1 pound) for the rate table
  const fromBase  = ohlc.currency === 'GBp' ? 'GBP' : ohlc.currency;
  const penceDiv  = ohlc.currency === 'GBp' ? 100 : 1;

  if (fromBase === rowCurrency) {
    // Same base currency — only pence scaling needed
    if (penceDiv === 1) return ohlc;
    return { low: ohlc.low / penceDiv, high: ohlc.high / penceDiv, currency: rowCurrency };
  }

  // Cross-currency conversion via USD as the intermediate
  const rateFrom = rates[fromBase];
  const rateTo   = rates[rowCurrency];
  if (!rateFrom || !rateTo) return ohlc; // unknown rate — return unchanged

  const convert = (v) => (v / penceDiv / rateFrom) * rateTo;
  return { low: convert(ohlc.low), high: convert(ohlc.high), currency: rowCurrency };
}

// ---------------------------------------------------------------------------
// Validation dot
// ---------------------------------------------------------------------------
function ValidationDot({ status, price, ohlc }) {
  const color =
    status === VALID   ? '#20bf6b' :
    status === INVALID ? '#e74c3c' :
    '#555577';

  let tooltip;
  if (status === UNKNOWN) {
    tooltip = 'No OHLC data available for this date.';
  } else {
    const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const range = ohlc
      ? `${fmt(ohlc.low)} – ${fmt(ohlc.high)}${ohlc.currency ? ` ${ohlc.currency}` : ''}`
      : '?';
    const verdict = status === VALID
      ? `✓ ${price} is within day range: ${range}`
      : `✗ ${price} is outside day range: ${range} — possible data entry error`;
    tooltip = `${verdict}\n${SANITY_NOTE}`;
  }

  const ariaLabel =
    status === VALID   ? 'Price within day range' :
    status === INVALID ? 'Price outside day range — possible data entry error' :
    'Day OHLC data unavailable';

  return (
    <span
      className="hm-dot"
      style={{ color }}
      title={tooltip}
      aria-label={ariaLabel}
    >
      ●
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * HistoryModal — transaction history and OHLC price validation for one position.
 *
 * Props:
 *   position  {EnrichedPosition} — enriched position object from PortfolioView
 *   rows      {object[]}         — raw CSV rows filtered to this ticker + broker
 *   onClose   {() => void}
 */
export default function HistoryModal({ position, rows, onClose }) {
  if (!position) return null;

  const { rates } = useCurrency();
  const [ohlcMap, setOhlcMap]       = useState({});   // { [dateStr]: { low, high } | null }
  const [ohlcLoading, setOhlcLoading] = useState(true);
  const fetchStarted = useRef(false);

  const allRows = rows ?? [];

  const transactions = allRows
    .filter((r) => {
      const a = r.action?.toLowerCase();
      return a === 'buy' || a === 'sell';
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Fetch OHLC once per unique trade date when modal opens
  useEffect(() => {
    if (fetchStarted.current) return;
    fetchStarted.current = true;

    const uniqueDates = [...new Set(transactions.map((r) => r.date.slice(0, 10)))];
    if (uniqueDates.length === 0) {
      setOhlcLoading(false);
      return;
    }

    Promise.all(
      uniqueDates.map(async (d) => [d, await fetchOHLC(position.ticker, position.type, d)])
    ).then((entries) => {
      setOhlcMap(Object.fromEntries(entries));
      setOhlcLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getValidationStatus(row, ohlc) {
    if (ohlcLoading) return UNKNOWN;
    if (!ohlc) return UNKNOWN;
    const price = parseFloat(row.price);
    if (isNaN(price)) return UNKNOWN;
    return price >= ohlc.low && price <= ohlc.high ? VALID : INVALID;
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="hm-backdrop" onClick={handleBackdropClick}>
      <div className="hm-dialog" role="dialog" aria-modal="true">
        <header className="hm-header">
          <div>
            <span className="hm-ticker">{position.ticker}</span>
            <span className="hm-name">{position.name}</span>
          </div>
          <button className="hm-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="hm-body">
          {transactions.length > 0 && (
            <>
              <h3 className="hm-section-title">Transactions</h3>
              <p className="hm-ohlc-legend">
                <span className="hm-dot" style={{ color: '#20bf6b' }}>●</span> within day range
                <span className="hm-legend-sep" />
                <span className="hm-dot" style={{ color: '#e74c3c' }}>●</span> outside range
                <span className="hm-legend-sep" />
                <span className="hm-dot" style={{ color: '#555577' }}>●</span> no data
              </p>
              <div className="hm-table-wrap">
                <table className="hm-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th className="hm-num">Units</th>
                      <th className="hm-num">Price</th>
                      <th>Currency</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((row, i) => {
                      const ohlc = convertOhlcToRowCurrency(
                        ohlcMap[row.date.slice(0, 10)] ?? null,
                        row.currency,
                        rates,
                      );
                      const status = getValidationStatus(row, ohlc);
                      return (
                        <tr key={i}>
                          <td className="hm-date">{row.date.slice(0, 10)}</td>
                          <td>
                            <span className={`hm-action hm-action--${row.action?.toLowerCase()}`}>
                              {row.action}
                            </span>
                          </td>
                          <td className="hm-num">{row.quantity}</td>
                          <td className="hm-num hm-price-cell">
                            {row.price}
                            <ValidationDot status={status} price={row.price} ohlc={ohlc} />
                          </td>
                          <td>{row.currency}</td>
                          <td className="hm-comment">{row.comment || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {transactions.length === 0 && (
            <p className="hm-note">No transaction data available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
