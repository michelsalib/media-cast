import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { pickLocalIpFor } from '../network';

export interface EventingOptions {
  eventSubUrl: string;
  targetIp: string;
  onEvent: (xml: string) => void;
}

export class UpnpEventing {
  private server?: http.Server;
  private port = 0;
  private readonly path: string;
  private sid?: string;
  private renewalTimer?: NodeJS.Timeout;
  private readonly callbackIp: string;

  constructor(private readonly options: EventingOptions) {
    this.path = `/upnp/${randomUUID()}`;
    this.callbackIp = pickLocalIpFor(options.targetIp);
  }

  async start(): Promise<void> {
    await this.startServer();
    await this.subscribe();
  }

  async stop(): Promise<void> {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = undefined;
    }
    if (this.sid) {
      await this.upnpRequest('UNSUBSCRIBE', { SID: this.sid }).catch(() => {});
      this.sid = undefined;
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = undefined;
    }
  }

  private startServer(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.method === 'NOTIFY' && req.url === this.path) {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            this.options.onEvent(body);
            res.writeHead(200);
            res.end();
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      this.server.listen(0, () => {
        const addr = this.server?.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  private async subscribe(): Promise<void> {
    const callback = `<http://${this.callbackIp}:${this.port}${this.path}>`;
    const res = await this.upnpRequest('SUBSCRIBE', {
      CALLBACK: callback,
      NT: 'upnp:event',
      TIMEOUT: 'Second-300',
    });
    this.sid = typeof res.headers.sid === 'string' ? res.headers.sid : undefined;
    this.scheduleRenewal(res.headers.timeout);
  }

  private async renew(): Promise<void> {
    if (!this.sid) {
      return;
    }
    try {
      const res = await this.upnpRequest('SUBSCRIBE', {
        SID: this.sid,
        TIMEOUT: 'Second-300',
      });
      this.scheduleRenewal(res.headers.timeout);
    } catch {
      this.sid = undefined;
      this.subscribe().catch(() => {});
    }
  }

  private scheduleRenewal(timeoutHeader: string | string[] | undefined): void {
    const value = Array.isArray(timeoutHeader) ? timeoutHeader[0] : timeoutHeader;
    const seconds = Number((value ?? '').replace(/[^\d]/g, '')) || 300;
    const delay = Math.max(30, seconds - 30) * 1000;
    this.renewalTimer = setTimeout(() => this.renew(), delay);
  }

  private upnpRequest(
    method: string,
    headers: Record<string, string>
  ): Promise<{ headers: http.IncomingHttpHeaders }> {
    const u = new URL(this.options.eventSubUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          method,
          hostname: u.hostname,
          port: u.port || 80,
          path: u.pathname + (u.search ?? ''),
          headers,
        },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`UPnP ${method} failed: HTTP ${res.statusCode}`));
          } else {
            resolve({ headers: res.headers });
          }
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error(`UPnP ${method} timeout`)));
      req.end();
    });
  }
}
