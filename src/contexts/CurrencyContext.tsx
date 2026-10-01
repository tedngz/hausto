
import React, { createContext, useContext, useState } from 'react';

export type Currency = 'VND' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  formatPrice: (price: number) => string;
  convertPrice: (priceInVND: number) => number;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

// 1 USD = 24,500 VND (approximate exchange rate)
const VND_TO_USD_RATE = 24500;

const currencySymbols = {
  VND: '₫',
  USD: '$'
};

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrency] = useState<Currency>('VND');

  const convertPrice = (priceInVND: number) => {
    if (currency === 'VND') {
      return priceInVND;
    } else {
      return Math.round(priceInVND / VND_TO_USD_RATE);
    }
  };

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

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatPrice, convertPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
};

// The hook lives beside its provider; editing this file reloads the page
// rather than hot-swapping, which is the price of keeping the pair together.
// eslint-disable-next-line react-refresh/only-export-components
export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
