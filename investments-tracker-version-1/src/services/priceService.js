// Proxied through Vite dev server to avoid CORS — see vite.config.js
const YAHOO = '/api/yahoo/v8/finance/chart'
const COINGECKO = 'https://api.coingecko.com/api/v3'

// 'bond' is intentionally excluded: savings bonds (e.g. EDO series) are not exchange-traded
// and have no Yahoo Finance listing. Exchange-traded bond products use type 'etf'.
export const YAHOO_TYPES = ['stock', 'etf', 'precious_metal']

// Optional ticker overrides — map a CSV ticker to a different Yahoo Finance symbol.
// Use this if a ticker in your CSV doesn't resolve on Yahoo Finance as-is.
// Example: { MYETF: 'MYETF.AS' }
const YAHOO_TICKER_MAP = {}

// Fetch with a hard timeout — prevents slow/hanging requests from blocking Promise.allSettled
function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id))
}

// In-memory cache: ticker (uppercase) → CoinGecko coin ID string (or null if not found)
const coingeckoIdCache = new Map()

async function resolveCoinGeckoId(ticker) {
  const key = ticker.toUpperCase()
  if (coingeckoIdCache.has(key)) return coingeckoIdCache.get(key)
  try {
    const res = await fetchWithTimeout(`${COINGECKO}/search?query=${encodeURIComponent(key)}`)
    if (!res.ok) { coingeckoIdCache.set(key, null); return null }
    const data = await res.json()
    // Pick the first coin whose symbol matches exactly (case-insensitive)
    const match = data.coins?.find(c => c.symbol.toUpperCase() === key)
    const id = match?.id ?? null
    coingeckoIdCache.set(key, id)
    return id
  } catch {
    coingeckoIdCache.set(key, null)
    return null
  }
}

export async function fetchCurrentPrices(positions) {
  // positions: [{ ticker, type }]
  // Returns { prices, previousPrices, priceCurrencies }
  // All prices are in the exchange's native currency (e.g. EUR for .AS, GBP for .L, USD for crypto).
  // The caller is responsible for converting to a common currency using priceCurrencies + FX rates.
  const prices = {}
  const previousPrices = {}
  const priceCurrencies = {} // ticker → ISO currency string

  const cryptos = positions.filter(p => p.type === 'crypto')
  const others = positions.filter(p => YAHOO_TYPES.includes(p.type))

  // Resolve CoinGecko IDs for all crypto tickers, then batch-fetch prices
  if (cryptos.length) {
    const resolved = await Promise.all(
      cryptos.map(async ({ ticker }) => ({ ticker, id: await resolveCoinGeckoId(ticker) }))
    )
    const idToTicker = {}
    const ids = []
    for (const { ticker, id } of resolved) {
      if (id) { ids.push(id); idToTicker[id] = ticker }
    }
    if (ids.length) {
      try {
        const res = await fetchWithTimeout(
          `${COINGECKO}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`
        )
        if (res.ok) {
          const data = await res.json()
          for (const [id, ticker] of Object.entries(idToTicker)) {
            if (!data[id]) continue
            const current = data[id].usd
            const change = data[id].usd_24h_change
            if (current != null) {
              prices[ticker] = current
              priceCurrencies[ticker] = 'USD'
              if (change != null) previousPrices[ticker] = current / (1 + change / 100)
            }
          }
        }
      } catch { /* silently skip */ }
    }
  }

  // Yahoo Finance — one request per ticker, run in parallel
  await Promise.allSettled(
    others.map(async ({ ticker }) => {
      const yahooTicker = YAHOO_TICKER_MAP[ticker] ?? ticker
      try {
        const res = await fetchWithTimeout(`${YAHOO}/${yahooTicker}?interval=1d&range=1d`)
        if (!res.ok) return
        const data = await res.json()
        const meta = data?.chart?.result?.[0]?.meta
        if (meta?.regularMarketPrice != null) {
          // GBp = pence (GBX): Yahoo returns the price in pence, divide by 100 to get GBP
          const rawCurrency = meta.currency ?? 'USD'
          const scale = rawCurrency === 'GBp' ? 100 : 1
          const currency = rawCurrency === 'GBp' ? 'GBP' : rawCurrency
          prices[ticker] = meta.regularMarketPrice / scale
          priceCurrencies[ticker] = currency
          if (meta.previousClose != null) previousPrices[ticker] = meta.previousClose / scale
        }
      } catch { /* silently skip */ }
    })
  )

  return { prices, previousPrices, priceCurrencies }
}

