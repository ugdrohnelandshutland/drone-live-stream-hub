import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/server/logger.js";
import { ChaosProxy } from "../../src/sim/chaos-proxy.js";

const logger = createLogger({ name: "test", level: "silent" });

/** Echo server behind the proxy. */
async function echoServer(): Promise<net.Server> {
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", () => undefined);
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Sends `bytes` and resolves with the time until all came back. */
function roundTrip(socket: net.Socket, bytes: number): Promise<number> {
  return new Promise((resolve) => {
    const started = Date.now();
    let received = 0;
    const onData = (data: Buffer) => {
      received += data.length;
      if (received >= bytes) {
        socket.off("data", onData);
        resolve(Date.now() - started);
      }
    };
    socket.on("data", onData);
    socket.write(Buffer.alloc(bytes, 7));
  });
}

describe("ChaosProxy", () => {
  const cleanup: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });

  async function setup() {
    const server = await echoServer();
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const proxy = new ChaosProxy({
      name: "test",
      targetHost: "127.0.0.1",
      targetPort: (server.address() as AddressInfo).port,
      logger,
    });
    await proxy.start();
    cleanup.push(() => proxy.stop());
    const socket = await connect(proxy.port);
    socket.on("error", () => undefined);
    cleanup.push(() => void socket.destroy());
    return { proxy, socket };
  }

  it("forwards data unchanged", async () => {
    const { socket } = await setup();
    const payload = Buffer.from("hello drone");
    const echoed = new Promise<Buffer>((resolve) => socket.once("data", resolve));
    socket.write(payload);
    expect(await echoed).toEqual(payload);
  });

  it("adds latency in both directions", async () => {
    const { proxy, socket } = await setup();
    proxy.setConditions({ latencyMs: 100 });
    const ms = await roundTrip(socket, 10);
    expect(ms).toBeGreaterThanOrEqual(190);
    expect(ms).toBeLessThan(400);
  });

  it("caps bandwidth", async () => {
    const { proxy, socket } = await setup();
    proxy.setConditions({ bandwidthKbps: 800 }); // 100 kB/s
    const ms = await roundTrip(socket, 50_000); // ~0.5 s per direction, pipelined
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(1500);
  });

  it("stalls without closing, then delivers", async () => {
    const { proxy, socket } = await setup();
    proxy.stall(300);
    const ms = await roundTrip(socket, 10);
    expect(ms).toBeGreaterThanOrEqual(280);
    expect(socket.destroyed).toBe(false);
  });

  it("cuts connections hard and refuses new ones for a while", async () => {
    const { proxy, socket } = await setup();
    const closed = new Promise((resolve) => socket.once("close", resolve));
    proxy.cut(300);
    await closed;
    const refused = await connect(proxy.port).then(
      (s) => new Promise((resolve) => s.once("close", () => resolve("closed"))),
      () => "error",
    );
    expect(refused).toMatch(/closed|error/);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const again = await connect(proxy.port);
    cleanup.push(() => void again.destroy());
    expect(await roundTrip(again, 5)).toBeLessThan(200);
  });

  it("heal() restores a perfect network", async () => {
    const { proxy, socket } = await setup();
    proxy.setConditions({ latencyMs: 500, bandwidthKbps: 10 });
    proxy.heal();
    expect(await roundTrip(socket, 1000)).toBeLessThan(100);
  });
});
