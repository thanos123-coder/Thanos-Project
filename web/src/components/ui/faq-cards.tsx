"use client";

import { Accordion } from "@base-ui/react/accordion";
import clsx from "clsx";
import { Scene } from "@/components/motion/scene";

const colours = ["bg-paper", "bg-cobalt-tint", "bg-surface"];

/**
 * Tabbed index cards: questions filed like cards in a drawer. Each card carries a tab with its topic,
 * the tabs step right, one card is open at a time and the first is open on load.
 */
export function FaqCards({
  items,
  title,
  id,
}: {
  items: { topic: string; q: string; a: string }[];
  title: string;
  id: string;
}) {
  const steps = items.length - 1;
  return (
    <section className="frame section" aria-labelledby={id}>
      <div className="mx-auto max-w-[62rem]">
        <h2 id={id} className="text-head">
          {title}
        </h2>
        <Scene kind="deal-cards">
        <Accordion.Root defaultValue={[0]} className="faq-drawer mt-12 flex flex-col">
          {items.map((it, i) => (
            <Accordion.Item
              key={it.q}
              value={i}
              className={clsx("faq-card relative rounded-[1.5rem] text-ink", colours[i % colours.length])}
              style={{ "--i": i, "--steps": steps, zIndex: i + 1 } as React.CSSProperties}
            >
              <span aria-hidden className={clsx("faq-tab", colours[i % colours.length])}>
                {it.topic}
              </span>
              <Accordion.Header className="m-0">
                <Accordion.Trigger className="press group/faq flex min-h-[5.5rem] w-full items-center justify-between gap-6 rounded-[1.5rem] px-6 py-5 text-left sm:px-8">
                  <span className="text-[clamp(1.125rem,1rem+0.5vw,1.375rem)] font-medium leading-snug">{it.q}</span>
                  <span
                    aria-hidden
                    className="relative h-5 w-9 shrink-0 rounded-full bg-mid transition-colors duration-200 group-data-[panel-open]/faq:bg-cobalt"
                  >
                    <span className="absolute left-[3px] top-1/2 size-[14px] -translate-y-1/2 rounded-full bg-paper transition-transform duration-200 ease-[var(--ease-out)] group-data-[panel-open]/faq:translate-x-4" />
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="faq-panel h-[var(--accordion-panel-height)] overflow-hidden transition-[height] duration-250 ease-[var(--ease-out)] data-ending-style:h-0 data-starting-style:h-0">
                <p className="max-w-[60ch] px-6 pb-8 text-body sm:px-8">{it.a}</p>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion.Root>
        </Scene>
      </div>
    </section>
  );
}
