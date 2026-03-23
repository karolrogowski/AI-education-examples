/**
 * Aggregates raw CSV rows into a nested map: { [broker]: { [ticker]: Position } }
 *
 * Position fields:
 *   ticker        {string}   — asset symbol
 *   name          {string}   — human-readable asset name
 *   type          {string}   — stock | etf | bond | crypto | cash | precious_metal
 *   broker        {string}   — account / broker name
 *   currency      {string}   — original transaction currency (ISO 4217)
 *   buyUnits      {number}   — total units purchased
 *   sellUnits     {number}   — total units sold
 *   units         {number}   — buyUnits - sellUnits (remaining holding)
 *   isClosed      {boolean}  — true when units === 0 (fully exited position)
 *   minBuyPrice   {number}   — lowest purchase price in original currency
 *   maxBuyPrice   {number}   — highest purchase price in original currency
 *   firstBuyDate  {Date}     — date of first purchase
 *   lastSellDate  {Date|null}— date of most recent sale, null if never sold
 *   buyAmount     {number}   — sum of (quantity × price) for all buys, original currency
 *   sellAmount    {number}   — sum of (quantity × price) for all sells, original currency
 *   costBasis     {number}   — average cost of remaining units in original currency
 *                              formula: (buyAmount / buyUnits) × units
 *
 * NOTE — dividends are fetched from Yahoo Finance at enrichment time (not from CSV).
 * NOTE — unrealizedGain and returnRate are NOT computed here because they require
 * a live current price from the price service. They are calculated at the
 * enrichment layer (PortfolioView) using:
 *   unrealizedGain = currentValue + sellAmount - buyAmount
 *   returnRate     = (unrealizedGain / buyAmount) × 100
 */
export function aggregatePortfolio(rows) {
  const byBroker = {};

  for (const row of rows) {
    const { date, ticker, name, type, action, currency, broker } = row;
    const quantity = Number(row.quantity);
    const price = Number(row.price);

    if (!byBroker[broker]) byBroker[broker] = {};

    if (!byBroker[broker][ticker]) {
      byBroker[broker][ticker] = {
        ticker,
        name,
        type,
        broker,
        currency,
        buyUnits: 0,
        sellUnits: 0,
        minBuyPrice: Infinity,
        maxBuyPrice: -Infinity,
        firstBuyDate: null,
        lastSellDate: null,
        buyAmount: 0,
        sellAmount: 0,
      };
    }

    const pos = byBroker[broker][ticker];
    const txDate = new Date(date);

    if (action === 'buy') {
      pos.buyUnits += quantity;
      pos.buyAmount += quantity * price;
      if (price < pos.minBuyPrice) pos.minBuyPrice = price;
      if (price > pos.maxBuyPrice) pos.maxBuyPrice = price;
      if (!pos.firstBuyDate || txDate < pos.firstBuyDate) pos.firstBuyDate = txDate;
    } else if (action === 'sell') {
      pos.sellUnits += quantity;
      pos.sellAmount += quantity * price;
      if (!pos.lastSellDate || txDate > pos.lastSellDate) pos.lastSellDate = txDate;
    }
  }

  // Derive computed fields after all rows are processed
  for (const positions of Object.values(byBroker)) {
    for (const pos of Object.values(positions)) {
      pos.units = pos.buyUnits - pos.sellUnits;
      pos.isClosed = pos.units === 0;
      pos.costBasis =
        pos.buyUnits > 0 ? (pos.buyAmount / pos.buyUnits) * pos.units : 0;

      // Replace sentinel values when there were no buy rows
      if (pos.minBuyPrice === Infinity) pos.minBuyPrice = null;
      if (pos.maxBuyPrice === -Infinity) pos.maxBuyPrice = null;
    }
  }

  return byBroker;
}
