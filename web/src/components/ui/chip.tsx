"use client";

import clsx from "clsx";
import type { ComponentProps } from "react";

/** A pressable capsule that shows its state: off on the surface, on in cobalt with its marker lit. */
export function Chip({
  pressed,
  className,
  children,
  size = "md",
  onField = false,
  ...rest
}: ComponentProps<"button"> & { pressed?: boolean; size?: "sm" | "md"; onField?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={clsx(
        "press group/chip inline-flex items-center gap-2 rounded-full font-medium",
        size === "md" ? "h-11 px-4 text-body" : "h-9 px-3.5 text-small",
        pressed
          ? "bg-cobalt text-on-cobalt"
          : onField
            ? "bg-white/12 text-on-cobalt hover:bg-white/20"
            : "bg-surface text-ink hover:bg-mid",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={clsx(
          "size-2 rounded-full transition-[transform,background-color] duration-200 ease-[var(--ease-out)]",
          pressed ? "scale-125 bg-paper" : onField ? "bg-white/60" : "bg-soft/50",
        )}
      />
      {children}
    </button>
  );
}
