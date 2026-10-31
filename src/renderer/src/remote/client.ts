import type { RemoteApi } from '../../../main/remote/api';
import type { PlayerStatus, TorrentStats } from '../../../shared/types';

// The phone page's counterpart of ipc.ts, over HTTP to RemoteServer. The import above
// MUST stay `import type`: main-process code can't be bundled into a web page.

export type RemoteClient = {
  [K in keyof RemoteApi]: (
    ...args: Parameters<RemoteApi[K]>
  ) => Promise<Awaited<ReturnType<RemoteApi[K]>>>;
};

export type RemoteState = Awaited<ReturnType<RemoteClient['state']>>;

// What RemoteServer relays. The null ones only say "ask for the state again": what plays
// changed (nowPlaying), the screens found (scan), what the window has ready (context).
export interface RemoteEvents {
  status: PlayerStatus;
  torrents: TorrentStats[];
  subtitleScale: number;
  nowPlaying: null;
  scan: null;
  context: null;
}

// URLs are relative to the page, which lives at /r/<token>/.
export const remote = new Proxy({} as RemoteClient, {
  get:
    (_target, method) =>
    async (...args: unknown[]) => {
      const res = await fetch(`api/${String(method)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
      return body;
    },
});

// One EventSource for the page; it reconnects by itself (`retry` is set by the server).
export function connectEvents(
  handlers: {
    [K in keyof RemoteEvents]: (payload: RemoteEvents[K]) => void;
  } & { open: () => void; error: () => void }
): () => void {
  const source = new EventSource('events');
  for (const channel of [
    'status',
    'torrents',
    'subtitleScale',
    'nowPlaying',
    'scan',
    'context',
  ] as const) {
    source.addEventListener(channel, (e) =>
      (handlers[channel] as (payload: unknown) => void)(JSON.parse((e as MessageEvent).data))
    );
  }
  source.onopen = handlers.open;
  source.onerror = handlers.error;
  return () => source.close();
}
