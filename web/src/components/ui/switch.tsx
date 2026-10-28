"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import clsx from "clsx";

/**
 * The motif as a control: the track is the band, the thumb is the marker.
 * Sized in em so it can sit inside a sentence at any type size.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
  tone = "cobalt",
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  className?: string;
  tone?: "cobalt" | "ink" | "paper";
}) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v)}
      aria-label={label}
      className={clsx(
        "group/sw press relative inline-flex h-[1.1em] w-[2em] shrink-0 items-center rounded-full p-[0.12em] transition-colors duration-200 ease-[var(--ease-out)]",
        "data-unchecked:bg-mid",
        tone === "cobalt" && "data-checked:bg-cobalt",
        tone === "ink" && "data-checked:bg-ink",
        tone === "paper" && "data-checked:bg-paper",
        className,
      )}
    >
      <BaseSwitch.Thumb
        className={clsx(
          "block aspect-square h-full rounded-full transition-transform duration-200 ease-[var(--ease-out)] data-checked:translate-x-[0.9em]",
          tone === "paper" ? "bg-paper data-checked:bg-cobalt" : "bg-paper",
        )}
      />
    </BaseSwitch.Root>
  );
}
