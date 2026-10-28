import clsx from "clsx";
import type { ReactNode } from "react";
import { BlurText, wordCount } from "@/components/vendor/blur-text";

const stageTone = {
  cobalt: "bg-cobalt",
  ink: "bg-ink",
  tint: "bg-cobalt-tint",
  surface: "bg-surface",
};

/** A size, in container units, at which the longer of the two lines still fits on one line. */
function titleSize(title: [string, string]) {
  const longest = Math.max(title[0].length, title[1].length);
  return Math.min(12.4, +(188 / longest).toFixed(2));
}

/**
 * Product-page hero: a two-line title and one sentence on the ground, and a stage cut to the motif
 * (the band's rounded end, entering from the right edge) carrying a piece of the product.
 */
export function PageHero({
  title,
  sentence,
  actions,
  note,
  stage,
  tone = "cobalt",
  id = "page-title",
}: {
  title: [string, string];
  sentence: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  stage: ReactNode;
  tone?: keyof typeof stageTone;
  id?: string;
}) {
  return (
    <section className="page-hero relative overflow-hidden" aria-labelledby={id}>
      <div className="frame grid-12 items-center gap-y-10 pb-8 pt-8 lg:min-h-[calc(100svh-4.5rem)] lg:py-12">
        <div className="col-span-12 [container-type:inline-size] lg:col-span-6">
          <h1
            id={id}
            className="page-title font-medium leading-[1.02] tracking-[-0.035em]"
            style={{ fontSize: `min(${titleSize(title)}cqi, 6.25rem)` }}
          >
            <BlurText text={title[0]} className="block" />
            <BlurText text={title[1]} start={wordCount(title[0])} className="block" />
          </h1>
          <p className="page-sentence mt-7 max-w-[40ch] text-lead text-ink/85">{sentence}</p>
          {actions ? <div className="page-actions mt-9 flex flex-wrap items-center gap-3">{actions}</div> : null}
          {note ? <div className="page-note mt-6 text-body text-soft">{note}</div> : null}
        </div>
        <div className="col-span-12 lg:col-span-6">
          <div
            className={clsx(
              "page-stage relative -mr-[var(--margin)] flex min-h-[26rem] items-center rounded-l-[999px] py-10 pl-[clamp(3rem,10vw,7rem)] pr-[var(--margin)] lg:-mr-[calc(var(--margin)+max(0px,(100vw-96rem)/2))] lg:min-h-[min(40rem,72vh)] lg:pl-[clamp(5rem,9vw,9rem)]",
              stageTone[tone],
            )}
            data-field={tone === "cobalt" || tone === "ink" ? tone : undefined}
          >
            <div className="page-stage-content w-full max-w-[34rem]">{stage}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
