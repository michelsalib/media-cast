import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron';

// Generic bridge: no per-method code. Typing lives in src/renderer/src/ipc.ts,
// derived from the main handler map in src/main/api.ts. Only `electron` is
// imported here, which keeps the preload sandbox-compatible.
const bridge = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),

  on: (channel: string, callback: (payload: unknown) => void): (() => void) => {
    // One listener per subscription so `off` removes exactly this one. Never forward
    // the IpcRendererEvent (not cloneable, exposes `sender`).
    const listener = (_event: IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  },

  // `File` can't cross IPC; webUtils only exists in preload.
  pathFor: (file: File): string => webUtils.getPathForFile(file),
};

export type IpcBridge = typeof bridge;

contextBridge.exposeInMainWorld('ipc', bridge);
