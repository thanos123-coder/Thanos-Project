"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "lenis/dist/lenis.css";

gsap.registerPlugin(ScrollTrigger);

/** Interface that scrolls on its own keeps native scrolling: dialogs, menus, listboxes and marked scrollers. */
const nativeScroll = '[role="dialog"], [role="menu"], [role="listbox"], [data-lenis-prevent]';

/**
 * Lenis gives the page its weight. GSAP's ticker drives it, so every ScrollTrigger scene reads the same
 * smoothed position on the same frame. Lenis turns smoothing off by itself for reduced motion, and pauses
 * while a dialog locks the page (autoToggle).
 */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      autoRaf: false,
      lerp: 0.12,
      autoToggle: true,
      anchors: { offset: -32 },
      stopInertiaOnNavigate: true,
      prevent: (node) => node instanceof Element && node.matches(nativeScroll),
    });
    const off = lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      off();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return null;
}
