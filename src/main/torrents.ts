import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, relative, sep } from 'node:path';
import type WebTorrent from 'webtorrent';
import type { Torrent, TorrentFile } from 'webtorrent';
import { VIDEO_EXTENSIONS } from '../shared/media';
import type { TorrentContents, TorrentStats, TorrentSubtitles } from '../shared/types';
import { TEXT_SUBTITLE_EXTENSIONS } from './subtitleExtractor';

const METADATA_TIMEOUT_MS = 60_000;
const SUBTITLES_TIMEOUT_MS = 30_000;

// Magnet links often carry only WebRTC (wss://) trackers; these public UDP trackers plus
// the DHT find the TCP/uTP peers that most popular torrents are shared by.
const EXTRA_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
];

// Torrents are fetched on demand (added deselected, so webtorrent downloads only the ranges
// being read) and each video in them is served on a loopback URL with byte ranges. That URL
// is the video's "path" everywhere else: ffmpeg and ffprobe read it like a file, and the
// media and preview servers proxy it for direct play (see videoSource.ts).
export class TorrentStore {
  // Started on the first open: webtorrent is a large ESM graph with native bindings
  // (node-datachannel, utp-native), not worth loading for local files.
  private client?: Promise<WebTorrent>;
  private readonly torrents = new Map<string, Torrent>();
  private readonly server: Server;
  private readonly ready: Promise<void>;
  private readonly subtitlesDir: string;
  // By local path; dropped on failure so a retry downloads again.
  private readonly fetchedSubtitles = new Map<string, Promise<string>>();

  constructor(private readonly dir: string) {
    this.subtitlesDir = join(dir, '.subtitles');
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
    const torrent = await this.torrentFor(await readSource(source));
    const { port } = this.server.address() as AddressInfo;
    const videos = videoFiles(torrent).map(({ file, index }) => ({
      name: file.name,
      // The file name stays last so basename/extname work on the URL.
      path: `http://127.0.0.1:${port}/${torrent.infoHash}/${index}/${encodeURIComponent(file.name)}`,
      size: file.length,
    }));
    if (videos.length === 0) {
      throw new Error(`“${torrent.name}” has no MP4, MKV or AVI video in it`);
    }
    return { infoHash: torrent.infoHash, name: torrent.name, videos };
  }

  // Every subtitle file in the torrent of a video (a URL from open()), in path order. Only
  // listed: `path` is the local file fetchSubtitles() makes on demand, since subtitles are
  // read by path everywhere (ffmpeg filters, retiming, the sync preview) and a pack can
  // hold hundreds of them, spread next to each video.
  subtitlesOf(videoPath: string): TorrentSubtitles[] {
    const infoHash = torrentOf(videoPath);
    const torrent = infoHash ? this.torrents.get(infoHash) : undefined;
    const video = torrent?.files[Number(new URL(videoPath).pathname.split('/')[2])];
    if (!torrent || !video) return [];
    return torrent.files
      .map((file, i) => ({ file, i }))
      .filter(
        ({ file }) =>
          file.length > 0 && TEXT_SUBTITLE_EXTENSIONS.has(extname(file.name).toLowerCase())
      )
      .sort((a, b) => a.file.path.localeCompare(b.file.path, undefined, { numeric: true }))
      .map(({ file, i }) => ({
        name: file.name,
        path: join(this.subtitlesDir, torrent.infoHash, String(i), file.name),
        label: subtitlesLabel(file, video),
        folder: folderIn(torrent, file),
      }));
  }

