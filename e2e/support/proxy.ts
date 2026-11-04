import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WEB_URL } from './env';

/**
 * A switchable connection between the real desktop app and the isolated test server, for testing
 * poor connectivity without touching the machine's network:
 * - `down()` refuses connections (the app sees net::ERR_CONNECTION_REFUSED, as when offline);
 * - `up()` restores them on the same port;
 * - `dropNextAnswer(path)` lets the next request to `path` reach the server, then cuts the
 *   connection before the answer arrives (an interrupted sync: sent, but never confirmed).
 */
export interface Proxy {
  url: string;
  up(): Promise<void>;
  down(): Promise<void>;
  dropNextAnswer(path: string): void;
  /** requests forwarded so far, as "METHOD path" */
  seen: string[];
  close(): Promise<void>;
}

export async function startProxy(): Promise<Proxy> {
  const target = new URL(WEB_URL);
  const sockets = new Set<Socket>();
  const seen: string[] = [];
  let drop: string | null = null;
  let port = 0;
  let server: http.Server | null = null;

  const listen = () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        seen.push(`${req.method} ${req.url}`);
        const cut = drop !== null && req.url?.startsWith(drop);
        if (cut) drop = null;
        const out = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (answer) => {
          if (cut) {
            // The server has done the work; the app never hears back.
            answer.resume();
            answer.on('end', () => req.socket.destroy());
            return;
          }
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        });
        out.on('error', () => req.socket.destroy());
        req.pipe(out);
      });
      server.on('connection', (s) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
      });
      server.listen(port, '127.0.0.1', () => {
        port = (server!.address() as AddressInfo).port;
        resolve();
      });
    });
  const stop = () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve();
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
      server = null;
    });

  await listen();
  return {
    url: `http://127.0.0.1:${port}`,
    up: async () => {
      if (!server) await listen();
    },
    down: stop,
    dropNextAnswer: (path) => {
      drop = path;
    },
    seen,
    close: stop,
  };
}
