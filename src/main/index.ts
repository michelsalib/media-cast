import { join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import icon from '../../build/icon.png?asset';
import type { Device, DevicesScanner } from '../shared/types';
import { type ChromecastDevice, ChromecastDevicesScanner } from './chromecast/DevicesScanner';
import { ffmpegPath, ffprobePath, getFfmpegVersion, probe, thumbnail } from './ffmpeg';
import {
  type InvokeHandlers,
  registerInvokeHandlers,
  registerSendHandlers,
  type SendHandlers,
  sendEvent,
} from './ipc';
import { MediaServer } from './MediaServer';
import { PlaybackController } from './PlaybackController';
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
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    icon,
    titleBarOverlay: {
      color: '#181818',
      symbolColor: '#ffffff',
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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
  electronApp.setAppUserModelId('com.electron');

  if (!is.dev) {
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((err) => console.error('update check failed:', err));
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  const mainWindow = createWindow();

  app.on('second-instance', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  const chromecastScanner = new ChromecastDevicesScanner();
  const upnpScanner = new UpnpDevicesScanner();
  const server = new MediaServer(port);

  const knownDevices = new Map<string, KnownDevice>();
  const controller = new PlaybackController(mainWindow, server, () => knownDevices);

  function broadcastDevices(): void {
    const devices: Device[] = [...knownDevices.values()].map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      ip: d.ip,
    }));
    sendEvent(mainWindow, 'scan', devices);
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

  const invokeHandlers: InvokeHandlers = {
    probe: (videoPath) => probe(videoPath),
    appInfo: async () => ({
      appVersion: app.getVersion(),
      ffmpegPath,
      ffprobePath,
      ffmpegVersion: await getFfmpegVersion(),
    }),
    thumbnail: (videoPath, width, height) => thumbnail(videoPath, width, height),
    connect: (deviceId) => controller.connect(deviceId),
    disconnect: () => controller.disconnect(),
    load: (videoPath, subtitlesPathOrIndex) => controller.load(videoPath, subtitlesPathOrIndex),
  };

  const sendHandlers: SendHandlers = {
    play: () => {
      void controller.play();
    },
    pause: () => {
      void controller.pause();
    },
    seek: (time) => {
      void controller.seek(time);
    },
    refresh: () => {
      for (const s of scanners) s.refresh();
    },
  };

  registerInvokeHandlers(invokeHandlers);
  registerSendHandlers(sendHandlers);

  mainWindow.on('closed', async () => {
    await controller.close();
    for (const s of scanners) s.close();
    await server.close();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
