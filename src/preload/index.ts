import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from 'electron';
import {
  EVENT_CHANNELS,
  type EventChannel,
  type EventChannels,
  INVOKE_CHANNELS,
  type InvokeChannel,
  type InvokeChannels,
  SEND_CHANNELS,
  type SendChannel,
  type SendChannels,
} from '../shared/api';

export type MediaCastApi = typeof api;

type Unsubscribe = () => void;
type Subscriber<E> = (callback: (payload: E) => void) => Unsubscribe;
type EventApi = {
  [K in keyof EventChannels as `on${Capitalize<string & K>}`]: Subscriber<EventChannels[K]>;
};

function makeInvoke<K extends InvokeChannel>(channel: K): InvokeChannels[K] {
  return ((...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)) as unknown as InvokeChannels[K];
}

function makeSend<K extends SendChannel>(channel: K): SendChannels[K] {
  return ((...args: unknown[]) => ipcRenderer.send(channel, ...args)) as unknown as SendChannels[K];
}

function makeOn<K extends EventChannel>(channel: K): Subscriber<EventChannels[K]> {
  return (callback) => {
    const handler = (_event: IpcRendererEvent, payload: EventChannels[K]): void =>
      callback(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.off(channel, handler);
    };
  };
}

const invoke = Object.fromEntries(
  INVOKE_CHANNELS.map((c) => [c, makeInvoke(c)])
) as unknown as InvokeChannels;

const send = Object.fromEntries(
  SEND_CHANNELS.map((c) => [c, makeSend(c)])
) as unknown as SendChannels;

const events = Object.fromEntries(
  EVENT_CHANNELS.map((c) => [`on${c[0].toUpperCase()}${c.slice(1)}`, makeOn(c)])
) as unknown as EventApi;

// Renderer-facing API. Auto-derived bindings are the default; the three methods that
// accept `File` are overridden here to coerce to the wire-level `string` path.
const api = {
  ...invoke,
  ...send,
  ...events,

  probe(file: File): ReturnType<InvokeChannels['probe']> {
    return invoke.probe(webUtils.getPathForFile(file));
  },

  thumbnail(file: File, width?: number, height?: number): ReturnType<InvokeChannels['thumbnail']> {
    return invoke.thumbnail(webUtils.getPathForFile(file), width, height);
  },

  load(
    video: File,
    subs?: File | number,
    audioIndex?: number,
    burnSubtitles?: boolean
  ): ReturnType<InvokeChannels['load']> {
    const subsArg = subs instanceof File ? webUtils.getPathForFile(subs) : subs;
    return invoke.load(webUtils.getPathForFile(video), subsArg, audioIndex, burnSubtitles);
  },
};

try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  contextBridge.exposeInMainWorld('api', api);
} catch (error) {
  console.error(error);
}
