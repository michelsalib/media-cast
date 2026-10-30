import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, extname } from 'node:path';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import send from 'send';
import {
  type SubtitleSource,
  type TranscodeHandle,
  transcodeToMpegTs,
  type VideoSize,
} from './ffmpeg';
import { pickLocalIpFor } from './network';
import { DIRECT_PLAY_FEATURES, TRANSCODED_FEATURES } from './upnp/dlna';

export interface ServeVideoOptions {
  transcode?: boolean;
  targetIp: string;
  duration?: number;
  burnSubtitles?: SubtitleSource;
  videoSize?: VideoSize;
  frameRate?: number;
  audioTrackIndex?: number;
  hdr?: boolean;
}

export interface ServeSubtitlesOptions {
  targetIp: string;
  format: 'vtt' | 'srt' | 'smi';
}

export class MediaServer {
  private readonly server: Server;
  private currentVideoPath?: string;
  private currentVideoTranscode = false;
  private currentDuration?: number;
  private currentSubtitleSource?: SubtitleSource;
  private currentVideoSize?: VideoSize;
  private currentFrameRate?: number;
  private currentAudioTrackIndex?: number;
  private currentHdr = false;
  private currentSubtitlesData?: Buffer;
  private currentSubtitlesFormat: 'vtt' | 'srt' | 'smi' = 'vtt';
  private sessionHash = randomUUID();
  private port: number;
  // The encoder feeding the TV right now. TVs open a probe GET before the real one and
  // every seek is a new GET; without this each one runs its own full encoder until its
  // socket happens to close.
  private activeTranscode?: { kill: () => void; res: ServerResponse };

