'use client';

/**
 * The wallet connect → sign progress rail, as a single presentational piece.
 *
 * The step's own state (which check is pending, which is met, whether the
 * signature just verified) is derived by the caller; this component only paints
 * it. It replaces the earlier two-chip strip, which could only ever show the
 * sign check as "active": a completed signature had no representation, so the
 * mark silently vanished the moment the wallet was torn down.
 *
 * The rail is one continuous line with a dot per check. The coloured "lit"
 * layer is the same geometry as the resting layer, clipped from the right to
 * the completed fraction, so the line fills smoothly and each dot turns green
 * exactly as the fill crosses it rather than popping per check. The clip
 * transition is the only motion; it lives in `globals.css` (`.kade-checkrail-*`)
 * and every keyframe is disabled under `prefers-reduced-motion: reduce`, where
 * the end states stay fully legible.
 *
 * A check that is `active` (in flight) shows a pulsing ring but never a filled
 * dot; a check that failed or was skipped simply never becomes `done`, so the
 * rail cannot imply a success the app has not established.
 */

export type CheckState = 'upcoming' | 'active' | 'done';

export interface ConnectSignCheck {
  /** The exact visible label, e.g. `Step 2 · Sign (optional)`. */
  readonly label: string;
  readonly state: CheckState;
}

export interface ConnectSignRailProps {
  /** The checks in order, one dot each. */
  readonly checks: readonly ConnectSignCheck[];
}

export function ConnectSignRail({ checks }: ConnectSignRailProps) {
  const total = checks.length;
  const done = checks.filter((check) => check.state === 'done').length;
  const progress = total === 0 ? 0 : done / total;
  // The right inset that leaves `progress` of the rail revealed.
  const clipPath = `inset(0 ${100 - progress * 100}% 0 0)`;
  const allDone = total > 0 && done === total;

  return (
    <div
      className={`kade-checkrail${allDone ? ' kade-checkrail-done' : ''}`}
      role="group"
      aria-label="Wallet verification progress"
    >
      {/* The resting rail: a muted track with one dot per check. */}
      <span aria-hidden className="kade-checkrail-track" />
      <div className="kade-checkrail-items">
        {checks.map((check, index) => (
          <CheckItem key={check.label} check={check} index={index} />
        ))}
      </div>

      {/*
        The lit overlay: identical geometry, clipped to the completed fraction.
        It carries only dots (never the labels), so the accessible text is not
        duplicated. A `done` check is drawn resting here and lights up only as
        the fill reaches it.
      */}
      <div
        aria-hidden
        className="kade-checkrail-lit"
        style={{ clipPath }}
      >
        <span className="kade-checkrail-lit-line" />
        <div className="kade-checkrail-items">
          {checks.map((check) => (
            <div className="kade-checkrail-item" key={check.label}>
              <span className="kade-checkrail-dot kade-checkrail-dot-done">
                ✓
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CheckItem({
  check,
  index,
}: Readonly<{ check: ConnectSignCheck; index: number }>) {
  // A met check is drawn muted in the resting layer so the lit overlay is what
  // turns it green, in step with the fill. Only in-flight checks keep the
  // pulse here.
  const restingState = check.state === 'done' ? 'upcoming' : check.state;
  return (
    <div
      className="kade-checkrail-item"
      data-state={check.state}
      aria-current={check.state === 'active' ? 'step' : undefined}
    >
      <span
        aria-hidden
        className={`kade-checkrail-dot${
          restingState === 'active' ? ' kade-checkrail-dot-active' : ''
        }`}
      >
        {index + 1}
      </span>
      <span className="kade-checkrail-label">{check.label}</span>
    </div>
  );
}
