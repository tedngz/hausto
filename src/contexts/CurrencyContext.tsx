
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Currency = 'VND' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  formatPrice: (price: number) => string;
  convertPrice: (priceInVND: number) => number;
  /** A figure stored in USD (a building's rent bands), in the chosen currency. */
  formatUsd: (priceInUSD: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

// 1 USD = 24,500 VND (approximate exchange rate) - the rate public-property-search
// converts with, so a filter typed in one currency and a price shown in the
// other agree.
export const VND_TO_USD_RATE = 24500;

// The choice outlives the page. Each page wraps its own provider, so without
// this a renter who picked USD on a listing was back in VND on the hub.
const STORAGE_KEY = 'hausto-currency';
const CHANGED_EVENT = 'hausto:currency';

function savedCurrency(): Currency {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'USD' ? 'USD' : 'VND';
  } catch {
    return 'VND';
  }
}

function formatterFor(currency: Currency) {
  const convertPrice = (priceInVND: number) =>
    currency === 'VND' ? priceInVND : Math.round(priceInVND / VND_TO_USD_RATE);

  const formatPrice = (priceInVND: number) => {
    const convertedPrice = convertPrice(priceInVND);

    if (currency === 'VND') {
      // Format VND in millions for readability (English)
      if (convertedPrice >= 1000000000) {
        const billions = convertedPrice / 1000000000;
        return `${billions % 1 === 0 ? billions.toFixed(0) : billions.toFixed(1)}B VND`;
      } else if (convertedPrice >= 1000000) {
        const millions = convertedPrice / 1000000;
        return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M VND`;
      } else if (convertedPrice >= 1000) {
        return `${(convertedPrice / 1000).toFixed(0)}K VND`;
      } else {
        return `${convertedPrice.toLocaleString()} VND`;
      }
    } else {
      return `$${convertedPrice.toLocaleString()}`;
    }
  };

  const formatUsd = (priceInUSD: number) => formatPrice(priceInUSD * VND_TO_USD_RATE);

  return { convertPrice, formatPrice, formatUsd };
}

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<Currency>(savedCurrency);

  // Any provider's change reaches every other one on the page - a nav bar's
  // dropdown and the pane it sits over can sit under different providers.
  useEffect(() => {
    const onChange = (e: Event) => setCurrencyState((e as CustomEvent<Currency>).detail);
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CHANGED_EVENT, onChange);
  }, []);

  const setCurrency = (next: Currency) => {
    setCurrencyState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode: this page only */ }
    window.dispatchEvent(new CustomEvent<Currency>(CHANGED_EVENT, { detail: next }));
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, ...formatterFor(currency) }}>
      {children}
    </CurrencyContext.Provider>
  );
};

// The hook lives beside its provider; editing this file reloads the page
// rather than hot-swapping, which is the price of keeping the pair together.
//
// Outside a provider it answers in the saved currency rather than throwing: a
// price shown on a page that forgot its provider is a smaller fault than the
// page failing to render.
// eslint-disable-next-line react-refresh/only-export-components
export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    const currency = savedCurrency();
    return { currency, setCurrency: () => {}, ...formatterFor(currency) };
  }
  return context;
};
