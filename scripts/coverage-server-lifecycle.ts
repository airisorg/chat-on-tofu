export function requireOwnedServerShutdown(
  requested: boolean,
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  // Next16 explicitly exits143 after completing its SIGTERM cleanup. Accept
  // that convention only when this runner requested its owned child shutdown.
  if (
    !requested ||
    !(
      (code === 0 && signal === null) ||
      (code === 143 && signal === null) ||
      (code === null && signal === 'SIGTERM')
    )
  )
    throw new Error('Unexpected coverage server termination.');
}
