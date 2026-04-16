import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Fallback rates used only when the API call fails at startup.
// These are approximate — the app will warn the user in that case.
// ---------------------------------------------------------------------------
const FALLBACK_RATES = { USD: 1, EUR: 0.92, PLN: 4.05 };

const STORAGE_KEY = 'displayCurrency';
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'PLN'];

const CurrencyContext = createContext(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function CurrencyProvider({ children }) {
  // Rehydrate last choice from localStorage, default to PLN
  const [displayCurrency, setDisplayCurrencyState] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? 'PLN',
  );

  // Rates are always keyed in USD (i.e. "how many X per 1 USD")
  // USD: 1 is always guaranteed — the API omits it, so we add it manually.
  const [rates, setRates] = useState({ USD: 1 });
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesError, setRatesError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch('https://api.frankfurter.app/latest?base=USD', {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        // data.rates omits the base currency, so we inject USD: 1 ourselves
        setRates({ USD: 1, ...data.rates });
        setRatesLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.warn('[CurrencyContext] Failed to fetch forex rates — using fallback values.', err);
        setRates(FALLBACK_RATES);
        setRatesError('Could not load live exchange rates. Displayed conversions may be approximate.');
        setRatesLoading(false);
      });

    return () => controller.abort();
  }, []);

  // Persist selection and update state in one call
  const setDisplayCurrency = useCallback((currency) => {
    if (!SUPPORTED_CURRENCIES.includes(currency)) return;
    setDisplayCurrencyState(currency);
    localStorage.setItem(STORAGE_KEY, currency);
  }, []);

  /**
   * Convert a USD amount to the currently selected display currency.
   * IMPORTANT: amountUSD must already be in USD. This function never
   * performs source-currency normalization — that is the price service's job.
   *
   * Returns null (not 0) when input is null/NaN so the UI can show "—".
   */
  const convertToDisplay = useCallback(
    (amountUSD) => {
      if (amountUSD == null || Number.isNaN(amountUSD)) return null;
      return amountUSD * (rates[displayCurrency] ?? 1);
    },
    [rates, displayCurrency],
  );

  return (
    <CurrencyContext.Provider
      value={{
        displayCurrency,
        setDisplayCurrency,
        rates,
        ratesLoading,
        ratesError,
        convertToDisplay,
        supportedCurrencies: SUPPORTED_CURRENCIES,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used inside <CurrencyProvider>');
  return ctx;
}
