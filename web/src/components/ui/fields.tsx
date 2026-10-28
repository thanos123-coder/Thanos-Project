"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import clsx from "clsx";
import { useId, type ComponentProps, type ReactNode } from "react";

export const inputClass =
  "w-full rounded-[1rem] bg-surface px-4 text-body text-ink outline-none transition-[background-color,box-shadow] duration-200 placeholder:text-soft/80 hover:bg-mid/60 focus-visible:bg-paper focus-visible:shadow-[0_0_0_3px_var(--cobalt)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)] aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_var(--danger)]";

/**
 * The transitions.dev error shake: a short, decaying side-to-side shake on the field that needs attention.
 * Restarts cleanly on a second failed try (remove, reflow, add).
 */
export function shake(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) return;
  el.classList.remove("is-shaking");
  void el.offsetWidth;
  el.classList.add("is-shaking");
  window.setTimeout(() => el.classList.remove("is-shaking"), 320);
}

/**
 * A visible label above its control, an optional hint, and an error that says how to fix it.
 * The hint and the error are both tied to the control with aria-describedby.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (ids: { id: string; hintId?: string; invalid: boolean }) => ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const auto = useId();
  const id = htmlFor ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      {children({ id, hintId: describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-small text-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error flex items-center gap-2 text-small font-medium text-danger">
          <span aria-hidden className="relative block h-2.5 w-5 shrink-0 rounded-full bg-danger">
            <span className="absolute left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-paper" />
          </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: ComponentProps<"input">) {
  return <input className={clsx(inputClass, "h-13", className)} {...rest} />;
}

export function TextArea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={clsx(inputClass, "min-h-28 resize-y py-3 leading-relaxed", className)} {...rest} />;
}

/** Base UI Select dressed as a capsule; its popup grows from the trigger. */
export function Select<T extends string>({
  value,
  onChange,
  items,
  id,
  label,
  className,
  tone = "surface",
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
  id?: string;
  label?: string;
  className?: string;
  tone?: "surface" | "onInk";
}) {
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => v !== null && onChange(v as T)} items={items}>
      <BaseSelect.Trigger
        id={id}
        aria-label={label}
        className={clsx(
          "press flex h-13 w-full items-center justify-between gap-3 rounded-[1rem] px-4 text-left text-body outline-none focus-visible:shadow-[0_0_0_3px_var(--cobalt)]",
          tone === "surface" ? "bg-surface text-ink hover:bg-mid/60" : "bg-white/10 text-paper hover:bg-white/15",
          className,
        )}
      >
        <BaseSelect.Value className="truncate" />
        <BaseSelect.Icon className="shrink-0">
          <svg viewBox="0 0 16 16" className="size-4 opacity-70" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={8} alignItemWithTrigger={false} className="z-[60]">
          <BaseSelect.Popup className="menu-pop max-h-[min(22rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-[1.25rem] bg-paper p-1.5 text-ink shadow-[0_24px_60px_-20px_rgba(12,16,48,0.35)]">
            <BaseSelect.List>
              {items.map((it) => (
                <BaseSelect.Item key={it.value} value={it.value} className="menu-item justify-between gap-4 data-[selected]:font-medium">
                  <BaseSelect.ItemText>{it.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <span className="block size-2.5 rounded-full bg-cobalt" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
