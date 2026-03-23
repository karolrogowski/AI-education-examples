export const TYPE_COLORS = {
  stock:          '#4f8ef7',
  etf:            '#9b59f5',
  bond:           '#56b4b4',
  crypto:         '#f5a623',
  cash:           '#7ed321',
  precious_metal: '#d4af37',
  other:          '#9b9b9b',
}

export const TYPE_LABELS = {
  stock:          'Stocks',
  etf:            'ETFs',
  bond:           'Bonds',
  crypto:         'Crypto',
  cash:           'Cash',
  precious_metal: 'Precious Metals',
  other:          'Other',
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function unitsAtDate(transactions, dateStr) {
  let units = 0
  for (const tx of transactions) {
    if (tx.date.slice(0, 10) <= dateStr) {
      const qty = parseFloat(tx.quantity)
      units += tx.action === 'buy' ? qty : -qty
    }
  }
  return Math.max(0, units)
}

function investedAtDate(transactions, dateStr, rates = {}) {
  let invested = 0
  for (const tx of transactions) {
    if (tx.date.slice(0, 10) <= dateStr && tx.action === 'buy') {
      invested += parseFloat(tx.quantity) * parseFloat(tx.price) / (rates[tx.currency] ?? 1)
    }
  }
  return invested
}

// Returns end-of-month date strings from the earliest transaction to today.
// For the current (incomplete) month the date is capped at today so that
// findNearestClose can always resolve it from recent historical data.
function getMonthEndDates(transactions) {
  if (!transactions.length) return []
  const first = transactions
    .map(tx => tx.date.slice(0, 7))
    .reduce((a, b) => (a < b ? a : b))
  const todayUTC   = new Date().toISOString().slice(0, 10)
  const todayMonth = todayUTC.slice(0, 7)
  const dates = []
  let [y, m] = first.split('-').map(Number)
  const [ty, tm] = todayMonth.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    const endOfMonth = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    // If end-of-month is in the future, use today instead
    dates.push(endOfMonth > todayUTC ? todayUTC : endOfMonth)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return dates
}

// Look back up to 7 days to find a trading-day close price
function findNearestClose(priceMap, targetDate) {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(targetDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    if (priceMap[key]?.close != null) return priceMap[key].close
  }
  return null
}

// ─── chart data functions ─────────────────────────────────────────────────────

// 1. Pie chart — current allocation by type
export function computeAllocationByType(groups) {
  const totals = {}
  for (const { positions } of groups) {
    for (const pos of positions) {
      if (pos.currentValue == null || pos.currentValue <= 0) continue
      totals[pos.type] = (totals[pos.type] ?? 0) + pos.currentValue
    }
  }
  return Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([type, value]) => ({ type, value, name: TYPE_LABELS[type] ?? type }))
}

// 2. Stacked area — allocation ratio by type over time (percentages, sums to 100)
// currentPrices: { ticker: priceUSD } — live prices in USD, used as fallback for the latest point
// priceCurrencies: { ticker: string } — native currency of each Yahoo-fetched ticker
export function computeAllocationOverTime(positions, historicalPrices, currentPrices = {}, priceCurrencies = {}, rates = {}) {
  if (!positions.length) return []
  const allTx   = positions.flatMap(p => p.transactions)
  const dates   = getMonthEndDates(allTx)
  const allTypes = [...new Set(positions.map(p => p.type))]
  // Cache the last successfully resolved USD price per ticker so data gaps
  // (e.g. missing Yahoo closes for a specific week) don't drop the position
  // entirely and cause phantom allocation dips.
  const lastKnownPriceUSD = {}

  return dates.flatMap(date => {
    const typeValues = {}
    let total = 0
    for (const pos of positions) {
      const units = unitsAtDate(pos.transactions, date)
      if (units <= 0) continue
      const priceMap = historicalPrices[pos.ticker]
      const historicalClose = priceMap ? findNearestClose(priceMap, date) : null
      let priceUSD
      if (historicalClose != null) {
        // Historical prices are in the exchange's native currency — convert to USD
        const currency = priceCurrencies[pos.ticker] ?? 'USD'
        const candidate = historicalClose / (rates[currency] ?? 1)
        // Yahoo Finance sometimes mislabels GBP prices as GBp around corporate actions
        // (e.g. share consolidations), causing a 100× undervaluation. If the candidate
        // is implausibly low vs the live price, fall back to the last known good value.
        const livePrice = currentPrices[pos.ticker]
        if (livePrice != null && candidate < livePrice / 50) {
          priceUSD = lastKnownPriceUSD[pos.ticker] ?? livePrice
        } else {
          priceUSD = candidate
          lastKnownPriceUSD[pos.ticker] = priceUSD
        }
      } else {
        // Fallback priority: live price (already USD) → last known historical price
        priceUSD = currentPrices[pos.ticker] ?? lastKnownPriceUSD[pos.ticker] ?? null
      }
      if (priceUSD == null) continue
      const value = units * priceUSD
      typeValues[pos.type] = (typeValues[pos.type] ?? 0) + value
      total += value
    }
    if (total === 0) return []
    const point = { date }
    for (const type of allTypes) {
      point[type] = typeValues[type] != null ? (typeValues[type] / total) * 100 : 0
    }
    return [point]
  })
}

