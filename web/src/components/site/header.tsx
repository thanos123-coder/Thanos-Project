"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import clsx from "clsx";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/button";
import { mainNav } from "@/content/nav";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Hides the bar while reading down the page, brings it back the moment you scroll up. */
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - last.current;
      if (y < 120) setHidden(false);
      else if (delta > 6) setHidden(true);
      else if (delta < -6) setHidden(false);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}

function AccountMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="press flex h-11 items-center gap-2 rounded-full bg-surface pl-1.5 pr-4 text-small font-medium text-ink hover:bg-mid data-[popup-open]:bg-mid"
        aria-label="Your account, Pro plan"
      >
        <span className="grid size-8 place-items-center rounded-full bg-ink text-small font-bold text-paper">Y</span>
        Pro
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="z-50">
          <Menu.Popup className="menu-pop w-64 rounded-[1.25rem] bg-paper p-2 text-body text-ink shadow-[0_24px_60px_-20px_rgba(12,16,48,0.35)]">
            <div className="px-3 pb-2 pt-2">
              <p className="font-medium">You</p>
              <p className="text-small text-soft">Pro plan, unlimited messages</p>
            </div>
            <Menu.LinkItem render={<Link href="/plans" />} className="menu-item">
              Your plan
            </Menu.LinkItem>
            <Menu.LinkItem render={<Link href="/assessment" />} className="menu-item">
              Edit your answers
            </Menu.LinkItem>
            <Menu.LinkItem render={<Link href="/ask?panel=memory" />} className="menu-item">
              What Upchance remembers
            </Menu.LinkItem>
            <Menu.Item className="menu-item" onClick={() => toast("Signed out. See you soon.")}>
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  // A new page closes the menu (adjusting state while rendering, not in an effect)
  const [openedOn, setOpenedOn] = useState(pathname);
  if (openedOn !== pathname) {
    setOpenedOn(pathname);
    setOpen(false);
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="press flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-body font-medium text-ink hover:bg-mid xl:hidden">
        <span aria-hidden className="relative h-2.5 w-5 rounded-full bg-ink">
          <span className="absolute right-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-paper" />
        </span>
        Menu
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Popup className="mobile-menu fixed inset-0 z-50 flex flex-col overflow-y-auto bg-ink px-[var(--margin)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-paper">
          <div className="flex h-14 items-center justify-between">
            <Logo tone="paper" />
            <Dialog.Close className="press flex h-11 items-center rounded-full bg-white/10 px-4 font-medium hover:bg-white/20">
              Close
            </Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <nav aria-label="Main" className="mt-8 flex-1">
            <ul className="flex flex-col gap-1">
              {mainNav.map((item, i) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href} className="mobile-menu-item" style={{ "--i": i } as React.CSSProperties}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className="press flex items-center justify-between rounded-full py-2 text-[clamp(2rem,9vw,3rem)] font-medium leading-tight tracking-[-0.03em]"
                    >
                      {item.label}
                      {active ? (
                        <span aria-hidden className="relative h-4 w-10 rounded-full bg-cobalt">
                          <span className="absolute right-1 top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-paper" />
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="mt-8 flex flex-col gap-3">
            <LinkButton href="/assessment" size="lg" className="w-full">
              Free assessment
            </LinkButton>
            <p className="text-center text-small text-white/65">Signed in on the Pro plan</p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The main links share one band that slides to the current page. It is the range band again: a capsule
 * clipped to the active link with clip-path, so it moves on the compositor while the next page loads.
 */
function NavBand({ pathname }: { pathname: string }) {
  const list = useRef<HTMLUListElement>(null);
  const band = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const ul = list.current;
    const el = band.current;
    if (!ul || !el) return;
    const place = () => {
      const active = ul.querySelector<HTMLElement>("[aria-current='page']")?.parentElement;
      if (!active) {
        el.style.opacity = "0";
        return;
      }
      const right = ul.clientWidth - active.offsetLeft - active.offsetWidth;
      // The first placement lands without a slide; later ones glide
      if (!placed.current) el.style.transition = "none";
      el.style.clipPath = `inset(0 ${right}px 0 ${active.offsetLeft}px round 999px)`;
      el.style.opacity = "1";
      if (!placed.current) {
        void el.offsetWidth;
        el.style.transition = "";
        placed.current = true;
      }
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(ul);
    return () => ro.disconnect();
  }, [pathname]);

  return (
    <nav aria-label="Main" className="hidden xl:block">
      <ul ref={list} className="relative flex items-center gap-1">
        <span
          ref={band}
          aria-hidden
          className="absolute inset-0 rounded-full bg-surface opacity-0 transition-[clip-path] duration-300 ease-[var(--ease-in-out)] motion-reduce:transition-none"
        />
        {mainNav.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="relative">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "press relative flex h-11 items-center rounded-full px-4 text-body font-medium transition-colors",
                  active ? "text-ink" : "text-soft hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SiteHeader({ app = false }: { app?: boolean }) {
  const pathname = usePathname() ?? "/";
  const hidden = useHideOnScroll();

  return (
    <header
      data-hidden={!app && hidden ? "" : undefined}
      className={clsx(
        "site-header top-0 z-40 w-full bg-ground",
        app ? "relative" : "sticky",
      )}
    >
      {/* App screens run edge to edge, so their header does too; site pages keep the 96rem frame */}
      <div className={clsx("frame flex h-[4.5rem] items-center justify-between gap-6", app && "max-w-none")}>
        <Logo />
        <NavBand pathname={pathname} />
        <div className="flex items-center gap-2">
          <div className="hidden xl:block">
            <AccountMenu />
          </div>
          <LinkButton href="/assessment" size="md" className="max-sm:hidden">
            Free assessment
          </LinkButton>
          <MobileMenu pathname={pathname} />
        </div>
      </div>
    </header>
  );
}
