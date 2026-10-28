import Link from "next/link";
import clsx from "clsx";
import { LinkButton } from "@/components/ui/button";
import { footerColumns, legalNotes } from "@/content/nav";
import { Scene } from "@/components/motion/scene";

const letters = ["U", "p", "c", "h", "a", "n", "c", "e"];
const fills = [
  "bg-cobalt text-paper",
  "bg-cobalt-tint text-ink",
  "bg-paper text-ink",
  "bg-cobalt text-paper",
  "bg-mid text-ink",
  "bg-cobalt-tint text-ink",
  "bg-paper text-ink",
  "bg-cobalt text-paper",
];

/**
 * The close: the name built as a rising chart. Each letter is knocked out of its own capsule,
 * the capsules climb from left to right, and the last one carries the marker.
 */
function RisingName() {
  return (
    <Scene
      kind="rising-name"
      aria-hidden
      className="rising-name grid h-[22svh] min-h-40 grid-cols-8 items-end gap-1 [container-type:inline-size] sm:h-[34svh] sm:min-h-64"
    >
      {letters.map((l, i) => (
        <div
          key={i}
          className={clsx(
            "rising-bar relative flex items-end justify-center rounded-t-[999px] rounded-b-[1.25rem] pb-[2cqw]",
            fills[i],
          )}
          style={{ height: `${58 + i * 6}%`, "--i": i } as React.CSSProperties}
        >
          <span className="text-[11.5cqw] font-bold leading-none tracking-[-0.04em]">{l}</span>
          {i === letters.length - 1 ? (
            <span className="absolute left-1/2 top-[1.6cqw] size-[3.6cqw] -translate-x-1/2 rounded-full bg-paper shadow-[0_0_0_0.9cqw_var(--ink)]" />
          ) : null}
        </div>
      ))}
    </Scene>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ink pt-[calc(var(--section)/2)] text-paper" data-field="ink">
      <div className="frame">
        <RisingName />
        <p className="sr-only">Upchance</p>
        <div className="mt-14 grid gap-12 md:grid-cols-12">
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:col-span-8">
            {footerColumns.map((col) => (
              <div key={col.title}>
                <h2 className="text-body font-medium text-white/60">{col.title}</h2>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <li key={l.href + l.label}>
                      <Link
                        href={l.href}
                        prefetch={false}
                        className="text-[0.9375rem] text-paper/90 transition-colors hover:text-white focus-visible:text-white"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="flex flex-col gap-4 text-[0.9375rem] leading-relaxed text-white/70 md:col-span-4">
            {legalNotes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        </div>
        <div className="mt-14 flex items-center justify-between gap-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <p className="text-small text-white/60">© 2026 Upchance</p>
          <LinkButton href="/assessment" size="sm" tone="paper">
            Free assessment
          </LinkButton>
        </div>
      </div>
    </footer>
  );
}
