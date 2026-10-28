"use client";

import createGlobe from "cobe";
import { useEffect, useRef } from "react";

const athens: [number, number] = [37.98, 23.73];
const destinations: [number, number][] = [
  [51.51, -0.13], // London
  [42.36, -71.06], // Boston
  [43.65, -79.38], // Toronto
  [52.01, 4.36], // Delft
  [48.14, 11.58], // Munich
  [47.37, 8.54], // Zurich
  [45.46, 9.19], // Milan
  [1.35, 103.82], // Singapore
  [24.45, 54.38], // Abu Dhabi
];

/**
 * The global journey, drawn as a horizon: only the top of the planet shows, with arcs from Greece
 * to the nine countries Upchance covers. It turns slowly, can be dragged, holds still for reduced
 * motion, and stops drawing when it is off screen or the tab is hidden.
 *
 * The canvas is only as tall as the visible cap (cobe's scale and offset place the sphere below it),
 * so the GPU draws a strip, not a whole sphere.
 */
export function Globe({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; phi: number } | null>(null);
  const phi = useRef(-0.35);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current;
    const wrap = box.current;
    if (!el || !wrap) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const fit = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      const r = Math.min(Math.max(w * 0.44, 250), 500);
      const centre = h * 0.1 + r;
      const scale = r / (0.4 * h);
      return { width: w, height: h, scale, offset: [0, (2 * (centre - h / 2)) / scale] as [number, number] };
    };

    const before = document.head.lastElementChild;
    const globe = createGlobe(el, {
      devicePixelRatio: dpr,
      ...fit(),
      phi: phi.current,
      theta: 0.22,
      dark: 0,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      mapBaseBrightness: 0.03,
      baseColor: [0.886, 0.898, 0.918],
      markerColor: [0.122, 0.176, 0.902],
      glowColor: [0.984, 0.988, 0.992],
      markers: [{ location: athens, size: 0.026 }, ...destinations.map((d) => ({ location: d, size: 0.014 }))],
      markerElevation: 0.01,
      arcs: destinations.map((d) => ({ from: athens, to: d })),
      arcColor: [0.122, 0.176, 0.902],
      arcWidth: 0.4,
      arcHeight: 0.09,
    });
    // cobe rewrites a :root stylesheet every frame for anchored markers. Nothing is anchored here,
    // so freeze that sheet and spare the whole page a style recalculation per frame.
    const sheet = document.head.lastElementChild;
    if (sheet && sheet !== before && sheet.tagName === "STYLE") {
      Object.defineProperty(sheet, "textContent", { configurable: true, get: () => "", set: () => {} });
    }

    let frame = 0;
    let visible = true;
    const draw = () => globe.update({ phi: phi.current });
    const loop = () => {
      if (!drag.current) phi.current += 0.0018;
      draw();
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      if (!reduce && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };
    redraw.current = () => {
      if (reduce) draw();
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      start();
    });
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      globe.update(fit());
      if (reduce) draw();
    });
    ro.observe(wrap);
    document.addEventListener("visibilitychange", start);

    draw();
    start();
    const show = requestAnimationFrame(() => (el.style.opacity = "1"));
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(show);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", start);
      globe.destroy();
    };
  }, []);

  return (
    <div ref={box} className={className}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="A globe with arcs from Greece to the United Kingdom, the United States, Canada, the Netherlands, Germany, Switzerland, Italy, Singapore and the United Arab Emirates"
        className="block size-full cursor-grab touch-pan-y opacity-0 transition-opacity duration-1000 active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, phi: phi.current };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          phi.current = drag.current.phi + (e.clientX - drag.current.x) / 240;
          redraw.current();
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  );
}
