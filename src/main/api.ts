import { app, type BrowserWindow, ipcMain } from 'electron';
import type {
  SubtitleQuery,
  SubtitleSearchResult,
  SubtitleSettingsPatch,
  SubtitleTiming,
} from '../shared/subtitleSearch';
import type {
  AppInfo,
  DevicesScanner,
  MainEvents,
  RemoteContext,
  ThemeSource,
  TrackChange,
} from '../shared/types';
import { appearance, setThemeSource, setTitleBarColors } from './appearance';
import { getBinaryPaths, getFfmpegVersion, probe, thumbnail } from './ffmpeg';
import type { PlaybackController } from './PlaybackController';
import type { PreviewServer } from './PreviewServer';
import type { RemoteHub } from './remote/RemoteHub';
import type { RemoteServer } from './remote/RemoteServer';
import { parseReleaseName } from './subtitles/releaseName';
import {
  downloadSubtitle,
  retimeSubtitles,
  searchSubtitles,
  subtitleCues,
} from './subtitles/search';
import { saveSubtitleSettings, subtitleSettingsView } from './subtitles/settings';
import type { TorrentStore } from './torrents';

export interface MainApiDeps {
  window: BrowserWindow;
  controller: PlaybackController;
  preview: PreviewServer;
  torrents: TorrentStore;
  remote: RemoteServer;
  hub: RemoteHub;
  // The video the TV is being sent, kept when other torrents are dropped.
  playingVideoPath: () => string | undefined;
  scanners: readonly DevicesScanner[];
  updater: { quitAndInstall(): void };
}

// Single source of truth for renderer → main calls. Each key becomes an
// `ipcMain.handle` channel; the renderer client (src/renderer/src/ipc.ts) is
// derived from `MainApi`, so adding a method here is the whole job.
// Params must be structured-cloneable: paths as strings, never `File`.
export function createMainApi({
  window,
  controller,
  preview,
  torrents,
  remote,
  hub,
  playingVideoPath,
  scanners,
  updater,
}: MainApiDeps) {
  return {
    appearance: () => appearance(),
    setThemeSource: (themeSource: ThemeSource): void => setThemeSource(themeSource),
    setTitleBarColors: (color: string, symbolColor: string): void =>
      setTitleBarColors(window, color, symbolColor),
    appInfo: async (): Promise<AppInfo> => ({
      appVersion: app.getVersion(),
      ...getBinaryPaths(),
      ffmpegVersion: await getFfmpegVersion(),
    }),
    // A magnet link or a .torrent/.magnet path. Its videos come back with loopback URLs
    // as paths, usable wherever a video path is. Torrents other than this one, the one
    // playing and `keepVideoPath`'s are dropped with their pieces.
    openTorrent: async (source: string, keepVideoPath?: string) => {
      const contents = await torrents.open(source);
      torrents.prune([contents.videos[0].path, playingVideoPath(), keepVideoPath]);
      return contents;
    },
    // The subtitle files in a torrent video's torrent, listed; one is downloaded to its
    // `path` by fetchTorrentSubtitles before use.
    torrentSubtitles: (videoPath: string) => torrents.subtitlesOf(videoPath),
    fetchTorrentSubtitles: (path: string) => torrents.fetchSubtitles(path),
    probe: (videoPath: string) => probe(videoPath),
    thumbnail: (videoPath: string, width?: number) => thumbnail(videoPath, width),
    connect: (deviceId: string) => controller.connect(deviceId),
    disconnect: () => controller.disconnect(),
    load: (
      videoPath: string,
      subtitlesPathOrIndex?: string | number,
      audioIndex?: number,
      burnSubtitles?: boolean,
      normalizeAudio?: boolean
    ) =>
      controller.load(videoPath, subtitlesPathOrIndex, audioIndex, burnSubtitles, normalizeAudio),
    play: () => controller.play(),
    pause: () => controller.pause(),
    seek: (time: number) => controller.seek(time),
    subtitleScale: () => controller.subtitleScale,
    setSubtitleScale: (scale: number) => controller.setSubtitleScale(scale),
    refresh: (): void => {
      for (const s of scanners) s.refresh();
    },
    quitAndInstall: (): void => updater.quitAndInstall(),

    // Phone remote (see remote/RemoteServer.ts).
    remoteInfo: () => remote.info(),
    setRemoteEnabled: (enabled: boolean) => remote.setEnabled(enabled),
    newRemoteLink: () => remote.newLink(),
    // While playing: the same switches as the phone remote's.
    playingTracks: () => controller.tracks(),
    changeTracks: (change: TrackChange) => controller.changeTracks(change),
    playingCues: () => controller.cues(),
    retimePlaying: (offset: number) => controller.retime(offset),
    // The window reports what it has ready, and how a phone-started Play went.
    setRemoteContext: (context: RemoteContext): void => hub.setContext(context),
    remoteDone: (requestId: string, error?: string): void => hub.done(requestId, error),

    // Online subtitles. Downloads and resyncs land in a cache dir and come back as a
    // path the renderer treats like a dropped sidecar file.
    guessSubtitleQuery: (videoPath: string) => parseReleaseName(videoPath),
    subtitleSettings: () => subtitleSettingsView(),
    saveSubtitleSettings: (patch: SubtitleSettingsPatch) => saveSubtitleSettings(patch),
    searchSubtitles: (videoPath: string, query: SubtitleQuery) => searchSubtitles(videoPath, query),
    downloadSubtitle: (
      result: SubtitleSearchResult,
      query: Pick<SubtitleQuery, 'season' | 'episode'>
    ) => downloadSubtitle(result, query),
    subtitleCues: (videoPath: string, subtitlesPathOrIndex: string | number) =>
      subtitleCues(videoPath, subtitlesPathOrIndex),
    retimeSubtitles: (
      videoPath: string,
      subtitlesPathOrIndex: string | number,
      timing: SubtitleTiming
    ) => retimeSubtitles(videoPath, subtitlesPathOrIndex, timing),
    startPreview: (videoPath: string, audioIndex?: number) => preview.start(videoPath, audioIndex),
    stopPreview: (): void => preview.stop(),
  };
}

export type MainApi = ReturnType<typeof createMainApi>;

// Register once (ipcMain.handle throws on a second handler for the same channel).
export function registerMainApi(api: MainApi): void {
  for (const [channel, handler] of Object.entries(api)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) =>
      (handler as (...a: unknown[]) => unknown)(...args)
    );
  }
}

type EventTap = <K extends keyof MainEvents>(channel: K, payload: MainEvents[K]) => void;
const eventTaps = new Set<EventTap>();

// Sees every push sent to the window (the phone remote relays them).
export function tapEvents(tap: EventTap): () => void {
  eventTaps.add(tap);
  return () => eventTaps.delete(tap);
}

export function sendEvent<K extends keyof MainEvents>(
  window: BrowserWindow,
  channel: K,
  payload: MainEvents[K]
): void {
  for (const tap of eventTaps) tap(channel, payload);
  // Renderer events (GENA NOTIFY, cast status) can still arrive between the window
  // closing and shutdown finishing; send() on a destroyed window throws.
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}
