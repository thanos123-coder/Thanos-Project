"use client";

import { useSyncExternalStore } from "react";

/**
 * Dev-only data switch (break-ui): `?data=worst` swaps the demo content for the worst-case fixtures,
 * `?data=empty` for empty lists. Production always gets the demo content.
 */
export type DataMode = "demo" | "worst" | "empty";

const EVENT = "upchance:data-mode";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function read(): DataMode {
  if (process.env.NODE_ENV === "production") return "demo";
  const v = new URLSearchParams(window.location.search).get("data");
  return v === "worst" || v === "empty" ? v : "demo";
}

export function useDataMode(): DataMode {
  return useSyncExternalStore(subscribe, read, () => "demo");
}

/** The fixture for the current mode; `empty` keeps the demo content where a list has no empty state. */
export function useFixture<T>(demo: T, worst: T, empty?: T): T {
  const mode = useDataMode();
  if (mode === "worst") return worst;
  if (mode === "empty") return empty ?? demo;
  return demo;
}

export function setDataMode(mode: DataMode) {
  const url = new URL(window.location.href);
  if (mode === "demo") url.searchParams.delete("data");
  else url.searchParams.set("data", mode);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(EVENT));
}
