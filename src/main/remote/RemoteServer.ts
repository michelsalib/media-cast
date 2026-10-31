import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { app } from 'electron';
import QRCode from 'qrcode';
import send from 'send';
import type { MainEvents, RemoteInfo } from '../../shared/types';
import { tapEvents } from '../api';
import { thumbnail } from '../ffmpeg';
import { lanAddresses } from '../network';
import type { PlaybackController } from '../PlaybackController';
import type { PreviewServer } from '../PreviewServer';
import { sendVideo } from '../videoSource';
import type { RemoteApi } from './api';
import type { RemoteHub } from './RemoteHub';

const PREFERRED_PORT = 4005;
const MAX_BODY = 64 * 1024;

// Pushes a phone gets, as server-sent events. For the CHANGED ones (local paths, IPs) it
// only hears that something changed and asks for the state again; so it does for the
// window's context (`context`).
const RELAYED: readonly (keyof MainEvents)[] = ['status', 'torrents', 'subtitleScale'];
const CHANGED: readonly (keyof MainEvents)[] = ['nowPlaying', 'scan'];

interface Settings {
  enabled: boolean;
  token: string;
}

// The phone remote: a page and a small API on the LAN, under /r/<token>/. Off until the
// user turns it on; the token is the only credential (it's in the QR code), and a new
// one locks out every phone that had the old link.
export class RemoteServer {
  private server?: Server;
  private port = PREFERRED_PORT;
  private settings: Settings;
  private readonly clients = new Set<ServerResponse>();
  // Thumbnails by video path, oldest first.
  private readonly artwork = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly api: RemoteApi,
    private readonly controller: PlaybackController,
    private readonly preview: PreviewServer,
    private readonly hub: RemoteHub
  ) {
    this.settings = loadSettings();
    tapEvents((channel, payload) => {
      if (RELAYED.includes(channel)) this.broadcast(channel, payload);
      else if (CHANGED.includes(channel)) this.broadcast(channel, null);
    });
    hub.onChange(() => this.broadcast('context', null));
    if (this.settings.enabled) this.listen();
  }

  async info(): Promise<RemoteInfo> {
    if (!this.settings.enabled) return { enabled: false, links: [] };
    await this.listening();
    const links = await Promise.all(
      lanAddresses().map(async (address) => {
        const url = `http://${address}:${this.port}/r/${this.settings.token}/`;
        const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 2 });
        return { address, url, qrSvg };
      })
    );
    return { enabled: true, links };
  }

  async setEnabled(enabled: boolean): Promise<RemoteInfo> {
    this.save({ ...this.settings, enabled });
    if (enabled) this.listen();
    else this.stop();
    return this.info();
  }

  async newLink(): Promise<RemoteInfo> {
    this.save({ ...this.settings, token: newToken() });
    // Phones on the old link are listening to events; cut them off too.
    for (const res of this.clients) res.destroy();
    return this.info();
  }

  close(): void {
    this.stop();
  }

  private listen(): void {
    if (this.server) return;
    const server = createServer((req, res) => void this.handle(req, res));
    this.server = server;
    server.on('listening', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) this.port = addr.port;
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && this.port !== 0) {
        console.warn(`[remote] port ${this.port} in use, falling back to an ephemeral port`);
        this.port = 0;
        server.listen(0);
        return;
      }
      console.error('[remote] server error:', err);
    });
    server.listen(this.port);
  }

  private listening(): Promise<void> {
    const server = this.server;
    if (!server || server.listening) return Promise.resolve();
    return new Promise((resolve) => server.once('listening', () => resolve()));
  }

  private stop(): void {
    for (const res of this.clients) res.destroy();
    this.clients.clear();
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
    this.port = PREFERRED_PORT;
  }

  private save(settings: Settings): void {
    this.settings = settings;
    writeFileSync(settingsPath(), JSON.stringify(settings));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://remote');
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const m = /^\/r\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m || !this.tokenMatches(m[1])) {
      // In dev the page's modules come from the Vite server, at its root.
      if (devUrl && !m) {
        sendVideo(req, res, `${devUrl}${url.pathname}${url.search}`);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    const route = m[2];
    if (route === undefined) {
      // Relative asset and API URLs need the trailing slash.
      res.writeHead(301, { Location: `${url.pathname}/` });
      res.end();
      return;
    }

    try {
      if (route === '/' || route.startsWith('/assets/')) {
        if (devUrl) {
          sendVideo(req, res, `${devUrl}${route === '/' ? '/remote.html' : route}`);
        } else {
          const file = route === '/' ? 'remote.html' : route.slice(1);
          send(req, file, { root: join(__dirname, '../renderer') }).pipe(res);
        }
      } else if (route === '/events') {
        this.events(req, res);
      } else if (route === '/artwork') {
        await this.sendArtwork(res, url.searchParams.get('video') === 'next');
      } else if (route.startsWith('/preview/')) {
        const base = this.preview.baseUrl;
        if (!base) throw new Error('No preview');
        sendVideo(req, res, `${base}/${route.slice('/preview/'.length)}${url.search}`);
      } else if (route.startsWith('/api/') && req.method === 'POST') {
        await this.call(route.slice('/api/'.length), req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }

  private tokenMatches(token: string): boolean {
    const a = Buffer.from(token);
    const b = Buffer.from(this.settings.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async call(method: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!Object.hasOwn(this.api, method)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const args: unknown = JSON.parse((await readBody(req)) || '[]');
    if (!Array.isArray(args)) throw new Error('Arguments must be an array');
    const handler = this.api[method as keyof RemoteApi] as (...a: unknown[]) => unknown;
    const result = await handler(...args);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result ?? null));
  }

  private events(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    this.clients.add(res);
    // Phones and Wi-Fi routers drop idle connections.
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  // `next`: the video the window has ready; otherwise the one playing.
  private async sendArtwork(res: ServerResponse, next: boolean): Promise<void> {
    const videoPath = next
      ? this.hub.current.prepared?.videoPath
      : this.controller.nowPlaying?.videoPath;
    if (!videoPath) {
      res.writeHead(404);
      res.end();
      return;
    }
    let jpeg = this.artwork.get(videoPath);
    if (!jpeg) {
      jpeg = thumbnail(videoPath, 640);
      jpeg.catch(() => this.artwork.delete(videoPath));
      this.artwork.set(videoPath, jpeg);
      // The playing and the ready video, plus a little slack.
      for (const old of [...this.artwork.keys()].slice(0, -4)) this.artwork.delete(old);
    }
    const data = await jpeg;
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length });
    res.end(data);
  }

  private broadcast(channel: string, data: unknown): void {
    for (const res of this.clients)
      res.write(`event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'remote.json');
}

function loadSettings(): Settings {
  try {
    const { enabled, token } = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    if (typeof token === 'string' && token.length >= 16) return { enabled: !!enabled, token };
  } catch {
    // First run.
  }
  return { enabled: false, token: newToken() };
}

function newToken(): string {
  return randomBytes(12).toString('base64url');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
