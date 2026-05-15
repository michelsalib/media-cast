import { basename, join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import icon from '../../resources/icon.png?asset';
import type { Device, Renderer } from '../shared/types';
import { type ChromecastDevice, ChromecastDevicesScanner } from './ChromecastDevicesScanner';
import { CastPlayer } from './castPlayer';
import { probe, thumbnail } from './ffmpeg';
import { MediaServer } from './MediaServer';
import { extractSubtitles } from './subtitleExtractor';
import { type UpnpDevice, UpnpDevicesScanner } from './UpnpDevicesScanner';
import { UpnpPlayer } from './upnp/UpnpPlayer';

const port = 4004;

type KnownDevice = ChromecastDevice | UpnpDevice;

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
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

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let renderer: Renderer | undefined;
  let currentDeviceId: string | undefined;

  const mainWindow = createWindow();
  const chromecastScanner = new ChromecastDevicesScanner();
  const upnpScanner = new UpnpDevicesScanner();
  const server = new MediaServer(port);

  const knownDevices = new Map<string, KnownDevice>();

  function broadcastDevices(): void {
    const devices: Device[] = [...knownDevices.values()].map((d) => ({
      id: d.id,
      type: d.type,
      name: d.name,
      ip: d.ip,
    }));
    mainWindow.webContents.send('scan', devices);
  }

  chromecastScanner.onDevices((devices) => {
    for (const [id, d] of knownDevices) {
      if (d.type === 'chromecast') knownDevices.delete(id);
    }
    for (const d of devices) knownDevices.set(d.id, d);
    broadcastDevices();
  });

  upnpScanner.onDevices((devices) => {
    for (const [id, d] of knownDevices) {
      if (d.type === 'upnp') knownDevices.delete(id);
    }
    for (const d of devices) knownDevices.set(d.id, d);
    broadcastDevices();
  });

  ipcMain.on('scan', () => {
    chromecastScanner.refresh();
    upnpScanner.refresh();
  });

  ipcMain.on('status', () => renderer?.getStatus());

  ipcMain.handle('probe', (_event, path: string) => probe(path));

  ipcMain.handle('thumbnail', (_event, path: string, width?: number, height?: number) =>
    thumbnail(path, width, height)
  );

  ipcMain.handle('connect', async (_event, deviceId: string) => {
    if (deviceId === currentDeviceId) {
      return;
    }

    const device = knownDevices.get(deviceId);
    if (!device) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    await renderer?.close();

    if (device.type === 'chromecast') {
      renderer = new CastPlayer(device.ip);
    } else {
      renderer = new UpnpPlayer({
        avTransportControlUrl: device.avTransportControlUrl,
        avTransportEventSubUrl: device.avTransportEventSubUrl,
        targetIp: device.ip,
      });
    }

    renderer.onStatus((s) => mainWindow.webContents.send('status', s));
    await renderer.connect();
    currentDeviceId = deviceId;
  });

  ipcMain.handle('disconnect', async () => {
    await renderer?.close();
    renderer = undefined;
    currentDeviceId = undefined;
  });

  ipcMain.on('load', async (_evt, videoPath, subtitlesPathOrIndex) => {
    if (!renderer) {
      return;
    }
    const device = knownDevices.get(currentDeviceId ?? '');
    if (!device?.ip) {
      console.error('load failed: no current device');
      return;
    }

    try {
      const [subtitlesData, probeData] = await Promise.all([
        extractSubtitles(videoPath, subtitlesPathOrIndex),
        probe(videoPath),
      ]);

      const duration = Number(probeData.format.duration);
      const targetIp = device.ip;
      const transcode = device.type === 'upnp';
      const videoUrl = server.serveVideo(videoPath, {
        transcode,
        targetIp,
        duration: Number.isFinite(duration) ? duration : undefined,
      });
      const subtitlesUrl = subtitlesData
        ? server.serveSubtitles(subtitlesData, { targetIp })
        : undefined;

      await renderer.loadVideo({
        title: basename(videoPath),
        videoUrl,
        subtitlesUrl,
        duration: Number.isFinite(duration) ? duration : undefined,
      });
    } catch (err) {
      console.error('load failed:', err);
    }
  });

  ipcMain.on('seek', (_evt, time) => renderer?.seek(time));

  ipcMain.on('pause', () => renderer?.pause());

  ipcMain.on('play', () => renderer?.play());

  mainWindow.on('closed', async () => {
    await renderer?.close();
    chromecastScanner.close();
    upnpScanner.close();
    await server.close();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
