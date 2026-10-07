/** Only trusted deployment configuration contributes external connection origins. */
export function contentSecurityPolicy(nonce: string, authUrl: string | undefined, development = false): string {
  const connections = ["'self'"];
  try {
    const url = new URL(authUrl || '');
    if (url.protocol === 'https:' && !url.username && !url.password) {
      connections.push(url.origin, url.origin.replace(/^https:/, 'wss:'));
    }
  } catch { /* An unconfigured local preview needs no identity-provider connection. */ }
  // Local routed-provider fixtures and the dev server's HMR need these development sources.
  if (development) connections.push('https:', 'ws:');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // React uses inline style properties for measured menus, avatars and viewports.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://googleusercontent.com https://*.googleusercontent.com https://gstatic.com https://*.gstatic.com",
    "font-src 'self'",
    "media-src 'self' data: blob:",
    `connect-src ${connections.join(' ')}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

export const responseSecurityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
];
