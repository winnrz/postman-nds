/**
 * Bound a promise that may never settle.
 *
 * Needed because unreachable dependencies here do not fail fast: node-redis
 * retries a dead host indefinitely, so `connect()` neither resolves nor rejects.
 * Anything on a request path that touches Redis has to impose its own ceiling,
 * or a dependency outage turns into hung requests rather than fast failures.
 *
 * The losing promise is not cancelled — it is left to settle on its own.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      // `unref` so a pending timer never keeps the process alive on shutdown.
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ).unref();
    }),
  ]);
}
