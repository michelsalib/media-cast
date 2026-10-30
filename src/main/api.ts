import { app, type BrowserWindow, ipcMain } from 'electron';
import type {
  SubtitleQuery,
  SubtitleSearchResult,
  SubtitleSettingsPatch,
  SubtitleTiming,
} from '../shared/subtitleSearch';
import type { AppInfo, DevicesScanner, MainEvents } from '../shared/types';
import { getBinaryPaths, getFfmpegVersion, probe, thumbnail } from './ffmpeg';
import type { PlaybackController } from './PlaybackController';
import type { PreviewServer } from './PreviewServer';
import { parseReleaseName } from './subtitles/releaseName';
import {
  downloadSubtitle,
  retimeSubtitles,
  searchSubtitles,
  subtitleCues,
} from './subtitles/search';
import { saveSubtitleSettings, subtitleSettingsView } from './subtitles/settings';

export interface MainApiDeps {
  controller: PlaybackController;
  preview: PreviewServer;
  scanners: readonly DevicesScanner[];
  updater: { quitAndInstall(): void };
}

// Single source of truth for renderer → main calls. Each key becomes an
// `ipcMain.handle` channel; the renderer client (src/renderer/src/ipc.ts) is
// derived from `MainApi`, so adding a method here is the whole job.
// Params must be structured-cloneable: paths as strings, never `File`.
export function createMainApi({ controller, preview, scanners, updater }: MainApiDeps) {
  return {
    appInfo: async (): Promise<AppInfo> => ({
      appVersion: app.getVersion(),
      ...getBinaryPaths(),
      ffmpegVersion: await getFfmpegVersion(),
    }),
    probe: (videoPath: string) => probe(videoPath),
    thumbnail: (videoPath: string, width?: number) => thumbnail(videoPath, width),
    connect: (deviceId: string) => controller.connect(deviceId),
    disconnect: () => controller.disconnect(),
    load: (
      videoPath: string,
      subtitlesPathOrIndex?: string | number,
      audioIndex?: number,
      burnSubtitles?: boolean
    ) => controller.load(videoPath, subtitlesPathOrIndex, audioIndex, burnSubtitles),
    play: () => controller.play(),
    pause: () => controller.pause(),
    seek: (time: number) => controller.seek(time),
    refresh: (): void => {
      for (const s of scanners) s.refresh();
    },
    quitAndInstall: (): void => updater.quitAndInstall(),

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

export function sendEvent<K extends keyof MainEvents>(
  window: BrowserWindow,
  channel: K,
  payload: MainEvents[K]
): void {
  // Renderer events (GENA NOTIFY, cast status) can still arrive between the window
  // closing and shutdown finishing; send() on a destroyed window throws.
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(channel, payload);
}
