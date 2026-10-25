// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDronesStore } from "../../src/web/service/drones-store";
import { DronesContext } from "../../src/web/service/use-drones";
import type { LivePlayerOptions, PlayerStatus } from "../../src/web/player/live-player";
import { readPageOptions } from "../../src/web/routes";
import { drone, FakeEventSource } from "./fake-event-source";

/** Stand-in for LivePlayer: records instances so tests can count running players. */
class FakePlayer {
  static instances: FakePlayer[] = [];
  started = false;
  destroyed = false;
  constructor(readonly options: LivePlayerOptions) {
    FakePlayer.instances.push(this);
  }
  start(): void {
    this.started = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  emit(status: PlayerStatus): void {
    this.options.onStatus(status);
  }
  static running(): FakePlayer[] {
    return FakePlayer.instances.filter((p) => p.started && !p.destroyed);
  }
  static only(): FakePlayer {
    const [player, ...rest] = FakePlayer.running();
    if (!player || rest.length)
      throw new Error(`expected one running player, got ${rest.length + (player ? 1 : 0)}`);
    return player;
  }
}

vi.mock("../../src/web/player/live-player", () => ({ LivePlayer: FakePlayer }));
const { App } = await import("../../src/web/app");

function renderApp(pathname: string, search = "") {
  window.history.replaceState(null, "", pathname + search);
  return render(
    <StrictMode>
      <DronesContext value={createDronesStore()}>
        <App options={readPageOptions(search)} />
      </DronesContext>
    </StrictMode>,
  );
}

const sse = () => FakeEventSource.latest();

beforeEach(() => {
  localStorage.clear();
  FakePlayer.instances = [];
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  // /api/info never answers: the footer stays empty.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("single view", () => {
  it("keeps exactly one player running under StrictMode and stops it on unmount", () => {
    const view = renderApp("/drone/m30t-01");
    expect(FakePlayer.only().options.url).toBe("ws://localhost:3000/ws/live/m30t-01");

    act(() => sse().snapshot([drone("a", "offline"), drone("m30t-01", "live", "Drohne Nord")]));
    FakePlayer.only();
    expect(screen.getByText("Drohne Nord")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // slot number from the config order
    expect(FakeEventSource.open()).toHaveLength(1);

    view.unmount();
    expect(FakePlayer.running()).toHaveLength(0);
  });

  it("stops the player and reports an id that is not configured", () => {
    renderApp("/drone/nope");
    act(() => sse().snapshot([drone("m30t-01", "live")]));
    expect(FakePlayer.running()).toHaveLength(0);
    expect(screen.getByText("Unbekannte Drohne")).toBeTruthy();
  });

  it("passes latency tuning from the URL to the player", () => {
    renderApp("/drone/m30t-01", "?syncTarget=0.2&syncMax=x");
    expect(FakePlayer.only().options.tuning).toEqual({ syncTarget: 0.2 });
  });

  it("shows 'Kein Signal' in badge and overlay together, only after a short interruption has lasted", () => {
    vi.useFakeTimers();
    const { container } = renderApp("/drone/m30t-01");
    const badge = () => container.querySelector<HTMLElement>(".status")!;
    const overlayShown = () => container.querySelector(".picture-overlay")!.hasAttribute("data-visible");

    act(() => FakePlayer.only().emit("playing"));
    expect(badge().dataset["state"]).toBe("playing");
    expect(overlayShown()).toBe(false);

    act(() => FakePlayer.only().emit("stalled"));
    act(() => vi.advanceTimersByTime(500));
    expect(badge().dataset["state"]).toBe("playing"); // camera switch: no flicker
    expect(overlayShown()).toBe(false);

    act(() => vi.advanceTimersByTime(500));
    expect(badge().dataset["state"]).toBe("stalled");
    expect(overlayShown()).toBe(true);
    expect(screen.getByText("Das Bild steht – warte auf neue Daten …")).toBeTruthy();

    act(() => FakePlayer.only().emit("playing"));
    expect(overlayShown()).toBe(false);
  });

  it("enables the still image only while a picture is shown", () => {
    renderApp("/drone/m30t-01");
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Standbild" });
    expect(button.disabled).toBe(true);
    act(() => FakePlayer.only().emit("playing"));
    expect(button.disabled).toBe(false);
  });

  it("starts and stops a recording", () => {
    const { container } = renderApp("/drone/m30t-01");
    const start = screen.getByRole<HTMLButtonElement>("button", { name: "Aufnahme" });
    expect(start.disabled).toBe(true);
    act(() => FakePlayer.only().emit("playing"));
    act(() => start.click());

    // No frames from the fake player: the recording waits for a keyframe.
    expect(container.querySelector(".recording-indicator")?.textContent).toBe("REC – warte auf Bild");
    const stop = screen.getByRole<HTMLButtonElement>("button", { name: "Aufnahme beenden" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    act(() => stop.click());
    expect(container.querySelector(".recording-indicator")).toBeNull();
    expect(screen.getByRole("button", { name: "Aufnahme" })).toBeTruthy();
  });

  it("hides navigation, still image and recording in kiosk mode", () => {
    renderApp("/drone/m30t-01", "?kiosk");
    expect(screen.queryByRole("link", { name: "Übersicht" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Standbild" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aufnahme" })).toBeNull();
  });
});

describe("overview", () => {
  it("shows a loading state until the first snapshot", () => {
    renderApp("/");
    expect(screen.getByText("Lade Drohnen …")).toBeTruthy();
    act(() => sse().snapshot([]));
    expect(screen.getByText("Keine Drohnen eingerichtet")).toBeTruthy();
  });

  it("runs a preview player only while a drone is live", () => {
    renderApp("/", "?datensparen=0");
    act(() => sse().snapshot([drone("m30t-01", "offline"), drone("m30t-02", "live")]));
    expect(FakePlayer.running().map((p) => p.options.url)).toEqual(["ws://localhost:3000/ws/live/m30t-02"]);

    act(() => sse().updated(drone("m30t-01", "live")));
    expect(FakePlayer.running()).toHaveLength(2);

    act(() => sse().updated(drone("m30t-02", "offline")));
    expect(FakePlayer.running().map((p) => p.options.url)).toEqual(["ws://localhost:3000/ws/live/m30t-01"]);
  });

  it("numbers tiles in config order, links them and starts no previews with ?previews=0", () => {
    renderApp("/", "?previews=0");
    act(() => sse().snapshot([drone("b", "live", "Nord"), drone("a", "offline", "Süd")]));
    const tiles = screen.getAllByRole("listitem");
    expect(within(tiles[0]!).getByText("1")).toBeTruthy();
    expect(within(tiles[0]!).getByText("Nord")).toBeTruthy();
    expect(within(tiles[1]!).getByText("Offline")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nord öffnen" }).getAttribute("href")).toBe("/drone/b");
    expect(FakePlayer.running()).toHaveLength(0);
    expect(screen.getByText("Live – zum Öffnen tippen")).toBeTruthy();
  });

  it("shows the server banner only when the event stream stays down", () => {
    vi.useFakeTimers();
    renderApp("/");
    act(() => sse().snapshot([drone("a", "live")]));
    act(() => sse().fail());
    expect(screen.queryByText(/Keine Verbindung zum Server/)).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText(/Keine Verbindung zum Server/)).toBeTruthy();
    act(() => sse().snapshot([drone("a", "live")]));
    expect(screen.queryByText(/Keine Verbindung zum Server/)).toBeNull();
  });

  it("switches between day and night and remembers the choice", () => {
    renderApp("/");
    const toggle = screen.getByRole("switch", { name: "Nachtmodus" });
    expect(toggle.getAttribute("aria-checked")).toBe("false"); // device default: light
    act(() => toggle.click());
    expect(document.documentElement.dataset["theme"]).toBe("night");
    expect(localStorage.getItem("dlsh.theme")).toBe("night");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    act(() => toggle.click());
    expect(document.documentElement.dataset["theme"]).toBe("day");
    expect(localStorage.getItem("dlsh.theme")).toBe("day");
  });
});

describe("paused by an admin (ADR 0012)", () => {
  it("stops every player, says why, and starts again on release", () => {
    renderApp("/", "?datensparen=0");
    act(() => sse().snapshot([drone("m30t-01", "live"), drone("m30t-02", "live")]));
    expect(FakePlayer.running()).toHaveLength(2);

    act(() => sse().emit("client-paused", {}));
    expect(FakePlayer.running()).toHaveLength(0);
    expect(screen.getAllByText("Übertragung angehalten")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toMatch(/für dieses Gerät angehalten/);

    act(() => sse().emit("client-resumed", {}));
    expect(FakePlayer.running()).toHaveLength(2);
    expect(screen.queryByText("Übertragung angehalten")).toBeNull();
  });

  it("shows the notice when the player hears 4003 first", () => {
    renderApp("/drone/m30t-01");
    act(() => sse().snapshot([drone("m30t-01", "live")]));
    act(() => FakePlayer.only().emit("paused"));
    expect(screen.getByText("Übertragung angehalten")).toBeTruthy();
  });
});

describe("overview filter 'Nur live'", () => {
  const slots = () =>
    screen.queryAllByRole("listitem").map((tile) => within(tile).getByText(/^\d$/).textContent);
  const three = () => [drone("a", "offline", "Nord"), drone("b", "live", "Mitte"), drone("c", "live", "Süd")];

  beforeEach(() => localStorage.clear());

  it("shows all drones by default and only live ones when switched on, keeping their numbers", () => {
    renderApp("/");
    act(() => sse().snapshot(three()));
    const toggle = screen.getByRole("switch", { name: "Nur live" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(slots()).toEqual(["1", "2", "3"]);

    act(() => toggle.click());
    expect(slots()).toEqual(["2", "3"]);
    expect(screen.getByText("2 von 3 live · 1 ausgeblendet")).toBeTruthy();
    expect(localStorage.getItem("dlsh.liveOnly")).toBe("1");

    act(() => toggle.click());
    expect(slots()).toEqual(["1", "2", "3"]);
    expect(localStorage.getItem("dlsh.liveOnly")).toBe("0");
  });

  it("keeps a drone that lost its signal for 30 s, and at once when it returns", () => {
    vi.useFakeTimers();
    localStorage.setItem("dlsh.liveOnly", "1");
    renderApp("/");
    act(() => sse().snapshot(three()));
    expect(slots()).toEqual(["2", "3"]);

    act(() => sse().updated(drone("b", "offline", "Mitte")));
    expect(slots()).toEqual(["2", "3"]); // "Kein Signal", still on the wall
    act(() => vi.advanceTimersByTime(20_000));
    act(() => sse().updated(drone("b", "live", "Mitte")));
    act(() => vi.advanceTimersByTime(20_000));
    expect(slots()).toEqual(["2", "3"]); // back in time: the grace period starts over

    act(() => sse().updated(drone("b", "offline", "Mitte")));
    act(() => vi.advanceTimersByTime(29_000));
    expect(slots()).toEqual(["2", "3"]);
    act(() => vi.advanceTimersByTime(1_000));
    expect(slots()).toEqual(["3"]);

    act(() => sse().updated(drone("a", "live", "Nord")));
    expect(slots()).toEqual(["1", "3"]);
  });

  it("offers to show all drones when none is live", () => {
    renderApp("/", "?nurlive");
    act(() => sse().snapshot([drone("a", "offline"), drone("b", "offline")]));
    expect(screen.getByRole("switch", { name: "Nur live" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Keine Drohne live")).toBeTruthy();
    expect(localStorage.getItem("dlsh.liveOnly")).toBeNull(); // from the URL, not stored

    act(() => screen.getByRole("button", { name: "Alle anzeigen" }).click());
    expect(slots()).toEqual(["1", "2"]);
    expect(screen.queryByText("Keine Drohne live")).toBeNull();
  });
});

describe("overview 'Datensparen'", () => {
  const nordLive = () => [drone("m30t-01", "live", "Nord")];
  const toggle = () => screen.getByRole("switch", { name: "Datensparen" });

  it("is on until the device chooses, then remembers the choice", () => {
    renderApp("/");
    act(() => sse().snapshot(nordLive()));
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(FakePlayer.only().options).toMatchObject({
      url: "ws://localhost:3000/ws/live/m30t-01?keyframes=1",
      mode: "keyframes",
    });
    expect(localStorage.getItem("dlsh.dataSaver")).toBeNull();

    act(() => toggle().click());
    expect(localStorage.getItem("dlsh.dataSaver")).toBe("0");
    expect(FakePlayer.only().options).toMatchObject({
      url: "ws://localhost:3000/ws/live/m30t-01",
      mode: "full",
    });

    cleanup();
    renderApp("/");
    act(() => sse().snapshot(nordLive()));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("gives the opened drone the full stream and the tile keyframes again on return", () => {
    renderApp("/");
    act(() => sse().snapshot(nordLive()));
    const tile = FakePlayer.only();

    act(() => screen.getByRole("link", { name: "Nord öffnen" }).click());
    const single = FakePlayer.only();
    expect(single).not.toBe(tile);
    expect(single.options).toMatchObject({ url: "ws://localhost:3000/ws/live/m30t-01", mode: "full" });

    act(() => screen.getByRole("link", { name: "Übersicht" }).click());
    expect(FakePlayer.only().options.mode).toBe("keyframes");
  });

  it("follows ?datensparen without storing it and is hidden with ?previews=0", () => {
    renderApp("/", "?datensparen=0");
    act(() => sse().snapshot(nordLive()));
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem("dlsh.dataSaver")).toBeNull();

    cleanup();
    renderApp("/", "?previews=0");
    act(() => sse().snapshot(nordLive()));
    expect(screen.queryByRole("switch", { name: "Datensparen" })).toBeNull();
  });
});

describe("switching between wall and single view", () => {
  const twoLive = () => [drone("m30t-01", "live", "Nord"), drone("m30t-02", "live", "Süd")];
  // Without "Datensparen" the tile and the single view share one stream (ADR 0007).
  beforeEach(() => localStorage.setItem("dlsh.dataSaver", "0"));

  it("keeps the tapped drone's player running into the single view and back", () => {
    renderApp("/");
    act(() => sse().snapshot(twoLive()));
    const [nord, sued] = FakePlayer.running();
    expect(nord!.options.url).toContain("m30t-01");

    act(() => screen.getByRole("link", { name: "Nord öffnen" }).click());
    expect(location.pathname).toBe("/drone/m30t-01");
    expect(FakePlayer.only()).toBe(nord); // same player, same WebSocket: no reconnect
    expect(sued!.destroyed).toBe(true); // hidden monitors stop
    expect(screen.getByRole("button", { name: "Standbild" })).toBeTruthy();

    act(() => screen.getByRole("link", { name: "Übersicht" }).click());
    expect(location.pathname).toBe("/");
    expect(FakePlayer.running()).toHaveLength(2);
    expect(FakePlayer.running()).toContain(nord);
  });

  it("follows the browser's back button", () => {
    renderApp("/");
    act(() => sse().snapshot(twoLive()));
    act(() => screen.getByRole("link", { name: "Süd öffnen" }).click());
    const sued = FakePlayer.only();

    act(() => {
      history.back();
      // jsdom changes the URL asynchronously; dispatch what the browser would.
      history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(FakePlayer.running()).toContain(sued);
  });

  it("starts the player of a directly opened drone before the drone list arrives", () => {
    renderApp("/drone/m30t-02");
    expect(FakePlayer.only().options.url).toContain("m30t-02");
    const first = FakePlayer.only();
    act(() => sse().snapshot(twoLive()));
    expect(FakePlayer.only()).toBe(first);
    expect(screen.getByText("Süd")).toBeTruthy();
  });

  it("leaves fullscreen when going back, by button or by the browser", () => {
    // jsdom has no Fullscreen API: emulate the part the UI uses. The element that asked for
    // fullscreen is the `this` of the last requestFullscreen call.
    let active = false;
    const request = vi.fn(() => {
      active = true;
      return Promise.resolve();
    });
    HTMLElement.prototype.requestFullscreen = request;
    const fullscreenElement = () => (active ? (request.mock.contexts.at(-1) as Element) : null);
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: fullscreenElement });
    const exit = vi.fn(() => {
      active = false;
      return Promise.resolve();
    });
    document.exitFullscreen = exit;

    renderApp("/");
    act(() => sse().snapshot(twoLive()));
    for (const leave of ["button", "popstate"] as const) {
      act(() => screen.getByRole("link", { name: "Nord öffnen" }).click());
      act(() => screen.getByRole("button", { name: "Vollbild" }).click());
      expect(fullscreenElement()).not.toBeNull();
      act(() => {
        if (leave === "button") {
          screen.getByRole("link", { name: "Übersicht" }).click();
        } else {
          history.replaceState(null, "", "/");
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      });
      expect(location.pathname).toBe("/");
      expect(fullscreenElement()).toBeNull();
    }
    expect(exit).toHaveBeenCalledTimes(2);
  });

  it("hides the strip in fullscreen; a tap or the mouse at the top shows it", () => {
    vi.useFakeTimers();
    let element: Element | null = null;
    HTMLElement.prototype.requestFullscreen = function (this: HTMLElement) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- `this` is the element that asked
      element = this;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    document.exitFullscreen = () => {
      element = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });

    const view = renderApp("/drone/m30t-01");
    act(() => sse().snapshot(twoLive()));
    const strip = () => view.container.querySelector(".strip")!;
    const picture = () => view.container.querySelector(".monitor-picture") as HTMLElement;
    expect(strip().hasAttribute("data-hidden")).toBe(false);

    act(() => screen.getByRole("button", { name: "Vollbild" }).click());
    expect(strip().hasAttribute("data-hidden")).toBe(true);
    expect(strip().hasAttribute("inert")).toBe(true);

    act(() => picture().click());
    expect(strip().hasAttribute("data-hidden")).toBe(false);
    act(() => vi.advanceTimersByTime(3000));
    act(() => strip().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => vi.advanceTimersByTime(3000));
    expect(strip().hasAttribute("data-hidden")).toBe(false); // using the strip keeps it
    act(() => vi.advanceTimersByTime(1000));
    expect(strip().hasAttribute("data-hidden")).toBe(true);

    act(() => picture().click());
    act(() => picture().click());
    expect(strip().hasAttribute("data-hidden")).toBe(true); // second tap hides it again

    // Mouse: only the top area (as high as the strip; 0 px in jsdom) shows it, while there.
    const move = (clientY: number) =>
      act(() => picture().dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY })));
    move(300);
    expect(strip().hasAttribute("data-hidden")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(strip().hasAttribute("data-hidden")).toBe(true);
    move(0);
    expect(strip().hasAttribute("data-hidden")).toBe(false);
    act(() => vi.advanceTimersByTime(10_000));
    expect(strip().hasAttribute("data-hidden")).toBe(false); // stays while the mouse is up there
    move(300);
    expect(strip().hasAttribute("data-hidden")).toBe(true);

    act(() => picture().click());
    act(() => screen.getByRole("button", { name: "Vollbild beenden" }).click());
    expect(strip().hasAttribute("data-hidden")).toBe(false);
  });

  it("leaves fullscreen alone when it was already ended (Esc)", () => {
    renderApp("/drone/m30t-01");
    act(() => sse().snapshot(twoLive()));
    const exit = vi.fn(() => Promise.resolve());
    document.exitFullscreen = exit;
    act(() => screen.getByRole("link", { name: "Übersicht" }).click());
    expect(exit).not.toHaveBeenCalled();
  });

  it("leaves modified clicks to the browser (new tab)", () => {
    renderApp("/");
    act(() => sse().snapshot(twoLive()));
    const link = screen.getByRole("link", { name: "Nord öffnen" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => link.dispatchEvent(event));
    expect(location.pathname).toBe("/");
  });
});

describe("footer", () => {
  const info = { name: "Drone Live Stream Hub", version: "0.3.0", commit: "bb3260d", builtAt: null };
  const notices = {
    web: [{ name: "react", version: "19.3.0", license: "MIT", licenseText: "MIT License (react)" }],
    service: [
      { name: "ws", version: "8.22.0", license: "MIT", licenseText: "" },
      { name: "react", version: "19.3.0", license: "MIT", licenseText: "MIT License (react)" },
    ],
  };

  beforeEach(() => {
    const responses: Record<string, unknown> = { "/api/info": info, "/third-party.json": notices };
    vi.stubGlobal("fetch", (path: string) =>
      Promise.resolve(
        new Response(JSON.stringify(responses[path]), { status: path in responses ? 200 : 404 }),
      ),
    );
    // jsdom has no modal dialogs yet.
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  it("opens the changelog from the version and marks the installed release", async () => {
    renderApp("/");
    const opener = await screen.findByRole("button", { name: "Version 0.3.0" });
    act(() => opener.click());
    const dialog = screen.getByRole("dialog", { name: "Neuigkeiten" });
    expect(within(dialog).getByText("installiert")).toBeTruthy();
    expect(within(dialog).getByText(/Version 0\.1\.0/)).toBeTruthy();

    act(() => within(dialog).getByRole("button", { name: "Schließen" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens 'Über' from the name with publisher and each license once", async () => {
    renderApp("/");
    const opener = await screen.findByRole("button", { name: "Drone Live Stream Hub" });
    act(() => opener.click());
    const dialog = screen.getByRole("dialog", { name: "Über" });
    expect(within(dialog).getByText("Herausgeber")).toBeTruthy();
    expect(within(dialog).getByText("Version 0.3.0 · Commit bb3260d · Entwicklungsstand")).toBeTruthy();
    await within(dialog).findByText("ws");
    expect(within(dialog).getAllByText("react")).toHaveLength(1);
    expect(within(dialog).getByText("Kein Lizenztext im Paket enthalten.")).toBeTruthy();
  });

  it("shows name and version as plain text in kiosk mode", async () => {
    renderApp("/", "?kiosk");
    await screen.findByText("Version 0.3.0");
    expect(screen.queryByRole("button", { name: "Version 0.3.0" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drone Live Stream Hub" })).toBeNull();
  });
});

describe("error boundary", () => {
  it("replaces a crashed page with a message instead of a blank screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ErrorBoundary } = await import("../../src/web/components/error-boundary");
    const Boom = () => {
      throw new Error("boom");
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Anzeige gestört")).toBeTruthy();
  });
});
