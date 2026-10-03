import type { MainApi } from '../../main/api';
import type { IpcBridge } from '../../preload';
import type { MainEvents } from '../../shared/types';

// All three imports above MUST stay `import type`: main/preload runtime code would
// break the renderer bundle. Biome's useImportType is the tripwire.

declare global {
  interface Window {
    ipc: IpcBridge;
  }
}

// What a main return value looks like after structured clone.
type Received<T> = T extends Buffer ? Uint8Array : T;

type Promisify<F> = F extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Received<Awaited<R>>>
  : never;

export type RendererApi = { [K in keyof MainApi]: Promisify<MainApi[K]> };

// Every property access is a call to the same-named ipcMain.handle channel.
// Never `await api`, spread it or log it: a `then` lookup would become a call.
export const api = new Proxy({} as RendererApi, {
  get:
    (_target, channel) =>
    (...args: unknown[]) =>
      window.ipc.invoke(String(channel), ...args),
});

export function onEvent<K extends keyof MainEvents>(
  channel: K,
  callback: (payload: MainEvents[K]) => void
): () => void {
  return window.ipc.on(channel, callback as (payload: unknown) => void);
}

export function pathFor(file: File): string {
  return window.ipc.pathFor(file);
}
