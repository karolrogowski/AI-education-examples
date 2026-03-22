import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  aggregateByBroker,
  withCurrentPrices,
  computePortfolioSummary,
  daysHeld,
} from './portfolioAggregator'

// ─── helpers ────────────────────────────────────────────────────────────────

function tx(overrides) {
  return {
    broker: 'TestBroker',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock',
    currency: 'USD',
    action: 'buy',
    quantity: '1',
    price: '100',
    date: '2023-01-01 09:00:00',
    comment: '',
    ...overrides,
  }
}

// ─── aggregateByBroker ───────────────────────────────────────────────────────

describe('aggregateByBroker', () => {
  it('creates one broker group per broker', () => {
    const rows = [tx({ broker: 'XTB' }), tx({ broker: 'Coinbase' })]
    const groups = aggregateByBroker(rows)
    expect(groups.map(g => g.broker)).toEqual(['XTB', 'Coinbase'])
  })

  it('calculates units as buys minus sells', () => {
    const rows = [
      tx({ action: 'buy',  quantity: '10', price: '100' }),
      tx({ action: 'buy',  quantity: '5',  price: '120' }),
      tx({ action: 'sell', quantity: '4',  price: '130' }),
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.units).toBe(11) // 10 + 5 - 4
  })

  it('sums buy amount correctly', () => {
    const rows = [
      tx({ action: 'buy', quantity: '10', price: '100' }), // 1000
      tx({ action: 'buy', quantity: '5',  price: '120' }), // 600
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.buyAmount).toBeCloseTo(1600)
  })

  it('sums sell amount correctly', () => {
    const rows = [
      tx({ action: 'buy',  quantity: '10', price: '100' }),
      tx({ action: 'sell', quantity: '3',  price: '150' }), // 450
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.sellAmount).toBeCloseTo(450)
  })

  it('picks min and max buy price', () => {
    const rows = [
      tx({ action: 'buy', price: '100' }),
      tx({ action: 'buy', price: '80'  }),
      tx({ action: 'buy', price: '120' }),
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.minBuyPrice).toBe(80)
    expect(pos.maxBuyPrice).toBe(120)
  })

  it('sell transactions do not affect min/max buy price', () => {
    const rows = [
      tx({ action: 'buy',  price: '100' }),
      tx({ action: 'sell', price: '200' }), // should not count
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.minBuyPrice).toBe(100)
    expect(pos.maxBuyPrice).toBe(100)
  })

  it('tracks earliest buy date as firstBuyDate', () => {
    const rows = [
      tx({ date: '2023-06-01 10:00:00' }),
      tx({ date: '2023-01-01 10:00:00' }), // earlier
      tx({ date: '2023-12-01 10:00:00' }),
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.firstBuyDate).toBe('2023-01-01 10:00:00')
  })

  it('tracks latest sell date as lastSellDate', () => {
    const rows = [
      tx({ action: 'buy',  date: '2023-01-01 10:00:00' }),
      tx({ action: 'sell', date: '2023-06-01 10:00:00' }),
      tx({ action: 'sell', date: '2023-12-01 10:00:00' }), // latest
    ]
    const pos = aggregateByBroker(rows)[0].positions[0]
    expect(pos.lastSellDate).toBe('2023-12-01 10:00:00')
  })

  it('groups positions by ticker within the same broker', () => {
    const rows = [
      tx({ ticker: 'AAPL' }),
      tx({ ticker: 'MSFT' }),
      tx({ ticker: 'AAPL' }),
    ]
    const group = aggregateByBroker(rows)[0]
    expect(group.positions).toHaveLength(2)
    expect(group.positions.map(p => p.ticker).sort()).toEqual(['AAPL', 'MSFT'])
  })

  it('same ticker in different brokers creates separate positions', () => {
    const rows = [
      tx({ broker: 'XTB',      ticker: 'AAPL', quantity: '5' }),
      tx({ broker: 'Coinbase', ticker: 'AAPL', quantity: '3' }),
    ]
    const groups = aggregateByBroker(rows)
    const xtbPos      = groups.find(g => g.broker === 'XTB').positions[0]
    const coinbasePos = groups.find(g => g.broker === 'Coinbase').positions[0]
    expect(xtbPos.units).toBe(5)
    expect(coinbasePos.units).toBe(3)
  })
})

