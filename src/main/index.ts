import { basename, join } from 'node:path';
import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import icon from '../../build/icon.png?asset';
import type { Device, DevicesScanner, Renderer } from '../shared/types';
import { type ChromecastDevice, ChromecastDevicesScanner } from './chromecast/DevicesScanner';
import { CastPlayer } from './chromecast/Player';
import { getFfmpegInfo, probe, thumbnail } from './ffmpeg';
import { MediaServer } from './MediaServer';
import { extractSubtitles } from './subtitleExtractor';
import { type UpnpDevice, UpnpDevicesScanner } from './upnp/DevicesScanner';
import { UpnpPlayer } from './upnp/Player';

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
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('update check failed:', err));
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let renderer: Renderer | undefined;
  let currentDeviceId: string | undefined;

  const mainWindow = createWindow();

  app.on('second-instance', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

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

  ipcMain.on('scan', () => {
    for (const s of scanners) s.refresh();
  });

  ipcMain.on('status', () => renderer?.getStatus());

  ipcMain.handle('probe', (_event, path: string) => probe(path));

  ipcMain.handle('ffmpegInfo', () => getFfmpegInfo());

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

        const videoUrl = server.serveVideo(videoPath, {
          transcode: true,
          targetIp,
          duration,
          burnSubtitles,
          videoSize,
        });
        await renderer.loadVideo({ title, videoUrl, duration });
        return;
      }

      // Chromecast path: pass video direct, sidecar WebVTT subs.
      const subtitlesData = await extractSubtitles(videoPath, subtitlesPathOrIndex, 'vtt');
      const videoUrl = server.serveVideo(videoPath, {
        transcode: false,
        targetIp,
        duration,
      });
      const subtitlesUrl = subtitlesData
        ? server.serveSubtitles(subtitlesData, { targetIp, format: 'vtt' })
        : undefined;

      await renderer.loadVideo({
        title,
        videoUrl,
        subtitlesUrl,
        subtitlesFormat: 'vtt',
        duration,
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
    for (const s of scanners) s.close();
    await server.close();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
