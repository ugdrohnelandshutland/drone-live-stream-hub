import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    const info = await stat(filePath);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves the built web UI from `rootDir` with SPA fallback to index.html.
 * Vite puts hashed files under /assets/, which are cached forever; everything else is revalidated.
 */
export function createStaticHandler(rootDir: string) {
  const root = path.resolve(rootDir);
  const indexFile = path.join(root, "index.html");

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (pathname.includes("\0")) {
      res.writeHead(400).end("Bad request");
      return;
    }

    const candidate = path.resolve(root, `.${path.posix.normalize(pathname)}`);
    const insideRoot = candidate === root || candidate.startsWith(root + path.sep);
    let filePath = insideRoot ? candidate : undefined;
    let size = filePath ? await fileSize(filePath) : undefined;

    if (size === undefined && path.extname(pathname) === "") {
      filePath = indexFile; // SPA route such as /drone/m30t-01
      size = await fileSize(indexFile);
    }
    if (filePath === undefined || size === undefined) {
      const builtUi = await fileSize(indexFile);
      res
        .writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        .end(
          builtUi === undefined ? "Web UI not built. Run `npm run build` or use `npm run dev`." : "Not found",
        );
      return;
    }

    const immutable = pathname.startsWith("/assets/");
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "content-length": size,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath)
      .on("error", () => res.destroy())
      .pipe(res);
  };
}
