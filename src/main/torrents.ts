import { readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname } from 'node:path';
import torrentStream from 'torrent-stream';
import { VIDEO_EXTENSIONS } from '../shared/media';
import type { TorrentContents, TorrentStats } from '../shared/types';

const METADATA_TIMEOUT_MS = 60_000;

// Magnet links often carry only WebRTC (wss://) trackers, which this Node client can't
// use; these public UDP trackers plus the DHT find TCP peers for most popular torrents.
const EXTRA_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
];

// What the typings leave out of peer-wire-swarm.
interface Swarm {
  wires: unknown[];
  downloaded: number;
  downloadSpeed(): number;
}

type Engine = TorrentStream.TorrentEngine;

// Torrents are fetched on demand (torrent-stream downloads only the ranges being read)
// and each video in them is served on a loopback URL with byte ranges. That URL is the
// video's "path" everywhere else: ffmpeg and ffprobe read it like a file, and the media
// and preview servers proxy it for direct play (see videoSource.ts).
export class TorrentStore {
  private readonly engines = new Map<string, Engine>();
  private readonly server: Server;
  private readonly ready: Promise<void>;

  constructor(private readonly dir: string) {
    this.server = createServer((req, res) => this.handle(req, res));
    this.ready = Promise.all([
      new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve)),
      // Pieces left behind by a crash or a forced quit.
      rm(dir, { recursive: true, force: true }).catch(() => {}),
    ]).then(() => {});
  }

  // `source` is a magnet link, or the path of a .torrent or .magnet file.
  async open(source: string): Promise<TorrentContents> {
    await this.ready;
    const engine = await this.engineFor(await readSource(source));
    const { port } = this.server.address() as AddressInfo;
    const all = engine.files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => VIDEO_EXTENSIONS.includes(extname(file.name).toLowerCase()));
    // Release groups ship a short "sample" clip next to the real thing.
    const withoutSamples = all.filter(({ file }) => !/(^|[\W_])sample([\W_]|$)/i.test(file.name));
    const videos = (withoutSamples.length > 0 ? withoutSamples : all)
      .sort((a, b) => a.file.path.localeCompare(b.file.path, undefined, { numeric: true }))
      .map(({ file, index }) => ({
        name: file.name,
        // The file name stays last so basename/extname work on the URL.
        path: `http://127.0.0.1:${port}/${engine.infoHash}/${index}/${encodeURIComponent(file.name)}`,
        size: file.length,
      }));
    const name = (engine as Engine & { torrent: { name: string } }).torrent.name;
    if (videos.length === 0) {
      throw new Error(`“${name}” has no MP4, MKV or AVI video in it`);
    }
    return { infoHash: engine.infoHash, name, videos };
  }

  stats(): TorrentStats[] {
    return [...this.engines.values()].map((engine) => {
      const swarm = engine.swarm as unknown as Swarm;
      return {
        infoHash: engine.infoHash,
        peers: swarm.wires.length,
        downloadSpeed: swarm.downloadSpeed(),
        downloaded: swarm.downloaded,
      };
    });
  }

  get size(): number {
    return this.engines.size;
  }

  // Drops every torrent none of `keep` (video paths) points into, with its pieces.
  prune(keep: readonly (string | undefined)[]): void {
    for (const [infoHash, engine] of this.engines) {
      if (keep.some((path) => path && torrentOf(path) === infoHash)) continue;
      this.engines.delete(infoHash);
      void removeEngine(engine);
    }
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    const engines = [...this.engines.values()];
    this.engines.clear();
    await Promise.all(engines.map(removeEngine));
    await rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }

  private async engineFor(torrent: string | Buffer): Promise<Engine> {
    const engine = torrentStream(torrent, { tmp: this.dir, trackers: EXTRA_TRACKERS });
    const existing = this.engines.get(engine.infoHash);
    if (existing) {
      engine.destroy(() => {});
      return existing;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Nobody seems to be sharing this torrent right now')),
          METADATA_TIMEOUT_MS
        );
        engine.on('ready', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch (err) {
      void removeEngine(engine);
      throw err;
    }
    this.engines.set(engine.infoHash, engine);
    return engine;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const [, infoHash, index] = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.split('/');
    const file = this.engines.get(infoHash)?.files[Number(index)];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }

    const size = file.length;
    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    res.writeHead(range ? 206 : 200, {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType(file.name),
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    // Reading a range is what makes torrent-stream fetch (and prioritise) its pieces.
    const stream = file.createReadStream({ start, end });
    stream.pipe(res);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
  }
}

// The info hash of a TorrentStore URL, or undefined for any other path.
export function torrentOf(videoPath: string): string | undefined {
  return /^http:\/\/127\.0\.0\.1:\d+\/([0-9a-f]{40})\//i.exec(videoPath)?.[1];
}

async function readSource(source: string): Promise<string | Buffer> {
  if (/^magnet:/i.test(source)) {
    return source;
  }
  if (extname(source).toLowerCase() === '.magnet') {
    const link = (await readFile(source, 'utf8')).trim();
    if (!/^magnet:/i.test(link)) {
      throw new Error('This .magnet file doesn’t contain a magnet link');
    }
    return link;
  }
  return readFile(source);
}

function removeEngine(engine: Engine): Promise<void> {
  return new Promise((resolve) => {
    engine.remove(false, () => engine.destroy(() => resolve()));
  });
}

// A single `bytes=` range (all ffmpeg and TVs send), or undefined for the whole file.
function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | 'invalid' | undefined {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return undefined;
  }
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start > end || start >= size ? 'invalid' : { start, end };
}

function mimeType(name: string): string {
  switch (extname(name).toLowerCase()) {
    case '.mp4':
      return 'video/mp4';
    case '.mkv':
      return 'video/x-matroska';
    case '.avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}
