import { app, type BrowserWindow, ipcMain } from 'electron';
import type { AppInfo, DevicesScanner, MainEvents } from '../shared/types';
import { getBinaryPaths, getFfmpegVersion, probe, thumbnail } from './ffmpeg';
import type { PlaybackController } from './PlaybackController';

export interface MainApiDeps {
  controller: PlaybackController;
  scanners: readonly DevicesScanner[];
  updater: { quitAndInstall(): void };
}

// Single source of truth for renderer → main calls. Each key becomes an
// `ipcMain.handle` channel; the renderer client (src/renderer/src/ipc.ts) is
// derived from `MainApi`, so adding a method here is the whole job.
// Params must be structured-cloneable: paths as strings, never `File`.
export function createMainApi({ controller, scanners, updater }: MainApiDeps) {
  return {
    appInfo: async (): Promise<AppInfo> => ({
      appVersion: app.getVersion(),
      ...getBinaryPaths(),
      ffmpegVersion: await getFfmpegVersion(),
    }),
    probe: (videoPath: string) => probe(videoPath),
    thumbnail: (videoPath: string, width?: number, height?: number) =>
      thumbnail(videoPath, width, height),
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
  window.webContents.send(channel, payload);
}