export async function fetchHistoricalPrices(ticker, type) {
  // Returns { prices: { 'YYYY-MM-DD': { high, low, close } }, currency: string|null }
  const results = {}
  let priceCurrency = null

  try {
    if (type === 'crypto') {
      const id = await resolveCoinGeckoId(ticker)
      if (!id) return { prices: results, currency: null }
      // market_chart returns separate arrays for prices (close), but not high/low on the free tier.
      // Use the OHLC endpoint instead (up to 90 days at daily granularity on the free plan).
      // For older transactions we fall back gracefully (no data = no color).
      const res = await fetchWithTimeout(`${COINGECKO}/coins/${id}/ohlc?vs_currency=usd&days=365`)
      if (!res.ok) return { prices: results, currency: null }
      const data = await res.json() // [[timestamp, open, high, low, close], ...]
      for (const [ts, , high, low, close] of data) {
        const date = new Date(ts).toISOString().slice(0, 10)
        results[date] = { high, low, close }
      }
      priceCurrency = 'USD'
    } else if (YAHOO_TYPES.includes(type)) {
      const yahooTicker = YAHOO_TICKER_MAP[ticker] ?? ticker
      const period2 = Math.floor(Date.now() / 1000)
      const period1 = period2 - 10 * 365 * 86400 // 10 years back
      const res = await fetchWithTimeout(`${YAHOO}/${yahooTicker}?interval=1d&period1=${period1}&period2=${period2}`)
      if (!res.ok) return { prices: results, currency: null }
      const data = await res.json()
      const result = data?.chart?.result?.[0]
      const timestamps = result?.timestamp ?? []
      const quote = result?.indicators?.quote?.[0] ?? {}
      const highs   = quote.high  ?? []
      const lows    = quote.low   ?? []
      const closes  = quote.close ?? []
      // GBp = pence: Yahoo returns prices in pence for LSE stocks; divide by 100 to get GBP
      const rawCurrency = result?.meta?.currency ?? 'USD'
      const scale = rawCurrency === 'GBp' ? 100 : 1
      priceCurrency = rawCurrency === 'GBp' ? 'GBP' : rawCurrency
      timestamps.forEach((ts, i) => {
        if (highs[i] != null && lows[i] != null) {
          results[new Date(ts * 1000).toISOString().slice(0, 10)] = {
            high: highs[i] / scale, low: lows[i] / scale, close: closes[i] != null ? closes[i] / scale : null,
          }
        }
      })
    }
  } catch { /* silently skip */ }

  return { prices: results, currency: priceCurrency }
}

export async function fetchAllHistoricalPrices(positions) {
  // positions: [{ ticker, type }]
  // Returns { ticker: { 'YYYY-MM-DD': { high, low, close } } }
  const entries = await Promise.allSettled(
    positions.map(async ({ ticker, type }) => [ticker, await fetchHistoricalPrices(ticker, type)])
  )
  return Object.fromEntries(
    entries
      .filter(r => r.status === 'fulfilled')
      .map(r => {
        const [ticker, { prices }] = r.value
        return [ticker, prices]
      })
  )
}

export async function fetchDividendEvents(positions) {
  // Returns { ticker: [{ date: 'YYYY-MM-DD', amount: number }] }
  const results = {}
  const yahooPositions = positions.filter(p => YAHOO_TYPES.includes(p.type))
  await Promise.allSettled(
    yahooPositions.map(async ({ ticker }) => {
      const yahooTicker = YAHOO_TICKER_MAP[ticker] ?? ticker
      try {
        const res = await fetchWithTimeout(`${YAHOO}/${yahooTicker}?events=dividends&range=10y&interval=1d`)
        if (!res.ok) return
        const data = await res.json()
        const divs = data?.chart?.result?.[0]?.events?.dividends
        if (!divs) return
        results[ticker] = Object.values(divs).map(d => ({
          date: new Date(d.date * 1000).toISOString().slice(0, 10),
          amount: d.amount,
        }))
      } catch { /* silently skip */ }
    })
  )
  return results
}
