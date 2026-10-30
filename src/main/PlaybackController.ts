import { basename, extname } from 'node:path';
import type { BrowserWindow } from 'electron';
import { checkCompat } from '../shared/compat';
import { isBitmapSubtitleCodec } from '../shared/subtitles';
import type { Renderer } from '../shared/types';
import { sendEvent } from './api';
import type { ChromecastDevice } from './chromecast/DevicesScanner';
import { CastPlayer } from './chromecast/Player';
import {
  isHdrTransfer,
  parseFrameRate,
  probe,
  probeSubtitleCanvas,
  type SubtitleSource,
} from './ffmpeg';
import type { MediaServer } from './MediaServer';
import { detectSubtitleCharenc, extractSubtitles } from './subtitleExtractor';
import type { UpnpDevice } from './upnp/DevicesScanner';
import { UpnpPlayer } from './upnp/Player';

type KnownDevice = ChromecastDevice | UpnpDevice;

const STATUS_TICK_MS = 1000;

interface LoadOptions {
  subtitlesPathOrIndex?: string | number;
  audioIndex?: number;
  burnSubtitles: boolean;
}

export class PlaybackController {
  private renderer?: Renderer;
  // Snapshot taken at connect: the scan map evicts a TV that misses a few SSDP replies
  // (LG does), which must not break the session it's in the middle of.
  private currentDevice?: KnownDevice;
  private statusInterval?: NodeJS.Timeout;
  private currentlyTranscoded?: boolean;
  private loading = false;
  private polling = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly server: MediaServer,
    private readonly devices: () => ReadonlyMap<string, KnownDevice>
  ) {}

  async connect(deviceId: string): Promise<void> {
    if (deviceId === this.currentDevice?.id) {
      return;
    }

    const device = this.devices().get(deviceId);
    if (!device) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    await this.teardown();

    const renderer: Renderer =
      device.type === 'chromecast'
        ? new CastPlayer(device.ip)
        : new UpnpPlayer({
            avTransportControlUrl: device.avTransportControlUrl,
            avTransportEventSubUrl: device.avTransportEventSubUrl,
            targetIp: device.ip,
          });

    renderer.onStatus((s) =>
      sendEvent(this.window, 'status', { ...s, transcoded: this.currentlyTranscoded })
    );
    try {
      await renderer.connect();
    } catch (err) {
      // A half-open renderer keeps its NOTIFY server or cast socket + heartbeat alive.
      await renderer.close().catch(() => {});
      throw err;
    }

    this.renderer = renderer;
    this.currentDevice = device;
    // Drive a periodic status push from main so the renderer UI updates between
    // player-side events without having to poll over IPC. Skip a tick while the previous
    // poll is still out or a load is talking to the renderer: on a slow TV unguarded
    // ticks pile up behind the 5 s SOAP timeout.
    this.statusInterval = setInterval(() => {
      if (this.polling || this.loading || !this.renderer) {
        return;
      }
      this.polling = true;
      void this.renderer
        .getStatus()
        .catch(() => {})
        .finally(() => {
          this.polling = false;
        });
    }, STATUS_TICK_MS);
  }

  async disconnect(): Promise<void> {
    await this.teardown();
  }

  async load(
    videoPath: string,
    subtitlesPathOrIndex?: string | number,
    audioIndex?: number,
    burnSubtitles = false
  ): Promise<void> {
    if (!this.renderer || !this.currentDevice) {
      throw new Error('Not connected');
    }
    // Concurrent loads would race on the media server's single session.
    if (this.loading) {
      throw new Error('A video is already loading');
    }
    this.loading = true;
    try {
      await this.loadOn(this.renderer, this.currentDevice, videoPath, {
        subtitlesPathOrIndex,
        audioIndex,
        burnSubtitles,
      });
    } finally {
      this.loading = false;
    }
  }

  private async loadOn(
    renderer: Renderer,
    device: KnownDevice,
    videoPath: string,
    { subtitlesPathOrIndex, audioIndex, burnSubtitles }: LoadOptions
  ): Promise<void> {
    const targetIp = device.ip;
    const probeData = await probe(videoPath);
    const rawDuration = Number(probeData.format.duration);
    const duration = Number.isFinite(rawDuration) ? rawDuration : undefined;
    const rawSize = Number(probeData.format.size);
    const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : undefined;
    const title = basename(videoPath);
    const videoStream = probeData.streams.find((s) => s.codec_type === 'video');
    const videoSize =
      videoStream?.width && videoStream?.height
        ? { width: videoStream.width, height: videoStream.height }
        : undefined;
    const subtitleStream =
      typeof subtitlesPathOrIndex === 'number'
        ? probeData.streams.filter((s) => s.codec_type === 'subtitle')[subtitlesPathOrIndex]
        : undefined;

    if (device.type === 'upnp') {
      let burnSubtitlesArg: SubtitleSource | undefined;
      if (burnSubtitles && typeof subtitlesPathOrIndex === 'number') {
        const bitmap = isBitmapSubtitleCodec(subtitleStream?.codec_name)
          ? { canvas: await probeSubtitleCanvas(videoPath, subtitlesPathOrIndex) }
          : undefined;
        burnSubtitlesArg = {
          source: 'internal',
          videoPath,
          trackIndex: subtitlesPathOrIndex,
          bitmap,
        };
      } else if (burnSubtitles && typeof subtitlesPathOrIndex === 'string') {
        burnSubtitlesArg = {
          source: 'external',
          path: subtitlesPathOrIndex,
          charenc: await detectSubtitleCharenc(subtitlesPathOrIndex),
        };
      }

      const compat = checkCompat({
        videoFileName: videoPath,
        probeData,
        deviceType: 'upnp',
        burnSubtitles,
        audioIndex,
        acceptedVideoMimes: device.acceptedVideoMimes,
        acceptedWildcardVideoMimes: device.acceptedWildcardVideoMimes,
      });

      // Sidecar subtitles: extract to SMI (the format the DIDL builder defaults to —
      // Samsung sec:CaptionInfoEx + pv:subtitleFileUri attrs target this).
      const sidecarData =
        !burnSubtitles && subtitlesPathOrIndex !== undefined
          ? await extractSubtitles(videoPath, subtitlesPathOrIndex, 'smi', {
              language: subtitleStream?.tags?.language,
            })
          : undefined;

      // Rotate the URL prefix only now, after the slow probe/extract work: until here the
      // TV may still be playing the previous file and its range requests must keep working.
      this.server.startSession();
      const subtitlesUrl = sidecarData
        ? this.server.serveSubtitles(sidecarData, { targetIp, format: 'smi' })
        : undefined;

      if (!compat.needsTranscoding) {
        this.currentlyTranscoded = false;
        const videoUrl = this.server.serveVideo(videoPath, {
          transcode: false,
          targetIp,
          duration,
        });
        await renderer.loadVideo({
          title,
          videoUrl,
          videoMimeType: compat.videoMimeType,
          videoTranscoded: false,
          subtitlesUrl,
          subtitlesFormat: subtitlesUrl ? 'smi' : undefined,
          duration,
          size,
        });
        return;
      }

      this.currentlyTranscoded = true;
      const videoUrl = this.server.serveVideo(videoPath, {
        transcode: true,
        targetIp,
        duration,
        burnSubtitles: burnSubtitlesArg,
        videoSize,
        frameRate: parseFrameRate(videoStream?.avg_frame_rate),
        audioTrackIndex: audioIndex,
        hdr: isHdrTransfer(videoStream?.color_transfer),
      });
      await renderer.loadVideo({
        title,
        videoUrl,
        videoMimeType: 'video/mpeg',
        videoTranscoded: true,
        subtitlesUrl,
        subtitlesFormat: subtitlesUrl ? 'smi' : undefined,
        duration,
      });
      return;
    }

    // Chromecast is always direct play today, and its receiver has no AVI demuxer.
    if (extname(videoPath).toLowerCase() === '.avi') {
      throw new Error("Chromecast can't play AVI files — cast it to a DLNA TV instead");
    }
    this.currentlyTranscoded = false;

    // Chromecast path: pass video direct, sidecar WebVTT subs.
    const subtitlesData = await extractSubtitles(videoPath, subtitlesPathOrIndex, 'vtt');
    this.server.startSession();
    const videoUrl = this.server.serveVideo(videoPath, {
      transcode: false,
      targetIp,
      duration,
    });
    const subtitlesUrl = subtitlesData
      ? this.server.serveSubtitles(subtitlesData, { targetIp, format: 'vtt' })
      : undefined;

    await renderer.loadVideo({
      title,
      videoUrl,
      subtitlesUrl,
      subtitlesFormat: 'vtt',
      duration,
    });
  }

  async play(): Promise<void> {
    await this.renderer?.play();
  }

  async pause(): Promise<void> {
    await this.renderer?.pause();
  }

  async seek(time: number): Promise<void> {
    await this.renderer?.seek(time);
  }

  async close(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = undefined;
    }
    const renderer = this.renderer;
    // Clear first: a close() that throws (e.g. cast receiver already gone) must not
    // leave a dead renderer behind that every later connect/disconnect trips over.
    this.renderer = undefined;
    this.currentDevice = undefined;
    this.currentlyTranscoded = undefined;
    await renderer?.close().catch((err) => console.warn('[playback] close failed:', err));
  }
}
