/**
 * Convert and format a monetary value.
 * @param {number|null} value         - Amount in `fromCurrency`
 * @param {string}      fromCurrency  - Source currency (ISO 4217)
 * @param {string}      toCurrency    - Display currency (ISO 4217)
 * @param {object}      rates         - { USD: 1, EUR: 0.92, PLN: 4.05, ... } (all vs USD)
 */
export function fmtCurrency(value, fromCurrency, toCurrency, rates) {
  if (value == null) return '—'
  const from = rates[fromCurrency] ?? 1
  const to   = rates[toCurrency]   ?? 1
  const converted = value / from * to
  try {
    return converted.toLocaleString(undefined, {
      style: 'currency',
      currency: toCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } catch {
    return `${toCurrency} ${converted.toFixed(2)}`
  }
}
