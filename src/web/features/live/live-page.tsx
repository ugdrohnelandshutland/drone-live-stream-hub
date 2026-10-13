import type { CSSProperties } from "react";
import type { DroneStatus } from "../../../shared/api";
import { AppFooter } from "../../components/app-footer";
import { Banner } from "../../components/banner";
import { DroneStrip } from "../../components/drone-strip";
import { Notice } from "../../components/notice";
import { PictureOverlay } from "../../components/picture-overlay";
import { ThemeSwitch } from "../../components/theme-switch";
import { countLive } from "../../lib/format";
import { useDelayedFlag, useTick } from "../../lib/use-delayed";
import { useDocumentTitle } from "../../lib/use-document-title";
import { describeStatus } from "../../player/player-status";
import type { PageOptions } from "../../routes";
import { useDrones } from "../../service/use-drones";
import { t } from "../../strings";
import { BackLink, DroneMonitor } from "./drone-monitor";
import { useFilteredWall, useLiveOnly } from "./live-filter";
import { useDataSaver } from "./data-saver";
import { HeaderSwitch } from "./header-switch";
import { wallLayout } from "./wall-layout";
import "./live.css";
import "./monitor-focus.css";

/** Brief SSE hiccups (service restart, Wi-Fi roaming) should not flash the banner. */
const BANNER_DELAY_MS = 2000;

interface LivePageProps {
  /** The drone shown large (`/drone/<id>`); undefined shows the whole wall (`/`). */
  focusId: string | undefined;
  options: PageOptions;
}

/**
 * `/` and `/drone/<id>` in one page: the monitor wall, or one of its monitors shown large.
 * Navigating between them (navigation.ts) keeps that monitor mounted — the tree below is the
 * same in both modes and monitors are keyed by drone id — so its picture continues without a
 * reconnect — unless "Datensparen" is on: the tile then switches from keyframes to the full
 * stream (ADR 0009). The other monitors unmount (and stop) while one is focused.
 */
export function LivePage({ focusId, options }: LivePageProps) {
  const { drones, connection, lostAt } = useDrones();
  const [liveOnly, setLiveOnly] = useLiveOnly(options.liveOnly);
  const [dataSaver, setDataSaver] = useDataSaver(options.dataSaver);
  const serverLost = useDelayedFlag(connection === "reconnecting", BANNER_DELAY_MS);
  useTick(60_000); // "seit 14:03 Uhr" in the strips

  const single = focusId !== undefined;
  const focusIndex = single ? (drones?.findIndex((d) => d.id === focusId) ?? -1) : -1;
  const focused = drones?.[focusIndex];
  const wall = useFilteredWall(drones ?? [], lostAt, liveOnly && !single);
  useDocumentTitle(single ? (focused?.name ?? focusId) : undefined);

  if (single && drones !== undefined && !focused) {
    return <UnknownDrone droneId={focusId} kiosk={options.kiosk} />;
  }

  // Single: just the focused drone — until the first snapshot a placeholder, so the player
  // starts right away (the server holds the socket open). Wall: the drones in config order,
  // with "Nur live" only those that are live (live-filter.ts).
  const monitors: { drone: DroneStatus; slot: number | undefined }[] = single
    ? [{ drone: focused ?? placeholderDrone(focusId), slot: focused ? focusIndex + 1 : undefined }]
    : wall.shown;

  const layout = wallLayout(monitors.length || 1);
  const wallStyle = {
    "--cols-landscape": layout.landscape.cols,
    "--rows-landscape": layout.landscape.rows,
    "--cols-portrait": layout.portrait.cols,
    "--rows-portrait": layout.portrait.rows,
  } as CSSProperties;

  return (
    <main className="live" data-mode={single ? "single" : "wall"}>
      {!single && (
        <header className="live-header">
          <h1>
            {t.wordmark[0]}
            <span>{t.wordmark[1]}</span>
          </h1>
          {drones && drones.length > 0 && (
            <span className="live-summary">
              {t.overview.summary(countLive(drones), drones.length)}
              {wall.hidden > 0 && ` · ${t.overview.hidden(wall.hidden)}`}
            </span>
          )}
          {/* One group, so the switches wrap together on narrow screens. */}
          <div className="live-header-actions">
            {drones && drones.length > 0 && (
              <>
                <HeaderSwitch
                  label={t.overview.liveOnly}
                  title={liveOnly ? t.overview.liveOnlyOff : t.overview.liveOnlyOn}
                  on={liveOnly}
                  onChange={setLiveOnly}
                  tone="live"
                />
                {options.previews && (
                  <HeaderSwitch
                    label={t.overview.dataSaver}
                    title={dataSaver ? t.overview.dataSaverOff : t.overview.dataSaverOn}
                    on={dataSaver}
                    onChange={setDataSaver}
                  />
                )}
              </>
            )}
            <ThemeSwitch />
          </div>
        </header>
      )}
      <Banner show={serverLost && !single}>{t.overview.serverLost}</Banner>
      <ul className="wall" style={wallStyle}>
        {monitors.map(({ drone, slot }) => (
          <DroneMonitor
            key={drone.id}
            drone={drone}
            slot={slot}
            focused={single}
            dataSaver={dataSaver}
            options={options}
          />
        ))}
      </ul>
      {!single && drones === undefined && <Notice title={t.loading} />}
      {!single && drones?.length === 0 && (
        <Notice title={t.overview.noDrones} detail={t.overview.noDronesDetail} />
      )}
      {!single && drones && drones.length > 0 && monitors.length === 0 && (
        <Notice title={t.overview.noneLive} detail={t.overview.noneLiveDetail}>
          <button type="button" onClick={() => setLiveOnly(false)}>
            {t.overview.showAll}
          </button>
        </Notice>
      )}
      {!single && <AppFooter kiosk={options.kiosk} />}
    </main>
  );
}

function placeholderDrone(id: string): DroneStatus {
  return { id, name: id, state: "live", since: null, sessionId: null, viewerCount: 0, video: null };
}

/** `/drone/<id>` for an id that is not configured: reported at once, no player. */
function UnknownDrone({ droneId, kiosk }: { droneId: string; kiosk: boolean }) {
  const view = describeStatus("unknown-drone", droneId);
  return (
    <main className="live" data-mode="single">
      <ul className="wall">
        <li className="monitor" data-focused data-tone={view.tone}>
          <div className="monitor-picture">
            <PictureOverlay view={view} />
          </div>
          <DroneStrip
            slot={undefined}
            name={droneId}
            view={view}
            state="unknown-drone"
            {...(kiosk ? {} : { leading: <BackLink /> })}
          />
        </li>
      </ul>
    </main>
  );
}
