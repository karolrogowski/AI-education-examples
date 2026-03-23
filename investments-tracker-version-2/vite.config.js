import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      // Yahoo Finance — stocks, ETFs, precious metals
      // /api/yahoo/v8/finance/chart/AAPL → https://query1.finance.yahoo.com/v8/finance/chart/AAPL
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
      },

      // CoinGecko — crypto (free tier, no key required)
      // /api/coingecko/simple/price → https://api.coingecko.com/api/v3/simple/price
      '/api/coingecko': {
        target: 'https://api.coingecko.com/api/v3',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/coingecko/, ''),
      },
    },
  },

  // Vitest configuration — used when running `npm test`
  test: {
    environment: 'node',
    globals: true,
  },
});
