import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createService, type Service } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";
import { createLogger } from "../../src/server/logger.js";
import type { AdminState } from "../../src/shared/admin.js";
import { CloseCode } from "../../src/shared/close-codes.js";
import { SseClient } from "../helpers/sse.js";
import { waitFor } from "../helpers/wait.js";

const logger = createLogger({ name: "test", level: process.env["LOG_LEVEL"] ?? "silent" });
const config: AppConfig = {
  rtmpPort: 1935,
  httpPort: 8080,
  adminPin: "4711",
  drones: [{ id: "m30t-01", name: "Drohne 1" }],
};
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

async function startService(cfg: AppConfig, dataDir?: string): Promise<Service> {
  const staticDir = await mkdtemp(path.join(os.tmpdir(), "dlsh-web-"));
  await writeFile(path.join(staticDir, "index.html"), "<html>ui</html>");
  const service = createService(cfg, logger, {
    rtmpPort: 0,
    httpPort: 0,
    host: "127.0.0.1",
    staticDir,
    probeIntervalMs: 0,
    ...(dataDir !== undefined ? { dataDir } : {}),
  });
  await service.start();
  return service;
}

/** A WebSocket that resolves with its close code, or "open" if it is still open after `ms`. */
function watch(url: string, cookie: string, ms = 500): Promise<number | "open"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { cookie, "user-agent": TABLET_UA } });
    const timer = setTimeout(() => {
      ws.close();
      resolve("open");
    }, ms);
    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    ws.on("error", () => undefined);
  });
}

describe("admin API (ADR 0012)", () => {
  let service: Service;
  let base: string;
  let dataDir: string;
  let adminCookie = "";

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "dlsh-data-"));
    service = await startService(config, dataDir);
    base = `http://127.0.0.1:${service.httpPort}`;
  });

  afterAll(async () => {
    await service?.stop();
  });

  const post = (pathname: string, body: unknown = {}, cookie = adminCookie) =>
    fetch(base + pathname, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  const state = async (): Promise<AdminState> =>
    (await (
      await fetch(`${base}/api/admin/state`, { headers: { cookie: adminCookie } })
    ).json()) as AdminState;

  it("gives a browser its client id with the page", async () => {
    const res = await fetch(`${base}/drone/m30t-01`);
    expect(res.headers.get("set-cookie")).toMatch(
      /^dlsh_client=[\w-]{16,}; Path=\/; .*HttpOnly; SameSite=Lax/,
    );
    const again = await fetch(`${base}/`, { headers: { cookie: "dlsh_client=abcdefghijklmnopqrstuv" } });
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("requires the PIN and locks out after wrong ones", async () => {
    expect((await fetch(`${base}/api/admin/state`)).status).toBe(401);
    expect((await post("/api/admin/login", { pin: "0000" }, "")).status).toBe(401);
    // Without the JSON content type (e.g. a cross-site form) nothing happens.
    const form = await fetch(`${base}/api/admin/login`, { method: "POST", body: "pin=4711" });
    expect(form.status).toBe(400);
    expect((await fetch(`${base}/api/drones`, { method: "POST" })).status).toBe(405);

    const ok = await post("/api/admin/login", { pin: "4711" }, "");
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly; SameSite=Strict/);
    adminCookie = setCookie.split(";")[0] ?? "";
    expect((await fetch(`${base}/api/admin/state`, { headers: { cookie: adminCookie } })).status).toBe(200);
  });

  it("lists a device, pauses it with 4003 and releases it again", async () => {
    const tablet = "dlsh_client=tablet-0123456789abcdef";
    const events = new SseClient(`${base}/api/events`, { cookie: tablet, "user-agent": TABLET_UA });
    const ws = new WebSocket(`ws://127.0.0.1:${service.httpPort}/ws/live/m30t-01`, {
      headers: { cookie: tablet, "user-agent": TABLET_UA },
    });
    const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
    await new Promise((resolve) => ws.on("open", resolve));
    try {
      await waitFor(() => events.events.some((e) => e.event === "snapshot"), 2000, "SSE snapshot");
      const listed = (await state()).clients.find((c) => c.id === "tablet-0123456789abcdef");
      expect(listed).toMatchObject({
        anonymous: false,
        online: true,
        paused: false,
        device: "Chrome · Android",
        streams: [{ droneId: "m30t-01", mode: "full" }],
      });

      expect((await post("/api/admin/clients/tablet-0123456789abcdef/pause")).status).toBe(200);
      expect(await closed).toBe(CloseCode.Paused);
      await waitFor(() => events.events.some((e) => e.event === "client-paused"), 2000, "client-paused");
      expect(await watch(`ws://127.0.0.1:${service.httpPort}/ws/live/m30t-01`, tablet)).toBe(
        CloseCode.Paused,
      );
      // Other devices keep watching.
      expect(
        await watch(`ws://127.0.0.1:${service.httpPort}/ws/live/m30t-01`, "dlsh_client=other-0123456789abcd"),
      ).toBe("open");

      expect((await post("/api/admin/clients/tablet-0123456789abcdef/resume")).status).toBe(200);
      await waitFor(() => events.events.some((e) => e.event === "client-resumed"), 2000, "client-resumed");
      expect(await watch(`ws://127.0.0.1:${service.httpPort}/ws/live/m30t-01`, tablet)).toBe("open");

      expect((await post("/api/admin/clients/tablet-0123456789abcdef/reload")).status).toBe(200);
      await waitFor(() => events.events.some((e) => e.event === "client-reload"), 2000, "client-reload");

      const kinds = (await state()).events.map((e) => e.kind);
      expect(kinds).toEqual(
        expect.arrayContaining(["client-online", "client-paused", "client-resumed", "client-reload"]),
      );
    } finally {
      events.close();
    }
  });

  it("names devices and keeps the names on disk", async () => {
    const res = await post("/api/admin/clients/tablet-0123456789abcdef/name", { name: "ELW Großbildschirm" });
    expect(res.status).toBe(200);
    expect((await state()).clients.find((c) => c.id === "tablet-0123456789abcdef")?.name).toBe(
      "ELW Großbildschirm",
    );
    expect(
      (await post("/api/admin/clients/tablet-0123456789abcdef/name", { name: "x".repeat(41) })).status,
    ).toBe(400);
    expect((await post("/api/admin/clients/nobody-0123456789abcd/pause")).status).toBe(404);

    await service.stop();
    const file = JSON.parse(await readFile(path.join(dataDir, "clients.json"), "utf8")) as {
      clients: Record<string, { name: string }>;
    };
    expect(file.clients["tablet-0123456789abcdef"]?.name).toBe("ELW Großbildschirm");
  });

  it("answers 404 without a configured PIN", async () => {
    const plain = await startService({ ...config, adminPin: undefined });
    try {
      const res = await fetch(`http://127.0.0.1:${plain.httpPort}/api/admin/state`);
      expect(res.status).toBe(404);
    } finally {
      await plain.stop();
    }
  });
});