// ─── withCurrentPrices ───────────────────────────────────────────────────────

describe('withCurrentPrices', () => {
  it('computes currentValue as units × currentPrice', () => {
    const rows = [tx({ action: 'buy', quantity: '10', price: '100' })]
    const groups = withCurrentPrices(aggregateByBroker(rows), { AAPL: 150 })
    expect(groups[0].positions[0].currentValue).toBeCloseTo(1500) // 10 × 150
  })

  it('gain: currentValue + sellAmount − buyAmount', () => {
    // Buy 10 @ 100 = 1000, sell 3 @ 130 = 390, hold 7, current price 150
    // currentValue = 7 × 150 = 1050
    // gainLoss = 1050 + 390 − 1000 = +440
    const rows = [
      tx({ action: 'buy',  quantity: '10', price: '100' }),
      tx({ action: 'sell', quantity: '3',  price: '130' }),
    ]
    const groups = withCurrentPrices(aggregateByBroker(rows), { AAPL: 150 })
    expect(groups[0].positions[0].totalGainLoss).toBeCloseTo(440)
  })

  it('loss: reports negative totalGainLoss', () => {
    // Buy 10 @ 100 = 1000, current price 80 → currentValue 800 → loss 200
    const rows = [tx({ action: 'buy', quantity: '10', price: '100' })]
    const groups = withCurrentPrices(aggregateByBroker(rows), { AAPL: 80 })
    expect(groups[0].positions[0].totalGainLoss).toBeCloseTo(-200)
  })

  it('rateOfReturn = totalGainLoss / buyAmount × 100', () => {
    // Buy 10 @ 100 = 1000, price rises to 120 → gain 200 → 20%
    const rows = [tx({ action: 'buy', quantity: '10', price: '100' })]
    const groups = withCurrentPrices(aggregateByBroker(rows), { AAPL: 120 })
    expect(groups[0].positions[0].rateOfReturn).toBeCloseTo(20)
  })

  it('portfolioRatio sums to 100% across all positions', () => {
    const rows = [
      tx({ ticker: 'AAPL', quantity: '10', price: '100' }),
      tx({ ticker: 'MSFT', quantity: '5',  price: '200' }),
    ]
    const groups = withCurrentPrices(aggregateByBroker(rows), { AAPL: 100, MSFT: 200 })
    const positions = groups[0].positions
    const total = positions.reduce((s, p) => s + p.portfolioRatio, 0)
    expect(total).toBeCloseTo(100)
  })

  it('position with no price in the map gets currentPrice null', () => {
    const rows = [tx()]
    const groups = withCurrentPrices(aggregateByBroker(rows), {})
    expect(groups[0].positions[0].currentPrice).toBeNull()
    expect(groups[0].positions[0].totalGainLoss).toBeUndefined()
  })
})

// ─── computePortfolioSummary ─────────────────────────────────────────────────

