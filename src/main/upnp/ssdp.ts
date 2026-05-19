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

export class SsdpScanner {
  private socket?: dgram.Socket;
  private callback?: (response: SsdpResponse) => void;

  start(callback: (response: SsdpResponse) => void): void {
    this.callback = callback;
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('message', (msg) => this.handleMessage(msg));
    this.socket.on('error', () => {});
    this.socket.bind(0, () => {
      this.search();
    });
  }

  search(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    const msg = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_HOST}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ${TARGET}\r\n\r\n`
    );
    // Without setMulticastInterface, the OS sends M-SEARCH out the default-route NIC only —
    // which is the VPN tunnel on multi-homed hosts. Fan out across every LAN interface so
    // the renderer on the actual LAN gets the query.
    const addrs = localIPv4Addresses();
    if (addrs.length === 0) {
      socket.send(msg, SSDP_PORT, SSDP_HOST);
      return;
    }
    for (const addr of addrs) {
      try {
        socket.setMulticastInterface(addr);
        socket.send(msg, SSDP_PORT, SSDP_HOST);
      } catch {}
    }
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
    this.socket?.close();
    this.socket = undefined;
  }
}

function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal)
    .map((i) => i?.address)
    .filter((a): a is string => !!a);
}
