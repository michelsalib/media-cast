import type { BrowserWindow } from 'electron';
import type { Device, PlayerStatus, TrackChange } from '../../shared/types';
import { sendEvent } from '../api';
import { appearance } from '../appearance';
import type { PlaybackController } from '../PlaybackController';
import type { PreviewServer } from '../PreviewServer';
import { parseReleaseName } from '../subtitles/releaseName';
import { torrentOf } from '../torrents';
import { sourceName } from '../videoSource';
import type { RemoteHub } from './RemoteHub';

export interface RemoteApiDeps {
  window: BrowserWindow;
  controller: PlaybackController;
  preview: PreviewServer;
  hub: RemoteHub;
  devices: () => Device[];
}

// What a phone may do, and nothing else: every call acts on the video already playing
// or the one the window has ready (launch, pickReadyTracks: named by the id `state` gave,
// so never one picked since), never on a path the phone sends;
// each key is a POST /r/<token>/api/<key> with a JSON array of args;
// the phone client (src/renderer/src/remote/client.ts) is typed from `RemoteApi`.
export function createRemoteApi({ window, controller, preview, hub, devices }: RemoteApiDeps) {
  const playing = () => {
    const now = controller.nowPlaying;
    if (!now) throw new Error('Nothing is playing');
    return now;
  };
  // The video ready, unless it's the one playing (the phone is shown the player instead).
  const ready = () => {
    const prepared = hub.current.prepared;
    return prepared && prepared.videoPath !== controller.nowPlaying?.videoPath
      ? prepared
      : undefined;
  };
  const checkReady = (preparedId: unknown): void => {
    if (!ready()) throw new Error('Nothing is ready on the computer');
    hub.checkPrepared(String(preparedId));
  };

  return {
    state: () => {
      const now = controller.nowPlaying;
      const prepared = ready();
      return {
        accentColor: appearance().accentColor,
        status: (controller.status ?? null) as PlayerStatus | null,
        position: controller.position(),
        nowPlaying: now
          ? {
              fileName: sourceName(now.videoPath),
              release: parseReleaseName(now.videoPath),
              deviceName: now.deviceName,
              infoHash: torrentOf(now.videoPath),
              hasSubtitles: now.subtitlesPathOrIndex !== undefined,
              resizableSubtitles: now.resizableSubtitles,
            }
          : null,
        prepared: prepared
          ? {
              id: hub.currentPreparedId ?? '',
              title: prepared.title,
              details: prepared.details,
              tracks: prepared.tracks,
            }
          : null,
        devices: devices().map(({ id, name, type }) => ({ id, name, type })),
        deviceId: hub.current.deviceId,
        subtitleScale: controller.subtitleScale,
      };
    },
    // Plays what the window has ready (`preparedId`) on `deviceId`, as its own Play would.
    launch: async (preparedId: string, deviceId: string): Promise<void> => {
      checkReady(preparedId);
      const device = devices().find((d) => d.id === deviceId);
      if (!device) throw new Error('That screen can’t be found anymore');
      await hub.launch(device);
    },
    // Picks audio or subtitles for what the window has ready, as if picked there.
    pickReadyTracks: async (preparedId: string, change: TrackChange): Promise<void> => {
      checkReady(preparedId);
      await hub.pickTracks(trackChange(change));
    },
    play: () => controller.play(),
    pause: () => controller.pause(),
    seek: (time: number) => controller.seek(finite(time)),
    setSubtitleScale: (scale: number) => controller.setSubtitleScale(finite(scale)),
    // The window owns the connection state, so it does the stopping.
    stop: (): void => sendEvent(window, 'remoteStop', null),

    // Empty for image subtitles (nothing to show as text) and when there are none.
    cues: () => controller.cues(),
    // Shifts the playing subtitles by `offset` seconds and reloads them on the TV.
    applyOffset: (offset: number) => controller.retime(finite(offset)),
    tracks: () => controller.tracks(),
    changeTracks: (change: TrackChange) => controller.changeTracks(trackChange(change)),
    // Paths relative to the page; the server proxies them to the preview server.
    startPreview: async () => {
      const now = playing();
      const source = await preview.start(now.videoPath, now.audioIndex);
      return {
        directUrl: source.directUrl ? 'preview/video' : undefined,
        transcodeUrl: 'preview/preview.mp4',
        duration: source.duration,
      };
    },
    stopPreview: (): void => preview.stop(),
  };
}

export type RemoteApi = ReturnType<typeof createRemoteApi>;

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Not a number');
  return value;
}

// Only the shapes TrackChange allows: the phone's JSON is untrusted.
function trackChange(value: unknown): TrackChange {
  const { subtitles, audioIndex } = (value ?? {}) as Record<string, unknown>;
  const index = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
  if (
    subtitles !== undefined &&
    subtitles !== null &&
    subtitles !== 'external' &&
    !index(subtitles) &&
    !(typeof subtitles === 'string' && /^file:\d+$/.test(subtitles))
  ) {
    throw new Error('Bad subtitle choice');
  }
  if (audioIndex !== undefined && !index(audioIndex)) throw new Error('Bad audio choice');
  return { subtitles, audioIndex } as TrackChange;
}
