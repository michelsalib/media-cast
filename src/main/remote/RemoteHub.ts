import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { Device, MainEvents, RemoteContext, TrackChange } from '../../shared/types';
import { sendEvent } from '../api';

// Probing, extracting subtitles and a slow TV can make a load take a while; a torrent
// still finding its first pieces even longer.
const LAUNCH_TIMEOUT_MS = 180_000;

// Between the window and the phone remote. The window owns what is ready to play (video,
// subtitles, audio, burn-in) and the connection state, so it reports its context here and
// a phone's Play or track pick is handed back to it to run exactly like its own.
export class RemoteHub {
  private context: RemoteContext = { prepared: null, deviceId: null };
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly window: BrowserWindow) {}

  get current(): RemoteContext {
    return this.context;
  }

  setContext(context: RemoteContext): void {
    this.context = context;
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  launch(device: Device): Promise<void> {
    return this.request('remoteLaunch', (requestId) => ({ requestId, device }));
  }

  // Another audio or subtitle pick for what is ready (not for what plays).
  pickTracks(change: TrackChange): Promise<void> {
    return this.request('remoteTracks', (requestId) => ({ requestId, change }));
  }

  // The window's answer to a request.
  done(requestId: string, error?: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;
    this.requests.delete(requestId);
    clearTimeout(request.timer);
    if (error) request.reject(new Error(error));
    else request.resolve();
  }

  private request<K extends 'remoteLaunch' | 'remoteTracks'>(
    channel: K,
    payload: (requestId: string) => MainEvents[K]
  ): Promise<void> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error('The computer didn’t answer'));
      }, LAUNCH_TIMEOUT_MS);
      this.requests.set(requestId, { resolve, reject, timer });
      sendEvent(this.window, channel, payload(requestId));
    });
  }
}
