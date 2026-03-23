import { useState, useEffect, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
  BarChart, Bar,
} from 'recharts'
import { fetchAllHistoricalPrices, fetchDividendEvents } from '../services/priceService'
import {
  computeAllocationByType,
  computeAllocationOverTime,
  computeGainLossOverTime,
  computeDividendsOverTime,
  TYPE_COLORS, TYPE_LABELS,
} from '../utils/chartDataUtils'
import { useCurrency } from '../context/CurrencyContext'
import { fmtCurrency } from '../utils/formatCurrency'
import './ChartsSection.css'

// ─── static helpers (no currency) ────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const [y, m] = dateStr.split('-')
  return `${MONTHS[parseInt(m) - 1]} '${y.slice(2)}`
}

// ─── tooltip components ───────────────────────────────────────────────────────

function PieTooltip({ active, payload, fmt }) {
  if (!active || !payload?.length) return null
  const { name, value, _total } = payload[0].payload
  const pct = _total ? ((value / _total) * 100).toFixed(1) : '—'
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{name}</p>
      <p>{fmt(value)} ({pct}%)</p>
    </div>
  )
}

function AllocationTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const nonZero = [...payload].reverse().filter(p => p.value > 0)
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{fmtDate(label)}</p>
      {nonZero.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {TYPE_LABELS[p.dataKey] ?? p.dataKey}: {p.value?.toFixed(1)}%
        </p>
      ))}
    </div>
  )
}

