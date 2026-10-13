import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { thirdPartyNotices } from "./scripts/lib/third-party.js";

const SERVICE = process.env["DLSH_SERVICE_URL"] ?? "http://127.0.0.1:8080";

export default defineConfig({
  root: "src/web",
  plugins: [react(), thirdPartyNotices(import.meta.dirname)],
  publicDir: false,
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    // Chrome on Android/Windows and WebKit on iPadOS >= 17.1.
    target: ["chrome110", "safari17"],
    // One bundle (mpegts.js + React) loaded once over the local Wi-Fi; splitting gains nothing.
    chunkSizeWarningLimit: 800,
  },
  server: {
    host: true, // reachable from tablets in the same Wi-Fi
    // Paths under these prefixes never reach Vite: no folder in src/web may use them
    // (test/web/dev-proxy.test.ts).
    proxy: {
      "/api": SERVICE,
      "/healthz": SERVICE,
      "/ws": { target: SERVICE.replace(/^http/, "ws"), ws: true },
    },
  },
});
