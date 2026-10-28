"use client";

import NumberFlow from "@number-flow/react";
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A figure that counts up once, when it first scrolls into view. Without script, or with reduced motion,
 * the real number is simply there.
 */
export function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px 10% 0px" });
  const reduce = useReducedMotion();
  // Arm only on the client and only while out of view, so the server HTML (and a figure already on screen)
  // keeps the real number.
  const client = useSyncExternalStore(noop, () => true, () => false);
  const [armed, setArmed] = useState(false);
  if (client && !reduce && !inView && !armed) setArmed(true);
  const [go, setGo] = useState(false);

  useEffect(() => {
    if (armed && inView) {
      const t = setTimeout(() => setGo(true), 120);
      return () => clearTimeout(t);
    }
  }, [armed, inView]);

  const shown = armed && !go ? 0 : value;

  return (
    <span ref={ref} className="tabular">
      <NumberFlow
        value={shown}
        suffix={suffix}
        locales="en-GB"
        transformTiming={{ duration: 1100, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
        spinTiming={{ duration: 1100, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      />
    </span>
  );
}
