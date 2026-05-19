import { networkInterfaces } from 'node:os';
import { Bonjour, type Browser, type Service } from 'bonjour-service';
import type { Device, DevicesScanner } from '../../shared/types';

export interface ChromecastDevice extends Device {
  type: 'chromecast';
  ip: string;
}

// bonjour-service forwards `interface` to multicast-dns, which uses it as the outbound multicast
// NIC. The type is `Partial<ServiceConfig>` upstream and doesn't surface this option.
type BonjourOpts = ConstructorParameters<typeof Bonjour>[0] & { interface?: string };

export class ChromecastDevicesScanner implements DevicesScanner<ChromecastDevice> {
  readonly type = 'chromecast';
  // One Bonjour per LAN interface — multicast-dns only sets the outbound NIC once per instance,
  // so a single Bonjour sends queries down the default route (the VPN tunnel on multi-homed hosts)
  // and never reaches the LAN Chromecast.
  private readonly instances: { bonjour: Bonjour; browser: Browser }[] = [];
  private readonly devices = new Map<string, ChromecastDevice>();
  private devicesCallback?: (devices: ChromecastDevice[]) => void;

  constructor() {
    const addrs = localIPv4Addresses();
    const optsList: BonjourOpts[] = addrs.length > 0 ? addrs.map((a) => ({ interface: a })) : [{}];
    for (const opts of optsList) {
      const bonjour = new Bonjour(opts);
      const browser = bonjour.find({ type: 'googlecast' });
      browser.on('up', (service) => this.upsert(service));
      browser.on('down', (service) => this.remove(service));
      this.instances.push({ bonjour, browser });
    }
  }

  private upsert(service: Service): void {
    const ip = service.referer?.address;
    if (!ip) {
      return;
    }
    this.devices.set(ip, {
      id: `chromecast:${ip}`,
      type: 'chromecast',
      name: service.txt?.fn ?? service.name,
      ip,
    });
    this.emit();
  }

  private remove(service: Service): void {
    const ip = service.referer?.address;
    if (!ip) {
      return;
    }
    if (this.devices.delete(ip)) {
      this.emit();
    }
  }

  private emit(): void {
    this.devicesCallback?.([...this.devices.values()]);
  }

  onDevices(devicesCallback: (devices: ChromecastDevice[]) => void): void {
    this.devicesCallback = devicesCallback;
    this.emit();
  }

  refresh(): void {
    this.emit();
  }

  close(): void {
    for (const { bonjour, browser } of this.instances) {
      browser.stop();
      bonjour.destroy();
    }
    this.instances.length = 0;
  }
}

function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === 'IPv4' && !i.internal)
    .map((i) => i?.address)
    .filter((a): a is string => !!a);
}
