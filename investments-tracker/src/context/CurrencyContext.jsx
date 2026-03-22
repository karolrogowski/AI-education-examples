import { createContext, useContext, useState, useEffect } from 'react'

// rates are always expressed as "1 USD = X currency"
const DEFAULT_RATES = { USD: 1, EUR: 1, PLN: 1 }

const CurrencyContext = createContext({ displayCurrency: 'USD', rates: DEFAULT_RATES })

export function CurrencyProvider({ children }) {
  const [displayCurrency, setDisplayCurrency] = useState(
    () => localStorage.getItem('displayCurrency') ?? 'PLN'
  )
  const [rates, setRates] = useState(DEFAULT_RATES)

  useEffect(() => {
    fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,PLN,GBP')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.rates) setRates({ USD: 1, ...data.rates })
      })
      .catch(() => { /* keep default 1:1 rates */ })
  }, [])

  function setCurrency(c) {
    setDisplayCurrency(c)
    localStorage.setItem('displayCurrency', c)
  }

  return (
    <CurrencyContext.Provider value={{ displayCurrency, rates, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
