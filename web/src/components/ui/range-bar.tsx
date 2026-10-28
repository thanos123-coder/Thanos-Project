"use client";

import clsx from "clsx";
import type { CSSProperties } from "react";

export type Verdict = "Likely" | "Possible" | "Reach";

export const verdictTone: Record<Verdict, string> = {
  Likely: "bg-cobalt text-on-cobalt",
  Possible: "bg-cobalt-tint text-ink",
  Reach: "bg-mid text-ink",
};

/**
 * The honest range: a track, a band from the low to the high estimate, and a marker at its middle.
 * `reach` draws a lighter extension of the band: where it could go, never a promise.
 * Animates with clip-path and transform only.
 */
export function RangeBar({
  low,
  high,
  reach,
  size = "md",
  tone = "cobalt",
  track = "surface",
  className,
  label,
}: {
  low: number;
  high: number;
  reach?: number;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "cobalt" | "ink" | "paper";
  track?: "surface" | "ground" | "paper" | "cobaltDeep";
  className?: string;
  label?: string;
}) {
  const mid = (low + high) / 2;
  const height = { sm: "h-2.5", md: "h-4", lg: "h-6", xl: "h-10" }[size];
  const marker = { sm: "0.7rem", md: "1rem", lg: "1.4rem", xl: "2.1rem" }[size];
  const ring = { sm: "3px", md: "4px", lg: "5px", xl: "7px" }[size];
  const band = tone === "cobalt" ? "var(--cobalt)" : tone === "ink" ? "var(--ink)" : "var(--paper)";
  const trackBg = {
    surface: "bg-surface",
    ground: "bg-ground",
    paper: "bg-paper",
    cobaltDeep: "bg-[#3340ea]",
  }[track];

  return (
    <div
      role="img"
      aria-label={label ?? `Estimated range ${low} to ${high} percent`}
      className={clsx("relative w-full rounded-full [container-type:inline-size]", height, trackBg, className)}
      style={{ "--band": band } as CSSProperties}
    >
      {reach !== undefined && reach > high ? (
        <div
          aria-hidden
          className="absolute inset-0 rounded-full transition-[clip-path] duration-550 ease-[var(--ease-in-out)] motion-reduce:transition-none"
          style={{
            background: tone === "paper" ? "rgba(255,255,255,0.35)" : "var(--cobalt-tint)",
            clipPath: `inset(0 ${100 - reach}% 0 ${low}% round 999px)`,
          }}
        />
      ) : null}
      <div
        aria-hidden
        data-range-band
        className="absolute inset-0 rounded-full transition-[clip-path] duration-550 ease-[var(--ease-in-out)] motion-reduce:transition-none"
        style={{ background: band, clipPath: `inset(0 ${100 - high}% 0 ${low}% round 999px)` }}
      />
      {/* A zero-width rail moved in container units, so the marker glides without widening the page */}
      <div
        aria-hidden
        data-range-rail
        className="absolute left-0 top-0 h-full w-0 transition-transform duration-550 ease-[var(--ease-in-out)] motion-reduce:transition-none"
        style={{ transform: `translateX(${mid}cqw)` }}
      >
        <span
          className="marker left-0"
          style={{ "--marker": marker, "--marker-ring": ring } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function VerdictChip({ verdict, className }: { verdict: Verdict | "More details needed"; className?: string }) {
  const tone = verdict === "More details needed" ? "bg-surface text-soft" : verdictTone[verdict];
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center rounded-full px-3 text-small font-medium leading-none transition-[background-color,color] duration-200 ease-[ease]",
        tone,
        className,
      )}
    >
      <Swap value={verdict} />
    </span>
  );
}

/**
 * Text that changes in place (a verdict, a name) arrives with a short blurred rise instead of teleporting
 * (transitions.dev text swap: 4px, 2px blur). Keyed, so each new value plays once.
 */
export function Swap({ value, className }: { value: string; className?: string }) {
  return (
    <span key={value} className={clsx("swap-in", className)}>
      {value}
    </span>
  );
}
