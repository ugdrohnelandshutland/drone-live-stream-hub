/** A labelled switch in the wall header ("Nur live", "Datensparen"): filled while on. */
export function HeaderSwitch(props: {
  label: string;
  /** Tooltip: what tapping does now. */
  title: string;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Styles the dot while on, e.g. "live" for the live colour. */
  tone?: "live";
}) {
  const { label, title, on, onChange, tone } = props;
  return (
    <button
      type="button"
      role="switch"
      className="header-switch"
      data-tone={tone}
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
    >
      <span className="header-switch-dot" aria-hidden="true" />
      {label}
    </button>
  );
}