describe('computePortfolioSummary', () => {
  function buildGroups(positionOverrides, prices, previousPrices = {}) {
    const rows = positionOverrides.map(o => tx(o))
    const groups = withCurrentPrices(aggregateByBroker(rows), prices)
    return { groups, previousPrices }
  }

  it('sums currentValue across all positions', () => {
    // AAPL: 10 × 150 = 1500; MSFT: 5 × 200 = 1000 → total 2500
    const { groups, previousPrices } = buildGroups(
      [
        { ticker: 'AAPL', quantity: '10', price: '100' },
        { ticker: 'MSFT', quantity: '5',  price: '150' },
      ],
      { AAPL: 150, MSFT: 200 }
    )
    const s = computePortfolioSummary(groups, previousPrices)
    expect(s.currentValue).toBeCloseTo(2500)
  })

  it('inputValue = sum of all buyAmount regardless of prices', () => {
    const { groups, previousPrices } = buildGroups(
      [
        { ticker: 'AAPL', quantity: '10', price: '100' }, // 1000
        { ticker: 'MSFT', quantity: '5',  price: '200' }, // 1000
      ],
      {} // no current prices
    )
    const s = computePortfolioSummary(groups, previousPrices)
    expect(s.inputValue).toBeCloseTo(2000)
  })

  it('totalGainLoss = currentValue + sellProceeds − inputValue', () => {
    // Buy 10 @ 100 = 1000; sell 3 @ 130 = 390; current 7 @ 150 = 1050
    // gainLoss = 1050 + 390 − 1000 = 440
    const { groups, previousPrices } = buildGroups(
      [
        { action: 'buy',  quantity: '10', price: '100', date: '2023-01-01 09:00:00' },
        { action: 'sell', quantity: '3',  price: '130', date: '2023-06-01 09:00:00' },
      ],
      { AAPL: 150 }
    )
    const s = computePortfolioSummary(groups, previousPrices)
    expect(s.totalGainLoss).toBeCloseTo(440)
  })

  it('totalReturnPercent = totalGainLoss / inputValue × 100', () => {
    // Buy 10 @ 100 = 1000, current price 110 → gain 100 → 10%
    const { groups, previousPrices } = buildGroups(
      [{ quantity: '10', price: '100' }],
      { AAPL: 110 }
    )
    const s = computePortfolioSummary(groups, previousPrices)
    expect(s.totalReturnPercent).toBeCloseTo(10)
  })

  it('daily change uses only positions that have both current and previous price', () => {
    // AAPL: 10 units, prev 100 → current 110  (+100 for the day)
    // MSFT: 5 units, no previous price → excluded from daily calc
    const rows = [
      tx({ ticker: 'AAPL', quantity: '10', price: '100' }),
      tx({ ticker: 'MSFT', quantity: '5',  price: '200' }),
    ]
    const groups = withCurrentPrices(aggregateByBroker(rows), { AAPL: 110, MSFT: 220 })
    const s = computePortfolioSummary(groups, { AAPL: 100 /* MSFT omitted */ })
    // dailyCurrentValue  = 10 × 110 = 1100 (AAPL only)
    // dailyPreviousValue = 10 × 100 = 1000
    expect(s.dailyChange).toBeCloseTo(100)
    expect(s.dailyChangePercent).toBeCloseTo(10)
  })

  it('dailyChange is null when no previous prices are available', () => {
    const { groups } = buildGroups([{ quantity: '10', price: '100' }], { AAPL: 110 })
    const s = computePortfolioSummary(groups, {})
    expect(s.dailyChange).toBeNull()
    expect(s.dailyChangePercent).toBeNull()
  })

  it('yearlyReturnPercent is a finite number given valid data', () => {
    const { groups, previousPrices } = buildGroups(
      [{ quantity: '10', price: '100', date: '2020-01-01 09:00:00' }],
      { AAPL: 200 }
    )
    const s = computePortfolioSummary(groups, previousPrices)
    expect(s.yearlyReturnPercent).not.toBeNull()
    expect(Number.isFinite(s.yearlyReturnPercent)).toBe(true)
    expect(s.yearlyReturnPercent).toBeGreaterThan(0) // price doubled
  })
})

// ─── daysHeld ────────────────────────────────────────────────────────────────

describe('daysHeld', () => {
  // Use fake timers so new Date() is deterministic across machines and timezones.
  // Dates without a time component are parsed as UTC midnight by JS, so using
  // UTC midnight for the fake "now" gives an exact integer difference.
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns null when firstBuyDate is missing', () => {
    expect(daysHeld({ firstBuyDate: null, units: 5, lastSellDate: null })).toBeNull()
  })

  it('for an open position uses today as the end date', () => {
    vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'))
    const result = daysHeld({
      firstBuyDate: '2024-01-01', // UTC midnight → deterministic
      units: 10,
      lastSellDate: null,
    })
    // 2024 is a leap year: Jan(31) + Feb(29) + Mar(31) + Apr(30) + May(31) = 152
    expect(result).toBe(152)
  })

  it('for a fully sold position uses lastSellDate as end date', () => {
    const result = daysHeld({
      firstBuyDate: '2023-01-01', // UTC midnight
      lastSellDate: '2023-04-01', // UTC midnight
      units: 0,
    })
    // 2023 non-leap: Jan(31) + Feb(28) + Mar(31) = 90 days to Apr 1
    expect(result).toBe(90)
  })

  it('still uses today when units > 0 even if lastSellDate is set (partial sell)', () => {
    vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'))
    const result = daysHeld({
      firstBuyDate: '2024-01-01',
      lastSellDate: '2024-03-01', // ignored because units > 0
      units: 5,
    })
    expect(result).toBe(152) // 2024-01-01 → 2024-06-01
  })
})
