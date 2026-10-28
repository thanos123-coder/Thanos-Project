"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { generate } from "@/lib/generation/ui-generation.js";

/**
 * AI output that arrives as if it is being drawn (transitions.dev UI generation, skeleton mode): a dotted
 * wireframe measured from the element itself, then the real UI behind a scan line. Plays once when it mounts,
 * which is when the answer arrives; with reduced motion it is a 200ms fade.
 */
export function Generated({
  delay = 0,
  duration = 1600,
  className,
  children,
  ...rest
}: { delay?: number; duration?: number } & ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const run = generate(el, { mode: "skeleton", duration, delay });
    return () => run.cancel();
  }, [delay, duration]);
  return (
    <div ref={ref} className={className} {...rest}>
      {children}
    </div>
  );
}
