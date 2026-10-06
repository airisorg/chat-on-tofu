import type { NextConfig } from "next";
import { responseSecurityHeaders } from './src/lib/security-headers';
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  async headers() { return [{ source: '/(.*)', headers: responseSecurityHeaders }]; },
};
export default config;
