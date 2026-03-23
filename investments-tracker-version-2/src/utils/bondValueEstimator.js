/**
 * bondValueEstimator.js — estimates current redemption value of Polish savings bonds.
 *
 * Polish treasury savings bonds (obligacje oszczędnościowe) are non-marketable
 * instruments sold directly to retail investors by the Ministry of Finance.
 * They have no exchange price, so their value must be calculated from their
 * coupon structure and published inflation data.
 *
 * Supported series:
 *   EDO  — 10-year, inflation-indexed (CPI + 1.00% margin)
 *   COI  — 4-year,  inflation-indexed (CPI + 0.75% margin)
 *   ROS  — 6-year,  inflation-indexed (CPI + 1.50% margin), for 800+ beneficiaries
 *   DOS  — 2-year,  fixed rate throughout
 *   TOS  — 3-month, fixed rate throughout
 *
 * Interest model (EDO/COI/ROS):
 *   - Coupon period 1: fixed published rate (varies by issuance month)
 *   - Coupon periods 2+: prior year's CPI + series margin, compounded annually
 *   - Within the current incomplete period: linear accrual (simple interest)
 *
 * All returned values are in PLN. The price service converts to USD.
 *
 * Sources:
 *   - Rate tables: Polish Ministry of Finance bond offer archives
 *     https://www.obligacjeskarbowe.pl
 *   - CPI data: GUS (Central Statistical Office of Poland)
 *     https://stat.gov.pl
 */

// ---------------------------------------------------------------------------
// Series configuration
// ---------------------------------------------------------------------------

const FACE_VALUE_PLN = 100;

/**
 * margin: CPI margin for years 2+ (null = fixed rate, no inflation link)
 * termYears: nominal term of the series
 */
const SERIES_CONFIG = {
  EDO: { termYears: 10, margin: 0.0100 },
  COI: { termYears: 4,  margin: 0.0075 },
  ROS: { termYears: 6,  margin: 0.0150 },
  DOS: { termYears: 2,  margin: null },
  TOS: { termYears: 0.25, margin: null },
};

// ---------------------------------------------------------------------------
// First-year fixed rates by series and half-year of issuance
//
// Key format: 'YYYY-H1' (Jan–Jun) | 'YYYY-H2' (Jul–Dec)
// Values sourced from Polish MoF bond offer archives (obligacjeskarbowe.pl).
// ---------------------------------------------------------------------------
const FIRST_YEAR_RATE_TABLE = {
  EDO: {
    '2020-H1': 0.0240, '2020-H2': 0.0240,
    '2021-H1': 0.0170, '2021-H2': 0.0170,
    '2022-H1': 0.0400, '2022-H2': 0.0725,
    '2023-H1': 0.0700, '2023-H2': 0.0675,
    '2024-H1': 0.0655, '2024-H2': 0.0645,
    '2025-H1': 0.0600, '2025-H2': 0.0580,
  },
  COI: {
    '2020-H1': 0.0210, '2020-H2': 0.0210,
    '2021-H1': 0.0120, '2021-H2': 0.0120,
    '2022-H1': 0.0300, '2022-H2': 0.0650,
    '2023-H1': 0.0685, '2023-H2': 0.0655,
    '2024-H1': 0.0620, '2024-H2': 0.0610,
    '2025-H1': 0.0575, '2025-H2': 0.0555,
  },
  ROS: {
    '2021-H1': 0.0130, '2021-H2': 0.0130,
    '2022-H1': 0.0425, '2022-H2': 0.0750,
    '2023-H1': 0.0750, '2023-H2': 0.0725,
    '2024-H1': 0.0710, '2024-H2': 0.0700,
    '2025-H1': 0.0650, '2025-H2': 0.0630,
  },
  DOS: {
    '2020-H1': 0.0200, '2020-H2': 0.0200,
    '2021-H1': 0.0100, '2021-H2': 0.0100,
    '2022-H1': 0.0450, '2022-H2': 0.0575,
    '2023-H1': 0.0650, '2023-H2': 0.0630,
    '2024-H1': 0.0615, '2024-H2': 0.0605,
    '2025-H1': 0.0570, '2025-H2': 0.0550,
  },
  TOS: {
    '2020-H1': 0.0150, '2020-H2': 0.0150,
    '2021-H1': 0.0090, '2021-H2': 0.0090,
    '2022-H1': 0.0200, '2022-H2': 0.0525,
    '2023-H1': 0.0600, '2023-H2': 0.0585,
    '2024-H1': 0.0560, '2024-H2': 0.0550,
    '2025-H1': 0.0525, '2025-H2': 0.0510,
  },
};

// ---------------------------------------------------------------------------
// Annual Polish CPI (GUS)
//
// Used to set inflation-linked coupon rates for years 2+.
// Polish MoF technically uses the 12-month CPI ending in October of each year,
// but annual averages are used here as a sound portfolio-tracker approximation.
// ---------------------------------------------------------------------------
const POLISH_CPI_BY_YEAR = {
  2019: 0.023,
  2020: 0.032,
  2021: 0.051,
  2022: 0.144,
  2023: 0.114,
  2024: 0.036,
  2025: 0.050, // NBP projection
};
const CPI_FALLBACK = 0.050;

// ---------------------------------------------------------------------------
// Ticker parser
// ---------------------------------------------------------------------------

