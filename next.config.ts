import type { NextConfig } from 'next';
import { responseSecurityHeaders } from './src/lib/security-headers';
import { resolve } from 'node:path';
const coverage = process.env.CHAT_INSTRUMENT_COVERAGE === '1';
if (coverage && process.env.VERCEL)
  throw new Error('Coverage builds must remain local/CI fixtures.');
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  ...(coverage
    ? {
        distDir: '.next-coverage',
        webpack(config) {
          config.module.rules.push({
            test: /\.[jt]sx?$/,
            include: [resolve('src')],
            enforce: 'pre',
            use: [resolve('scripts/coverage-webpack-loader.cjs')],
          });
          return config;
        },
      }
    : {}),
  async headers() {
    return [{ source: '/(.*)', headers: responseSecurityHeaders }];
  },
};
export default config;
