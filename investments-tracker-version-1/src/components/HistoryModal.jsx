import { useState, useEffect } from 'react'
import { fetchHistoricalPrices } from '../services/priceService'
import { useCurrency } from '../context/CurrencyContext'
import { fmtCurrency } from '../utils/formatCurrency'
import './HistoryModal.css'

export default function HistoryModal({ broker, pos, onClose }) {
  const { displayCurrency, rates } = useCurrency()
  const fmt = (v, from = pos.currency) => fmtCurrency(v, from, displayCurrency, rates)
  const [historicalPrices, setHistoricalPrices] = useState({})
  const [yahooCurrency, setYahooCurrency] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchHistoricalPrices(pos.ticker, pos.type).then(({ prices, currency }) => {
      setHistoricalPrices(prices)
      setYahooCurrency(currency)
      setLoading(false)
    })
  }, [pos.ticker, pos.type])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function priceCheck(tx) {
    const day = historicalPrices[tx.date.slice(0, 10)]
    if (!day) return null

    // Normalize both paid price and Yahoo range to USD so the comparison is
    // currency-neutral. This handles cases where the CSV records the price in
    // a different currency than what Yahoo Finance returns (e.g. IWDA.AS bought
    // via XTB in USD, but Yahoo Finance quotes it in EUR on Amsterdam exchange).
    const yc = yahooCurrency ?? 'USD'
    const paidUSD = parseFloat(tx.price) / (rates[tx.currency] ?? 1)
    const lowUSD  = day.low  / (rates[yc] ?? 1)
    const highUSD = day.high / (rates[yc] ?? 1)

    const rangeLabel = `${fmt(day.low, yc)} – ${fmt(day.high, yc)}`
    if (paidUSD >= lowUSD && paidUSD <= highUSD) {
      return { ok: true, tooltip: `Within day's range: ${rangeLabel}` }
    }
    return { ok: false, tooltip: `Outside day's range: ${rangeLabel} — possible data entry error` }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{pos.ticker}</h2>
            <p className="modal-subtitle">{pos.name} &middot; {broker}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {loading && <p className="modal-loading">Fetching historical prices…</p>}
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Action</th>
                  <th>Units</th>
                  <th>Price Paid</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {pos.transactions.map((tx, i) => {
                  const check = loading ? null : priceCheck(tx)
                  const priceClass = check === null ? '' : check.ok ? 'price-ok' : 'price-error'
                  const tooltip = check?.tooltip ?? (loading ? 'Loading price data…' : 'No price data for this date')
                  return (
                    <tr key={i}>
                      <td className="cell-date">{tx.date}</td>
                      <td>
                        <span className={`action-badge action-badge--${tx.action}`}>{tx.action}</span>
                      </td>
                      <td>{parseFloat(tx.quantity).toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
                      <td>
                        <span className={`price-cell ${priceClass}`} title={tooltip}>
                          {fmt(parseFloat(tx.price))}
                        </span>
                      </td>
                      <td className="cell-comment" title={tx.comment || ''}>{tx.comment || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
