"use client";

import { Slider } from "@base-ui/react/slider";

/** A slider cut from the motif: the track is the range, the thumb is the marker. */
export function MotifSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (v: number) => string;
}) {
  return (
    <Slider.Root
      value={value}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      min={min}
      max={max}
      step={step}
      className="w-full"
    >
      <Slider.Control className="flex h-12 w-full touch-none select-none items-center">
        <Slider.Track className="relative h-5 w-full rounded-full bg-surface">
          <Slider.Indicator className="rounded-full bg-cobalt" />
          <Slider.Thumb
            aria-label={label}
            getAriaValueText={format ? (_formatted: string, v: number) => format(v) : undefined}
            className="size-8 rounded-full bg-paper shadow-[0_0_0_6px_var(--cobalt)] outline-none transition-[box-shadow,scale] duration-150 has-[:focus-visible]:shadow-[0_0_0_6px_var(--cobalt),0_0_0_10px_var(--cobalt-tint)] data-[dragging]:scale-110"
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
