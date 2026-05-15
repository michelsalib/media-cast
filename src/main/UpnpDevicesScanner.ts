import type { Device } from '../shared/types';
import { fetchDescription } from './upnp/description';
import { SsdpScanner } from './upnp/ssdp';

export interface UpnpDevice extends Device {
  type: 'upnp';
  ip: string;
  avTransportControlUrl: string;
  avTransportEventSubUrl: string;
}

interface DeviceRecord extends UpnpDevice {
  expiresAt: number;
}

const SEARCH_INTERVAL_MS = 10_000;
const EVICTION_INTERVAL_MS = 15_000;

export class UpnpDevicesScanner {
  private readonly ssdp = new SsdpScanner();
  private readonly devices = new Map<string, DeviceRecord>();
  private callback?: (devices: UpnpDevice[]) => void;
  private readonly searchTimer: NodeJS.Timeout;
  private readonly evictionTimer: NodeJS.Timeout;

  constructor() {
    this.ssdp.start((resp) => {
      this.handleSsdpResponse(resp.location, resp.cacheMaxAge).catch(() => {});
    });

    this.searchTimer = setInterval(() => this.ssdp.search(), SEARCH_INTERVAL_MS);
    this.evictionTimer = setInterval(() => this.evictExpired(), EVICTION_INTERVAL_MS);
  }

  private async handleSsdpResponse(location: string, cacheMaxAge: number): Promise<void> {
    const desc = await fetchDescription(location);
    if (!desc) {
      return;
    }
    const id = `upnp:${desc.udn}`;
    const previous = this.devices.get(id);
    const record: DeviceRecord = {
      id,
      type: 'upnp',
      name: desc.friendlyName,
      ip: new URL(location).hostname,
      avTransportControlUrl: desc.avTransportControlUrl,
      avTransportEventSubUrl: desc.avTransportEventSubUrl,
      expiresAt: Date.now() + cacheMaxAge * 1000,
    };
    this.devices.set(id, record);
    if (!previous || previous.name !== record.name) {
      this.emit();
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, dev] of this.devices) {
      if (dev.expiresAt < now) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.emit();
    }
  }

  private emit(): void {
    if (!this.callback) {
      return;
    }
    this.callback(
      [...this.devices.values()].map(({ expiresAt: _expiresAt, ...d }): UpnpDevice => d)
    );
  }

  onDevices(callback: (devices: UpnpDevice[]) => void): void {
    this.callback = callback;
    this.emit();
  }

  refresh(): void {
    this.ssdp.search();
    this.emit();
  }

  close(): void {
    clearInterval(this.searchTimer);
    clearInterval(this.evictionTimer);
    this.ssdp.close();
  }
}