/**
 * Parse a Polish savings bond ticker into its series type and maturity date.
 *
 * Format: PREFIX + MM + YY   (MM = 2-digit month, YY = last 2 digits of year)
 *   EDO1030  →  type=EDO,  maturityDate=Oct 2030
 *   COI0527  →  type=COI,  maturityDate=May 2027
 *
 * @param {string} ticker
 * @returns {{ type: string, maturityDate: Date } | null}
 */
export function parseBondTicker(ticker) {
  const match = ticker.match(/^(EDO|COI|ROS|DOS|TOS)(\d{2})(\d{2})$/i);
  if (!match) return null;

  const type = match[1].toUpperCase();
  const month = parseInt(match[2], 10) - 1; // Date months are 0-indexed
  const yearSuffix = parseInt(match[3], 10);
  const year = yearSuffix < 50 ? 2000 + yearSuffix : 1900 + yearSuffix;

  return { type, maturityDate: new Date(year, month, 1) };
}

// ---------------------------------------------------------------------------
// Rate lookups
// ---------------------------------------------------------------------------

/**
 * Find the first-year fixed coupon rate for a given series and issue date.
 * Looks up by half-year; falls back to the nearest available entry.
 */
function getFirstYearRate(seriesType, issueDate) {
  const table = FIRST_YEAR_RATE_TABLE[seriesType];
  if (!table) return 0.05;

  const year = issueDate.getFullYear();
  const half = issueDate.getMonth() < 6 ? 'H1' : 'H2';
  const key = `${year}-${half}`;

  if (table[key] !== undefined) return table[key];

  // Nearest available year, same half
  const years = [...new Set(Object.keys(table).map((k) => parseInt(k, 10)))].sort(
    (a, b) => a - b,
  );
  const closest = years.reduce((prev, curr) =>
    Math.abs(curr - year) < Math.abs(prev - year) ? curr : prev,
  );
  return table[`${closest}-${half}`] ?? table[`${closest}-H1`] ?? 0.05;
}

/**
 * Return the coupon rate for one full or partial coupon period.
 * Period number 2+ uses CPI + margin for indexed bonds, or the
 * original fixed rate for DOS/TOS.
 */
function getCouponRate(config, calendarYear, y1Rate) {
  if (config.margin !== null) {
    const cpi = POLISH_CPI_BY_YEAR[calendarYear] ?? CPI_FALLBACK;
    return cpi + config.margin;
  }
  return y1Rate;
}

// ---------------------------------------------------------------------------
// Core estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the current redemption value (PLN) of a single bond unit (face 100 PLN).
 *
 * Coupon periods are measured from the issue date anniversary.
 * Full periods compound at the end; the current incomplete period accrues linearly.
 *
 * @param {string} seriesType  — 'EDO' | 'COI' | 'ROS' | 'DOS' | 'TOS'
 * @param {Date}   issueDate   — when the bond was purchased (start of interest)
 * @param {Date}   today       — valuation date
 * @returns {number}           — estimated PLN value per unit
 */
function estimateSingleUnitValue(seriesType, issueDate, today) {
  const config = SERIES_CONFIG[seriesType];
  if (!config) return FACE_VALUE_PLN;

  const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
  const totalYears = (today - issueDate) / MS_PER_YEAR;

  if (totalYears <= 0) return FACE_VALUE_PLN;

  const y1Rate = getFirstYearRate(seriesType, issueDate);
  const fullPeriods = Math.floor(totalYears);
  const partialFraction = totalYears - fullPeriods;

  let value = FACE_VALUE_PLN;

  // Period 1 — fixed rate
  if (fullPeriods === 0) {
    // Still inside year 1: linear accrual
    value *= 1 + y1Rate * totalYears;
    return value;
  }
  value *= 1 + y1Rate; // end of period 1

  // Periods 2+ — annual compound
  for (let p = 2; p <= fullPeriods; p++) {
    // The pth coupon period starts in calendar year: issueYear + (p - 1)
    const calendarYear = issueDate.getFullYear() + p - 1;
    value *= 1 + getCouponRate(config, calendarYear, y1Rate);
  }

  // Current incomplete period — linear accrual
  if (partialFraction > 0) {
    const calendarYear = issueDate.getFullYear() + fullPeriods;
    value *= 1 + getCouponRate(config, calendarYear, y1Rate) * partialFraction;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Estimate the current per-unit price (in PLN) for a Polish savings bond.
 *
 * The valuation date is capped at maturity — after maturity the bond has
 * repaid and its "price" is the fully accrued terminal value.
 *
 * @param {string} ticker    — e.g. 'EDO1030', 'COI0527'
 * @param {Date}   issueDate — purchase date (start of interest accrual for the investor)
 * @param {Date}   [today]   — valuation date (defaults to now)
 * @returns {{ pricePerUnit: number, currency: 'PLN', isPolishBond: true } | null}
 *   Returns null when the ticker cannot be parsed.
 */
export function estimateBondPrice(ticker, issueDate, today = new Date()) {
  const parsed = parseBondTicker(ticker);
  if (!parsed || !issueDate) return null;

  const { type, maturityDate } = parsed;

  // Cap valuation at maturity — bonds don't accrue after they've paid out
  const valuationDate = today > maturityDate ? maturityDate : today;

  const pricePerUnit = estimateSingleUnitValue(type, issueDate, valuationDate);

  return {
    pricePerUnit,
    currency: 'PLN',
    isPolishBond: true,
  };
}
