import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { LinkButton } from "@/components/ui/button";
import { RangeBar, VerdictChip } from "@/components/ui/range-bar";

export const metadata = { title: "Page not found" };

/** A rare page, so it gets a small joke in the product's own language: a chance card for the missing page. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="frame grid-12 items-center gap-y-12 py-16 lg:min-h-[calc(100svh-4.5rem)] lg:py-24">
        <div className="col-span-12 lg:col-span-6">
          <h1 className="text-[clamp(2.75rem,1.4rem+4.6vw,6rem)] font-medium leading-[1.02] tracking-[-0.035em]">
            We couldn’t find
            <br />
            that page
          </h1>
          <p className="mt-7 max-w-[40ch] text-lead text-ink/85">
            It may have moved, or the link may be wrong. Everything else is where you left it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <LinkButton href="/" size="lg">
              Go to the home page
            </LinkButton>
            <LinkButton href="/ask" size="lg" tone="outline" dot={false}>
              Ask Upchance
            </LinkButton>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-5 lg:col-start-8">
          <div data-ui className="rounded-[var(--radius)] bg-paper p-6 text-ink sm:p-8">
            <div className="flex items-center gap-3">
              <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-full bg-surface px-2 text-small font-bold">
                404
              </span>
              <div className="min-w-0">
                <p className="text-lead font-medium leading-tight">This page</p>
                <p className="text-small text-soft">Not found</p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
              <p className="tabular text-[clamp(2.5rem,1.6rem+2.6vw,3.75rem)] font-medium leading-none tracking-[-0.04em]">
                0<span className="text-soft">–</span>0%
              </p>
              <VerdictChip verdict="Reach" />
            </div>
            <RangeBar className="mt-5" low={0} high={0} size="lg" label="Chances of finding this page: 0 percent" />
            <p className="mt-5 flex items-center gap-2.5 text-body">
              <span className="bullet" aria-hidden />
              The links above can move this.
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
