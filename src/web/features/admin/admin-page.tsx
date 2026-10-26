import { useState, type FormEvent } from "react";
import type { AdminEvent, AdminLoad, AdminLoginError, AdminState } from "../../../shared/admin";
import { Banner } from "../../components/banner";
import { Notice } from "../../components/notice";
import { ThemeSwitch } from "../../components/theme-switch";
import { useDocumentTitle } from "../../lib/use-document-title";
import { apiPost, HttpError } from "../../service/http";
import { t } from "../../strings";
import { CapturePanel } from "./capture-panel";
import { ClientCard } from "./client-card";
import { clockTime, eventText, formatKbps, formatMegabytes, formatUptime } from "./admin-format";
import { useAdminState } from "./use-admin-state";
import "./admin.css";

/**
 * `/admin` (ADR 0012): which devices watch which drone and how their connection is doing;
 * pause, release, reload and name devices; load of the service; recent events. Behind the PIN
 * from the config. Not linked from the live pages.
 */
export function AdminPage() {
  useDocumentTitle(t.admin.title);
  const { view, failed, refresh } = useAdminState();

  const logout = () => {
    void apiPost("/api/admin/logout").finally(refresh);
  };

  return (
    <main className="page admin">
      <header className="admin-header">
        <h1>{t.admin.title}</h1>
        <span className="admin-header-actions">
          <a className="button" href="/diagnose">
            {t.admin.diagnostics}
          </a>
          {view.kind === "ok" && (
            <button type="button" onClick={logout}>
              {t.admin.logout}
            </button>
          )}
          <ThemeSwitch />
        </span>
      </header>
      <Banner show={failed}>{t.admin.unreachable}</Banner>
      {view.kind === "loading" && !failed && <Notice title={t.loading} />}
      {view.kind === "off" && <Notice title={t.admin.off} detail={t.admin.offDetail} />}
      {view.kind === "login" && <LoginForm onDone={refresh} />}
      {view.kind === "ok" && <AdminContent state={view.state} events={view.events} onChanged={refresh} />}
    </main>
  );
}

function AdminContent(props: { state: AdminState; events: readonly AdminEvent[]; onChanged: () => void }) {
  const { state, events, onChanged } = props;
  const droneName = (id: string) => state.load.drones.find((d) => d.id === id)?.name ?? id;
  return (
    <>
      <section className="admin-section" aria-labelledby="admin-devices">
        <h2 id="admin-devices">{t.admin.devicesTitle}</h2>
        {state.clients.length === 0 ? (
          <Notice title={t.admin.noDevices} detail={t.admin.noDevicesDetail} />
        ) : (
          <ul className="admin-clients">
            {state.clients.map((client) => (
              <ClientCard key={client.id} client={client} droneName={droneName} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </section>
      <LoadPanel load={state.load} />
      <CapturePanel captures={state.captures} drones={state.load.drones} onChanged={onChanged} />
      <section className="admin-section" aria-labelledby="admin-events">
        <h2 id="admin-events">{t.admin.eventsTitle}</h2>
        {events.length === 0 ? (
          <p className="quiet">{t.admin.noEvents}</p>
        ) : (
          <ol className="admin-events">
            {/* Newest first. */}
            {[...events].reverse().map((event) => (
              <li key={event.seq} data-kind={event.kind}>
                <time dateTime={event.at}>{clockTime(event.at)}</time>
                {eventText(event, droneName)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function LoadPanel({ load }: { load: AdminLoad }) {
  const { service } = load;
  return (
    <section className="admin-section" aria-labelledby="admin-load">
      <h2 id="admin-load">{t.admin.loadTitle}</h2>
      <div className="admin-load">
        <table className="admin-table">
          <caption>{t.admin.incoming}</caption>
          <tbody>
            {load.drones.map((drone) => (
              <tr key={drone.id}>
                <th scope="row">{drone.name}</th>
                <td>
                  {drone.live
                    ? drone.inKbps !== null
                      ? formatKbps(drone.inKbps)
                      : t.admin.live
                    : t.admin.droneOffline}
                </td>
                <td>
                  {drone.viewers} {t.admin.viewers}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="admin-table">
          <caption>{t.admin.service}</caption>
          <tbody>
            <tr>
              <th scope="row">{t.admin.outgoing}</th>
              <td>{formatKbps(load.outKbps)}</td>
            </tr>
            <tr>
              <th scope="row">{t.admin.devices}</th>
              <td>
                {load.devices} · {load.viewers} {t.admin.viewers}
              </td>
            </tr>
            <tr>
              <th scope="row">{t.admin.cpu}</th>
              <td>{service.cpuPercent !== null ? `${service.cpuPercent} %` : "–"}</td>
            </tr>
            <tr>
              <th scope="row">{t.admin.memory}</th>
              <td>{formatMegabytes(service.rssBytes)}</td>
            </tr>
            <tr>
              <th scope="row">{t.admin.uptime}</th>
              <td>{formatUptime(service.uptimeSec)}</td>
            </tr>
            <tr>
              <th scope="row">{t.admin.version}</th>
              <td>{service.version}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    apiPost("/api/admin/login", { pin })
      .then(() => {
        setError(undefined);
        onDone();
      })
      .catch((err: unknown) => {
        const body = err instanceof HttpError ? (err.body as AdminLoginError | undefined) : undefined;
        setError(
          body?.error === "locked"
            ? t.admin.locked(body.retryAfterSec ?? 60)
            : body?.error === "wrong-pin"
              ? t.admin.wrongPin
              : t.admin.loginFailed,
        );
        setPin("");
      })
      .finally(() => setBusy(false));
  };

  return (
    <form className="admin-login" onSubmit={submit}>
      <h2>{t.admin.loginTitle}</h2>
      <label>
        <span>{t.admin.pin}</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          maxLength={12}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="admin-primary" disabled={busy || pin.length < 4}>
        {t.admin.login}
      </button>
    </form>
  );
}
