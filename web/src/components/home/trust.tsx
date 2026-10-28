import { TextLink } from "@/components/ui/button";
import { trust } from "@/content/home";
import { Scene } from "@/components/motion/scene";

/** Large marks on tiles: what students and parents should know, set large, one claim per tile. */
export function Trust() {
  return (
    <section className="frame section" aria-labelledby="trust-title">
      <Scene kind="board" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4 lg:gap-2">
        <div
          data-field="cobalt"
          className="flex min-h-56 flex-col justify-between gap-8 rounded-[var(--radius)] rounded-tr-[999px] bg-cobalt p-6 text-on-cobalt sm:col-span-2 sm:p-8 lg:min-h-[22rem]"
        >
          <h2 id="trust-title" className="max-w-[12ch] text-[clamp(2rem,1.2rem+2.6vw,3.5rem)] leading-[1.02] tracking-[-0.035em]">
            {trust.heading}
          </h2>
          <p className="max-w-[30ch] text-lead text-white/90">{trust.intro}</p>
        </div>
        {trust.tiles.map((t) => (
          <article
            key={t.title}
            className="flex min-h-64 flex-col justify-between gap-6 rounded-[var(--radius)] bg-surface p-6 sm:p-7 lg:min-h-[22rem]"
          >
            <h3 className="text-[clamp(1.625rem,1.2rem+1vw,2rem)] font-bold leading-[1.1] tracking-[-0.025em]">{t.title}</h3>
            <div className="flex flex-col items-start gap-4">
              <p className="text-body">{t.text}</p>
              {t.link ? (
                <TextLink href={t.link.href} tone="cobalt">
                  {t.link.label}
                </TextLink>
              ) : null}
            </div>
          </article>
        ))}
      </Scene>
    </section>
  );
}
