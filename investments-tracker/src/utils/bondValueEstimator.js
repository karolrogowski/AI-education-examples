// Annual average GUS CPI for Poland (%)
// Source: https://stat.gov.pl/
const POLAND_ANNUAL_CPI = {
  2019: 2.3,
  2020: 3.4,
  2021: 5.1,
  2022: 14.4,
  2023: 11.4,
  2024: 3.6,
  2025: 4.9,
}

// Fallback CPI used when data for a year is not yet available
const DEFAULT_CPI = 4.0

// Margin added on top of CPI for bond years 2-10
const EDO_MARGIN_PCT = 1.0

// First-year fixed rates for EDO series, keyed by purchase month as 'YYYYMM'
// Source: obligacjeskarbowe.pl
const EDO_FIRST_YEAR_RATES = {
  // 2020 series
  '202008': 1.50, '202009': 1.50, '202010': 1.50, '202011': 1.50, '202012': 1.50,
  // 2021 series
  '202101': 1.20, '202102': 1.30, '202103': 1.30, '202104': 1.30,
  '202105': 1.30, '202106': 1.30, '202107': 1.30, '202108': 1.30,
  '202109': 1.30, '202110': 1.30, '202111': 1.30, '202112': 1.30,
  // 2022 series
  '202201': 2.70, '202202': 2.70, '202203': 4.70, '202204': 5.75,
  '202205': 6.00, '202206': 6.75, '202207': 7.25, '202208': 7.25,
  '202209': 7.25, '202210': 7.25, '202211': 7.25, '202212': 8.00,
  // 2023 series
  '202301': 7.25, '202302': 6.85, '202303': 6.85, '202304': 6.85,
  '202305': 6.85, '202306': 6.85, '202307': 6.85, '202308': 6.85,
  '202309': 6.85, '202310': 6.85, '202311': 6.85, '202312': 6.85,
  // 2025 series
  '202504': 6.50, '202507': 6.25, '202508': 6.00, '202510': 6.50,
  // 2026 series
  '202603': 6.50,
}

/**
 * Estimate the current per-unit value (in PLN) of an EDO Polish savings bond.
 *
 * EDO = 10-year savings bond; par value = 100 PLN at purchase.
 * - Year 1:    fixed rate from EDO_FIRST_YEAR_RATES
 * - Years 2-10: CPI of the calendar year preceding that bond-year + EDO_MARGIN_PCT
 *
 * Interest accrues daily within each bond year using compound interest for complete
 * years and simple (linear) interest for the current partial year.
 *
 * Ticker format: EDO{MM}{YY}  e.g. 'EDO0830' matures Aug 2030, purchased Aug 2020.
 *
 * @param {string} ticker        EDO ticker
 * @param {Date}   purchaseDate  Actual transaction date from the CSV
 * @param {Date}   [asOf]        Valuation date (defaults to today)
 * @returns {number|null}  Estimated PLN value per unit, or null if ticker/series is unrecognised
 */
export function estimateBondCurrentPrice(ticker, purchaseDate, asOf = new Date()) {
  const match = ticker.match(/^EDO(\d{2})(\d{2})$/)
  if (!match || !purchaseDate) return null

  if (asOf < purchaseDate) return 100 // bond not yet issued

  const purchaseYear  = purchaseDate.getUTCFullYear()
  const purchaseMonth = purchaseDate.getUTCMonth() + 1 // 1-based

  const seriesKey = `${purchaseYear}${String(purchaseMonth).padStart(2, '0')}`
  const firstYearRate = EDO_FIRST_YEAR_RATES[seriesKey]
  if (firstYearRate == null) return null // unknown series — no data

  let value = 100

  for (let bondYear = 1; bondYear <= 10; bondYear++) {
    // Bond-year anniversaries are relative to the actual purchase date
    const yearStart = new Date(Date.UTC(
      purchaseYear + bondYear - 1,
      purchaseDate.getUTCMonth(),
      purchaseDate.getUTCDate(),
    ))
    const yearEnd = new Date(Date.UTC(
      purchaseYear + bondYear,
      purchaseDate.getUTCMonth(),
      purchaseDate.getUTCDate(),
    ))

    if (asOf <= yearStart) break // haven't entered this year yet

    let ratePct
    if (bondYear === 1) {
      ratePct = firstYearRate
    } else {
      // CPI of the calendar year that preceded this bond-year
      const cpiYear = yearStart.getUTCFullYear() - 1
      const cpi = POLAND_ANNUAL_CPI[cpiYear] ?? DEFAULT_CPI
      ratePct = cpi + EDO_MARGIN_PCT
    }

    const rate = ratePct / 100

    if (asOf >= yearEnd) {
      // Complete year — compound the full annual rate
      value *= (1 + rate)
    } else {
      // Partial year — simple (linear) interest on the accrued value
      const msElapsed = asOf.getTime() - yearStart.getTime()
      const msInYear  = yearEnd.getTime() - yearStart.getTime()
      value *= (1 + rate * (msElapsed / msInYear))
    }
  }

  return value
}
