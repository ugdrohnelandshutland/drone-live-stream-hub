/**
 * `npm run dev`: service in watch mode + Vite dev server, with prefixed output.
 * Spawns node directly on the local CLIs, so it works the same on Windows and Linux.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const tsxCli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const viteCli = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const extraArgs = process.argv.slice(2); // e.g. --config path, forwarded to the service

const children: ChildProcess[] = [];

function run(name: string, args: string[]): void {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => console.log(`[${name}] ${line}`));
  }
  child.on("exit", (code) => {
    console.log(`[${name}] exited with ${code}`);
    shutdown(code ?? 1);
  });
}

let stopping = false;
function shutdown(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("service", [tsxCli, "watch", "src/server/index.ts", ...extraArgs]);
run("web", [viteCli]);
