import { useCurrency } from '../context/CurrencyContext';
import { formatCurrency, formatPercent } from '../utils/formatCurrency';
import './PortfolioSummary.css';

/**
 * PortfolioSummary — top-of-page stat bar.
 *
 * Receives pre-computed totals from PortfolioView (via calcPortfolioTotals).
 * Does zero calculation — only formats and renders.
 * All values are in USD and converted to displayCurrency at render time.
 *
 * Props:
 *   totals {PortfolioTotals} — output of calcPortfolioTotals()
 */
export default function PortfolioSummary({ totals }) {
  const { convertToDisplay, displayCurrency } = useCurrency();

  if (!totals) return null;

  const fc = (usd) => formatCurrency(usd, convertToDisplay, displayCurrency);

  const {
    totalBuyAmountUSD,
    totalCurrentValue,
    totalUnrealizedGain,
    totalReturnRate,
    dailyChangeValueUSD,
    dailyChangePercent,
    annualizedReturn,
    returnSign,
    dailySign,
    annualSign,
  } = totals;

  return (
    <div className="ps-root">
      <StatCard label="Total Value">
        <span className="ps-primary">{fc(totalCurrentValue)}</span>
      </StatCard>

      <StatCard label="Invested">
        <span className="ps-primary">{fc(totalBuyAmountUSD)}</span>
      </StatCard>

      <StatCard label="Daily Change">
        <span className={`ps-primary${dailySign ? ` value--${dailySign}` : ''}`}>
          {dailyChangeValueUSD != null ? fc(dailyChangeValueUSD) : '—'}
        </span>
        <span className={`ps-secondary${dailySign ? ` value--${dailySign}` : ''}`}>
          {formatPercent(dailyChangePercent)}
        </span>
      </StatCard>

      <StatCard label="All-time Return">
        <span className={`ps-primary${returnSign ? ` value--${returnSign}` : ''}`}>
          {totalUnrealizedGain != null ? fc(totalUnrealizedGain) : '—'}
        </span>
        <span className={`ps-secondary${returnSign ? ` value--${returnSign}` : ''}`}>
          {formatPercent(totalReturnRate)}
        </span>
      </StatCard>

      <StatCard label="Avg Yearly Return">
        <span className={`ps-primary${annualSign ? ` value--${annualSign}` : ''}`}>
          {formatPercent(annualizedReturn)}
        </span>
        <span className="ps-secondary">CAGR</span>
      </StatCard>
    </div>
  );
}

function StatCard({ label, children }) {
  return (
    <div className="ps-card">
      <span className="ps-card__label">{label}</span>
      <div className="ps-card__values">{children}</div>
    </div>
  );
}
