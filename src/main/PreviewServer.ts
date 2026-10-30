import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, dirname, extname } from 'node:path';
import { promisify } from 'node:util';
import send from 'send';
import { type FFProbeData, isHdrTransfer, probe, transcodePreview } from './ffmpeg';

export interface PreviewSource {
  // Set when Chromium can likely play the file as is (seekable, no encoder running).
  directUrl?: string;
  // Fragmented MP4 from ffmpeg; append `?t=<seconds>` to start elsewhere.
  transcodeUrl: string;
  duration: number;
}

// Local-only HTTP server feeding the subtitle-sync preview <video> in our own window.
// Separate from MediaServer: that one is bound to the LAN and its session rotation is
// tuned for TVs. One preview at a time, behind a random token.
export class PreviewServer {
  private readonly server: Server;
  private port = 0;
  private current?: { token: string; videoPath: string; audioIndex?: number; hdr: boolean };
  private activeEncoder?: { kill: () => void; res: ServerResponse };

  constructor() {
    this.server = createServer((req, res) => this.handle(req, res));
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server.address();
      if (typeof addr === 'object' && addr) this.port = addr.port;
    });
  }

  async start(videoPath: string, audioIndex?: number): Promise<PreviewSource> {
    this.stop();
    const data = await probe(videoPath);
    const video = data.streams.find((s) => s.codec_type === 'video');
    const token = randomUUID();
    this.current = { token, videoPath, audioIndex, hdr: isHdrTransfer(video?.color_transfer) };
    const base = `http://127.0.0.1:${this.port}/${token}`;
    return {
      directUrl: isDirectPlayable(videoPath, data, audioIndex) ? `${base}/video` : undefined,
      transcodeUrl: `${base}/preview.mp4`,
      duration: Number(data.format.duration) || 0,
    };
  }

  stop(): void {
    this.killEncoder();
    this.current = undefined;
  }

  async close(): Promise<void> {
    this.stop();
    this.server.closeAllConnections();
    await promisify(this.server.close).bind(this.server)();
  }

  private killEncoder(): void {
    this.activeEncoder?.res.destroy();
    this.activeEncoder?.kill();
    this.activeEncoder = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const current = this.current;
    if (!current || !url.pathname.startsWith(`/${current.token}/`)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const route = url.pathname.slice(current.token.length + 2);

    if (route === 'video') {
      send(req, encodeURIComponent(basename(current.videoPath)), {
        root: dirname(current.videoPath),
        dotfiles: 'allow',
      }).pipe(res);
      return;
    }

    if (route === 'preview.mp4') {
      // Every seek is a new GET; the previous encoder is no longer watched.
      this.killEncoder();
      let handle: Awaited<ReturnType<typeof transcodePreview>>;
      try {
        handle = await transcodePreview({
          videoPath: current.videoPath,
          seekSeconds: Math.max(0, Number(url.searchParams.get('t')) || 0),
          audioTrackIndex: current.audioIndex,
          hdr: current.hdr,
        });
      } catch (err) {
        console.error('[preview] transcode failed to start:', err);
        res.writeHead(500);
        res.end();
        return;
      }
      const active = { kill: handle.kill, res };
      this.activeEncoder = active;
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none' });
      handle.stream.pipe(res);
      handle.stream.on('error', () => res.destroy());
      res.on('close', () => {
        handle.kill();
        if (this.activeEncoder === active) this.activeEncoder = undefined;
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }
}

const DIRECT_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const DIRECT_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

// Conservative: Chromium's own demuxers (MP4/WebM), 8-bit SDR, browser audio codecs,
// and the default audio track (a <video> can't pick another). Anything else, and any
// playback error in the renderer, goes through the transcoder.
function isDirectPlayable(videoPath: string, data: FFProbeData, audioIndex?: number): boolean {
  if (!['.mp4', '.m4v', '.webm'].includes(extname(videoPath).toLowerCase())) return false;
  if (audioIndex !== undefined && audioIndex !== 0) return false;
  const video = data.streams.find((s) => s.codec_type === 'video');
  const audio = data.streams.find((s) => s.codec_type === 'audio');
  return (
    !!video &&
    DIRECT_VIDEO_CODECS.has(video.codec_name) &&
    (video.pix_fmt === undefined || video.pix_fmt === 'yuv420p') &&
    !isHdrTransfer(video.color_transfer) &&
    (!audio || DIRECT_AUDIO_CODECS.has(audio.codec_name))
  );
}
