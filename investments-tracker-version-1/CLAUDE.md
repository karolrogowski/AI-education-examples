# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**investments-tracker** — A client-side React app for tracking a personal investment portfolio via CSV import. No backend, no database, no paid APIs.

The app lives in the `investments-tracker/` subdirectory. All commands below should be run from there.

## Commands

```bash
npm run dev          # Start Vite dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build
npm test             # Run tests once (vitest)
npm run test:watch   # Run tests in watch mode
```

To run a single test file:
```bash
npx vitest run src/utils/portfolioAggregator.test.js
```

## Architecture

### Data Flow

1. **CSV import** (`CsvDropZone`) → validates required columns, auto-loads `/example-data/portfolio.csv` on startup
2. **Aggregation** (`portfolioAggregator.js`) → groups transactions by broker → ticker, calculates cost basis, unrealized gains, rate of return
3. **Price enrichment** (`priceService.js`) → parallel fetches to Yahoo Finance (proxied via Vite) and CoinGecko; 8s timeout per ticker
4. **Currency normalization** (`CurrencyContext`) → forex rates from Frankfurter.app; all values stored in USD, converted at display time
5. **Rendering** → `PortfolioView` → `PortfolioSummary` + `ChartsSection` + per-ticker tables + `HistoryModal`

### Key files

| File | Responsibility |
|---|---|
| `src/utils/portfolioAggregator.js` | Core business logic — aggregation, gain/loss calculations |
| `src/utils/chartDataUtils.js` | Transforms aggregated data into Recharts-ready format |
| `src/services/priceService.js` | All external API calls (Yahoo Finance, CoinGecko, caching) |
| `src/context/CurrencyContext.jsx` | Global currency state + Frankfurter.app rates |
| `src/components/HistoryModal.jsx` | Transaction history + buy price vs OHLC validation |

### External APIs

- **Yahoo Finance** — stocks, ETFs, precious metals; proxied through `/api/yahoo` in `vite.config.js` to avoid CORS
- **CoinGecko** — crypto prices (free tier); ticker → coin ID resolved once and cached in-memory
- **Frankfurter.app** — forex rates for multi-currency conversion

### CSV format

Semicolon-delimited with columns: `date;ticker;name;type;action;quantity;price;currency;broker;comment`

Supported types: `stock`, `etf`, `bond`, `crypto`, `cash`, `precious_metal`, `other`
Type aliases normalized on import: `stocks→etf`, `bonds→bond`, `metal/metals→precious_metal`

### Currency handling

All internal calculations use USD. The `fmtCurrency()` helper converts at display time:
`displayValue = value / rates[sourceCurrency] * rates[targetCurrency]`

### Theme

CSS variables defined in `src/index.css` under `:root` (dark) and `[data-theme="light"]`. Theme preference persisted to `localStorage`.