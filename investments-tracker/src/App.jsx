import { useState, useEffect } from 'react'
import Papa from 'papaparse'
import CsvDropZone from './components/CsvDropZone'
import PortfolioView from './components/PortfolioView'
import { CurrencyProvider, useCurrency } from './context/CurrencyContext'
import './App.css'

const AUTO_LOAD_URL = '/example-data/portfolio.csv'

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}

export default function App() {
  return <CurrencyProvider><AppInner /></CurrencyProvider>
}

function AppInner() {
  const { displayCurrency, setCurrency } = useCurrency()
  const [transactions, setTransactions] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [loading, setLoading] = useState(true)
  const { theme, toggle } = useTheme()

  useEffect(() => {
    fetch(`${AUTO_LOAD_URL}?_=${Date.now()}`, { cache: 'no-store' })
      .then(res => {
        if (!res.ok) throw new Error('not found')
        return res.text()
      })
      .then(csv => {
        Papa.parse(csv, {
          header: true,
          skipEmptyLines: true,
          complete({ data }) {
            const TYPE_ALIASES = { stocks: 'etf', bonds: 'bond', metal: 'precious_metal', metals: 'precious_metal' }
            const rows = data
              .filter(r => r.action !== 'dividend')
              .map(r => ({ ...r, type: TYPE_ALIASES[r.type] ?? r.type }))
            setTransactions(rows)
            setFileName('portfolio.csv (auto-loaded)')
          },
        })
      })
      .catch(() => { /* no default file — show drop zone */ })
      .finally(() => setLoading(false))
  }, [])

  function handleData(rows, name) {
    setTransactions(rows)
    setFileName(name)
  }

  function handleReset() {
    setTransactions(null)
    setFileName(null)
  }

  if (loading) {
    return (
      <div className="app">
        <header className="app-header"><h1>Investments Tracker</h1></header>
        <main className="app-main app-main--center"><p className="loading">Loading…</p></main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Investments Tracker</h1>
        <div className="header-right">
          {fileName && (
            <span className="file-badge">
              {fileName}
              <button className="reset-btn" onClick={handleReset} title="Load another file">✕</button>
            </span>
          )}
          <select
            className="currency-select"
            value={displayCurrency}
            onChange={e => setCurrency(e.target.value)}
            title="Display currency"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="PLN">PLN</option>
          </select>
          <button
            className="theme-btn"
            onClick={toggle}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {transactions ? (
          <>
            <PortfolioView rows={transactions} />
            <CsvDropZone onData={handleData} compact />
          </>
        ) : (
          <CsvDropZone onData={handleData} />
        )}
      </main>
    </div>
  )
}