function TimeTooltip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{fmtDate(label)}</p>
      {payload.map(p => p.value != null && (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

function DividendTooltip({ active, payload, fmt }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload // { year, income, items: [{ticker, date, income}] }
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{d.year} — {fmt(d.income)}</p>
      <hr className="chart-tooltip-divider" />
      {d.items?.map((item, i) => (
        <p key={i} className="chart-tooltip-item">
          {MONTHS[parseInt(item.date.slice(5, 7)) - 1]} · {item.ticker}: {fmt(item.income)}
        </p>
      ))}
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

function PiePercentLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.04) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
      fill="white" fontSize={11} fontWeight={600}>
      {(percent * 100).toFixed(1)}%
    </text>
  )
}

const PERIODS = ['1D', '5D', '1M', '6M', '1Y', '3Y', '5Y', 'All']

function filterByPeriod(data, period) {
  if (period === 'All' || !data.length) return data
  const today = new Date()
  const cutoff = new Date(today)
  if      (period === '1D') cutoff.setDate(today.getDate() - 1)
  else if (period === '5D') cutoff.setDate(today.getDate() - 5)
  else if (period === '1M') cutoff.setMonth(today.getMonth() - 1)
  else if (period === '6M') cutoff.setMonth(today.getMonth() - 6)
  else if (period === '1Y') cutoff.setFullYear(today.getFullYear() - 1)
  else if (period === '3Y') cutoff.setFullYear(today.getFullYear() - 3)
  else if (period === '5Y') cutoff.setFullYear(today.getFullYear() - 5)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return data.filter(d => d.date >= cutoffStr)
}

export default function ChartsSection({ groups, priceCurrencies = {} }) {
  const { displayCurrency, rates } = useCurrency()
  const [historicalPrices, setHistoricalPrices] = useState(null)
  const [dividendEvents,   setDividendEvents]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [allocPeriod, setAllocPeriod] = useState('All')
  const [gainPeriod,  setGainPeriod]  = useState('All')

  // Convert a USD value to the display currency (full format)
  const fmt = (v) => fmtCurrency(v, 'USD', displayCurrency, rates)

  // Compact Y-axis label: converted value with 'k' suffix for thousands
  const fmtAxis = (v) => {
    const c = v * (rates[displayCurrency] ?? 1)
    return Math.abs(c) >= 1000 ? `${(c / 1000).toFixed(0)}k` : c.toFixed(0)
  }

  // Stable key so we don't refetch when only prices change
  const tickerKey = useMemo(
    () => groups.flatMap(g => g.positions).map(p => p.ticker).sort().join(','),
    [groups]
  )

  useEffect(() => {
    setLoading(true)
    const positions = groups.flatMap(g => g.positions)
    const unique = [...new Map(positions.map(p => [p.ticker, p])).values()]
    Promise.all([
      fetchAllHistoricalPrices(unique),
      fetchDividendEvents(unique),
    ]).then(([hist, divs]) => {
      setHistoricalPrices(hist)
      setDividendEvents(divs)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey])

  const positions = groups.flatMap(g => g.positions)
  const allTypes  = [...new Set(positions.map(p => p.type))]

  // Live prices from the already-fetched enriched groups — used as fallback for today's data point
  const currentPrices = useMemo(() => {
    const p = {}
    for (const pos of positions) {
      if (pos.currentPrice != null) p[pos.ticker] = pos.currentPrice
    }
    return p
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  const pieData = computeAllocationByType(groups)
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0)
  const pieDataWithTotal = pieData.map(d => ({ ...d, _total: pieTotal }))

  const overTimeData  = !loading && historicalPrices ? computeAllocationOverTime(positions, historicalPrices, currentPrices, priceCurrencies, rates) : []
  const gainLossData  = !loading && historicalPrices ? computeGainLossOverTime(positions, historicalPrices, currentPrices, rates, priceCurrencies) : []
  const dividendsData = !loading && dividendEvents   ? computeDividendsOverTime(dividendEvents, positions, priceCurrencies, rates) : []

  function ticks(data) {
    if (data.length <= 12) return data.map(d => d.date)
    return data.filter((_, i) => i % 6 === 0).map(d => d.date)
  }

  const axisStyle = { fontSize: 11, fill: 'var(--text-muted)' }
  const gridStyle = { strokeDasharray: '3 3', stroke: 'var(--border)' }

  return (
    <div className="charts-section">
      <h2 className="charts-heading">Portfolio Analysis</h2>
      <div className="charts-grid">

        {/* 1 — Current allocation (pie) */}
        <div className="chart-card">
          <h3 className="chart-card-title">Current Allocation</h3>
          {pieData.length === 0 ? (
            <p className="chart-empty">No price data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieDataWithTotal}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  outerRadius={110}
                  label={PiePercentLabel}
                  labelLine={false}
                >
                  {pieDataWithTotal.map(entry => (
                    <Cell key={entry.type} fill={TYPE_COLORS[entry.type] ?? '#aaa'} />
                  ))}
                </Pie>
                <Tooltip content={p => <PieTooltip {...p} fmt={fmt} />} />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value, entry) => {
                    const pct = pieTotal > 0 ? ((entry.payload.value / pieTotal) * 100).toFixed(1) : '0'
                    return `${value} (${pct}%)`
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 2 — Allocation over time (stacked area) */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Allocation Over Time</h3>
            <div className="chart-period-selector">
              {PERIODS.map(p => (
                <button key={p} className={`chart-period-btn${allocPeriod === p ? ' active' : ''}`} onClick={() => setAllocPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>
          {loading ? (
            <p className="chart-loading">Loading historical data…</p>
          ) : (() => { const d = filterByPeriod(overTimeData, allocPeriod); return d.length < 2 ? (
            <p className="chart-empty">Not enough data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={d} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="date" ticks={ticks(d)} tickFormatter={fmtDate} tick={axisStyle} />
                <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={axisStyle} domain={[0, 100]} />
                <Tooltip content={<AllocationTooltip />} />
                <Legend formatter={key => TYPE_LABELS[key] ?? key} wrapperStyle={{ fontSize: 12 }} />
                {allTypes.map(type => (
                  <Area
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stackId="1"
                    fill={TYPE_COLORS[type] ?? '#aaa'}
                    stroke={TYPE_COLORS[type] ?? '#aaa'}
                    fillOpacity={0.85}
                    name={TYPE_LABELS[type] ?? type}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )})()}
        </div>

        {/* 3 — Gain / loss vs invested (line) */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h3 className="chart-card-title">Gain / Loss vs Invested</h3>
            <div className="chart-period-selector">
              {PERIODS.map(p => (
                <button key={p} className={`chart-period-btn${gainPeriod === p ? ' active' : ''}`} onClick={() => setGainPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>
          {loading ? (
            <p className="chart-loading">Loading historical data…</p>
          ) : (() => { const d = filterByPeriod(gainLossData, gainPeriod); return d.length < 2 ? (
            <p className="chart-empty">Not enough data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={d} margin={{ top: 4, right: 8, left: 40, bottom: 0 }}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="date" ticks={ticks(d)} tickFormatter={fmtDate} tick={axisStyle} />
                <YAxis tickFormatter={fmtAxis} tick={axisStyle} width={48} />
                <Tooltip content={p => <TimeTooltip {...p} fmt={fmt} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="invested" name="Invested"       stroke="var(--accent)"   dot={false} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="value"    name="Portfolio Value" stroke="var(--positive)" dot={false} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )})()}
        </div>

        {/* 4 — Dividends over time (bar) */}
        <div className="chart-card">
          <h3 className="chart-card-title">Dividends Received</h3>
          {loading ? (
            <p className="chart-loading">Loading dividend data…</p>
          ) : dividendsData.length === 0 ? (
            <p className="chart-empty">No dividend data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dividendsData} margin={{ top: 4, right: 8, left: 40, bottom: 0 }}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="year" tick={axisStyle} />
                <YAxis tickFormatter={fmtAxis} tick={axisStyle} width={48} />
                <Tooltip content={p => <DividendTooltip {...p} fmt={fmt} />} />
                <Bar dataKey="income" name="Dividends" fill="var(--positive)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  )
}
