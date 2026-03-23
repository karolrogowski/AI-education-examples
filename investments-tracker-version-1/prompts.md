# Optimized Build Prompts — Investment Portfolio Tracker

These prompts are designed to rebuild the `investments-tracker` app faster than the original ~10-12 hours by front-loading the constraints that caused the most rework: multi-currency normalization, gain/loss sign correctness, API failure handling, and chart/table data consistency.

All prompts should be run using the **`portfolio-tracker-advisor`** agent defined in CLAUDE.md.

---

## Prompt 1 — Project scaffolding + CLAUDE.md + agent definition

```
Initialize a new Vite + React project called `investments-tracker` inside this repository.

Also create a CLAUDE.md file in the project root with:
1. A description of the app: a client-side portfolio tracker that reads a CSV of investment transactions and displays aggregated stats with live prices. No backend, no database, no paid APIs.
2. The agent definition to use for all future work:
   "You're a frontend developer specialist experienced with stock markets and individual investor portfolio tracking. You keep things simple, ask for confirmation before taking action, show step-by-step reasoning, and explain financial terms when introducing them."
3. The CSV format the app will consume (semicolon-delimited):
   date;ticker;name;type;action;quantity;price;currency;broker;comment
   - date: ISO 8601 (YYYY-MM-DD HH:MM:SS)
   - type values: stock, etf, bond, crypto, cash, precious_metal, other (aliases: stocks→etf, bonds→bond, metal/metals→precious_metal)
   - action values: buy, sell, dividend
4. A critical architecture rule:
   ALL monetary calculations must be done in USD internally. Currency conversion happens only at the display layer. Never mix currencies in calculations.

Then create a `public/example-data/portfolio.csv` with 15 rows covering: stocks (USD), ETFs (EUR), crypto (USD), bonds (PLN), precious metals — include multiple buy transactions for the same ticker, one sell, and two dividend rows.

Show me how to run the app.
```

---

## Prompt 2 — Core data model and portfolio aggregation logic

```
Before building any UI, implement the core aggregation logic in `src/utils/portfolioAggregator.js`.

The function takes raw CSV rows and returns data grouped by broker → ticker with these per-position fields:
- ticker, name, type, broker
- units: buyUnits - sellUnits
- minBuyPrice, maxBuyPrice (in original transaction currency)
- firstBuyDate, lastSellDate
- buyAmount, sellAmount (in original transaction currency — sum of quantity × price)
- costBasis: (buyAmount / buyUnits) × units — in original currency
- dividends: array of { date, amount, currency }

Important constraints to implement correctly from the start:
1. If units reach 0 (fully sold position), still include it — mark it as closed.
2. Gain/loss formula: unrealizedGain = currentValue + sellAmount - buyAmount
   - This means: positive = you made money, negative = you lost money.
   - Do NOT invert this sign anywhere.
3. Return rate: (unrealizedGain / buyAmount) × 100

Write unit tests in `src/utils/portfolioAggregator.test.js` with at least these cases:
- single buy
- multiple buys of same ticker
- buy + partial sell (gain scenario — verify sign is positive)
- buy + partial sell (loss scenario — verify sign is negative)
- dividend rows are collected but don't affect units or cost basis
```

---

## Prompt 3 — Currency context with forex rates

```
Create `src/context/CurrencyContext.jsx`.

Requirements:
1. On mount, fetch forex rates from `https://api.frankfurter.app/latest?base=USD` — store rates as a map { USD: 1, EUR: x, PLN: y, ... }.
2. Expose: displayCurrency (default: PLN), setDisplayCurrency, rates.
3. Provide a helper function: convertToDisplay(amountUSD) → amountUSD × rates[displayCurrency]
4. Persist displayCurrency choice to localStorage.
5. Add a currency dropdown to the app header (EUR, USD, PLN) wired to this context.

Architecture rule: all values passed to this context for conversion must already be in USD. The context never knows or cares about the source currency — that normalization happens in the price service (next step).
```

---

## Prompt 4 — Price service with multi-currency normalization and error handling

```
Create `src/services/priceService.js`.

This service fetches current and historical prices and normalizes everything to USD.

APIs to use (all free, no auth):
- Yahoo Finance for stocks, ETFs, precious metals:
  proxy through Vite: `/api/yahoo` → `https://query1.finance.yahoo.com`
  current price endpoint: `/api/yahoo/v8/finance/chart/{ticker}?interval=1d&range=1d`
  historical endpoint: `/api/yahoo/v8/finance/chart/{ticker}?interval=1mo&range=10y`
  Yahoo returns prices in the instrument's native currency — the response includes `meta.currency`. Use the forex rates from CurrencyContext to convert to USD: priceUSD = price / rates[instrumentCurrency]
