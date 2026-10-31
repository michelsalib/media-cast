import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';

log.initialize();
Object.assign(console, log.functions);

// Route renderer logs to a separate file. The renderer creates a logger with this
// same `logId`; electron-log's IPC transport tags messages with it so main routes
// them through this logger instead of the default one.
const rendererLog = log.create({ logId: 'renderer' });
rendererLog.transports.file.fileName = 'renderer.log';

import icon from '../../build/icon.png?asset';
import type { Device, DevicesScanner } from '../shared/types';
import { resolveBundledBinary } from './binaryResolver';
import { type ChromecastDevice, ChromecastDevicesScanner } from './chromecast/DevicesScanner';
import { configureBinaries } from './ffmpeg';

configureBinaries({
  ffmpegPath: resolveBundledBinary('ffmpeg') ?? 'ffmpeg',
  ffprobePath: resolveBundledBinary('ffprobe') ?? 'ffprobe',
});

import { createMainApi, registerMainApi, sendEvent } from './api';
import { initialWindowColors, loadThemeSource, onAccentColorChanged } from './appearance';
import { MediaServer } from './MediaServer';
import { PlaybackController } from './PlaybackController';
import { PreviewServer } from './PreviewServer';
import { createRemoteApi } from './remote/api';
import { RemoteHub } from './remote/RemoteHub';
import { RemoteServer } from './remote/RemoteServer';
import { TorrentStore } from './torrents';
import { type UpnpDevice, UpnpDevicesScanner } from './upnp/DevicesScanner';

const port = 4004;

type KnownDevice = ChromecastDevice | UpnpDevice;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 560,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    icon,
    backgroundColor: initialWindowColors().color,
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { ...initialWindowColors(), height: 32 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      devTools: is.dev,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron.app');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  loadThemeSource();
  const mainWindow = createWindow();
  onAccentColorChanged((color) => sendEvent(mainWindow, 'accentColor', color));

  if (!is.dev) {
    autoUpdater.on('update-downloaded', () => {
      sendEvent(mainWindow, 'updateReady', null);
    });
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((err) => console.error('update check failed:', err));
  }

  app.on('second-instance', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  const chromecastScanner = new ChromecastDevicesScanner();
  const upnpScanner = new UpnpDevicesScanner();
  const server = new MediaServer(port);
  const preview = new PreviewServer();
  const torrents = new TorrentStore(join(app.getPath('temp'), 'media-cast-torrents'));
  const torrentTicker = setInterval(() => {
    if (torrents.size > 0) sendEvent(mainWindow, 'torrents', torrents.stats());
  }, 1000);

  const knownDevices = new Map<string, KnownDevice>();
  const controller = new PlaybackController(mainWindow, server, () => knownDevices);

  function listDevices(): Device[] {
    return [...knownDevices.values()].map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      ip: d.ip,
      ...(d.type === 'upnp'
        ? {
            acceptedVideoMimes: d.acceptedVideoMimes,
            acceptedWildcardVideoMimes: d.acceptedWildcardVideoMimes,
          }
        : {}),
    }));
  }

  function broadcastDevices(): void {
    sendEvent(mainWindow, 'scan', listDevices());
  }

  function wireScanner<D extends KnownDevice>(scanner: DevicesScanner<D>): void {
    scanner.onDevices((devices) => {
      for (const [id, d] of knownDevices) {
        if (d.type === scanner.type) knownDevices.delete(id);
      }
      for (const d of devices) knownDevices.set(d.id, d);
      broadcastDevices();
    });
  }
  wireScanner(chromecastScanner);
  wireScanner(upnpScanner);

  const scanners: DevicesScanner[] = [chromecastScanner, upnpScanner];
  const hub = new RemoteHub(mainWindow);
  const remote = new RemoteServer(
    createRemoteApi({ window: mainWindow, controller, preview, hub, devices: listDevices }),
    controller,
    preview,
    hub
  );

  registerMainApi(
    createMainApi({
      window: mainWindow,
      controller,
      preview,
      torrents,
      remote,
      hub,
      playingVideoPath: () => server.videoPath,
      scanners,
      updater: autoUpdater,
    })
  );

  // Stop + UNSUBSCRIBE must reach the renderer, or the TV is left on a dead URL and
  // keeps NOTIFYing a closed port until the subscription expires. Run once, and hold
  // the quit until it's done — bounded, as server.close() waits on open TV sockets.
  let shutdown: Promise<void> | undefined;
  const shutDown = (): Promise<void> => {
    shutdown ??= Promise.race([
      (async () => {
        await controller.close().catch((err) => console.error('controller close failed:', err));
        for (const s of scanners) s.close();
        clearInterval(torrentTicker);
        remote.close();
        server.closeAllConnections();
        await Promise.all([server.close(), preview.close(), torrents.close()]);
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    return shutdown;
  };

  mainWindow.on('closed', () => void shutDown());

  let readyToQuit = false;
  app.on('before-quit', (event) => {
    if (readyToQuit) return;
    event.preventDefault();
    void shutDown().finally(() => {
      readyToQuit = true;
      app.quit();
    });
  });
});

// Quit on every platform, macOS included: closing the window shuts the playback, scanning
// and media services down for good, so a window reopened from the dock would be inert.
app.on('window-all-closed', () => {
  app.quit();
});
