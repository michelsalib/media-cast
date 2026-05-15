import { electronAPI } from '@electron-toolkit/preload';
import type { MediaStatus } from 'castv2-client';
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron';
import type { ChromecastDevice } from '../main/ChromecastDevicesScanner';
import type { FFProbeData } from '../main/ffmpeg';

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

  onStatus(callback: (status: MediaStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: MediaStatus): void => callback(status);
    ipcRenderer.on('status', handler);
    return () => {
      ipcRenderer.off('status', handler);
    };
  },

  onScan(callback: (devices: ChromecastDevice[]) => void): () => void {
    const handler = (_event: IpcRendererEvent, devices: ChromecastDevice[]): void =>
      callback(devices);
    ipcRenderer.on('scan', handler);
    ipcRenderer.send('scan');
    return () => {
      ipcRenderer.off('scan', handler);
    };
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

try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  contextBridge.exposeInMainWorld('api', api);
} catch (error) {
  console.error(error);
}
