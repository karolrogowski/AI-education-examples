import { describe, it, expect } from 'vitest'
import { fmtCurrency } from './formatCurrency'

const RATES = { USD: 1, EUR: 0.92, PLN: 4.0 }

describe('fmtCurrency', () => {
  it('returns — for null value', () => {
    expect(fmtCurrency(null, 'USD', 'USD', RATES)).toBe('—')
  })

  // Number formatting is locale-dependent (thousands/decimal separators vary).
  // We test the numeric value by stripping non-digit/dot characters, and test
  // the currency symbol separately.

  function extractNumber(str) {
    // Parse the numeric part out of a locale-formatted currency string.
    // Replace any grouping separators (space, comma, dot used as thousands) and
    // normalise the decimal separator to a dot, then parse as float.
    // Strategy: remove everything that is not a digit, comma, or dot; then
    // determine which of comma/dot is the decimal separator by position.
    const digits = str.replace(/[^\d.,]/g, '')
    // If both separators exist, the last one is the decimal separator.
    const lastComma = digits.lastIndexOf(',')
    const lastDot   = digits.lastIndexOf('.')
    let normalised
    if (lastComma > lastDot) {
      normalised = digits.replace(/\./g, '').replace(',', '.')
    } else {
      normalised = digits.replace(/,/g, '')
    }
    return parseFloat(normalised)
  }

  it('no conversion when from and to are the same currency', () => {
    const result = fmtCurrency(1000, 'USD', 'USD', RATES)
    expect(extractNumber(result)).toBeCloseTo(1000)
  })

  it('converts USD to EUR using the rate', () => {
    // 100 USD × 0.92 = 92 EUR
    const result = fmtCurrency(100, 'USD', 'EUR', RATES)
    expect(extractNumber(result)).toBeCloseTo(92)
  })

  it('converts USD to PLN using the rate', () => {
    // 100 USD × 4.0 = 400 PLN
    const result = fmtCurrency(100, 'USD', 'PLN', RATES)
    expect(extractNumber(result)).toBeCloseTo(400)
  })

  it('converts EUR to PLN via USD as the pivot', () => {
    // 92 EUR → 92/0.92 = 100 USD → 100 × 4.0 = 400 PLN
    const result = fmtCurrency(92, 'EUR', 'PLN', RATES)
    expect(extractNumber(result)).toBeCloseTo(400)
  })

  it('converts PLN to EUR', () => {
    // 400 PLN → 400/4.0 = 100 USD → 100 × 0.92 = 92 EUR
    const result = fmtCurrency(400, 'PLN', 'EUR', RATES)
    expect(extractNumber(result)).toBeCloseTo(92)
  })

  it('uses display currency symbol in the formatted string', () => {
    const eur = fmtCurrency(100, 'USD', 'EUR', RATES)
    const pln = fmtCurrency(100, 'USD', 'PLN', RATES)
    expect(eur).toMatch(/€|EUR/)
    expect(pln).toMatch(/zł|PLN/)
  })

  it('handles a rate of 1 (USD → USD)', () => {
    expect(extractNumber(fmtCurrency(250, 'USD', 'USD', { USD: 1 }))).toBeCloseTo(250)
  })

  it('handles unknown currency gracefully (falls back to raw format)', () => {
    const result = fmtCurrency(100, 'USD', 'XYZ', { USD: 1 })
    expect(result).toContain('100')
  })
})
