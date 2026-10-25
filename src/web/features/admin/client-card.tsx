import { useState, type FormEvent } from "react";
import { ADMIN_NAME_MAX, type AdminClient } from "../../../shared/admin";
import { Dialog } from "../../components/dialog";
import { formatSince } from "../../lib/format";
import { apiPost } from "../../service/http";
import { t } from "../../strings";
import { clientLabel, clockTime, formatKbps, qualityIssues } from "./admin-format";

interface ClientCardProps {
  client: AdminClient;
  droneName: (id: string) => string;
  /** After an action: poll again at once. */
  onChanged: () => void;
}

type Action = "pause" | "resume" | "reload";

/** One device: what it watches, its connection, and the buttons to control it. */
export function ClientCard({ client, droneName, onChanged }: ClientCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const issues = qualityIssues(client.quality);
  const state = client.paused ? "paused" : client.online ? "online" : "offline";

  const run = (action: Action) => {
    setBusy(true);
    apiPost(`/api/admin/clients/${encodeURIComponent(client.id)}/${action}`)
      .then(() => setError(undefined))
      .catch(() => setError(t.admin.actionFailed))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  return (
    <li className="admin-client" data-state={state}>
      <div className="admin-client-head">
        <h3>{clientLabel(client)}</h3>
        <span className="admin-client-state">
          {client.paused ? t.admin.paused : client.online ? t.admin.online : t.admin.offline}
        </span>
      </div>
      <p className="quiet admin-client-meta">
        {[
          client.name !== null && client.device,
          client.address,
          client.online && client.onlineSince
            ? t.admin.onlineSince(formatSince(client.onlineSince))
            : t.admin.lastSeen(clockTime(client.lastSeen)),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="admin-client-streams">
        {client.streams.length === 0
          ? t.admin.noStreams
          : client.streams
              .map((s) => `${droneName(s.droneId)}${s.mode === "keyframes" ? ` (${t.admin.dataSaver})` : ""}`)
              .join(", ")}
      </p>
      {client.online && (
        <p className="admin-client-quality" data-issues={issues.length > 0 || undefined}>
          <span className="quiet">{t.admin.quality}: </span>
          {[formatKbps(client.quality.kbps), ...(issues.length > 0 ? issues : [t.admin.qualityGood])].join(
            " · ",
          )}
        </p>
      )}
      {client.anonymous ? (
        <p className="quiet">{t.admin.anonymous}</p>
      ) : (
        <div className="admin-client-actions">
          {client.paused ? (
            <button type="button" className="admin-primary" disabled={busy} onClick={() => run("resume")}>
              {t.admin.resume}
            </button>
          ) : (
            <button type="button" className="admin-pause" disabled={busy} onClick={() => run("pause")}>
              {t.admin.pause}
            </button>
          )}
          <button
            type="button"
            disabled={busy || !client.online}
            title={client.online ? undefined : t.admin.reloadUnavailable}
            onClick={() => run("reload")}
          >
            {t.admin.reload}
          </button>
          <button type="button" disabled={busy} onClick={() => setRenaming(true)}>
            {t.admin.rename}
          </button>
        </div>
      )}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {renaming && (
        <RenameDialog
          client={client}
          onClose={() => setRenaming(false)}
          onSaved={() => {
            setRenaming(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function RenameDialog(props: { client: AdminClient; onClose: () => void; onSaved: () => void }) {
  const { client, onClose, onSaved } = props;
  const [name, setName] = useState(client.name ?? "");
  const [error, setError] = useState<string>();

  const save = (value: string | null) => {
    apiPost(`/api/admin/clients/${encodeURIComponent(client.id)}/name`, { name: value })
      .then(onSaved)
      .catch(() => setError(t.admin.actionFailed));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save(name.trim() || null);
  };

  return (
    <Dialog title={t.admin.renameTitle} onClose={onClose}>
      <form className="admin-rename" onSubmit={submit}>
        <p className="quiet">{[client.device, client.address].filter(Boolean).join(" · ")}</p>
        <label>
          <span>{t.admin.nameLabel}</span>
          <input
            type="text"
            autoFocus
            maxLength={ADMIN_NAME_MAX}
            placeholder={t.admin.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-client-actions">
          <button type="submit" className="admin-primary">
            {t.admin.save}
          </button>
          {client.name !== null && (
            <button type="button" onClick={() => save(null)}>
              {t.admin.removeName}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
