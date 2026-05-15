import http from 'node:http';
import { extractTag } from './xml';

export interface DeviceDescription {
  friendlyName: string;
  udn: string;
  avTransportControlUrl: string;
  avTransportEventSubUrl: string;
}

export async function fetchDescription(url: string): Promise<DeviceDescription | undefined> {
  const xml = await httpGet(url);
  return parseDescription(xml, url);
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

function parseDescription(xml: string, descriptionUrl: string): DeviceDescription | undefined {
  const friendlyName = extractTag(xml, 'friendlyName') ?? 'Unknown';
  const udn = extractTag(xml, 'UDN');
  if (!udn) {
    return undefined;
  }

  const avtService = findService(xml, 'urn:schemas-upnp-org:service:AVTransport:1');
  if (!avtService) {
    return undefined;
  }

  const controlUrl = extractTag(avtService, 'controlURL');
  const eventSubUrl = extractTag(avtService, 'eventSubURL');
  if (!controlUrl || !eventSubUrl) {
    return undefined;
  }

  const base = new URL(descriptionUrl);
  return {
    friendlyName: friendlyName.trim(),
    udn: udn.trim(),
    avTransportControlUrl: new URL(controlUrl.trim(), base).toString(),
    avTransportEventSubUrl: new URL(eventSubUrl.trim(), base).toString(),
  };
}

function findService(xml: string, type: string): string | undefined {
  const services = xml.match(/<service\b[^>]*>[\s\S]*?<\/service>/gi) ?? [];
  return services.find((s) => extractTag(s, 'serviceType')?.trim() === type);
}
