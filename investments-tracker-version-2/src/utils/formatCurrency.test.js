import { describe, it, expect } from 'vitest';
import { formatCurrency, formatPercent } from './formatCurrency.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a simple convertToDisplay function for tests.
 * rate: how many display-currency units equal 1 USD (e.g. 4.2 for PLN).
 */
const converter = (rate) => (usd) => usd * rate;

// Identity converter: 1 USD = 1 USD
const asUSD = converter(1);

// ---------------------------------------------------------------------------
// formatCurrency — null / missing value handling
// ---------------------------------------------------------------------------

describe('formatCurrency — null and invalid inputs', () => {
  it('returns "—" for null', () => {
    expect(formatCurrency(null, asUSD, 'USD')).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatCurrency(undefined, asUSD, 'USD')).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatCurrency(NaN, asUSD, 'USD')).toBe('—');
  });

  it('returns "—" when convertToDisplay returns null', () => {
    const returnsNull = () => null;
    expect(formatCurrency(100, returnsNull, 'USD')).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// formatCurrency — USD display (identity conversion)
// ---------------------------------------------------------------------------

describe('formatCurrency — USD display', () => {
  it('formats a whole-dollar amount', () => {
    const result = formatCurrency(100, asUSD, 'USD');
    expect(result).toBe('$100.00');
  });

  it('formats zero', () => {
    const result = formatCurrency(0, asUSD, 'USD');
    expect(result).toBe('$0.00');
  });

  it('formats a fractional amount to 2 decimal places', () => {
    const result = formatCurrency(99.999, asUSD, 'USD');
    // Intl rounds to 2 decimal places → $100.00
    expect(result).toBe('$100.00');
  });

  it('formats a negative amount', () => {
    const result = formatCurrency(-250, asUSD, 'USD');
    expect(result).toContain('250.00');
    // Negative amounts must be represented (exact sign format is locale-dependent)
    expect(result).not.toBe('—');
  });
});

// ---------------------------------------------------------------------------
// formatCurrency — USD → PLN conversion
// ---------------------------------------------------------------------------

describe('formatCurrency — USD to PLN', () => {
  it('multiplies by the PLN rate and formats with PLN currency code', () => {
    // 100 USD × 4 = 400 PLN
    const result = formatCurrency(100, converter(4), 'PLN');

    expect(result).toMatch(/400\.00/);
    expect(result).toMatch(/PLN/);
  });

  it('handles fractional PLN amounts correctly (2 decimal places)', () => {
    // 1 USD × 4.25 = 4.25 PLN
    const result = formatCurrency(1, converter(4.25), 'PLN');

    expect(result).toMatch(/4\.25/);
    expect(result).toMatch(/PLN/);
  });

  it('returns "—" for null regardless of rate', () => {
    expect(formatCurrency(null, converter(4), 'PLN')).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// formatCurrency — USD → EUR conversion
// ---------------------------------------------------------------------------

describe('formatCurrency — USD to EUR', () => {
  it('multiplies by the EUR rate and formats with € symbol', () => {
    // 100 USD × 0.92 = 92 EUR
    const result = formatCurrency(100, converter(0.92), 'EUR');

    expect(result).toMatch(/92\.00/);
    // EUR symbol in en-US locale
    expect(result).toContain('€');
  });

  it('formats small EUR amounts', () => {
    // 1 USD × 0.92 = 0.92 EUR
    const result = formatCurrency(1, converter(0.92), 'EUR');

    expect(result).toMatch(/0\.92/);
    expect(result).toContain('€');
  });

  it('returns "—" for null regardless of rate', () => {
    expect(formatCurrency(null, converter(0.92), 'EUR')).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// formatPercent
// ---------------------------------------------------------------------------

describe('formatPercent', () => {
  it('returns "—" for null', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(formatPercent(undefined)).toBe('—');
  });

  it('returns "—" for NaN', () => {
    expect(formatPercent(NaN)).toBe('—');
  });

  it('prefixes positive values with "+"', () => {
    expect(formatPercent(12.5)).toBe('+12.50%');
  });

  it('does not double-prefix negative values', () => {
    expect(formatPercent(-7.33)).toBe('-7.33%');
  });

  it('formats zero without a "+" prefix', () => {
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('respects the decimals parameter', () => {
    expect(formatPercent(5.1234, 1)).toBe('+5.1%');
    expect(formatPercent(5.1234, 3)).toBe('+5.123%');
  });

  it('defaults to 2 decimal places', () => {
    expect(formatPercent(3)).toBe('+3.00%');
  });
});
