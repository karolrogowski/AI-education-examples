import { describe, it, expect } from 'vitest';
import { aggregatePortfolio } from './portfolioAggregator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides) {
  return {
    date: '2023-01-01 09:00:00',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock',
    action: 'buy',
    quantity: '10',
    price: '150.00',
    currency: 'USD',
    broker: 'Schwab',
    comment: '',
    ...overrides,
  };
}

/**
 * Convenience: given a position and a hypothetical currentValue (in original
 * currency), compute unrealizedGain and returnRate exactly as PortfolioView
 * will — keeping the formula in one place so tests stay readable.
 */
function enrich(pos, currentValue) {
  const unrealizedGain = currentValue + pos.sellAmount - pos.buyAmount;
  const returnRate = pos.buyAmount !== 0 ? (unrealizedGain / pos.buyAmount) * 100 : 0;
  return { unrealizedGain, returnRate };
}

// ---------------------------------------------------------------------------
// Single buy
// ---------------------------------------------------------------------------

describe('single buy', () => {
  it('records correct units, amounts, prices and dates', () => {
    const rows = [makeRow({ quantity: '10', price: '150.00' })];
    const result = aggregatePortfolio(rows);
    const pos = result['Schwab']['AAPL'];

    expect(pos.buyUnits).toBe(10);
    expect(pos.sellUnits).toBe(0);
    expect(pos.units).toBe(10);
    expect(pos.buyAmount).toBe(1500);
    expect(pos.sellAmount).toBe(0);
    expect(pos.minBuyPrice).toBe(150);
    expect(pos.maxBuyPrice).toBe(150);
    expect(pos.costBasis).toBe(1500);
    expect(pos.isClosed).toBe(false);
    expect(pos.firstBuyDate).toEqual(new Date('2023-01-01 09:00:00'));
    expect(pos.lastSellDate).toBeNull();
    expect(pos.dividends).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple buys of same ticker
// ---------------------------------------------------------------------------

describe('multiple buys of same ticker', () => {
  it('accumulates units and amounts, tracks min/max price', () => {
    const rows = [
      makeRow({ quantity: '10', price: '100.00', date: '2022-03-01 09:00:00' }),
      makeRow({ quantity: '5',  price: '120.00', date: '2022-06-01 09:00:00' }),
      makeRow({ quantity: '5',  price: '80.00',  date: '2022-09-01 09:00:00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    expect(pos.buyUnits).toBe(20);
    expect(pos.units).toBe(20);
    expect(pos.buyAmount).toBe(10 * 100 + 5 * 120 + 5 * 80); // 1000+600+400 = 2000
    expect(pos.minBuyPrice).toBe(80);
    expect(pos.maxBuyPrice).toBe(120);
    expect(pos.firstBuyDate).toEqual(new Date('2022-03-01 09:00:00'));
    // costBasis = (buyAmount / buyUnits) * units = (2000/20)*20 = 2000
    expect(pos.costBasis).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Buy + partial sell — GAIN scenario
// ---------------------------------------------------------------------------

describe('buy + partial sell (gain)', () => {
  it('unrealizedGain is positive and returnRate is positive', () => {
    // Buy 10 @ 100 → buyAmount = 1000
    // Sell 3 @ 130 → sellAmount = 390 (sold above cost — locked in gain)
    // Remaining 7 units now worth 140 each → currentValue = 980
    const rows = [
      makeRow({ action: 'buy',  quantity: '10', price: '100.00' }),
      makeRow({ action: 'sell', quantity: '3',  price: '130.00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    expect(pos.buyUnits).toBe(10);
    expect(pos.sellUnits).toBe(3);
    expect(pos.units).toBe(7);
    expect(pos.buyAmount).toBe(1000);
    expect(pos.sellAmount).toBe(390);
    expect(pos.isClosed).toBe(false);
    // costBasis = (1000/10) * 7 = 700
    expect(pos.costBasis).toBe(700);

    const currentValue = 7 * 140; // 980
    const { unrealizedGain, returnRate } = enrich(pos, currentValue);

    // unrealizedGain = 980 + 390 - 1000 = 370  (positive → gain)
    expect(unrealizedGain).toBeGreaterThan(0);
    expect(returnRate).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Buy + partial sell — LOSS scenario
// ---------------------------------------------------------------------------

describe('buy + partial sell (loss)', () => {
  it('unrealizedGain is negative and returnRate is negative', () => {
    // Buy 10 @ 100 → buyAmount = 1000
    // Sell 3 @ 70  → sellAmount = 210 (sold below cost — locked in loss)
    // Remaining 7 units worth 60 each → currentValue = 420
    const rows = [
      makeRow({ action: 'buy',  quantity: '10', price: '100.00' }),
      makeRow({ action: 'sell', quantity: '3',  price: '70.00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    expect(pos.buyAmount).toBe(1000);
    expect(pos.sellAmount).toBe(210);
    expect(pos.units).toBe(7);

    const currentValue = 7 * 60; // 420
    const { unrealizedGain, returnRate } = enrich(pos, currentValue);

    // unrealizedGain = 420 + 210 - 1000 = -370  (negative → loss)
    expect(unrealizedGain).toBeLessThan(0);
    expect(returnRate).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

describe('dividends', () => {
  it('are collected but do not affect units or cost basis', () => {
    const rows = [
      makeRow({ action: 'buy',      quantity: '10', price: '100.00' }),
      makeRow({ action: 'dividend', quantity: '0',  price: '0.22',  date: '2023-03-01 00:00:00' }),
      makeRow({ action: 'dividend', quantity: '0',  price: '0.23',  date: '2023-06-01 00:00:00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    // Units and cost basis unchanged by dividends
    expect(pos.buyUnits).toBe(10);
    expect(pos.units).toBe(10);
    expect(pos.buyAmount).toBe(1000);
    expect(pos.costBasis).toBe(1000);
    expect(pos.isClosed).toBe(false);

    // Dividends recorded correctly
    expect(pos.dividends).toHaveLength(2);
    expect(pos.dividends[0].amount).toBe(0.22);
    expect(pos.dividends[0].currency).toBe('USD');
    expect(pos.dividends[1].amount).toBe(0.23);
  });

  it('dividend with quantity > 0 stores quantity × price as amount', () => {
    const rows = [
      makeRow({ action: 'buy',      quantity: '10', price: '100.00' }),
      makeRow({ action: 'dividend', quantity: '10', price: '0.50', date: '2023-06-01 00:00:00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    expect(pos.dividends[0].amount).toBe(5); // 10 × 0.50
    expect(pos.units).toBe(10); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Fully sold position — isClosed flag
// ---------------------------------------------------------------------------

describe('fully sold position', () => {
  it('is included in results with isClosed = true and units = 0', () => {
    const rows = [
      makeRow({ action: 'buy',  quantity: '5', price: '200.00' }),
      makeRow({ action: 'sell', quantity: '5', price: '250.00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    expect(pos.units).toBe(0);
    expect(pos.isClosed).toBe(true);
    expect(pos.buyAmount).toBe(1000);
    expect(pos.sellAmount).toBe(1250);
    expect(pos.costBasis).toBe(0); // no remaining units
    // Position is still present in the result
    expect(pos).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple brokers / multiple tickers
// ---------------------------------------------------------------------------

describe('grouping by broker and ticker', () => {
  it('keeps separate positions for same ticker across different brokers', () => {
    const rows = [
      makeRow({ broker: 'Schwab', quantity: '10', price: '100.00' }),
      makeRow({ broker: 'DEGIRO', quantity: '5',  price: '105.00' }),
    ];
    const result = aggregatePortfolio(rows);

    expect(result['Schwab']['AAPL'].buyUnits).toBe(10);
    expect(result['DEGIRO']['AAPL'].buyUnits).toBe(5);
  });

  it('keeps separate positions for different tickers in same broker', () => {
    const rows = [
      makeRow({ ticker: 'AAPL', name: 'Apple', quantity: '10', price: '150.00' }),
      makeRow({ ticker: 'MSFT', name: 'Microsoft', quantity: '4', price: '300.00' }),
    ];
    const result = aggregatePortfolio(rows)['Schwab'];

    expect(result['AAPL'].buyAmount).toBe(1500);
    expect(result['MSFT'].buyAmount).toBe(1200);
  });
});

// ---------------------------------------------------------------------------
// Multi-currency positions (EUR)
// ---------------------------------------------------------------------------

describe('multi-currency positions (EUR)', () => {
  it('stores buyAmount and costBasis in the original currency, not USD', () => {
    // Two buys denominated in EUR — the aggregator must NOT convert to USD.
    // Currency conversion happens later in PortfolioView::enrichPosition().
    const rows = [
      makeRow({ currency: 'EUR', quantity: '10', price: '100.00', date: '2023-01-10 09:00:00' }),
      makeRow({ currency: 'EUR', quantity: '5',  price: '110.00', date: '2023-04-10 09:00:00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    expect(pos.currency).toBe('EUR');
    expect(pos.buyUnits).toBe(15);
    // buyAmount = (10 × 100) + (5 × 110) = 1000 + 550 = 1550 EUR
    expect(pos.buyAmount).toBe(1550);
    // costBasis = (buyAmount / buyUnits) × units = (1550 / 15) × 15 = 1550 EUR
    expect(pos.costBasis).toBe(1550);
    // min/max prices are in EUR
    expect(pos.minBuyPrice).toBe(100);
    expect(pos.maxBuyPrice).toBe(110);
  });

  it('tracks sell proceeds in the original currency', () => {
    const rows = [
      makeRow({ currency: 'EUR', action: 'buy',  quantity: '10', price: '80.00' }),
      makeRow({ currency: 'EUR', action: 'sell', quantity: '4',  price: '95.00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    // sellAmount = 4 × 95 = 380 EUR (not converted)
    expect(pos.sellAmount).toBe(380);
    expect(pos.units).toBe(6);
    // costBasis = (800 / 10) × 6 = 480 EUR
    expect(pos.costBasis).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// Gain/loss sign — edge cases
// ---------------------------------------------------------------------------

describe('gain/loss sign edge cases', () => {
  it('is positive (gain) when current value exceeds total invested', () => {
    const rows = [makeRow({ action: 'buy', quantity: '10', price: '100.00' })];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    const { unrealizedGain, returnRate } = enrich(pos, 1200); // above 1000 invested
    expect(unrealizedGain).toBeGreaterThan(0);
    expect(returnRate).toBeGreaterThan(0);
  });

  it('is negative (loss) when current value is below total invested', () => {
    const rows = [makeRow({ action: 'buy', quantity: '10', price: '100.00' })];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    const { unrealizedGain, returnRate } = enrich(pos, 800); // below 1000 invested
    expect(unrealizedGain).toBeLessThan(0);
    expect(returnRate).toBeLessThan(0);
  });

  it('is neutral (break-even) when current value exactly equals total invested', () => {
    const rows = [makeRow({ action: 'buy', quantity: '10', price: '100.00' })];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    const { unrealizedGain } = enrich(pos, 1000); // exactly equals buyAmount
    expect(unrealizedGain).toBe(0);
  });

  it('accounts for locked-in sell proceeds when determining overall gain', () => {
    // Buy 10 @ 100, sell 5 @ 150 (locked in 250 gain), remaining 5 @ 80 = 400
    // unrealizedGain = 400 + 750 - 1000 = 150 → still positive overall
    const rows = [
      makeRow({ action: 'buy',  quantity: '10', price: '100.00' }),
      makeRow({ action: 'sell', quantity: '5',  price: '150.00' }),
    ];
    const pos = aggregatePortfolio(rows)['Schwab']['AAPL'];

    const currentValue = 5 * 80; // remaining 5 units at a low price
    const { unrealizedGain } = enrich(pos, currentValue);
    // 400 + 750 - 1000 = 150 (positive — locked-in gain outweighs unrealized loss)
    expect(unrealizedGain).toBe(150);
    expect(unrealizedGain).toBeGreaterThan(0);
  });
});
