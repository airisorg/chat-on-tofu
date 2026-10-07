import { NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy } from './lib/security-headers';

export function proxy(request: NextRequest) {
  // Fresh request nonces authorize framework scripts without enabling injected scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = contentSecurityPolicy(
    nonce,
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NODE_ENV === 'development',
  );
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

// The app has one document route. Private APIs/static files use global response headers.
export const config = { matcher: ['/'] };
