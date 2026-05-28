import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { promisify } from 'node:util';
import send from 'send';
import { type SubtitleSource, transcodeToMpegTs, type VideoSize } from './ffmpeg';
import { pickLocalIpFor } from './network';

export interface ServeVideoOptions {
  transcode?: boolean;
  targetIp: string;
  duration?: number;
  burnSubtitles?: SubtitleSource;
  videoSize?: VideoSize;
  audioTrackIndex?: number;
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
  private currentAudioTrackIndex?: number;
  private currentSubtitlesData?: Buffer;
  private currentSubtitlesFormat: 'vtt' | 'srt' | 'smi' = 'vtt';
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

    const videoPaths = [
      `/${this.sessionHash}/video`,
      `/${this.sessionHash}/video.ts`,
      `/${this.sessionHash}/video.mp4`,
      `/${this.sessionHash}/video.mpg`,
      `/${this.sessionHash}/video.mkv`,
    ];
    if (req.url && videoPaths.includes(req.url)) {
      if (this.currentVideoTranscode) {
        await this.handleTranscodedVideo(req, res, this.currentVideoPath);
      } else {
        send(req, this.currentVideoPath).pipe(res);
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

    const handle = await transcodeToMpegTs({
      videoPath,
      seekSeconds,
      burnSubtitles: this.currentSubtitleSource,
      videoSize: this.currentVideoSize,
      audioTrackIndex: this.currentAudioTrackIndex,
    });

    res.writeHead(200, transcodedHeaders(this.currentDuration, seekSeconds));
    handle.stream.pipe(res);
    handle.stream.on('error', () => res.destroy());

    const cleanup = (): void => handle.kill();
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
    this.currentSubtitleSource = options.burnSubtitles;
    this.currentVideoSize = options.videoSize;
    this.currentAudioTrackIndex = options.audioTrackIndex;
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
