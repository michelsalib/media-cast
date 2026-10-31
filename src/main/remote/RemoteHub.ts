import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { Device, RemoteContext } from '../../shared/types';
import { sendEvent } from '../api';

// Probing, extracting subtitles and a slow TV can make a load take a while; a torrent
// still finding its first pieces even longer.
const LAUNCH_TIMEOUT_MS = 180_000;

// Between the window and the phone remote. The window owns what is ready to play (video,
// subtitles, audio, burn-in) and the connection state, so it reports its context here and
// a phone's Play is handed back to it to run exactly like its own Play button.
export class RemoteHub {
  private context: RemoteContext = { prepared: null, deviceId: null };
  private readonly listeners = new Set<() => void>();
  private readonly launches = new Map<
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
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.launches.delete(requestId);
        reject(new Error('The computer didn’t answer'));
      }, LAUNCH_TIMEOUT_MS);
      this.launches.set(requestId, { resolve, reject, timer });
      sendEvent(this.window, 'remoteLaunch', { requestId, device });
    });
  }

  launchDone(requestId: string, error?: string): void {
    const launch = this.launches.get(requestId);
    if (!launch) return;
    this.launches.delete(requestId);
    clearTimeout(launch.timer);
    if (error) launch.reject(new Error(error));
    else launch.resolve();
  }
}
