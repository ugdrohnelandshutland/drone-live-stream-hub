// `npm run bundle` → dist/bundle/server.mjs + dist/bundle/web/ (used by the Dockerfile).
// Run after `npm run build` (needs dist/web).
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleServer, releaseInfo } from "./lib/bundle-server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "bundle");
await rm(out, { recursive: true, force: true });
const info = await releaseInfo(root, new Date());
await bundleServer(root, out, info);
console.log(`dist/bundle: ${info.name} ${info.version} (commit ${info.commit ?? "unknown"})`);
