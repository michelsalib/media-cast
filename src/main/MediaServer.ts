import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import send from 'send';
import { pickLocalIpFor } from './network';

export interface ServeVideoOptions {
  transcode?: boolean;
  targetIp: string;
  duration?: number;
}

export interface ServeSubtitlesOptions {
  targetIp: string;
}

export class MediaServer {
  private readonly server: Server;
  private currentVideoPath?: string;
  private currentVideoTranscode = false;
  private currentDuration?: number;
  private currentSubtitlesData?: Buffer;
  private sessionHash = randomUUID();

  constructor(private readonly port: number) {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.currentVideoPath) {
      res.writeHead(404);
      res.end('No video path set');
      return;
    }

    if (req.url?.startsWith(`/${this.sessionHash}/video`) && !req.url.endsWith('/subs')) {
      if (this.currentVideoTranscode) {
        this.handleTranscodedVideo(req, res, this.currentVideoPath);
      } else {
        send(req, this.currentVideoPath).pipe(res);
      }
      return;
    }

    if (req.url === `/${this.sessionHash}/subs`) {
      if (!this.currentSubtitlesData) {
        res.writeHead(404);
        res.end('No subtitles data set');
        return;
      }

      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'content-length': this.currentSubtitlesData.length,
        'content-type': 'text/vtt;charset=utf-8',
      });

      res.end(this.currentSubtitlesData);
      return;
    }

    res.writeHead(404);
    res.end('Non supported path');
  }

  private handleTranscodedVideo(
    req: IncomingMessage,
    res: ServerResponse,
    videoPath: string
  ): void {
    const seekHeader = req.headers['timeseekrange.dlna.org'];
    const seekSeconds = parseTimeSeekRange(Array.isArray(seekHeader) ? seekHeader[0] : seekHeader);

    if (req.method === 'HEAD') {
      res.writeHead(200, transcodedHeaders(this.currentDuration, seekSeconds));
      res.end();
      return;
    }

    const args: string[] = [];
    if (seekSeconds > 0) {
      args.push('-ss', String(seekSeconds));
    }
    args.push('-i', videoPath);
    if (seekSeconds > 0) {
      // Make the output PTS start at the seek offset, so the renderer reports
      // the real position instead of restarting its counter at 0.
      args.push('-output_ts_offset', String(seekSeconds));
    }
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-profile:v',
      'high',
      '-level',
      '4.0',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '60',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-b:a',
      '192k',
      '-f',
      'mpegts',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
      'pipe:1'
    );

    const ffmpeg: ChildProcess = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';
    ffmpeg.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      console.log('[ffmpeg]', text.trimEnd());
      stderrTail = (stderrTail + text).slice(-2000);
    });

    res.writeHead(200, transcodedHeaders(this.currentDuration, seekSeconds));

    ffmpeg.stdout?.pipe(res);
    ffmpeg.on('error', (err) => {
      console.error('[ffmpeg] spawn error', err);
      res.destroy();
    });
    ffmpeg.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGKILL') {
        console.error(`[ffmpeg] exit code=${code} signal=${signal}\n${stderrTail}`);
      }
    });

    const cleanup = (): void => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  async close(): Promise<void> {
    await promisify(this.server.close).bind(this.server)();
  }

  serveVideo(videoPath: string, options: ServeVideoOptions): string {
    this.currentVideoPath = videoPath;
    this.currentVideoTranscode = options.transcode ?? false;
    this.currentDuration = options.duration;
    const filename = options.transcode ? 'video.ts' : 'video';
    const ip = pickLocalIpFor(options.targetIp);
    return `http://${ip}:${this.port}/${this.sessionHash}/${filename}`;
  }

  serveSubtitles(subtitlesData: Buffer, options: ServeSubtitlesOptions): string {
    this.currentSubtitlesData = subtitlesData;
    const ip = pickLocalIpFor(options.targetIp);
    return `http://${ip}:${this.port}/${this.sessionHash}/subs`;
  }
}

function transcodedHeaders(
  duration: number | undefined,
  seekSeconds: number
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'video/mpeg',
    'transferMode.dlna.org': 'Streaming',
    // OP=10 → time-based seek; FLAGS bit 30 set (CD70…) → lsop_TimeBasedSeek.
    'contentFeatures.dlna.org':
      'DLNA.ORG_PN=MPEG_TS_SD_EU_ISO;DLNA.ORG_OP=10;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=CD700000000000000000000000000000',
    'Accept-Ranges': 'none',
  };
  if (duration && Number.isFinite(duration)) {
    const total = formatNpt(duration);
    headers['TimeSeekRange.dlna.org'] = `npt=${formatNpt(seekSeconds)}-${total}/${total}`;
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
