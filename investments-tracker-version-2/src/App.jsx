import { useState } from 'react';
import { useTheme } from './context/ThemeContext';
import { useCurrency } from './context/CurrencyContext';
import CsvDropZone from './components/CsvDropZone';
import PortfolioView from './components/PortfolioView';
import './App.css';

function AppHeader() {
  const { theme, toggleTheme } = useTheme();
  const { displayCurrency, setDisplayCurrency, supportedCurrencies, ratesError } = useCurrency();

  return (
    <header className="app-header">
      <span className="app-header__title">Portfolio Tracker</span>

      <div className="app-header__controls">
        {ratesError && (
          <span className="app-header__rates-warning" title={ratesError}>
            ⚠ Approximate rates
          </span>
        )}

        <label className="app-header__currency-label" htmlFor="currency-select">
          Currency
        </label>
        <select
          id="currency-select"
          className="app-header__currency-select"
          value={displayCurrency}
          onChange={(e) => setDisplayCurrency(e.target.value)}
        >
          {supportedCurrencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <button
          className="app-header__theme-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          type="button"
        >
          {theme === 'dark' ? '☀' : '🌙'}
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [rows, setRows] = useState(null);

  return (
    <div className="app">
      <AppHeader />
      <main className="app-main">
        <CsvDropZone onLoad={setRows} />
        {rows !== null && <PortfolioView rows={rows} />}
      </main>
    </div>
  );
}
