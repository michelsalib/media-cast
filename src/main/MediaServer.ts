import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import send from 'send';

export class MediaServer {
  private readonly server: Server;
  private currentVideoPath?: string;
  private currentSubtitlesData?: Buffer;
  private readonly internalIp: string | undefined;
  private sessionHash = randomUUID();

  constructor(private readonly port: number) {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(port);
    this.internalIp = Object.values(networkInterfaces())
      .flat()
      .find((i) => i?.family == 'IPv4' && i.internal == false)?.address;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.currentVideoPath) {
      res.writeHead(404);
      res.end('No video path set');
      return;
    }

    if (req.url == `/${this.sessionHash}/video`) {
      send(req, this.currentVideoPath).pipe(res);

      return;
    } else if (req.url == `/${this.sessionHash}/subs`) {
      if (!this.currentSubtitlesData) {
        res.writeHead(404);
        res.end('No subtitles data set');
        return;
      }

      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'content-length': this.currentSubtitlesData.length,
        'content-type': 'text/vtt;charset=utf-8',
      });

      res.end(this.currentSubtitlesData);

      return;
    }

    res.writeHead(404);
    res.end('Non supported path');
    return;
  }

  async close(): Promise<void> {
    await promisify(this.server.close).bind(this.server)();
  }

  serveVideo(videoPath: string): string {
    this.currentVideoPath = videoPath;

    return `http://${this.internalIp}:${this.port}/${this.sessionHash}/video`;
  }

  serveSubtitles(subtitlesData: Buffer): string {
    this.currentSubtitlesData = subtitlesData;

    return `http://${this.internalIp}:${this.port}/${this.sessionHash}/subs`;
  }
}
