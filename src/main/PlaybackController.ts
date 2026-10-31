import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { checkCompat } from '../shared/compat';
import type { SubtitleCue } from '../shared/subtitleSearch';
import { isBitmapSubtitleCodec, SUBTITLE_SCALES } from '../shared/subtitles';
import { describeTracks } from '../shared/tracks';
import type {
  NowPlaying,
  PlayerStatus,
  PlayingTracks,
  Renderer,
  TrackChange,
} from '../shared/types';
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
import { retimeSubtitles, subtitleCues } from './subtitles/search';
import type { TorrentStore } from './torrents';
import type { UpnpDevice } from './upnp/DevicesScanner';
import { UpnpPlayer } from './upnp/Player';
import { sourceName } from './videoSource';

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
  private current?: NowPlaying;
  private lastStatus?: PlayerStatus;
  private lastStatusAt = 0;
  private scale = loadSubtitleScale();
  private external?: { videoPath: string; path: string };
  // The retimed copy playing in place of `original`, shifted by `offset` seconds.
  private timing?: { videoPath: string; path: string; original: string | number; offset: number };
  private loading = false;
  private polling = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly server: MediaServer,
    private readonly devices: () => ReadonlyMap<string, KnownDevice>,
    private readonly torrents: Pick<TorrentStore, 'subtitlesOf' | 'fetchSubtitles'>
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

    renderer.onStatus((s) => {
      this.lastStatus = { ...s, transcoded: this.currentlyTranscoded };
      this.lastStatusAt = Date.now();
      sendEvent(this.window, 'status', this.lastStatus);
    });
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
    // A DLNA TV draws a subtitle file at its own size: any other size means burning in.
    const burn =
      burnSubtitles ||
      (this.currentDevice.type === 'upnp' &&
        subtitlesPathOrIndex !== undefined &&
        this.scale !== 1);
    try {
      const resizableSubtitles = await this.loadOn(this.renderer, this.currentDevice, videoPath, {
        subtitlesPathOrIndex,
        audioIndex,
        burnSubtitles: burn,
      });
      this.current = {
        videoPath,
        subtitlesPathOrIndex,
        audioIndex,
        burnSubtitles: burn,
        deviceName: this.currentDevice.name,
        resizableSubtitles,
      };
      // A file of the torrent stays offered with the others, not as the added one.
      if (
        typeof subtitlesPathOrIndex === 'string' &&
        subtitlesPathOrIndex !== this.timing?.path &&
        !this.torrents.subtitlesOf(videoPath).some((f) => f.path === subtitlesPathOrIndex)
      ) {
        this.external = { videoPath, path: subtitlesPathOrIndex };
      }
      sendEvent(this.window, 'nowPlaying', this.current);
    } finally {
      this.loading = false;
    }
  }

  get subtitleScale(): number {
    return this.scale;
  }

  // Remembered for the next loads, and applied to the one playing: a Chromecast restyles
  // its track live; a burned-in stream picks it up at the next GET, which a seek to where
  // it is triggers; a DLNA TV drawing a subtitle file reloads with them burned in.
  async setSubtitleScale(scale: number): Promise<void> {
    if (!SUBTITLE_SCALES.some((s) => s.value === scale)) {
      throw new Error('Unknown subtitle size');
    }
    this.scale = scale;
    saveSubtitleScale(scale);
    sendEvent(this.window, 'subtitleScale', scale);
    if (!this.current?.resizableSubtitles || !this.renderer) return;
    if (this.renderer.setSubtitleScale) {
      await this.renderer.setSubtitleScale(scale);
    } else if (!this.current.burnSubtitles) {
      if (scale !== 1) await this.reloadAt({ burnSubtitles: true });
    } else {
      this.server.setSubtitleScale(scale);
      await this.seek(this.position());
    }
  }

  get nowPlaying(): NowPlaying | undefined {
    return this.current;
  }

  get status(): PlayerStatus | undefined {
    return this.lastStatus;
  }

  // Where playback is now: the last status, run forward while playing.
  position(): number {
    const s = this.lastStatus;
    if (!s) return 0;
    const elapsed = s.playerState === 'PLAYING' ? (Date.now() - this.lastStatusAt) / 1000 : 0;
    return s.currentTime + elapsed;
  }

  // The audio and subtitle tracks of the video playing, for switching while it plays (the
  // window and the phone remote label them the same way).
  async tracks(): Promise<PlayingTracks> {
    const current = this.playing();
    const data = await probe(current.videoPath);
    // A retimed copy is shown as the track it was made from.
    const { source: subs, offset } = this.subtitleTiming(current);
    return {
      ...describeTracks({
        streams: data.streams,
        files: this.torrents.subtitlesOf(current.videoPath),
        externalPath: this.externalFor(current.videoPath),
        subtitles: subs,
        audioIndex: current.audioIndex,
      }),
      deviceType: this.currentDevice?.type ?? 'upnp',
      subtitleOffset: offset,
    };
  }

  // Switches audio and/or subtitles of the video playing: a reload where it was.
  async changeTracks(change: TrackChange): Promise<void> {
    const current = this.playing();
    let { subtitlesPathOrIndex, burnSubtitles } = current;
    if (change.subtitles === null) {
      subtitlesPathOrIndex = undefined;
    } else if (change.subtitles === 'external') {
      const external = this.externalFor(current.videoPath);
      if (!external) throw new Error('No subtitle file was added to this video');
      subtitlesPathOrIndex = external;
    } else if (typeof change.subtitles === 'string') {
      const file = this.torrents.subtitlesOf(current.videoPath)[Number(change.subtitles.slice(5))];
      if (!file) throw new Error('Unknown subtitle file');
      subtitlesPathOrIndex = await this.torrents.fetchSubtitles(file.path);
    } else if (typeof change.subtitles === 'number') {
      const stream = (await probe(current.videoPath)).streams.filter(
        (s) => s.codec_type === 'subtitle'
      )[change.subtitles];
      if (!stream) throw new Error('Unknown subtitle track');
      if (isBitmapSubtitleCodec(stream.codec_name)) {
        if (this.currentDevice?.type === 'chromecast') {
          throw new Error('Image subtitles can’t be shown on a Chromecast');
        }
        // A TV can't draw image subtitles from a file: they have to be burned in.
        burnSubtitles = true;
      }
      subtitlesPathOrIndex = change.subtitles;
    }
    await this.reloadAt({
      subtitlesPathOrIndex,
      audioIndex: change.audioIndex ?? current.audioIndex,
      burnSubtitles,
    });
  }

  // Cues of the subtitles playing as text, at their original timing (see retime); empty
  // for image subtitles or none.
  async cues(): Promise<SubtitleCue[]> {
    const current = this.playing();
    const { source } = this.subtitleTiming(current);
    if (source === undefined) return [];
    return subtitleCues(current.videoPath, source).catch(() => []);
  }

  // Plays the subtitles shifted by `offset` seconds from their original timing, reloaded
  // where it was: always from the original (a new SRT in the cache), so offsets don't
  // stack up, and 0 goes back to the original itself.
  async retime(offset: number): Promise<void> {
    const current = this.playing();
    const { source } = this.subtitleTiming(current);
    if (source === undefined) throw new Error('No subtitles are playing');
    if (offset === 0) {
      this.timing = undefined;
      await this.reloadAt({ subtitlesPathOrIndex: source });
      return;
    }
    const saved = await retimeSubtitles(current.videoPath, source, { offset, ratio: 1 });
    this.timing = { videoPath: current.videoPath, path: saved.path, original: source, offset };
    await this.reloadAt({ subtitlesPathOrIndex: saved.path });
  }

  // The subtitles behind what plays, and their shift: a retimed copy maps back to its source.
  private subtitleTiming(current: NowPlaying): {
    source: string | number | undefined;
    offset: number;
  } {
    const t = this.timing;
    return t && t.videoPath === current.videoPath && t.path === current.subtitlesPathOrIndex
      ? { source: t.original, offset: t.offset }
      : { source: current.subtitlesPathOrIndex, offset: 0 };
  }

  private playing(): NowPlaying {
    if (!this.current) throw new Error('Nothing is playing');
    return this.current;
  }

  // The subtitle file last loaded with this video, kept while other tracks are tried.
  private externalFor(videoPath: string): string | undefined {
    return this.external?.videoPath === videoPath ? this.external.path : undefined;
  }

  // Reloads the current video with other options and returns to where it was. A TV only
  // reads subtitles and audio at load (and burned-in subtitles are in the stream itself).
  private async reloadAt(options: Partial<LoadOptions>): Promise<void> {
    const current = this.playing();
    const position = this.position();
    // So the wait below sees the new stream's status, not the old one's.
    this.lastStatus = undefined;
    const next = { ...current, ...options };
    await this.load(
      current.videoPath,
      next.subtitlesPathOrIndex,
      next.audioIndex,
      next.burnSubtitles
    );
    // Seeking before the TV has started the new stream is ignored or fails.
    const started = (): boolean => this.lastStatus?.playerState === 'PLAYING';
    const deadline = Date.now() + 20_000;
    while (!started() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await this.seek(position);
  }

  private async loadOn(
    renderer: Renderer,
    device: KnownDevice,
    videoPath: string,
    { subtitlesPathOrIndex, audioIndex, burnSubtitles }: LoadOptions
  ): Promise<boolean> {
    const targetIp = device.ip;
    const probeData = await probe(videoPath);
    const rawDuration = Number(probeData.format.duration);
    const duration = Number.isFinite(rawDuration) ? rawDuration : undefined;
    const rawSize = Number(probeData.format.size);
    const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : undefined;
    const title = sourceName(videoPath);
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
        // The TV draws the sidecar at its own size; another size reloads it burned in.
        return subtitlesPathOrIndex !== undefined;
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
        subtitleScale: this.scale,
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
      return subtitlesPathOrIndex !== undefined;
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
      subtitleScale: this.scale,
    });
    return !!subtitlesUrl;
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
    this.lastStatus = undefined;
    if (this.current) {
      this.current = undefined;
      sendEvent(this.window, 'nowPlaying', null);
    }
    await renderer?.close().catch((err) => console.warn('[playback] close failed:', err));
  }
}

function scalePath(): string {
  return join(app.getPath('userData'), 'subtitle-size.json');
}

function loadSubtitleScale(): number {
  try {
    const { scale } = JSON.parse(readFileSync(scalePath(), 'utf8'));
    if (SUBTITLE_SCALES.some((s) => s.value === scale)) return scale;
  } catch {
    // Never changed.
  }
  return 1;
}

function saveSubtitleScale(scale: number): void {
  writeFileSync(scalePath(), JSON.stringify({ scale }));
}
