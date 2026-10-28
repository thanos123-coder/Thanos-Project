"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";

/** Shared delay group: the first tip waits, the next ones open instantly (emil-design-eng). */
export const TipProvider = Tooltip.Provider;

export function Tip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={8} className="z-[60]">
          <Tooltip.Popup className="tip-pop rounded-full bg-ink px-3 py-1.5 text-small font-medium text-paper">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
