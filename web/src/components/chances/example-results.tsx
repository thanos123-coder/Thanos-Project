"use client";

import { useState } from "react";
import clsx from "clsx";
import { RangeBar, VerdictChip } from "@/components/ui/range-bar";
import { Switch } from "@/components/ui/switch";
import { TextLink } from "@/components/ui/button";
import { eleniResults, exampleStudent, verdictFor } from "@/content/universities";
import { worstResults } from "@/content/worst-case";
import { useFixture } from "@/lib/data-mode";

/** "What your results look like": Eleni's five results, with one switch for what would move each range. */
export function ExampleResults() {
  const [moves, setMoves] = useState(false);
  const results = useFixture(eleniResults, worstResults);
  return (
    <section className="frame section" aria-labelledby="results-title">
      <div className="grid-12 gap-y-6">
        <div className="col-span-12 lg:col-span-7">
          <h2 id="results-title" className="text-head">
            What your results look like
          </h2>
          <p className="mt-5 max-w-[46ch] text-lead text-soft">{exampleStudent.line}</p>
        </div>
        <div className="col-span-12 flex items-end lg:col-span-5 lg:justify-end">
          <label className="flex cursor-pointer items-center gap-4 rounded-full bg-surface py-2 pl-5 pr-2 text-body font-medium">
            Show what would move each one
            <span className="text-[1.75rem] leading-none">
              <Switch checked={moves} onCheckedChange={setMoves} label="Show what would move each one" />
            </span>
          </label>
        </div>
      </div>

      <ul className="mt-12 grid gap-2 md:grid-cols-2">
        {results.map((u, i) => {
          const verdict = verdictFor(u);
          const has = u.low !== undefined && u.high !== undefined;
          return (
            <li
              key={u.id}
              data-ui
              className={clsx(
                "result-card flex flex-col rounded-[var(--radius)] bg-paper p-6 sm:p-7",
                !has && "md:col-span-1",
              )}
              style={{ "--i": i } as React.CSSProperties}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-full bg-surface px-2 text-small font-bold">
                    {u.short}
                  </span>
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-lead font-medium leading-tight" title={u.name}>
                      {u.name}
                    </h3>
                    <p className="text-small text-soft">{u.country}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {has ? (
                    <p className="tabular whitespace-nowrap text-[clamp(1.75rem,1.3rem+1.4vw,2.5rem)] font-medium leading-none tracking-[-0.03em]">
                      {u.low}–{u.high}%
                    </p>
                  ) : null}
                  <VerdictChip verdict={verdict} />
                </div>
              </div>
              {has ? (
                <>
                  <RangeBar
                    className="mt-6"
                    low={u.low!}
                    high={u.high!}
                    reach={moves ? u.could : undefined}
                    size="md"
                    label={`${u.name}: ${u.low} to ${u.high} percent`}
                  />
                  {u.offerChance !== undefined ? (
                    <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-small text-soft tabular">
                      <span>Offer chance: {u.offerChance}%</span>
                      <span>Meeting the offer: {u.meetingOffer}%</span>
                    </p>
                  ) : null}
                  <p className="mt-4 flex items-center gap-2.5 text-body">
                    <span className="bullet" aria-hidden />
                    {u.mover}
                  </p>
                </>
              ) : (
                <div className="mt-6 flex flex-1 flex-col justify-between gap-4">
                  <div className="h-4 rounded-full bg-surface" aria-hidden />
                  <TextLink href="/assessment" tone="cobalt">
                    Add the details it needs
                  </TextLink>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
