import bonjour, { Browser } from 'bonjour';

export interface ChromecastDevice {
  name: string;
  ip: string;
}

export class ChromecastDevicesScanner {
  private readonly browser: Browser;
  private readonly devices: ChromecastDevice[] = [];
  private devicesCallback?: (devices: ChromecastDevice[]) => void;

  constructor() {
    this.browser = bonjour({ ttl: 30 }).find(
      {
        type: 'googlecast',
      },
      (service) => {
        const device: ChromecastDevice = {
          ip: service.referer.address,
          name: service.txt.fn,
        };
        this.devices.push(device);
        this.devicesCallback?.(this.devices);
      }
    );
  }

  onDevices(devicesCallback: (devices: ChromecastDevice[]) => void): void {
    devicesCallback(this.devices);

    this.devicesCallback = devicesCallback;
  }

  close(): void {
    this.browser.stop();
  }
}
