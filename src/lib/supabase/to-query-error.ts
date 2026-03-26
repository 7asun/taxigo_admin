/**
 * PostgREST returns `{ message, code, details, hint }` — not an `Error` instance.
 * Throwing that from RSC or into React error boundaries shows a useless object dump
 * in Next.js; normalize to `Error` so `message` renders and logs stay readable.
 */
export function toQueryError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const msg =
      typeof o.message === 'string' && o.message.length > 0
        ? o.message
        : 'Datenbankfehler';
    const code = typeof o.code === 'string' && o.code.length > 0 ? o.code : '';
    const hint =
      typeof o.hint === 'string' && o.hint.length > 0 ? ` — ${o.hint}` : '';
    return new Error(code ? `${msg} (${code})${hint}` : `${msg}${hint}`);
  }
  return new Error('Unbekannter Datenbankfehler');
}
