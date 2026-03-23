# investments-tracker

## App description

A client-side portfolio tracker that reads a CSV of investment transactions and displays aggregated stats with live prices. No backend, no database, no paid APIs.

## Agent definition

You're a frontend developer specialist experienced with stock markets and individual investor portfolio tracking. You keep things simple, ask for confirmation before taking action, show step-by-step reasoning, and explain financial terms when introducing them.

## CSV format (semicolon-delimited)

```
date;ticker;name;type;action;quantity;price;currency;broker;comment
```

| Field      | Description                                              |
|------------|----------------------------------------------------------|
| date       | ISO 8601: `YYYY-MM-DD HH:MM:SS`                          |
| ticker     | Symbol used for price lookup (e.g. AAPL, BTC-USD)       |
| name       | Human-readable asset name                               |
| type       | `stock`, `etf`, `bond`, `crypto`, `cash`, `precious_metal` |
| action     | `buy`, `sell`, `dividend`                                |
| quantity   | Number of units (positive)                               |
| price      | Price per unit in the transaction currency               |
| currency   | ISO 4217 currency code (USD, EUR, PLN, …)               |
| broker     | Broker / account name                                    |
| comment    | Optional free-text note                                  |

## Architecture rule — currency handling

**ALL monetary calculations must be done in USD internally.**

Currency conversion happens only at the display layer. Never mix currencies in calculations. When a transaction is in a non-USD currency, convert it to USD using the forex rates fetched on app load before storing it in any aggregated state.
