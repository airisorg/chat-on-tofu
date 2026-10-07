export type AuthSnapshot = { identity: string; token: string; generation: number };

export function refreshFailure(error: unknown): Error & { status: number } {
  const value = error as { status?: number; name?: string } | null;
  const invalid =
    value?.status === 400 ||
    value?.status === 401 ||
    value?.status === 403 ||
    value?.name === 'AuthSessionMissingError';
  return Object.assign(
    new Error(
      invalid
        ? 'Your session expired. Please sign in again.'
        : 'Sign-in is temporarily unavailable. Your session is still saved; please try again.',
    ),
    { status: invalid ? 401 : 503 },
  );
}

// An actual 401 is rejected by the server before mutation. Only that response
// permits one retry; lost responses and server failures never replay a POST.
export async function authenticatedFetch(
  send: (token: string) => Promise<Response>,
  current: () => AuthSnapshot,
  refresh: () => Promise<{ identity: string; token: string }>,
  signal: AbortSignal,
): Promise<Response> {
  const start = current();
  const owned = () => {
    signal.throwIfAborted();
    const next = current();
    if (next.generation !== start.generation || next.identity !== start.identity)
      throw new Error('Your account changed. Please try again.');
    return next;
  };
  owned();
  let response = await send(start.token);
  let next = owned();
  if (response.status !== 401) return response;
  void response.body?.cancel().catch(() => undefined);
  if (next.token === start.token) {
    const renewed = await refresh();
    next = owned();
    if (renewed.identity !== start.identity || !renewed.token)
      throw new Error('Your account changed. Please try again.');
    next = { ...next, token: renewed.token };
  }
  response = await send(next.token);
  owned();
  return response;
}