// 3. Line chart — gain/loss vs total invested over time (all values in USD)
// currentPrices: { ticker: priceUSD } — live prices in USD, used as fallback for the latest point
// priceCurrencies: { ticker: string } — native currency of each Yahoo-fetched ticker
export function computeGainLossOverTime(positions, historicalPrices, currentPrices = {}, rates = {}, priceCurrencies = {}) {
  if (!positions.length) return []
  const allTx = positions.flatMap(p => p.transactions)
  const dates = getMonthEndDates(allTx)
  const lastKnownPriceUSD = {}

  return dates.map(date => {
    let invested = 0
    let portfolioValue = 0
    let hasAnyPrice = false
    for (const pos of positions) {
      // investedAtDate already normalises to USD via rates[tx.currency]
      invested += investedAtDate(pos.transactions, date, rates)
      const units = unitsAtDate(pos.transactions, date)
      if (units <= 0) continue
      const priceMap = historicalPrices[pos.ticker]
      const historicalClose = priceMap ? findNearestClose(priceMap, date) : null
      let priceUSD
      if (historicalClose != null) {
        const currency = priceCurrencies[pos.ticker] ?? 'USD'
        priceUSD = historicalClose / (rates[currency] ?? 1)
        lastKnownPriceUSD[pos.ticker] = priceUSD
      } else {
        priceUSD = currentPrices[pos.ticker] ?? lastKnownPriceUSD[pos.ticker] ?? null
      }
      if (priceUSD != null) {
        portfolioValue += units * priceUSD
        hasAnyPrice = true
      }
    }
    return {
      date,
      invested: invested > 0 ? invested : null,
      value:    hasAnyPrice ? portfolioValue : null,
    }
  }).filter(p => p.invested != null || p.value != null)
}

// 4. Bar chart — dividend income per year (in USD), with per-asset per-month breakdown
// priceCurrencies: { ticker: string } — native currency of each Yahoo-fetched ticker
export function computeDividendsOverTime(dividendEvents, positions, priceCurrencies = {}, rates = {}) {
  // Combine transactions across all broker positions for the same ticker so that
  // holdings at any dividend date reflect the full portfolio, not just one account.
  const txByTicker = {}
  for (const pos of positions) {
    if (!txByTicker[pos.ticker]) txByTicker[pos.ticker] = []
    txByTicker[pos.ticker].push(...pos.transactions)
  }

  const byYear = {}
  for (const [ticker, divs] of Object.entries(dividendEvents)) {
    const allTx = txByTicker[ticker]
    if (!allTx) continue
    const currency = priceCurrencies[ticker] ?? 'USD'
    for (const { date, amount } of divs) {
      const sharesHeld = unitsAtDate(allTx, date)
      if (sharesHeld <= 0) continue
      const year = date.slice(0, 4)
      // Normalize dividend amount to USD (Yahoo returns it in the exchange's native currency)
      const incomeUSD = sharesHeld * amount / (rates[currency] ?? 1)
      if (!byYear[year]) byYear[year] = { income: 0, items: [] }
      byYear[year].income += incomeUSD
      byYear[year].items.push({ ticker, date, income: incomeUSD })
    }
  }
  return Object.entries(byYear)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, { income, items }]) => ({
      year,
      income,
      items: items.sort((a, b) => a.date.localeCompare(b.date)),
    }))
}
