/**
 * Format a USD amount for display in the user's chosen currency.
 *
 * @param {number|null} amountUSD     — value in USD (null → returns "—")
 * @param {Function}    convertToDisplay — from CurrencyContext
 * @param {string}      displayCurrency  — ISO 4217, e.g. 'PLN'
 * @returns {string}
 */
export function formatCurrency(amountUSD, convertToDisplay, displayCurrency) {
  if (amountUSD == null || Number.isNaN(amountUSD)) return '—';
  const converted = convertToDisplay(amountUSD);
  if (converted == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: displayCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(converted);
}

/**
 * Format a percentage with a + sign for positives.
 * @param {number|null} value
 * @param {number} decimals
 */
export function formatPercent(value, decimals = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}
