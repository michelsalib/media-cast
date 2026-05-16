import http from 'node:http';
import { escapeXml } from './xml';

const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1';

export async function soapCall(
  controlUrl: string,
  action: string,
  args: Record<string, string>,
  serviceType: string = AV_TRANSPORT
): Promise<string> {
  const argXml = Object.entries(args)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join('');

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body>` +
    `<u:${action} xmlns:u="${serviceType}">${argXml}</u:${action}>` +
    `</s:Body>` +
    `</s:Envelope>`;

  console.log(`[soap →] ${action}\n${body}`);

  const url = new URL(controlUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + (url.search ?? ''),
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          SOAPACTION: `"${serviceType}#${action}"`,
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          text += c;
        });
        res.on('end', () => {
          console.log(`[soap ←] ${action} HTTP ${res.statusCode}\n${text}`);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`SOAP ${action} failed: HTTP ${res.statusCode}\n${text}`));
            return;
          }
          // Some renderers return HTTP 200 with a SOAP fault in the body. Surface that.
          const fault = /<(?:s:)?Fault\b[\s\S]*?<\/(?:s:)?Fault>/i.exec(text);
          if (fault) {
            reject(new Error(`SOAP ${action} fault:\n${fault[0]}`));
            return;
          }
          resolve(text);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error(`SOAP ${action} timeout`)));
    req.end(body);
  });
}
