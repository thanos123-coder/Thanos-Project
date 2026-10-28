"use client";

import NumberFlow from "@number-flow/react";
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts up once, when it first scrolls into view. Without script, or with reduced motion,
 * the real number is simply there.
 */
export function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px 10% 0px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [armed, setArmed] = useState(false);

  // Arm only on the client, so the server-rendered HTML keeps the real figure.
  useEffect(() => {
    if (reduce) return;
    if (!inView) {
      setShown(0);
      setArmed(true);
    }
  }, [reduce, inView]);

  useEffect(() => {
    if (armed && inView) {
      const t = setTimeout(() => setShown(value), 120);
      return () => clearTimeout(t);
    }
  }, [armed, inView, value]);

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
