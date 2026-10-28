"use client";

import { useRef, type ComponentProps, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Expo out, the gallery's arrival curve; scrubbed scenes stay linear because the scroll is the easing. */
const ARRIVE = "expo.out";
const once = (trigger: Element, start = "top 78%") => ({ trigger, start, once: true });

/**
 * Each section arrives in its own manner, chosen for what it holds, and only once.
 * Everything here is created inside a reduced-motion query, so with reduced motion (or without script)
 * the page is simply there.
 */
const scenes = {
  // The footer's name climbs out of the ground as the page ends: each capsule fills from its base,
  // left to right, locked to the scroll
  "rising-name": (root: HTMLElement) => {
    const bars = gsap.utils.toArray<HTMLElement>(".rising-bar", root);
    gsap.fromTo(
      bars,
      { clipPath: "inset(100% 0% 0% 0% round 999px 999px 20px 20px)" },
      {
        clipPath: "inset(0% 0% 0% 0% round 999px 999px 20px 20px)",
        ease: "none",
        stagger: 0.12,
        scrollTrigger: { trigger: root, start: "top bottom", end: "bottom 82%", scrub: 0.6 },
      },
    );
  },

  // Three figures that refuse to line up step into their places, each from its own depth
  "stepped-tiles": (root: HTMLElement) => {
    const tiles = gsap.utils.toArray<HTMLElement>(".stat-tile", root);
    gsap.from(tiles, {
      y: (i) => 64 + i * 36,
      opacity: 0,
      duration: 1.1,
      ease: ARRIVE,
      stagger: 0.09,
      clearProps: "transform,opacity",
      scrollTrigger: once(root),
    });
  },

  // The tiles that grow open from their base, small to large, and each stage of the product settles inside
  "grow-tiles": (root: HTMLElement) => {
    const tiles = gsap.utils.toArray<HTMLElement>(".grow-tile", root);
    const tl = gsap.timeline({ scrollTrigger: once(root, "top 72%") });
    tiles.forEach((tile, i) => {
      const inner = tile.firstElementChild?.firstElementChild;
      tl.fromTo(
        tile,
        { clipPath: "inset(100% 0% 0% 0% round 28px)" },
        { clipPath: "inset(0% 0% 0% 0% round 28px)", duration: 0.9, ease: "power3.inOut", clearProps: "clipPath" },
        i * 0.16,
      );
      if (inner)
        tl.from(inner, { y: 28, opacity: 0, duration: 0.8, ease: ARRIVE, clearProps: "transform,opacity" }, i * 0.16 + 0.45);
    });
  },

  // A list arrives row by row, in reading order
  rows: (root: HTMLElement) => {
    gsap.utils.toArray<HTMLElement>("ul", root).forEach((list) => {
      gsap.from(list.children, {
        y: 16,
        opacity: 0,
        duration: 0.7,
        ease: ARRIVE,
        stagger: 0.035,
        clearProps: "transform,opacity",
        scrollTrigger: once(list, "top 82%"),
      });
    });
  },

  // The proof board's tiles settle into the grid one after another
  board: (root: HTMLElement) => {
    gsap.from(root.children, {
      scale: 0.94,
      opacity: 0,
      duration: 0.9,
      ease: ARRIVE,
      stagger: { each: 0.045, grid: "auto", from: "start" },
      transformOrigin: "50% 100%",
      clearProps: "transform,opacity",
      scrollTrigger: once(root),
    });
  },

  // Index cards dealt onto the table: each lands with a slight turn that straightens
  "deal-cards": (root: HTMLElement) => {
    const cards = gsap.utils.toArray<HTMLElement>(".faq-card", root);
    gsap.from(cards, {
      y: 56,
      rotate: (i) => (i % 2 ? 1.4 : -1.4),
      opacity: 0,
      duration: 0.95,
      ease: ARRIVE,
      stagger: 0.045,
      clearProps: "transform,opacity",
      scrollTrigger: once(root),
    });
  },

  // How a range is made, told in order: the published rate, the students admitted, the band, then you on it
  estimate: (root: HTMLElement) => {
    gsap.utils.toArray<HTMLElement>("[data-step]", root).forEach((step) => {
      const tl = gsap.timeline({ scrollTrigger: once(step, "top 80%") });
      const pops = step.querySelectorAll("[data-pop]");
      if (pops.length)
        tl.from(pops, {
          scale: 0.6,
          opacity: 0,
          duration: 0.55,
          ease: ARRIVE,
          stagger: { each: 0.015, from: "random" },
          clearProps: "transform,opacity",
        });
      const band = step.querySelector("[data-band]");
      if (band)
        tl.from(band, { scaleX: 0.08, opacity: 0, duration: 0.9, ease: "power3.inOut", clearProps: "transform,opacity" }, "-=0.1");
      const you = step.querySelector("[data-you]");
      if (you) tl.from(you, { y: -18, opacity: 0, duration: 0.6, ease: ARRIVE, clearProps: "transform,opacity" }, "-=0.25");
    });
  },
} satisfies Record<string, (root: HTMLElement) => void>;

export type SceneKind = keyof typeof scenes;

export function Scene({
  kind,
  children,
  className,
  as: Tag = "div",
  ...rest
}: {
  kind: SceneKind;
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
} & Omit<ComponentProps<"div">, "children" | "className">) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => scenes[kind](root));
      return () => mm.revert();
    },
    { scope: ref, dependencies: [kind] },
  );
  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}
