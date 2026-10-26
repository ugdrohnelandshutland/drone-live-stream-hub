// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminClient, AdminState } from "../../src/shared/admin";
import { AdminPage } from "../../src/web/features/admin/admin-page";

const tablet: AdminClient = {
  id: "tablet-1",
  anonymous: false,
  name: "ELW Großbildschirm",
  device: "Chrome · Android",
  address: "10.0.0.7",
  online: true,
  paused: false,
  onlineSince: "2026-10-25T08:00:00.000Z",
  lastSeen: "2026-10-25T09:00:00.000Z",
  streams: [{ droneId: "m30t-01", mode: "keyframes", since: "2026-10-25T08:00:00.000Z" }],
  quality: { kbps: 1200, droppedFrames: 3, slowClosures: 0, aborts: 0 },
};

function adminState(clients: AdminClient[]): AdminState {
  return {
    generatedAt: "2026-10-25T09:00:00.000Z",
    clients,
    load: {
      drones: [{ id: "m30t-01", name: "Drohne 1", live: true, inKbps: 4200, viewers: 1 }],
      outKbps: 1200,
      viewers: 1,
      devices: 1,
      service: { version: "0.9.0", uptimeSec: 3700, rssBytes: 112e6, heapUsedBytes: 20e6, cpuPercent: 3 },
    },
    eventsEpoch: "run-1",
    events: [{ seq: 1, at: "2026-10-25T08:00:00.000Z", kind: "drone-live", droneId: "m30t-01" }],
    captures: [
      {
        file: "m30t-01_2026-10-25T08-10-00-000Z.flv",
        droneId: "m30t-01",
        startedAt: "2026-10-25T08:10:00.000Z",
        recording: false,
        bytes: 7_480_000,
        cutShort: "offline",
      },
    ],
  };
}

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

let loggedIn: boolean;
let configured: boolean;
let requests: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  loggedIn = false;
  configured = true;
  requests = [];
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    requests.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (!configured) return json(404, { error: "not configured" });
    if (url === "/api/admin/login") {
      const pin = (JSON.parse(String(init.body)) as { pin: string }).pin;
      loggedIn = pin === "4711";
      return loggedIn ? json(200, { ok: true }) : json(401, { error: "wrong-pin" });
    }
    if (!loggedIn) return json(401, { error: "login required" });
    if (url.startsWith("/api/admin/state")) return json(200, adminState([tablet]));
    if (url === "/api/admin/captures") return json(409, { error: "busy" });
    return json(200, { ok: true });
  });
  // jsdom has no modal dialogs yet.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin page", () => {
  it("explains how to switch it on when no PIN is configured", async () => {
    configured = false;
    render(<AdminPage />);
    expect(await screen.findByText("Verwaltung nicht eingerichtet")).toBeTruthy();
  });

  it("asks for the PIN, reports a wrong one and shows the devices after login", async () => {
    render(<AdminPage />);
    const input = await screen.findByLabelText("PIN");
    fireEvent.change(input, { target: { value: "0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("PIN falsch.")).toBeTruthy();

    fireEvent.change(input, { target: { value: "47a11" } }); // digits only
    expect((input as HTMLInputElement).value).toBe("4711");
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("ELW Großbildschirm")).toBeTruthy();
    expect(screen.getByText("Drohne 1 (Datensparen)")).toBeTruthy();
    expect(screen.getByText(/1,2 Mbit\/s · 3 Bilder ausgelassen/)).toBeTruthy();
    expect(screen.getByText("4,2 Mbit/s")).toBeTruthy();
    expect(screen.getByText("Drohne 1 ist live")).toBeTruthy();
  });

  it("pauses a device and names it", async () => {
    loggedIn = true;
    render(<AdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Anhalten" }));
    await act(async () => undefined);
    expect(requests).toContainEqual({ method: "POST", url: "/api/admin/clients/tablet-1/pause", body: {} });

    fireEvent.click(screen.getByRole("button", { name: "Umbenennen" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Abschnitt Nord " } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => undefined);
    expect(requests).toContainEqual({
      method: "POST",
      url: "/api/admin/clients/tablet-1/name",
      body: { name: "Abschnitt Nord" },
    });
  });

  it("starts a capture and offers the finished ones for download", async () => {
    loggedIn = true;
    render(<AdminPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Drohne 1: 30 s mitschneiden" }));
    await act(async () => undefined);
    expect(requests).toContainEqual({
      method: "POST",
      url: "/api/admin/captures",
      body: { droneId: "m30t-01" },
    });
    expect(await screen.findByText("Für diese Drohne läuft schon ein Mitschnitt.")).toBeTruthy();

    const link = screen.getByRole("link", { name: "Herunterladen" });
    expect(link.getAttribute("href")).toBe("/api/admin/captures/m30t-01_2026-10-25T08-10-00-000Z.flv");
    expect(screen.getByText("7,5 MB")).toBeTruthy();
    expect(screen.getByText(/abgebrochen: Drohne offline/)).toBeTruthy();
  });
});
