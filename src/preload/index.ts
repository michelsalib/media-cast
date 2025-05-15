import { electronAPI } from '@electron-toolkit/preload';
import { MediaStatus } from 'castv2-client';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ChromecastDevice } from '../main/ChromecastDevicesScanner';
import { FFProbeData } from '../main/ffmpeg';

export type MediaCastApi = typeof api;

const api = {
  load(video: File, subs?: File | number): void {
    let filePath = '';
    if (subs instanceof File) {
      filePath = webUtils.getPathForFile(subs);
    }

    ipcRenderer.send('load', webUtils.getPathForFile(video), filePath || subs);
  },

  status(): void {
    ipcRenderer.send('status');
  },

  seek(time: number): void {
    ipcRenderer.send('seek', time);
  },

  play(): void {
    ipcRenderer.send('play');
  },

  pause(): void {
    ipcRenderer.send('pause');
  },

  onStatus(callback: (status: MediaStatus) => void): void {
    ipcRenderer.on('status', (_event, status) => callback(status));
  },

  onScan(callback: (devices: ChromecastDevice[]) => void): void {
    ipcRenderer.on('scan', (_event, status) => callback(status));
    ipcRenderer.send('scan');
  },

  probe(path: File): Promise<FFProbeData> {
    return ipcRenderer.invoke('probe', webUtils.getPathForFile(path));
  },

  thumbnail(path: File, width?: number, height?: number): Promise<Buffer> {
    return ipcRenderer.invoke('thumbnail', webUtils.getPathForFile(path), width, height);
  },

  connect(ip: string): Promise<void> {
    return ipcRenderer.invoke('connect', ip);
  },

  disconnect(): Promise<void> {
    return ipcRenderer.invoke('disconnect');
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
