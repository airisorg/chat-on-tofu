export async function withRequestDeadline<T>(
  controller: AbortController,
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<T> {
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () =>
    rejectAbort(controller.signal.reason ?? new DOMException('Request cancelled.', 'AbortError'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  const timer = setTimeout(
    () => controller.abort(new Error('Connection timed out. Please try again.')),
    timeoutMs,
  );
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work();
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
