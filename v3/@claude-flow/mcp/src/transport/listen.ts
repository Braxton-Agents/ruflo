/**
 * Shared listen helper for MCP network transports.
 *
 * On Node >= 17, `localhost` may resolve to `::1` first; hosts without an
 * IPv6 loopback (common in containers and minimal CI images) then fail the
 * bind with EAFNOSUPPORT/EADDRNOTAVAIL. For loopback hosts we retry on
 * 127.0.0.1 instead of crashing the server (#2990).
 */
import type { Server } from 'node:http';

// Only the ambiguous name falls back; an explicit '::1' request must fail
// cleanly so callers binding multiple loopback families don't collide.
const LOOPBACK_IPV4_FALLBACK: Record<string, string> = {
  localhost: '127.0.0.1',
};

/**
 * Listen on `host:port`, retrying on 127.0.0.1 when an IPv6-less host
 * rejects a loopback bind. Resolves with the host actually bound.
 */
export async function listenWithLoopbackFallback(
  server: Server,
  port: number,
  host: string | undefined,
  onFallback?: (from: string, to: string, error: Error) => void
): Promise<string | undefined> {
  const tryListen = (candidate: string | undefined) =>
    new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, candidate);
    });

  try {
    await tryListen(host);
    return host;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const fallback = host !== undefined ? LOOPBACK_IPV4_FALLBACK[host] : undefined;
    if (fallback && (code === 'EAFNOSUPPORT' || code === 'EADDRNOTAVAIL')) {
      onFallback?.(host as string, fallback, err as Error);
      await tryListen(fallback);
      return fallback;
    }
    throw err;
  }
}
