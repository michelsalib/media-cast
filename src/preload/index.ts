import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron';
import type { FFProbeData } from '../main/ffmpeg';
import type { Device, FfmpegInfo, PlayerStatus } from '../shared/types';

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

  onStatus(callback: (status: PlayerStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: PlayerStatus): void => callback(status);
    ipcRenderer.on('status', handler);
    return () => {
      ipcRenderer.off('status', handler);
    };
  },

  onScan(callback: (devices: Device[]) => void): () => void {
    const handler = (_event: IpcRendererEvent, devices: Device[]): void => callback(devices);
    ipcRenderer.on('scan', handler);
    ipcRenderer.send('scan');
    return () => {
      ipcRenderer.off('scan', handler);
    };
  },

  refresh(): void {
    ipcRenderer.send('scan');
  },

  probe(path: File): Promise<FFProbeData> {
    return ipcRenderer.invoke('probe', webUtils.getPathForFile(path));
  },

  ffmpegInfo(): Promise<FfmpegInfo> {
    return ipcRenderer.invoke('ffmpegInfo');
  },

  thumbnail(path: File, width?: number, height?: number): Promise<Buffer> {
    return ipcRenderer.invoke('thumbnail', webUtils.getPathForFile(path), width, height);
  },

  connect(deviceId: string): Promise<void> {
    return ipcRenderer.invoke('connect', deviceId);
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