- CoinGecko for crypto (free tier, no key):
  resolve ticker → coin ID once, cache in-memory Map to avoid repeat calls
  current price: `/api/coingecko/simple/price?ids={id}&vs_currencies=usd`
  historical: `/api/coingecko/coins/{id}/market_chart?vs_currency=usd&days=365`

Configure the Vite proxy for both in `vite.config.js`.

Error handling rules (non-negotiable — do not skip these):
- Each ticker fetch has an 8-second timeout using AbortController.
- If a ticker fails (network error, 404, timeout), set its currentPrice to null — never throw, never block other tickers.
- All tickers are fetched in parallel with Promise.allSettled — one failure must never stop the rest.
- In the UI, null price displays as "—" (em dash), not 0, not undefined, not NaN.
- After all fetches complete, if any ticker still has null price, show a non-blocking warning badge (not an alert).
- Show a loading progress indicator while fetching. If fetching takes more than 15 seconds total, show an alert: "Some price data could not be loaded. Displayed values may be incomplete."
```

---

## Prompt 5 — Polish treasury bond value estimator

```
Create `src/utils/bondValueEstimator.js`.

Polish treasury bonds (tickers starting with EDO, COI, ROS, DOS, TOS) have no Yahoo Finance data. Their value must be estimated manually.

Rules:
- These bonds have face value of 100 PLN per unit.
- The ticker encodes the maturity date, e.g. EDO1030 matures in October 2030.
- Estimated current value = face value × units × (1 + annualRate × yearsHeld)
  where annualRate = 0.065 (6.5% default, can be overridden per bond series)
  and yearsHeld = days since first buy date / 365
- Return the value in PLN — the price service will convert to USD using forex rates.

In the price service, before fetching from Yahoo, check if the ticker matches the Polish bond pattern. If yes, use this estimator instead of making an API call.

This is important for correct portfolio totals — if bonds are excluded from current value, the total will be wrong.
```

---

## Prompt 6 — Portfolio view: broker sections with aggregated tables

```
Build `src/components/PortfolioView.jsx`.

On mount:
1. Load aggregated portfolio data from portfolioAggregator.
2. Fetch current prices for all tickers using priceService (parallel, with loading state).
3. Enrich each position with: currentPrice (USD), currentValue (USD), unrealizedGain (USD), returnRate (%).

Render one collapsible section per broker. Each section header shows (collapsed by default):
  Broker name | Invested | Current Value | Return % | Portfolio %

The header values must use the same enriched data as the table rows below — never recalculate separately.

Inside each broker section, render a table with columns:
  Asset | Units | Min Buy | Max Buy | Days Held | Invested | Current Value | Return % | Gain/Loss | Portfolio % | History

Rules:
- Return % and Gain/Loss: green if positive (gain), red if negative (loss). Use a single source of truth for the sign — if gain/loss is positive, both must be green.
- Days Held: on hover show tooltip "X years, Y months, Z days".
- Portfolio % is this position's currentValue / total portfolio currentValue.
- All monetary values displayed using displayCurrency from CurrencyContext — convert from USD at render time only.
- If currentPrice is null, show "—" for currentValue, returnRate, gain/loss. Do not show 0.
- History column: a link that opens HistoryModal for that position.
```

---

## Prompt 7 — Portfolio summary bar

```
Add `src/components/PortfolioSummary.jsx` above the broker sections.

