import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

const SSDP_HOST = '239.255.255.250';
const SSDP_PORT = 1900;
const TARGET = 'urn:schemas-upnp-org:device:MediaRenderer:1';

export interface SsdpResponse {
  location: string;
  usn: string;
  cacheMaxAge: number;
}

interface BoundSocket {
  socket: dgram.Socket;
  ready: boolean;
}

export class SsdpScanner {
  private callback?: (response: SsdpResponse) => void;
  private started = false;
  // One socket per local IPv4 interface, each bound to that interface's address with its
  // own setMulticastInterface. A single shared socket does NOT work on multi-homed hosts:
  // send() is async, so looping setMulticastInterface()+send() over interfaces lets the
  // LAST interface win for every buffered datagram (typically a WSL/VPN virtual adapter),
  // and the M-SEARCH never egresses the real LAN — the renderer is then never discovered.
  private readonly sockets = new Map<string, BoundSocket>();

  start(callback: (response: SsdpResponse) => void): void {
    this.callback = callback;
    this.started = true;
    this.search();
  }

  search(): void {
    if (!this.started) {
      return;
    }
    this.syncSockets();
    for (const bound of this.sockets.values()) {
      if (bound.ready) {
        this.sendSearch(bound.socket);
      }
    }
  }

  // Reconcile the socket set with the current interface list: open a socket for each new
  // LAN address, close ones whose interface disappeared (VPN/adapter toggled). A newly
  // bound socket fires its initial M-SEARCH from its bind callback so it isn't skipped
  // before `ready` flips.
  private syncSockets(): void {
    const current = new Set(localIPv4Addresses());
    for (const [addr, bound] of this.sockets) {
      if (!current.has(addr)) {
        bound.socket.close();
        this.sockets.delete(addr);
      }
    }
    for (const addr of current) {
      if (this.sockets.has(addr)) {
        continue;
      }
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const bound: BoundSocket = { socket, ready: false };
      socket.on('message', (msg) => this.handleMessage(msg));
      socket.on('error', () => {});
      socket.bind(0, addr, () => {
        try {
          socket.setMulticastInterface(addr);
        } catch {}
        bound.ready = true;
        this.sendSearch(socket);
      });
      this.sockets.set(addr, bound);
    }
  }

  private sendSearch(socket: dgram.Socket): void {
    const msg = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_HOST}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ${TARGET}\r\n\r\n`
    );
    socket.send(msg, SSDP_PORT, SSDP_HOST, () => {});
  }

  private handleMessage(msg: Buffer): void {
    const text = msg.toString('utf8');
    if (!text.startsWith('HTTP/1.1 200')) {
      return;
    }

    const headers: Record<string, string> = {};
    for (const line of text.split('\r\n').slice(1)) {
      const idx = line.indexOf(':');
      if (idx === -1) {
        continue;
      }
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }

    if (headers.st !== TARGET || !headers.location || !headers.usn) {
      return;
    }

    const cacheControl = headers['cache-control'] ?? '';
    const m = /max-age\s*=\s*(\d+)/i.exec(cacheControl);
    const cacheMaxAge = m ? Number(m[1]) : 1800;

    this.callback?.({
      location: headers.location,
      usn: headers.usn,
      cacheMaxAge,
    });
  }

  close(): void {
    this.started = false;
    for (const bound of this.sockets.values()) {
      bound.socket.close();
    }
    this.sockets.clear();
  }
}

function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal)
    .map((i) => i?.address)
    .filter((a): a is string => !!a);
}