  // Downloads a file listed by subtitlesOf() to its `path`, once.
  fetchSubtitles(path: string): Promise<string> {
    let fetching = this.fetchedSubtitles.get(path);
    if (!fetching) {
      const [infoHash, index, ...rest] = relative(this.subtitlesDir, path).split(sep);
      const file = this.torrents.get(infoHash)?.files[Number(index)];
      if (!file || rest.join(sep) !== file.name) {
        return Promise.reject(new Error('These subtitles are no longer in a torrent'));
      }
      fetching = (async () => {
        const bytes = await withTimeout(file.arrayBuffer(), SUBTITLES_TIMEOUT_MS).catch(() => {
          throw new Error(`Couldn’t download ${file.name} from the torrent`);
        });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(bytes));
        return path;
      })();
      this.fetchedSubtitles.set(path, fetching);
      fetching.catch(() => this.fetchedSubtitles.delete(path));
    }
    return fetching;
  }

  stats(): TorrentStats[] {
    return [...this.torrents.values()].map((torrent) => ({
      infoHash: torrent.infoHash,
      peers: torrent.numPeers,
      downloadSpeed: torrent.downloadSpeed,
      downloaded: torrent.downloaded,
    }));
  }

  get size(): number {
    return this.torrents.size;
  }

  // Drops every torrent none of `keep` (video paths) points into, with its pieces.
  prune(keep: readonly (string | undefined)[]): void {
    for (const [infoHash, torrent] of this.torrents) {
      if (keep.some((path) => path && torrentOf(path) === infoHash)) continue;
      this.torrents.delete(infoHash);
      torrent.destroy();
    }
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    this.torrents.clear();
    const client = await this.client?.catch(() => undefined);
    // Destroys every torrent, and with it its pieces (destroyStoreOnDestroy).
    await new Promise<void>((resolve) => (client ? client.destroy(() => resolve()) : resolve()));
    await rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }

  private webTorrent(): Promise<WebTorrent> {
    this.client ??= import('webtorrent').then(({ default: WebTorrent }) => {
      const client = new WebTorrent();
      // Without a listener an error here (or a torrent's, outside torrentFor) would throw
      // in main.
      client.on('error', (err) => console.error('[torrent] client error:', err));
      return client;
    });
    return this.client;
  }

  private async torrentFor(source: string | Buffer): Promise<Torrent> {
    const client = await this.webTorrent();
    // add() destroys a duplicate with an error instead of returning the existing torrent.
    const torrent =
      (await client.get(source)) ??
      client.add(source, {
        path: this.dir,
        announce: EXTRA_TRACKERS,
        deselect: true,
        destroyStoreOnDestroy: true,
      });
    if (!torrent.ready) {
      try {
        await new Promise<void>((resolve, reject) => {
          const fail = (err: Error | string) => {
            clearTimeout(timer);
            torrent.off('ready', done);
            reject(typeof err === 'string' ? new Error(err) : err);
          };
          const done = () => {
            clearTimeout(timer);
            torrent.off('error', fail);
            resolve();
          };
          const timer = setTimeout(
            () => fail('Nobody seems to be sharing this torrent right now'),
            METADATA_TIMEOUT_MS
          );
          torrent.once('ready', done);
          torrent.once('error', fail);
        });
      } catch (err) {
        torrent.destroy();
        throw err;
      }
    }
    this.torrents.set(torrent.infoHash, torrent);
    return torrent;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const [, infoHash, index] = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.split('/');
    const file = this.torrents.get(infoHash)?.files[Number(index)];
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
    // Reading a range is what makes webtorrent fetch (and prioritise) its pieces.
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

// The torrent's videos in path order, without the short "sample" clip release groups ship
// next to the real thing (unless that's all there is).
function videoFiles(torrent: Torrent): { file: TorrentFile; index: number }[] {
  const all = torrent.files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => VIDEO_EXTENSIONS.includes(extname(file.name).toLowerCase()));
  const withoutSamples = all.filter(({ file }) => !/(^|[\W_])sample([\W_]|$)/i.test(file.name));
  return (withoutSamples.length > 0 ? withoutSamples : all).sort((a, b) =>
    a.file.path.localeCompare(b.file.path, undefined, { numeric: true })
  );
}

function stemOf(name: string): string {
  return name.slice(0, name.length - extname(name).length);
}

// The folders a file is in, inside the torrent's own ("Subs/Show.S01E01"), or "".
function folderIn(torrent: Torrent, file: TorrentFile): string {
  // webtorrent joins paths with the platform separator; a multi-file torrent's files are
  // all in a folder named after it.
  const segments = file.path.split(/[\\/]/).slice(0, -1);
  if (torrent.files.length > 1 && segments[0] === torrent.name) segments.shift();
  return segments.join('/');
}

// What sets a video's subtitle files apart: "2_English.srt" → "English",
// "Movie.en.forced.srt" → "en forced". Empty when the file is just named after the video.
function subtitlesLabel(subtitles: TorrentFile, video: TorrentFile): string {
  const stem = stemOf(subtitles.name);
  const videoStem = stemOf(video.name);
  const rest = stem.toLowerCase().startsWith(videoStem.toLowerCase())
    ? stem.slice(videoStem.length)
    : stem;
  return rest.replace(/[._]+/g, ' ').trim().replace(/^\d+ /, '');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
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
