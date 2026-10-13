/**
 * `npm run sim:proxy -- --listen 8090 --target 8080 --latency 40 --jitter 60 --bandwidth 4000`
 *
 * Puts the chaos proxy in front of a port, e.g. the web UI/WebSocket port, to emulate a weak
 * tablet connection: open http://<pc>:8090/drone/m30t-01 instead of :8080.
 * Interactive keys: s = stall 3 s, c = cut (refuse 5 s), h = heal, q = quit.
 */
import { parseArgs } from "node:util";
import { createLogger } from "../server/logger.js";
import { ChaosProxy } from "./chaos-proxy.js";

const { values } = parseArgs({
  options: {
    listen: { type: "string", default: "8090" },
    "listen-host": { type: "string", default: "0.0.0.0" },
    target: { type: "string", default: "8080" },
    "target-host": { type: "string", default: "127.0.0.1" },
    latency: { type: "string", default: "0" },
    jitter: { type: "string", default: "0" },
    bandwidth: { type: "string", default: "0" },
  },
});

const logger = createLogger({ name: "chaos-proxy" });
const proxy = new ChaosProxy({
  name: `:${values.listen}→:${values.target}`,
  listenPort: Number(values.listen),
  listenHost: values["listen-host"],
  targetHost: values["target-host"],
  targetPort: Number(values.target),
  logger,
});
await proxy.start();
proxy.setConditions({
  latencyMs: Number(values.latency),
  jitterMs: Number(values.jitter),
  bandwidthKbps: Number(values.bandwidth),
});
logger.info({ port: proxy.port }, "chaos proxy listening (keys: s = stall 3 s, c = cut, h = heal, q = quit)");

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on("data", (key: Buffer) => {
    switch (key.toString()) {
      case "s":
        proxy.stall(3000);
        break;
      case "c":
        proxy.cut(5000);
        break;
      case "h":
        proxy.heal();
        break;
      case "q":
      case "\u0003":
        void proxy.stop().then(() => process.exit(0));
        break;
    }
  });
}
process.on("SIGINT", () => void proxy.stop().then(() => process.exit(0)));
process.on("SIGTERM", () => void proxy.stop().then(() => process.exit(0)));
