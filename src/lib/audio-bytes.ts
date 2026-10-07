import { MAX_ATTACHMENT_BYTES } from './media-limits';

/** Decode bounded local audio without a fetch that would require CSP connect access. */
export function audioDataUrlBytes(url: string): ArrayBuffer | null {
  const match = /^data:audio\/(?:wav|mpeg|webm|mp4|ogg);base64,/.exec(url);
  if (!match) return null;
  const encoded = url.slice(match[0].length);
  if (
    !encoded ||
    encoded.length > 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3) ||
    encoded.length % 4 !== 0
  )
    return null;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  // A single-character scan avoids a repeated-group regex overflowing on5MiB.
  if (/[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding))) return null;
  try {
    const decoded = atob(encoded);
    if (decoded.length > MAX_ATTACHMENT_BYTES) return null;
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
    return bytes.buffer;
  } catch {
    return null;
  }
}
