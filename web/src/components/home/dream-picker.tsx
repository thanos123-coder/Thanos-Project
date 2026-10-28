"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { Chip } from "@/components/ui/chip";
import { dreamUniversities, moreUniversities, type ExampleChance } from "@/content/universities";
import { worstDreamUniversities, worstMoreUniversities } from "@/content/worst-case";
import { useFixture } from "@/lib/data-mode";

/** "Where do you dream of studying?" — the chips that drive the live range. */
export function DreamPicker({
  value,
  onChange,
  onField = false,
  className,
  labelClassName,
}: {
  value: string;
  onChange: (u: ExampleChance) => void;
  onField?: boolean;
  className?: string;
  labelClassName?: string;
}) {
  const dream = useFixture(dreamUniversities, worstDreamUniversities);
  return (
    <fieldset className={clsx("min-w-0", className)}>
      <legend className={clsx("mb-3 text-body font-medium", labelClassName)}>Where do you dream of studying?</legend>
      <div className="flex flex-wrap gap-2">
        {dream.map((u) => (
          <Chip key={u.id} size="sm" pressed={value === u.id} onField={onField} onClick={() => onChange(u)} title={u.name}>
            {u.name}
          </Chip>
        ))}
        <MoreUniversities onPick={onChange} onField={onField} value={value} />
      </div>
    </fieldset>
  );
}

function MoreUniversities({
  onPick,
  onField,
  value,
}: {
  onPick: (u: ExampleChance) => void;
  onField: boolean;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dream = useFixture(dreamUniversities, worstDreamUniversities);
  const more = useFixture(moreUniversities, worstMoreUniversities);
  const all = useMemo(() => [...dream, ...more], [dream, more]);
  const results = all.filter((u) => u.name.toLowerCase().includes(query.trim().toLowerCase()));
  const picked = more.find((u) => u.id === value);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className={clsx(
          "press inline-flex h-9 max-w-full items-center gap-2 rounded-full px-3.5 text-small font-medium",
          picked
            ? "bg-cobalt text-on-cobalt"
            : onField
              ? "text-on-cobalt shadow-[inset_0_0_0_2px_rgba(255,255,255,0.5)] hover:bg-white/10"
              : "text-ink shadow-[inset_0_0_0_2px_var(--mid)] hover:bg-surface",
        )}
      >
        <span className="truncate" title={picked?.name}>
          {picked ? picked.name : "More universities"}
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-end sm:place-items-center">
          <Dialog.Popup className="dialog-pop w-full max-w-lg rounded-t-[var(--radius)] bg-paper p-6 text-ink sm:rounded-[var(--radius)] sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-lead font-medium">More universities</Dialog.Title>
                <Dialog.Description className="mt-1 text-body text-soft">
                  Upchance knows admissions facts for 1,600 universities.
                </Dialog.Description>
              </div>
              <Dialog.Close className="press grid size-11 shrink-0 place-items-center rounded-full bg-surface hover:bg-mid" aria-label="Close">
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </Dialog.Close>
            </div>
            <label className="mt-6 block">
              <span className="sr-only">Search universities</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search 1,600 universities"
                className="h-13 w-full rounded-full bg-surface px-5 text-body outline-none placeholder:text-soft focus-visible:ring-3 focus-visible:ring-cobalt"
                autoComplete="off"
                inputMode="search"
              />
            </label>
            <ul className="mt-4 max-h-72 overflow-y-auto">
              {results.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(u);
                      setOpen(false);
                    }}
                    className="press flex w-full items-center justify-between gap-4 rounded-[1.75rem] px-4 py-3 text-left hover:bg-surface"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 min-w-9 shrink-0 place-items-center rounded-full bg-surface px-1.5 text-[0.75rem] font-bold">
                        {u.short}
                      </span>
                      <span className="font-medium">{u.name}</span>
                    </span>
                    <span className="max-w-[9rem] shrink-0 text-right text-small text-soft">{u.country}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 ? (
                <li className="px-4 py-6 text-body text-soft">
                  No match in the examples. The free assessment searches all 1,600.
                </li>
              ) : null}
            </ul>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
