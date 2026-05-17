import { type BrowserWindow, ipcMain } from 'electron';
import type { EventChannel, EventChannels, InvokeChannels, SendChannels } from '../shared/api';

export type InvokeHandlers = {
  [K in keyof InvokeChannels]: (
    ...args: Parameters<InvokeChannels[K]>
  ) => ReturnType<InvokeChannels[K]> | Awaited<ReturnType<InvokeChannels[K]>>;
};

export type SendHandlers = {
  [K in keyof SendChannels]: (...args: Parameters<SendChannels[K]>) => void;
};

export function registerInvokeHandlers(handlers: InvokeHandlers): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) =>
      (handler as (...a: unknown[]) => unknown)(...args)
    );
  }
}

export function registerSendHandlers(handlers: SendHandlers): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.on(channel, (_event, ...args: unknown[]) =>
      (handler as (...a: unknown[]) => void)(...args)
    );
  }
}

export function sendEvent<K extends EventChannel>(
  window: BrowserWindow,
  channel: K,
  payload: EventChannels[K]
): void {
  window.webContents.send(channel, payload);
}