Show these stats derived from the same enriched portfolio data used in PortfolioView:
- Total Current Value
- Total Invested (cost basis)
- Daily Change % and Daily Change value (from Yahoo's regularMarketChangePercent × position value)
- All-time Return %
- Average Yearly Return % (annualized: (1 + totalReturn)^(1/years) - 1)

Green if positive, red if negative.

Important: these numbers must match the sum of the per-broker section headers. Use a single shared calculation — do not calculate portfolio totals separately in multiple places.
```

---

## Prompt 8 — Charts section

```
Add `src/components/ChartsSection.jsx` below the broker sections. Use Recharts.

Build these 4 charts, stacked vertically (not side by side):

1. **Current Allocation pie chart** — by asset type (stock, etf, crypto, bond, precious_metal, cash, other). Show percentage labels on the pie slices without needing to hover.

2. **Allocation over time stacked area chart** — x-axis is months, y-axis is portfolio value, stacked by asset type. The rightmost data point must match the current allocation pie chart exactly (use the same currentValue data source).

3. **Gain/Loss vs Invested line chart** — two lines: total invested over time (cumulative buy amounts) and total portfolio value over time (using historical price data). The current values of both lines must match the portfolio summary totals exactly.

4. **Dividends bar chart** — dividends received per year, in displayCurrency. On hover over a year bar, show a breakdown by asset and month.

All charts must:
- Use displayCurrency for y-axis labels (update when currency changes).
- Source their data from the same enriched portfolio state as the tables — never fetch or calculate separately.
- Handle missing data points gracefully (skip, don't render 0).
```

---

## Prompt 9 — History modal with price validation

```
Build `src/components/HistoryModal.jsx`.

Shows all transactions for a single ticker. Columns: Date | Action | Units | Price | Currency | Comment

Price validation feature:
- For each buy/sell transaction, fetch the OHLC data for that day from Yahoo Finance (or CoinGecko for crypto).
- If the transaction price falls within the day's low–high range: show a green dot next to the price.
- If outside the range: show a red dot (possible data entry error).
- If OHLC data is unavailable: show a grey dot (no data).

This is a passive investor data-entry sanity check, not a trading signal — display a tooltip explaining this.
```

---

## Prompt 10 — CSV drop zone + auto-load

```
Build `src/components/CsvDropZone.jsx`.

Two ways to load data:
1. Auto-load `public/example-data/portfolio.csv` on app startup using fetch.
2. Drag-and-drop or file picker to upload a CSV — replaces currently loaded data.

Validation on load:
- Required columns: date, ticker, name, type, action, quantity, price, currency, broker
- Normalize type aliases: stocks→etf, bonds→bond, metal→precious_metal, metals→precious_metal
- If a required column is missing, show a clear error message naming the missing column.
- Invalid rows (unparseable date, non-numeric quantity/price): skip with a warning, don't crash.

Use PapaParse for CSV parsing with delimiter auto-detection (CSV may use comma or semicolon).
```

---

## Prompt 11 — Dark/light theme

```
Add a dark/light mode toggle to the app header.

Use CSS variables for all colors — define them in `src/index.css`:
- :root for dark mode (default)
- [data-theme="light"] for light mode

Variables to define: --text-primary, --text-secondary, --bg-primary, --bg-secondary, --bg-card, --border, --positive (green), --negative (red), --accent

Persist theme choice to localStorage. Toggle button should show a sun/moon icon.

Do not use any theme library — pure CSS variables only.
```

---

## Prompt 12 — Unit tests for all calculations

```
Write unit tests using Vitest for the following, covering both the happy path and edge cases:

1. `portfolioAggregator.js`:
   - Multi-currency positions: two buys in EUR, verify costBasis is in EUR
   - Fully sold position: units = 0, verify it's included as closed
   - Gain/loss sign: verify positive when currentValue > costBasis, negative when below

2. `chartDataUtils.js` (create this utility to extract chart data transformation from components):
   - Allocation pie data sums to 100%
   - The last point of allocation over time matches current allocation totals
   - Gain/loss chart current value matches portfolio summary total value

3. `formatCurrency.js`:
   - USD→PLN conversion
   - USD→EUR conversion
   - Null value returns "—"

Run with: `npm test`
```

---

## Prompt 13 — Final integration check + example data polish

```
Do a final pass to verify these known problem areas work correctly end-to-end:

1. Currency switching: change display currency from PLN to USD to EUR — verify ALL values update, including all 4 charts and all broker section headers. No chart should show a hardcoded "$" symbol.

2. Gain/loss consistency: find any position where current value > invested and verify: return % is green and positive, gain/loss is green and positive. Find a position where current value < invested and verify the opposite.

3. Chart/table consistency: the Total Current Value in PortfolioSummary must equal the sum of all broker Current Value headers, must equal the last data point in the Gain/Loss vs Invested chart.

4. Polish bonds: verify at least one EDO bond ticker appears with a non-null current value calculated by the bond estimator, converted to display currency.

5. API failure simulation: temporarily change one ticker to an invalid one (e.g. "INVALID999"), reload — verify the rest of the portfolio loads correctly, the invalid ticker shows "—", and no crash occurs.

Fix any discrepancies found.
```