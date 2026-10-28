import { LinkButton } from "@/components/ui/button";
import { pricingTeaser } from "@/content/home";

/** Two plans, two fields: free and paid meet at a hard edge; the wider field says which matters more. */
export function PricingTeaser() {
  const { free, paid } = pricingTeaser;
  return (
    <section aria-labelledby="pricing-title" className="py-[calc(var(--section)/2)]">
      <div className="grid lg:min-h-[90svh] lg:grid-cols-12">
        <div className="flex min-h-[70svh] flex-col justify-between gap-10 bg-surface px-[var(--margin)] py-10 sm:py-12 lg:col-span-5 lg:min-h-0 lg:pl-[max(var(--margin),calc((100vw-96rem)/2+var(--margin)))] lg:pr-10">
          <div>
            <h2 id="pricing-title" className="text-[clamp(2.5rem,1.4rem+3.6vw,5rem)] leading-[1] tracking-[-0.035em]">
              {free.name}
            </h2>
            <p className="mt-5 max-w-[26ch] text-lead">{free.sentence}</p>
            <ul className="mt-8 flex flex-col gap-3">
              {free.included.map((i) => (
                <li key={i} className="flex items-baseline gap-3 text-body">
                  <span className="bullet" aria-hidden />
                  {i}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <p className="text-[clamp(4rem,1.6rem+6.4vw,8rem)] font-medium leading-[0.9] tracking-[-0.05em]">{free.price}</p>
            <LinkButton href={free.cta.href} tone="ink" size="lg">
              {free.cta.label}
            </LinkButton>
          </div>
        </div>

        <div
          data-field="ink"
          className="flex min-h-[70svh] flex-col justify-between gap-10 bg-ink px-[var(--margin)] py-10 text-paper sm:py-12 lg:col-span-7 lg:min-h-0 lg:pl-12 lg:pr-[max(var(--margin),calc((100vw-96rem)/2+var(--margin)))]"
        >
          <div>
            <h3 className="text-[clamp(2.5rem,1.4rem+3.6vw,5rem)] leading-[1] tracking-[-0.035em]">{paid.name}</h3>
            <p className="mt-5 max-w-[30ch] text-lead text-white/90">{paid.sentence}</p>
            <p className="mt-8 max-w-[44ch] text-body text-white/75">{paid.included}</p>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <p className="flex flex-col">
              <span className="text-body text-white/70">From</span>
              <span className="flex items-end gap-3">
                <span className="text-[clamp(4rem,1.6rem+6.4vw,8rem)] font-medium leading-[0.9] tracking-[-0.05em] tabular">
                  ${paid.price}
                </span>
                <span className="pb-2 text-lead text-white/80">a month</span>
              </span>
            </p>
            <LinkButton href={paid.cta.href} tone="cobalt" size="lg">
              {paid.cta.label}
            </LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
