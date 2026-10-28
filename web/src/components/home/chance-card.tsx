"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import clsx from "clsx";
import { RangeBar, VerdictChip } from "@/components/ui/range-bar";
import { Switch } from "@/components/ui/switch";
import { exampleStudent, verdictFor, type ExampleChance } from "@/content/universities";

/** One university's example range, as an interface fragment of the product. */
export function ChanceCard({
  uni,
  className,
  size = "md",
  moverToggle = false,
  showStudent = true,
}: {
  uni: ExampleChance;
  className?: string;
  size?: "md" | "lg";
  /** Show the motif switch that reveals what would move the range. */
  moverToggle?: boolean;
  showStudent?: boolean;
}) {
  const [showMover, setShowMover] = useState(true);
  const verdict = verdictFor(uni);
  const hasRange = uni.low !== undefined && uni.high !== undefined;
  const mover = !moverToggle || showMover;

  return (
    <div
      data-ui
      className={clsx("rounded-[var(--radius)] bg-paper text-ink", size === "lg" ? "p-6 sm:p-8" : "p-6", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface text-small font-bold tracking-tight">
            {uni.short}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lead font-medium leading-tight">{uni.name}</p>
            <p className="truncate text-small text-soft">Engineering, {uni.country}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-small font-medium text-soft">Example</span>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        {hasRange ? (
          <p
            className="tabular text-[clamp(2.5rem,1.6rem+2.6vw,3.75rem)] font-medium leading-none tracking-[-0.04em]"
            aria-label={`${uni.low} to ${uni.high} percent`}
          >
            <NumberFlow value={uni.low!} />
            <span className="text-soft">–</span>
            <NumberFlow value={uni.high!} suffix="%" />
          </p>
        ) : (
          <p className="max-w-[26ch] text-body text-soft">{uni.note}</p>
        )}
        <VerdictChip verdict={verdict} />
      </div>

      <div className="mt-5">
        {hasRange ? (
          <RangeBar
            low={uni.low!}
            high={uni.high!}
            reach={mover ? uni.could : undefined}
            size={size === "lg" ? "lg" : "md"}
            label={`${uni.name}: estimated ${uni.low} to ${uni.high} percent${mover && uni.could ? `; what would move it could take it to ${uni.could} percent` : ""}`}
          />
        ) : (
          <div className="h-6 rounded-full bg-surface" aria-hidden />
        )}
      </div>

      {hasRange && uni.offerChance !== undefined ? (
        <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-small text-soft tabular">
          <span>Offer chance: {uni.offerChance}%</span>
          <span>Meeting the offer: {uni.meetingOffer}%</span>
        </p>
      ) : null}

      {hasRange && uni.mover ? (
        moverToggle ? (
          <div className="mt-5 flex items-center justify-between gap-4 rounded-full bg-ground py-2 pl-5 pr-2">
            <p className={clsx("text-body transition-opacity duration-300", showMover ? "opacity-100" : "opacity-60")}>
              {showMover ? uni.mover : "Show what would move it"}
            </p>
            <span className="text-[1.6rem] leading-none">
              <Switch checked={showMover} onCheckedChange={setShowMover} label="Show what would move it" />
            </span>
          </div>
        ) : (
          <p className="mt-4 flex items-center gap-2.5 text-body">
            <span className="bullet" aria-hidden />
            {uni.mover}
          </p>
        )
      ) : null}

      {showStudent ? (
        <p className="mt-5 text-small text-soft">
          {exampleStudent.line}
        </p>
      ) : null}
    </div>
  );
}
