import dgram from 'node:dgram';

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
    if (!this.socket) {
      return;
    }
    const msg = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_HOST}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 3\r\nST: ${TARGET}\r\n\r\n`
    );
    this.socket.send(msg, SSDP_PORT, SSDP_HOST);
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
