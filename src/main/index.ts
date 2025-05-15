import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import icon from '../../resources/icon.png?asset';
import { CastPlayer } from './castPlayer';
import { ChromecastDevicesScanner } from './ChromecastDevicesScanner';
import { probe, thumbail } from './ffmpeg';
import { MediaServer } from './MediaServer';
import { extractSubtitles } from './subtitleExtractor';

const port = 4004;

function createWindow(): BrowserWindow {
  // Create the browser window.
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  let chromecast: CastPlayer | undefined;

  const mainWindow = createWindow();
  const chromecastScanner = new ChromecastDevicesScanner();
  const server = new MediaServer(port);

  ipcMain.on('scan', () =>
    chromecastScanner.onDevices((devices) => {
      mainWindow.webContents.send('scan', devices);
    })
  );

  ipcMain.on('status', () => chromecast?.getStatus());
  chromecast?.onStatus((s) => mainWindow.webContents.send('status', s));

  ipcMain.handle('probe', (_event, path: string) => probe(path));

  ipcMain.handle('thumbnail', (_event, path: string, width?: number, height?: number) =>
    thumbail(path, width, height)
  );

  ipcMain.handle('connect', async (_event, ip) => {
    if (ip == chromecast?.host) {
      return;
    }

    await chromecast?.close();

    chromecast = new CastPlayer();

    chromecast.onStatus((s) => mainWindow.webContents.send('status', s));

    await chromecast.connect(ip);
  });

  ipcMain.handle('disconnect', async () => {
    chromecast?.close();
    chromecast = undefined;
  });

  ipcMain.on('load', async (_evt, videoPath, subtitlesPathOrIndex) => {
    if (!chromecast) {
      return;
    }

    const subtitlesData = await extractSubtitles(videoPath, subtitlesPathOrIndex);

    const videoUrl = server.serveVideo(videoPath);
    const subtitlesUrl = subtitlesData ? server.serveSubtitles(subtitlesData) : undefined;

    chromecast.loadVideo(videoPath.split('\\').pop()!, videoUrl, subtitlesUrl);
  });

  ipcMain.on('seek', (_evt, time) => chromecast?.seek(time));

  ipcMain.on('pause', () => chromecast?.pause());

  ipcMain.on('play', () => chromecast?.play());

  mainWindow.on('closed', async () => {
    chromecast?.close();
    await server.close();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