  constructor(preferredPort: number) {
    this.port = preferredPort;
    this.server = createServer((req, res) => this.handleRequest(req, res));
    // Renderers come back for the next range after a pause or once their buffer drains;
    // Node's 5 s default closes idle keep-alive sockets right as a TV reuses them.
    this.server.keepAliveTimeout = 65_000;
    this.server.on('listening', () => {
      const addr = this.server.address();
      if (typeof addr === 'object' && addr) {
        this.port = addr.port;
      }
    });
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      // URLs are built from this.port, so any free port works — the fixed one only
      // keeps firewall rules stable.
      if (err.code === 'EADDRINUSE' && this.port !== 0) {
        console.warn(`[http] port ${this.port} in use, falling back to an ephemeral port`);
        this.port = 0;
        this.server.listen(0);
        return;
      }
      console.error('[http] server error:', err);
    });
    this.server.listen(preferredPort);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    logRequest(req, res);
    if (!this.currentVideoPath) {
      res.writeHead(404);
      res.end('No video path set');
      return;
    }

    const videoPaths = [
      `/${this.sessionHash}/video`,
      `/${this.sessionHash}/video.ts`,
      `/${this.sessionHash}/video.mp4`,
      `/${this.sessionHash}/video.mpg`,
      `/${this.sessionHash}/video.mkv`,
      `/${this.sessionHash}/video.avi`,
    ];
    if (req.url && videoPaths.includes(req.url)) {
      if (this.currentVideoTranscode) {
        await this.handleTranscodedVideo(req, res, this.currentVideoPath);
      } else {
        // send() URL-decodes and dot-checks its path argument, so hand it a root plus an
        // encoded file name: a raw path with `%` or a `.directory` would 400/404.
        send(req, encodeURIComponent(basename(this.currentVideoPath)), {
          root: dirname(this.currentVideoPath),
          dotfiles: 'allow',
        })
          .on('headers', (response: ServerResponse) => {
            response.setHeader('transferMode.dlna.org', 'Streaming');
            response.setHeader('contentFeatures.dlna.org', DIRECT_PLAY_FEATURES);
          })
          .pipe(res);
      }
      return;
    }

    // Subtitle paths: both subs.* and video.* (sidecar pattern many old TVs sniff for).
    const subsPaths = [
      `/${this.sessionHash}/subs`,
      `/${this.sessionHash}/subs.vtt`,
      `/${this.sessionHash}/subs.srt`,
      `/${this.sessionHash}/subs.smi`,
      `/${this.sessionHash}/video.vtt`,
      `/${this.sessionHash}/video.srt`,
      `/${this.sessionHash}/video.smi`,
    ];
    if (req.url && subsPaths.includes(req.url)) {
      if (!this.currentSubtitlesData) {
        res.writeHead(404);
        res.end('No subtitles data set');
        return;
      }

      const contentType =
        this.currentSubtitlesFormat === 'smi'
          ? 'application/smil;charset=utf-8'
          : this.currentSubtitlesFormat === 'srt'
            ? 'application/x-subrip;charset=utf-8'
            : 'text/vtt;charset=utf-8';

      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'content-length': this.currentSubtitlesData.length,
        'content-type': contentType,
      });

      res.end(this.currentSubtitlesData);
      return;
    }

    res.writeHead(404);
    res.end('Non supported path');
  }

  private async handleTranscodedVideo(
    req: IncomingMessage,
    res: ServerResponse,
    videoPath: string
  ): Promise<void> {
    const seekHeader = req.headers['timeseekrange.dlna.org'];
    const seekSeconds = parseTimeSeekRange(Array.isArray(seekHeader) ? seekHeader[0] : seekHeader);

    if (req.method === 'HEAD') {
      res.writeHead(200, transcodedHeaders(this.currentDuration, seekSeconds));
      res.end();
      return;
    }

    // One encoder at a time: the newest request is the one the TV wants.
    this.activeTranscode?.res.destroy();
    this.activeTranscode?.kill();
    this.activeTranscode = undefined;

    let handle: TranscodeHandle;
    try {
      handle = await transcodeToMpegTs({
        videoPath,
        seekSeconds,
        burnSubtitles: this.currentSubtitleSource,
        videoSize: this.currentVideoSize,
        frameRate: this.currentFrameRate,
        audioTrackIndex: this.currentAudioTrackIndex,
        hdr: this.currentHdr,
      });
    } catch (err) {
      console.error('[http] transcode failed to start:', err);
      res.writeHead(500);
      res.end();
      return;
    }
    const active = { kill: handle.kill, res };
    this.activeTranscode = active;

    res.writeHead(200, transcodedHeaders(this.currentDuration, seekSeconds));
    // ffmpeg's pipe output arrives in tiny pieces (often a single 188-byte TS packet),
    // and HTTP sockets run with Nagle off, so each piece would go out as its own TCP
    // segment. Some TVs (LG) then decode partial frames — garbage at the bottom of the
    // picture until the next keyframe. Send fewer, larger writes instead.
    handle.stream.pipe(coalesce(64 * 1024, 100)).pipe(res);
    handle.stream.on('error', () => res.destroy());

    const cleanup = (): void => {
      handle.kill();
      if (this.activeTranscode === active) {
        this.activeTranscode = undefined;
      }
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  async close(): Promise<void> {
    await promisify(this.server.close).bind(this.server)();
  }

  // A TV holding a stream open would otherwise keep close() pending forever.
  closeAllConnections(): void {
    this.server.closeAllConnections();
  }

  // Call once per load, right before serveVideo/serveSubtitles. A fresh URL prefix
  // makes each load a distinct URI to the renderer — reusing one makes TVs (LG) treat
  // the new file as the media they already have loaded and reuse its cached state —
  // and new requests for the previous session's URLs 404 (responses already in
  // flight keep streaming until the TV drops them).
  startSession(): void {
    this.sessionHash = randomUUID();
    this.currentSubtitlesData = undefined;
  }

  serveVideo(videoPath: string, options: ServeVideoOptions): string {
    this.currentVideoPath = videoPath;
    this.currentVideoTranscode = options.transcode ?? false;
    this.currentDuration = options.duration;
    this.currentSubtitleSource = options.burnSubtitles;
    this.currentVideoSize = options.videoSize;
    this.currentFrameRate = options.frameRate;
    this.currentAudioTrackIndex = options.audioTrackIndex;
    this.currentHdr = options.hdr ?? false;
    // For direct-played files some DLNA TVs sniff the URL extension, so reflect
    // the source container; transcoded output is always MPEG-TS.
    const ext = options.transcode ? '.ts' : extname(videoPath).toLowerCase() || '';
    const filename = `video${ext}`;
    const ip = pickLocalIpFor(options.targetIp);
    return `http://${ip}:${this.port}/${this.sessionHash}/${filename}`;
  }

  serveSubtitles(subtitlesData: Buffer, options: ServeSubtitlesOptions): string {
    this.currentSubtitlesData = subtitlesData;
    this.currentSubtitlesFormat = options.format;
    const ip = pickLocalIpFor(options.targetIp);
    // Use the sidecar pattern (same basename as video) — old Samsung TVs match this implicitly.
    return `http://${ip}:${this.port}/${this.sessionHash}/video.${options.format}`;
  }
}

let nextRequestId = 1;

// Logs each request on arrival and again when its response closes, so a stalled
// renderer shows whether it stopped asking for data or we stopped sending it.
// Bytes are a socket.bytesWritten delta (includes headers); sockets are reused
// across keep-alive requests, hence the delta rather than the raw counter.
function logRequest(req: IncomingMessage, res: ServerResponse): void {
  const id = nextRequestId++;
  const start = Date.now();
  const socket = req.socket;
  const bytesAtStart = socket.bytesWritten;
  const peer = `${socket.remoteAddress}:${socket.remotePort}`;
  const range = req.headers.range ?? req.headers['timeseekrange.dlna.org'];
  const userAgent = req.headers['user-agent'];
  console.log(
    `[http #${id} →] ${peer} ${req.method} ${req.url}${range ? ` range=${range}` : ''}${userAgent ? ` ua="${userAgent}"` : ''}`
  );
  res.on('close', () => {
    const bytes = socket.bytesWritten - bytesAtStart;
    const outcome = res.writableFinished ? 'finished' : 'ABORTED';
    console.log(
      `[http #${id} ←] ${res.statusCode} ${outcome} ${formatBytes(bytes)} in ${((Date.now() - start) / 1000).toFixed(1)}s`
    );
  });
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${bytes} B`;
}

function transcodedHeaders(
  duration: number | undefined,
  seekSeconds: number
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'video/mpeg',
    'transferMode.dlna.org': 'Streaming',
    'contentFeatures.dlna.org': TRANSCODED_FEATURES,
    'Accept-Ranges': 'none',
  };
  if (duration && Number.isFinite(duration)) {
    const total = formatNpt(duration);
    headers['TimeSeekRange.dlna.org'] = `npt=${formatNpt(seekSeconds)}-${total}/${total}`;
    // DLNA 1.5 name, plus the pre-1.5 one older renderers still look for.
    headers['availableSeekRange.dlna.org'] = `1 npt=0-${total}`;
    headers['X-AvailableSeekRange'] = `1 npt=0-${total}`;
  }
  return headers;
}

function formatNpt(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function parseTimeSeekRange(header: string | undefined): number {
  if (!header) {
    return 0;
  }
  const m = /npt=([0-9.:]+)/i.exec(header);
  if (!m) {
    return 0;
  }
  const value = m[1];
  if (value.includes(':')) {
    const parts = value.split(':').map(Number);
    if (parts.some(Number.isNaN)) {
      return 0;
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }
  return Number(value) || 0;
}

// Buffers small chunks and emits them as one, once `minBytes` have accumulated or
// `maxDelayMs` have passed since the first buffered byte (keeps latency bounded when
// the encoder is slow).
function coalesce(minBytes: number, maxDelayMs: number): Transform {
  let pending: Buffer[] = [];
  let size = 0;
  let timer: NodeJS.Timeout | undefined;

  const flush = (stream: Transform): void => {
    clearTimeout(timer);
    timer = undefined;
    if (size > 0) {
      stream.push(Buffer.concat(pending, size));
      pending = [];
      size = 0;
    }
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      pending.push(chunk);
      size += chunk.length;
      if (size >= minBytes) {
        flush(this);
      } else if (!timer) {
        timer = setTimeout(() => flush(this), maxDelayMs);
      }
      callback();
    },
    flush(callback) {
      flush(this);
      callback();
    },
    destroy(error, callback) {
      clearTimeout(timer);
      callback(error);
    },
  });
}
