"use client";

import { Dialog } from "@base-ui/react/dialog";
import clsx from "clsx";
import type { ReactNode } from "react";

/** A centred modal that becomes a bottom sheet on phones. Dimmed backdrop, focus trapped, Escape closes. */
export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  wide = false,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger render={trigger as React.ReactElement} /> : null}
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-50 bg-ink/45" />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-end overflow-y-auto sm:place-items-center sm:p-6">
          <Dialog.Popup
            className={clsx(
              "dialog-pop relative w-full rounded-t-[var(--radius)] bg-paper px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-ink sm:rounded-[var(--radius)] sm:p-8",
              wide ? "sm:max-w-2xl" : "sm:max-w-lg",
            )}
          >
            <span aria-hidden className="mx-auto mb-5 block h-1.5 w-12 rounded-full bg-mid sm:hidden" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-[1.625rem] font-medium leading-tight tracking-[-0.02em]">{title}</Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-1.5 text-body text-soft">{description}</Dialog.Description>
                ) : null}
              </div>
              <Dialog.Close
                className="press grid size-11 shrink-0 place-items-center rounded-full bg-surface hover:bg-mid"
                aria-label="Close"
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </Dialog.Close>
            </div>
            <div className="mt-6">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;
