"use client";

import { Fragment, type ReactNode } from "react";
import { setDataMode, useDataMode, type DataMode } from "@/lib/data-mode";

const modes: { id: DataMode; label: string }[] = [
  { id: "demo", label: "Demo data" },
  { id: "worst", label: "Worst case" },
  { id: "empty", label: "Empty" },
];

/**
 * Dev-only (break-ui): remounts the page when the data mode changes, so state seeded from the fixtures
 * starts again, and shows the switch. Plain chrome on purpose: it is not part of the design.
 */
export function DataSwitch({ children }: { children: ReactNode }) {
  const mode = useDataMode();
  return (
    <>
      <Fragment key={mode}>{children}</Fragment>
      <div
        role="group"
        aria-label="Data"
        data-lenis-prevent
        style={{
          position: "fixed",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2147483647,
          display: "flex",
          gap: 2,
          padding: 3,
          borderRadius: 10,
          background: "#d4d4d8",
          font: "500 12px/1 system-ui, sans-serif",
          color: "#18181b",
        }}
      >
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => setDataMode(m.id)}
            style={{
              padding: "7px 10px",
              borderRadius: 7,
              border: 0,
              cursor: "pointer",
              background: mode === m.id ? "#ffffff" : "transparent",
              color: "inherit",
              font: "inherit",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    </>
  );
}
