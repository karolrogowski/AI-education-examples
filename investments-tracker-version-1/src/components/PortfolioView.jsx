import { useState, useEffect, useMemo } from 'react'
import { aggregateByBroker, withCurrentPrices, computePortfolioSummary, daysHeld } from '../utils/portfolioAggregator'
import { fetchCurrentPrices, YAHOO_TYPES } from '../services/priceService'
import { useCurrency } from '../context/CurrencyContext'
import { fmtCurrency } from '../utils/formatCurrency'
import { estimateBondCurrentPrice } from '../utils/bondValueEstimator'
import HistoryModal from './HistoryModal'
import PortfolioSummary from './PortfolioSummary'
import ChartsSection from './ChartsSection'
import './PortfolioView.css'

export default function PortfolioView({ rows }) {
  const { displayCurrency, rates } = useCurrency()
  const baseGroups = useMemo(() => aggregateByBroker(rows), [rows])
  const [groups, setGroups] = useState(baseGroups)
  const [previousPrices, setPreviousPrices] = useState({})
  const [priceCurrencies, setPriceCurrencies] = useState({})
  const [loadingPrices, setLoadingPrices] = useState(true)
  const [loadingTimedOut, setLoadingTimedOut] = useState(false)
  const [failedTickers, setFailedTickers] = useState([])
  const [incompleteDataDismissed, setIncompleteDataDismissed] = useState(false)
  const [modal, setModal] = useState(null) // { broker, pos }
  const [collapsed, setCollapsed] = useState(new Set()) // set of collapsed broker names

  function toggleBroker(broker) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(broker) ? next.delete(broker) : next.add(broker)
      return next
    })
  }

  // 15-second timeout: if prices haven't loaded, show an alert
  useEffect(() => {
    if (!loadingPrices) { setLoadingTimedOut(false); return }
    const timer = setTimeout(() => setLoadingTimedOut(true), 15_000)
    return () => clearTimeout(timer)
  }, [loadingPrices])

  useEffect(() => {
    setLoadingPrices(true)
    const seen = new Set()
    const unique = []
    for (const { positions } of baseGroups) {
      for (const pos of positions) {
        if (!seen.has(pos.ticker)) {
          seen.add(pos.ticker)
          unique.push({ ticker: pos.ticker, type: pos.type })
        }
      }
    }
    fetchCurrentPrices(unique).then(({ prices, previousPrices: prev, priceCurrencies: currencies }) => {
      setGroups(withCurrentPrices(baseGroups, prices))
      setPreviousPrices(prev)
      setPriceCurrencies(currencies)
      const fetchable = unique.filter(p => YAHOO_TYPES.includes(p.type) || p.type === 'crypto')
      const failed = fetchable.filter(p => prices[p.ticker] == null).map(p => p.ticker)
      setFailedTickers(failed)
      setIncompleteDataDismissed(false)
      setLoadingPrices(false)
    })
  }, [baseGroups])

  // Normalize all prices to USD and fill in bond estimates.
  // Done in a memo (not the fetch effect) so it always uses the latest rates — this
  // prevents a stale-closure bug where rates={PLN:1} at fetch time inflated bond values.
  // Yahoo Finance returns prices in the exchange's native currency (EUR for .AS, GBP for .L,
  // etc.) which must be converted to USD so all values are on a common scale.
  const enrichedGroups = useMemo(() => {
    // First pass: normalize currentPrice / currentValue to USD for every position
    const normalized = groups.map(group => ({
      ...group,
      positions: group.positions.map(pos => {
        if (pos.type === 'bond' && pos.currentValue == null && pos.buyUnits > 0) {
          // Sum estimated value across individual buy transactions — each lot accrues
          // from its own purchase date, so same-ticker bonds bought on different days
          // will have different per-unit values (matching how brokers track them).
          const buyTxs = pos.transactions.filter(tx => tx.action === 'buy')
          let totalEstimatedPLN = 0
          for (const tx of buyTxs) {
            const qty = parseFloat(tx.quantity)
            const estimated = estimateBondCurrentPrice(pos.ticker, new Date(tx.date))
            totalEstimatedPLN += (estimated ?? parseFloat(tx.price)) * qty
          }
          // Scale by remaining units / total bought to account for any partial sells
          const scaledPLN = totalEstimatedPLN * (pos.units / pos.buyUnits)
          const currentValueUSD = scaledPLN / (rates[pos.currency] ?? 1)
          const currentPriceUSD = pos.units > 0 ? currentValueUSD / pos.units : 0
          return { ...pos, currentPrice: currentPriceUSD, currentValue: currentValueUSD }
        }
        if (pos.currentPrice != null) {
          const priceCurr = priceCurrencies[pos.ticker] ?? 'USD'
          if (priceCurr !== 'USD') {
            const priceUSD = pos.currentPrice / (rates[priceCurr] ?? 1)
            return { ...pos, currentPrice: priceUSD, currentValue: pos.units * priceUSD }
          }
        }
        return pos
      }),
    }))

    // Second pass: recalculate portfolioRatio from corrected USD values
    const totalValue = normalized.reduce(
      (sum, g) => sum + g.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0), 0
    )
    return normalized.map(group => ({
      ...group,
      positions: group.positions.map(pos => ({
        ...pos,
        portfolioRatio: totalValue > 0 && pos.currentValue != null
          ? (pos.currentValue / totalValue) * 100
          : pos.portfolioRatio,
      })),
    }))
  }, [groups, rates, priceCurrencies])

  // Normalize previousPrices to USD so daily change uses the same scale as currentPrice
  const previousPricesUSD = useMemo(() => {
    const result = {}
    for (const [ticker, prev] of Object.entries(previousPrices)) {
      const priceCurr = priceCurrencies[ticker] ?? 'USD'
      result[ticker] = priceCurr === 'USD' ? prev : prev / (rates[priceCurr] ?? 1)
    }
    return result
  }, [previousPrices, priceCurrencies, rates])

  const summary = useMemo(
    () => computePortfolioSummary(enrichedGroups, previousPricesUSD, rates),
    [enrichedGroups, previousPricesUSD, rates]
  )

  // Total portfolio current value — used to compute per-broker portfolio %
  const totalCurrentValue = enrichedGroups.reduce(
    (sum, g) => sum + g.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0), 0
  )

  // Sort broker panels by current value descending (= portfolio % descending)
  const sortedGroups = [...enrichedGroups].sort((a, b) => {
    const va = a.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
    const vb = b.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
    return vb - va
  })

  return (
    <div className="portfolio-view">
      {loadingPrices && (
        <div className="loading-bar-wrap">
          <div className={`loading-bar${loadingTimedOut ? ' loading-bar--timed-out' : ''}`} />
          {loadingTimedOut && (
            <p className="loading-timeout-alert">
              ⚠ Price data could not be loaded after 15 seconds. Live values may be unavailable.
            </p>
          )}
        </div>
      )}
      {!loadingPrices && !incompleteDataDismissed && failedTickers.length > 0 && (
        <div className="incomplete-data-banner">
          <span>
            ⚠ Data incomplete — could not load live prices for:{' '}
            <strong>{failedTickers.join(', ')}</strong>.
            {' '}Showing last known or estimated values instead.
          </span>
          <button
            className="incomplete-data-dismiss"
            onClick={() => setIncompleteDataDismissed(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {<PortfolioSummary summary={summary} loading={loadingPrices} />}
      {sortedGroups.map(group => {
        const isCollapsed = collapsed.has(group.broker)

        const brokerCurrentValue = group.positions.reduce((s, p) => s + (p.currentValue ?? 0), 0)
        // Cost basis normalised to USD so it can be summed across multi-currency positions
        // (same logic as fmtCurrency: divide by the position's currency rate to get USD)
        const brokerCostBasis = group.positions.reduce((s, p) => {
          if (p.buyUnits <= 0) return s
          const cb    = (p.buyAmount / p.buyUnits) * p.units
          const cbUSD = cb / (rates[p.currency] ?? 1)
          return s + cbUSD
        }, 0)
        const brokerUnrealizedGain = group.positions.reduce((s, p) => {
          if (p.buyUnits <= 0) return s
          const cb    = (p.buyAmount / p.buyUnits) * p.units
          const cbUSD = cb / (rates[p.currency] ?? 1)
          return s + (p.currentValue != null ? p.currentValue - cbUSD : 0)
        }, 0)
        const brokerReturnRate   = brokerCostBasis > 0 ? (brokerUnrealizedGain / brokerCostBasis) * 100 : null
        const brokerPortfolioPct = totalCurrentValue > 0 ? (brokerCurrentValue / totalCurrentValue) * 100 : null

        return (
          <section key={group.broker} className="broker-section">
            <button
              className="broker-heading"
              onClick={() => toggleBroker(group.broker)}
              aria-expanded={!isCollapsed}
            >
              <span className="broker-heading-label">{group.broker}</span>
              {!loadingPrices && (
                <span className="broker-heading-stats">
                  <span className="broker-stat">
                    <span className="broker-stat-label">Invested</span>
                    <span className="broker-stat-value">{fmtCurrency(brokerCostBasis, 'USD', displayCurrency, rates)}</span>
                  </span>
                  <span className="broker-stat-sep" />
                  <span className="broker-stat">
                    <span className="broker-stat-label">Current Value</span>
                    <span className="broker-stat-value">{fmtCurrency(brokerCurrentValue, 'USD', displayCurrency, rates)}</span>
                  </span>
                  <span className="broker-stat-sep" />
                  <span className="broker-stat" title="Unrealized return: (current value − cost basis) / cost basis">
                    <span className="broker-stat-label">Return</span>
                    <span className={`broker-stat-value ${brokerReturnRate == null ? '' : brokerReturnRate >= 0 ? 'positive' : 'negative'}`}>
                      {brokerReturnRate != null ? `${brokerReturnRate >= 0 ? '+' : ''}${brokerReturnRate.toFixed(2)}%` : '—'}
                    </span>
                  </span>
                  <span className="broker-stat-sep" />
                  <span className="broker-stat">
                    <span className="broker-stat-label">Portfolio</span>
                    <span className="broker-stat-value">
                      {brokerPortfolioPct != null ? `${brokerPortfolioPct.toFixed(1)}%` : '—'}
                    </span>
                  </span>
                </span>
              )}
              <span className={`broker-chevron broker-chevron--${isCollapsed ? 'closed' : 'open'}`}>▼</span>
            </button>
            {!isCollapsed && (
              <div className="table-scroll">
                <table className="portfolio-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Units</th>
                      <th>Min Buy</th>
                      <th>Max Buy</th>
                      <th>Current Price</th>
                      <th>Days Held</th>
                      <th title="Average buy price × remaining units held">Invested</th>
                      <th>Current Value</th>
                      <th title="Unrealized return: (current value − cost basis) / cost basis">Return %</th>
                      <th title="Unrealized gain or loss: current value − cost basis">Gain / Loss</th>
                      <th>Portfolio %</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.positions.map(pos => (
                      <PositionRow
                        key={pos.ticker}
                        pos={pos}
                        loadingPrices={loadingPrices}
                        displayCurrency={displayCurrency}
                        rates={rates}
                        onHistory={() => setModal({ broker: group.broker, pos })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}

      <ChartsSection groups={enrichedGroups} priceCurrencies={priceCurrencies} />

      {modal && (
        <HistoryModal
          broker={modal.broker}
          pos={modal.pos}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function formatDaysTooltip(days) {
  if (days == null) return null
  const years  = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  const d      = days % 30
  const parts  = []
  if (years  > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`)
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`)
  if (d > 0 || parts.length === 0) parts.push(`${d} day${d !== 1 ? 's' : ''}`)
  return parts.join(', ')
}

function PositionRow({ pos, loadingPrices, displayCurrency, rates, onHistory }) {
  const days = daysHeld(pos)
  const closed = pos.units <= 0
  const fmt = (v, from = pos.currency) => fmtCurrency(v, from, displayCurrency, rates)

  // Cost basis in USD — normalise from the position's native currency so it can be
  // compared directly with currentValue (which comes from Yahoo Finance in USD).
  const costBasisRaw = pos.buyUnits > 0 ? (pos.buyAmount / pos.buyUnits) * pos.units : 0
  const costBasis    = costBasisRaw / (rates[pos.currency] ?? 1)
  const unrealizedGain  = pos.currentValue != null ? pos.currentValue - costBasis : null
  const unrealizedRoR   = costBasis > 0 && unrealizedGain != null ? (unrealizedGain / costBasis) * 100 : null

  return (
    <tr className={closed ? 'row-closed' : ''}>
      <td className="cell-asset">
        <span className="asset-ticker">{pos.ticker}</span>
        <span className="asset-name">{pos.name}</span>
      </td>
      <td>{pos.units.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
      <td>{fmt(pos.minBuyPrice)}</td>
      <td>{fmt(pos.maxBuyPrice)}</td>
      <td>
        {['stock', 'crypto', 'precious_metal', 'etf'].includes(pos.type)
          ? (loadingPrices ? <Dots /> : (pos.currentPrice != null ? fmt(pos.currentPrice, 'USD') : '—'))
          : null}
      </td>
      <td title={formatDaysTooltip(days) ?? undefined}>
        {days != null ? `${days}${closed ? ' (closed)' : ''}` : '—'}
      </td>
      <td>{fmt(costBasis, 'USD')}</td>
      <td>{loadingPrices ? <Dots /> : (pos.currentValue != null ? fmt(pos.currentValue, 'USD') : '—')}</td>
      <td className={unrealizedRoR != null ? (unrealizedRoR >= 0 ? 'positive' : 'negative') : ''}>
        {loadingPrices ? <Dots /> : (unrealizedRoR != null
          ? `${unrealizedRoR >= 0 ? '+' : ''}${unrealizedRoR.toFixed(2)}%`
          : '—')}
      </td>
      <td className={unrealizedGain != null ? (unrealizedGain >= 0 ? 'positive' : 'negative') : ''}>
        {loadingPrices ? <Dots /> : (unrealizedGain != null
          ? `${unrealizedGain >= 0 ? '+' : '-'}${fmt(Math.abs(unrealizedGain), 'USD')}`
          : '—')}
      </td>
      <td>{loadingPrices ? <Dots /> : (pos.portfolioRatio != null ? `${pos.portfolioRatio.toFixed(1)}%` : '—')}</td>
      <td>
        <button className="history-btn" onClick={onHistory}>History</button>
      </td>
    </tr>
  )
}

function Dots() {
  return <span className="loading-dots">…</span>
}

