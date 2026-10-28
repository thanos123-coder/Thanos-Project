"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import clsx from "clsx";
import type { ReactNode } from "react";

/** Tabs whose active marker is the motif: a capsule that slides to the chosen tab. */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
  children,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode }[];
  className?: string;
  children?: ReactNode;
  label: string;
}) {
  return (
    <BaseTabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <BaseTabs.List
        aria-label={label}
        className="relative z-0 inline-flex rounded-full bg-surface p-1"
      >
        {tabs.map((t) => (
          <BaseTabs.Tab
            key={t.value}
            value={t.value}
            className="press relative z-10 flex h-11 items-center gap-2 rounded-full px-5 text-body font-medium text-soft outline-none transition-colors duration-200 hover:text-ink focus-visible:shadow-[0_0_0_3px_var(--cobalt)] data-[active]:text-ink"
          >
            {t.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="tab-indicator absolute inset-x-0 top-1 -z-0 h-11 rounded-full bg-paper [clip-path:inset(0_var(--active-tab-right)_0_var(--active-tab-left)_round_999px)] transition-[clip-path] duration-250 ease-[var(--ease-out)] motion-reduce:transition-none" />
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}

export const TabPanel = BaseTabs.Panel;

/** A segmented choice (radio semantics) with the same sliding capsule. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; note?: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("grid auto-cols-fr grid-flow-col gap-1 rounded-[1.375rem] bg-surface p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                onChange(options[(i + 1) % options.length].value);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                onChange(options[(i - 1 + options.length) % options.length].value);
              }
            }}
            tabIndex={on ? 0 : -1}
            className={clsx(
              "press relative flex min-h-14 flex-col items-center justify-center rounded-[1.125rem] px-3 py-2 text-center outline-none transition-colors duration-200 focus-visible:shadow-[0_0_0_3px_var(--cobalt)]",
              on ? "bg-paper text-ink" : "text-soft hover:text-ink",
            )}
          >
            <span className="text-body font-medium">{o.label}</span>
            {o.note ? <span className={clsx("text-small", on ? "text-cobalt" : "")}>{o.note}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
