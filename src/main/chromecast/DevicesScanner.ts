import { Bonjour, type Browser, type Service } from 'bonjour-service';
import type { Device, DevicesScanner } from '../../shared/types';

export interface ChromecastDevice extends Device {
  type: 'chromecast';
  ip: string;
}

export class ChromecastDevicesScanner implements DevicesScanner<ChromecastDevice> {
  readonly type = 'chromecast';
  private readonly bonjour = new Bonjour();
  private readonly browser: Browser;
  private readonly devices = new Map<string, ChromecastDevice>();
  private devicesCallback?: (devices: ChromecastDevice[]) => void;

  constructor() {
    this.browser = this.bonjour.find({ type: 'googlecast' });
    this.browser.on('up', (service) => this.upsert(service));
    this.browser.on('down', (service) => this.remove(service));
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
    this.browser.stop();
    this.bonjour.destroy();
  }
}
