import { basename } from 'node:path';
import type { BrowserWindow } from 'electron';
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

    renderer.onStatus((s) => sendEvent(this.window, 'status', s));
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

  async load(videoPath: string, subtitlesPathOrIndex?: string | number): Promise<void> {
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
      // Burn subtitles into the video stream — most reliable on old DLNA TVs.
      const burnSubtitles =
        subtitlesPathOrIndex === undefined
          ? undefined
          : typeof subtitlesPathOrIndex === 'number'
            ? ({ source: 'internal', videoPath, trackIndex: subtitlesPathOrIndex } as const)
            : ({ source: 'external', path: subtitlesPathOrIndex } as const);

      const videoUrl = this.server.serveVideo(videoPath, {
        transcode: true,
        targetIp,
        duration,
        burnSubtitles,
        videoSize,
      });
      await this.renderer.loadVideo({ title, videoUrl, duration });
      return;
    }

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
  }
}
