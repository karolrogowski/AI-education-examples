import { useCurrency } from '../context/CurrencyContext'
import { fmtCurrency } from '../utils/formatCurrency'
import './PortfolioSummary.css'

export default function PortfolioSummary({ summary, loading }) {
  const { displayCurrency, rates } = useCurrency()
  const fmt = (v) => fmtCurrency(v, 'USD', displayCurrency, rates)
  const {
    currentValue,
    inputValue,
    dailyChange,
    dailyChangePercent,
    totalGainLoss,
    totalReturnPercent,
    yearlyReturnPercent,
  } = summary

  return (
    <div className="portfolio-summary">
      <SummaryCard
        label="Current Value"
        value={fmt(currentValue)}
      />
      <SummaryCard
        label="Invested"
        value={fmt(inputValue)}
      />
      <SummaryCard
        label="Daily Change"
        value={loading ? '—' : fmtSigned(dailyChange, fmt)}
        sub={loading ? null : fmtSignedPct(dailyChangePercent)}
        sign={loading ? null : Math.sign(dailyChange ?? 0)}
      />
      <SummaryCard
        label="Total Return"
        value={loading ? '—' : fmtSigned(totalGainLoss, fmt)}
        sub={loading ? null : fmtSignedPct(totalReturnPercent)}
        sign={loading ? null : Math.sign(totalGainLoss ?? 0)}
      />
      <SummaryCard
        label="Yearly Return (CAGR)"
        value={loading ? '—' : fmtSignedPct(yearlyReturnPercent)}
        sign={loading ? null : Math.sign(yearlyReturnPercent ?? 0)}
      />
    </div>
  )
}

function SummaryCard({ label, value, sub, sign }) {
  const colorClass = sign == null ? '' : sign > 0 ? 'positive' : sign < 0 ? 'negative' : ''
  return (
    <div className="summary-card">
      <span className="summary-label">{label}</span>
      <span className={`summary-value ${colorClass}`}>{value}</span>
      {sub && <span className={`summary-sub ${colorClass}`}>{sub}</span>}
    </div>
  )
}

function fmtSigned(value, fmt) {
  if (value == null) return '—'
  const sign = value >= 0 ? '+' : '−'
  return `${sign}${fmt(Math.abs(value))}`
}

function fmtSignedPct(value) {
  if (value == null) return null
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}
