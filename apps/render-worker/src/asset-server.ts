import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/**
 * A loopback-only static server for the asset store. The render browser can
 * reach this and nothing else we provide: compositions are data, and assets
 * are files that were type-checked when uploaded.
 */
const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export interface AssetServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startAssetServer(rootDirectory: string): Promise<AssetServer> {
  const root = path.resolve(rootDirectory);
  const server: Server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = path.resolve(root, relative);
      // Refuse traversal outside the asset root.
      if (!filePath.startsWith(root + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) {
        response.writeHead(404).end();
        return;
      }
      const type = MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
      const range = request.headers.range ? /bytes=(\d*)-(\d*)/.exec(request.headers.range) : null;
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        response.writeHead(206, {
          "content-type": type,
          "content-length": end - start + 1,
          "content-range": `bytes ${start}-${end}/${info.size}`,
          "accept-ranges": "bytes",
          "access-control-allow-origin": "*",
        });
        createReadStream(filePath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, { "content-type": type, "content-length": info.size, "accept-ranges": "bytes", "access-control-allow-origin": "*" });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Maps asset ids to served URLs: `<id>.<ext>` files under the asset root. */
export function assetUrlMap(baseUrl: string, assets: ReadonlyArray<{ id: string; fileName: string }>): Record<string, string> {
  return Object.fromEntries(assets.map((asset) => [asset.id, `${baseUrl}/${encodeURIComponent(asset.fileName)}`]));
}
