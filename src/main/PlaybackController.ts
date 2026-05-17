import { basename } from 'node:path';
import type { BrowserWindow } from 'electron';
import { checkCompat } from '../shared/compat';
import type { Renderer } from '../shared/types';
import type { ChromecastDevice } from './chromecast/DevicesScanner';
import { CastPlayer } from './chromecast/Player';
import { probe } from './ffmpeg';
import { sendEvent } from './ipc';
import type { MediaServer } from './MediaServer';
import { extractSubtitles } from './subtitleExtractor';
import type { UpnpDevice } from './upnp/DevicesScanner';
import { UpnpPlayer } from './upnp/Player';

type KnownDevice = ChromecastDevice | UpnpDevice;

const STATUS_TICK_MS = 1000;

export class PlaybackController {
  private renderer?: Renderer;
  private currentDeviceId?: string;
  private statusInterval?: NodeJS.Timeout;
  private currentlyTranscoded?: boolean;

  constructor(
    private readonly window: BrowserWindow,
    private readonly server: MediaServer,
    private readonly devices: () => ReadonlyMap<string, KnownDevice>
  ) {}

  async connect(deviceId: string): Promise<void> {
    if (deviceId === this.currentDeviceId) {
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
    await renderer.connect();

    this.renderer = renderer;
    this.currentDeviceId = deviceId;
    // Drive a periodic status push from main so the renderer UI updates between
    // player-side events without having to poll over IPC.
    this.statusInterval = setInterval(() => {
      void this.renderer?.getStatus();
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
    if (!this.renderer) {
      throw new Error('Not connected');
    }
    const device = this.devices().get(this.currentDeviceId ?? '');
    if (!device?.ip) {
      throw new Error('No current device');
    }

    const targetIp = device.ip;
    const probeData = await probe(videoPath);
    const rawDuration = Number(probeData.format.duration);
    const duration = Number.isFinite(rawDuration) ? rawDuration : undefined;
    const title = basename(videoPath);
    const videoStream = probeData.streams.find((s) => s.codec_type === 'video');
    const videoSize =
      videoStream?.width && videoStream?.height
        ? { width: videoStream.width, height: videoStream.height }
        : undefined;

    if (device.type === 'upnp') {
      const burnSubtitlesArg =
        burnSubtitles && subtitlesPathOrIndex !== undefined
          ? typeof subtitlesPathOrIndex === 'number'
            ? ({ source: 'internal', videoPath, trackIndex: subtitlesPathOrIndex } as const)
            : ({ source: 'external', path: subtitlesPathOrIndex } as const)
          : undefined;

      const compat = checkCompat({
        videoFileName: videoPath,
        probeData,
        deviceType: 'upnp',
        burnSubtitles,
        audioIndex,
      });

      // Sidecar subtitles: extract to SMI (the format the DIDL builder defaults to —
      // Samsung sec:CaptionInfoEx + pv:subtitleFileUri attrs target this).
      const sidecarData =
        !burnSubtitles && subtitlesPathOrIndex !== undefined
          ? await extractSubtitles(videoPath, subtitlesPathOrIndex, 'smi')
          : undefined;
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
        await this.renderer.loadVideo({
          title,
          videoUrl,
          videoMimeType: 'video/mp4',
          videoTranscoded: false,
          subtitlesUrl,
          subtitlesFormat: subtitlesUrl ? 'smi' : undefined,
          duration,
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
        audioTrackIndex: audioIndex,
      });
      await this.renderer.loadVideo({
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

    // Chromecast is always direct play today.
    this.currentlyTranscoded = false;

    // Chromecast path: pass video direct, sidecar WebVTT subs.
    const subtitlesData = await extractSubtitles(videoPath, subtitlesPathOrIndex, 'vtt');
    const videoUrl = this.server.serveVideo(videoPath, {
      transcode: false,
      targetIp,
      duration,
    });
    const subtitlesUrl = subtitlesData
      ? this.server.serveSubtitles(subtitlesData, { targetIp, format: 'vtt' })
      : undefined;

    await this.renderer.loadVideo({
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
    await this.renderer?.close();
    this.renderer = undefined;
    this.currentDeviceId = undefined;
    this.currentlyTranscoded = undefined;
  }
}
