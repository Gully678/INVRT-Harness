import { formatAppDisplayName } from "../branding.logic";
import { InvrtMark, InvrtWordmark } from "./InvrtMark";

// Ratios and cap-band alignment come from the approved Lockup.jsx master.
export function InvrtLockup({
  cap = 14,
  title = "INVRT Code",
  className,
  stageLabel,
}: {
  readonly cap?: number;
  readonly title?: string;
  readonly className?: string;
  readonly stageLabel?: string;
}) {
  const channelCue = stageLabel ? formatAppDisplayName({ baseName: "", stageLabel }).trim() : "";
  return (
    <span
      role="img"
      aria-label={title}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: cap * 0.42,
        padding: cap * 0.5,
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    >
      <span
        aria-hidden
        style={{ position: "relative", flex: "none", width: cap * 5.924044, height: cap * 1.21 }}
      >
        <InvrtMark
          aria-hidden
          style={{
            position: "absolute",
            display: "block",
            left: 0,
            top: 0,
            width: cap * 1.455044,
            height: cap * 1.21,
          }}
        />
        <InvrtWordmark
          aria-hidden
          style={{
            position: "absolute",
            display: "block",
            left: cap * 1.855044,
            top: cap * 0.082164,
            width: cap * 4.069,
            height: cap * 1.0418519,
          }}
        />
      </span>
      <span
        aria-hidden
        style={{
          fontFamily: '"Inter Variable", Inter, sans-serif',
          fontWeight: 600,
          fontSize: cap * 0.86,
          letterSpacing: "-.005em",
          lineHeight: 1.21 / 0.86,
          textTransform: "none",
          whiteSpace: "nowrap",
        }}
      >
        Code
        {channelCue ? <span> {channelCue}</span> : null}
      </span>
    </span>
  );
}
