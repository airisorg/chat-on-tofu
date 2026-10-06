export const CONNECTION_INTERRUPTED_MESSAGE = 'Connection interrupted. Check your connection and try again.';

// Native fetch failures vary by browser. Match their error class and known
// messages rather than replacing specific API, validation or programming errors.
export function normalizeNetworkError(failure: unknown): unknown {
  if (!failure || typeof failure !== 'object') return failure;
  const value = failure as { name?: unknown; message?: unknown; status?: unknown };
  if (typeof value.status === 'number') return failure;
  const fetchFailure = value.name === 'TypeError' && typeof value.message === 'string'
    && /^(?:failed to fetch|load failed|network request failed|networkerror(?: when attempting to fetch resource)?)[.!]?$/i.test(value.message.trim());
  if (!fetchFailure && value.name !== 'NetworkError') return failure;
  return new Error(CONNECTION_INTERRUPTED_MESSAGE, { cause: failure });
}

export function errorMessage(failure: unknown, fallback: string): string {
  const normalized = normalizeNetworkError(failure);
  return normalized instanceof Error ? normalized.message : fallback;
}
