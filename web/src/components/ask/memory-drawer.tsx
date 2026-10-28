"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Drawer } from "@base-ui/react/drawer";
import clsx from "clsx";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";

const HOLD_MS = 1600;

/**
 * Forgetting everything can't be undone, so it asks for a held press instead of a second dialog.
 * The fill sweeps while you hold and snaps back the moment you let go (emil-design-eng hold-to-delete).
 * Works with a held Space or Enter too.
 */
function HoldToForget({ onDone, disabled }: { onDone: () => void; disabled: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onDone();
    }, HOLD_MS);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={disabled}
        data-holding={holding ? "" : undefined}
        aria-describedby="hold-hint"
        onPointerDown={(e) => {
          if (e.button === 0) start();
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") cancel();
        }}
        onBlur={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className="hold press relative h-12 w-full select-none overflow-hidden rounded-full bg-surface font-medium text-danger [-webkit-touch-callout:none] disabled:opacity-45"
      >
        <span className="relative">Hold to forget everything</span>
        <span aria-hidden className="hold-fill absolute inset-0 grid place-items-center rounded-full bg-danger text-paper">
          Hold to forget everything
        </span>
      </button>
      <p id="hold-hint" className="text-center text-small text-soft">
        Press and hold. This can’t be undone.
      </p>
    </div>
  );
}

export function MemoryDrawer({
  open,
  onOpenChange,
  items,
  setItems,
  paused,
  setPaused,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: string[];
  setItems: (fn: (items: string[]) => string[]) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
}) {
  const reduce = useReducedMotion();

  const forget = (item: string) => {
    const index = items.indexOf(item);
    setItems((all) => all.filter((i) => i !== item));
    toast("Forgotten", {
      action: {
        label: "Undo",
        onClick: () =>
          setItems((all) => (all.includes(item) ? all : [...all.slice(0, index), item, ...all.slice(index)])),
      },
    });
  };

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <Drawer.Portal>
        <Drawer.Backdrop className="drawer-backdrop fixed inset-0 z-50 bg-ink" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex justify-end p-2 sm:p-3">
          <Drawer.Popup className="side-drawer flex h-full w-full max-w-[26rem] flex-col overflow-y-auto overscroll-contain rounded-[var(--radius)] bg-paper p-6 text-ink outline-none sm:p-7">
            <Drawer.Content className="flex flex-1 flex-col">
              <div className="flex items-start justify-between gap-4">
                <Drawer.Title className="text-[1.625rem] font-medium leading-tight tracking-[-0.02em]">
                  What Upchance remembers
                </Drawer.Title>
                <Drawer.Close
                  aria-label="Close"
                  className="press grid size-11 shrink-0 place-items-center rounded-full bg-surface hover:bg-mid"
                >
                  <Icon name="close" className="size-4" />
                </Drawer.Close>
              </div>
              <Drawer.Description className="mt-2 text-body text-soft">
                Upchance uses these details to tailor every answer. It never shares them.
              </Drawer.Description>

              <div className="mt-6 flex items-center justify-between gap-4 rounded-[1.25rem] bg-ground p-4">
                <div>
                  <p className="font-medium">Memory</p>
                  <p className="text-small text-soft">
                    {paused ? "Paused: new chats won’t use or add to it." : "On: used in every chat."}
                  </p>
                </div>
                <Switch
                  checked={!paused}
                  onCheckedChange={(v) => setPaused(!v)}
                  label="Memory"
                  className="text-[1.75rem]"
                />
              </div>

              <ul className={clsx("mt-4 flex flex-col gap-2 transition-opacity duration-300", paused && "opacity-50")}>
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <motion.li
                      key={item}
                      layout={!reduce}
                      initial={{ opacity: 0, transform: "scale(0.97)" }}
                      animate={{ opacity: 1, transform: "scale(1)" }}
                      exit={{ opacity: 0, transform: "scale(0.97)" }}
                      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-[1.25rem] bg-surface py-2 pl-4 pr-2"
                    >
                      <span className="text-body">{item}</span>
                      <button
                        type="button"
                        aria-label={`Forget “${item}”`}
                        onClick={() => forget(item)}
                        className="press grid size-10 shrink-0 place-items-center rounded-full text-soft hover:bg-mid hover:text-ink"
                      >
                        <Icon name="close" className="size-4" />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {items.length === 0 ? (
                <p className="fade-in mt-2 rounded-[1.25rem] bg-ground p-5 text-body text-soft">
                  Nothing remembered yet. Upchance learns from your log and your chats.
                </p>
              ) : null}

              <div className="mt-auto pt-8">
                <HoldToForget
                  disabled={items.length === 0}
                  onDone={() => {
                    setItems(() => []);
                    toast("Upchance has forgotten everything");
                  }}
                />
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
