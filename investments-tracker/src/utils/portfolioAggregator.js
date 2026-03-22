export function aggregateByBroker(transactions) {
  const map = new Map() // broker -> Map(ticker -> raw accumulator)

  for (const tx of transactions) {
    const qty = parseFloat(tx.quantity)
    const price = parseFloat(tx.price)

    if (!map.has(tx.broker)) map.set(tx.broker, new Map())
    const tickers = map.get(tx.broker)

    if (!tickers.has(tx.ticker)) {
      tickers.set(tx.ticker, {
        ticker: tx.ticker,
        name: tx.name,
        type: tx.type,
        currency: tx.currency,
        transactions: [],
        buyUnits: 0,
        sellUnits: 0,
        buyAmount: 0,
        sellAmount: 0,
        buyPrices: [],
        firstBuyDate: null,
        lastSellDate: null,
      })
    }

    const pos = tickers.get(tx.ticker)
    pos.transactions.push(tx)

    if (tx.action === 'buy') {
      pos.buyUnits += qty
      pos.buyAmount += qty * price
      pos.buyPrices.push(price)
      const d = new Date(tx.date)
      if (!pos.firstBuyDate || d < new Date(pos.firstBuyDate)) pos.firstBuyDate = tx.date
    } else if (tx.action === 'sell') {
      pos.sellUnits += qty
      pos.sellAmount += qty * price
      const d = new Date(tx.date)
      if (!pos.lastSellDate || d > new Date(pos.lastSellDate)) pos.lastSellDate = tx.date
    }
  }

  return Array.from(map.entries())
    .map(([broker, tickers]) => ({
      broker,
      positions: Array.from(tickers.values()).map(pos => ({
        ...pos,
        units: pos.buyUnits - pos.sellUnits,
        minBuyPrice: pos.buyPrices.length ? Math.min(...pos.buyPrices) : 0,
        maxBuyPrice: pos.buyPrices.length ? Math.max(...pos.buyPrices) : 0,
      })).sort((a, b) => {
        const edoA = a.ticker.match(/^EDO(\d{2})(\d{2})$/)
        const edoB = b.ticker.match(/^EDO(\d{2})(\d{2})$/)
        if (edoA && edoB) {
          const yearDiff = parseInt(edoA[2]) - parseInt(edoB[2])
          if (yearDiff !== 0) return yearDiff
          return parseInt(edoA[1]) - parseInt(edoB[1])
        }
        if (edoA) return 1  // EDOs after non-EDOs
        if (edoB) return -1
        return a.ticker.localeCompare(b.ticker)
      }),
    }))
    .sort((a, b) => a.broker.localeCompare(b.broker))
}

export function withCurrentPrices(brokerGroups, prices) {
  let totalValue = 0
  for (const { positions } of brokerGroups) {
    for (const pos of positions) {
      const p = prices[pos.ticker]
      if (p != null && pos.units > 0) totalValue += pos.units * p
    }
  }

  return brokerGroups.map(group => ({
    ...group,
    positions: group.positions.map(pos => {
      const currentPrice = prices[pos.ticker] ?? null
      if (currentPrice == null) return { ...pos, currentPrice: null }

      const currentValue = pos.units * currentPrice
      // Total gain = (current value + sell proceeds) - total amount spent on buys
      const totalGainLoss = currentValue + pos.sellAmount - pos.buyAmount
      const rateOfReturn = pos.buyAmount > 0 ? (totalGainLoss / pos.buyAmount) * 100 : null
      const portfolioRatio = totalValue > 0 ? (currentValue / totalValue) * 100 : null

      return { ...pos, currentPrice, currentValue, totalGainLoss, rateOfReturn, portfolioRatio }
    }),
  }))
}

export function computePortfolioSummary(brokerGroups, previousPrices, rates = {}) {
  let currentValue = 0
  let inputValue = 0
  let totalSellProceeds = 0
  let earliestDate = null
  // For daily change: only include positions that have BOTH current and previous price
  let dailyCurrentValue = 0
  let dailyPreviousValue = 0

  for (const { positions } of brokerGroups) {
    for (const pos of positions) {
      // Normalise to USD so multi-currency amounts can be summed consistently
      const rate = rates[pos.currency] ?? 1
      inputValue += pos.buyAmount / rate
      totalSellProceeds += pos.sellAmount / rate

      if (pos.currentValue != null) currentValue += pos.currentValue

      const prev = previousPrices[pos.ticker]
      if (prev != null && pos.currentPrice != null) {
        dailyCurrentValue  += pos.units * pos.currentPrice
        dailyPreviousValue += pos.units * prev
      }

      if (pos.firstBuyDate) {
        const d = new Date(pos.firstBuyDate)
        if (!earliestDate || d < earliestDate) earliestDate = d
      }
    }
  }

  const totalGainLoss = currentValue + totalSellProceeds - inputValue
  const totalReturnPercent = inputValue > 0 ? (totalGainLoss / inputValue) * 100 : null

  const hasDailyData = dailyPreviousValue > 0
  const dailyChange = hasDailyData ? dailyCurrentValue - dailyPreviousValue : null
  const dailyChangePercent = hasDailyData ? (dailyChange / dailyPreviousValue) * 100 : null

  let yearlyReturnPercent = null
  if (earliestDate && inputValue > 0 && currentValue > 0) {
    const years = (Date.now() - earliestDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (years >= 0.01) {
      const endValue = currentValue + totalSellProceeds
      yearlyReturnPercent = (Math.pow(endValue / inputValue, 1 / years) - 1) * 100
    }
  }

  return {
    currentValue,
    inputValue,
    dailyChange,
    dailyChangePercent,
    totalGainLoss,
    totalReturnPercent,
    yearlyReturnPercent,
  }
}

export function daysHeld(pos) {
  if (!pos.firstBuyDate) return null
  const end = pos.units <= 0 && pos.lastSellDate ? new Date(pos.lastSellDate) : new Date()
  return Math.floor((end - new Date(pos.firstBuyDate)) / 86_400_000)
}
