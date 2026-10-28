import { PageHero } from "@/components/site/page-hero";
import { LinkButton } from "@/components/ui/button";
import { ChancesFragment } from "@/components/fragments/fragments";
import { ExampleResults } from "@/components/chances/example-results";
import { HowWeEstimate } from "@/components/chances/how-we-estimate";

export const metadata = { title: "Your chances" };

export default function ChancesPage() {
  return (
    <>
      <PageHero
        title={["Your university", "chances"]}
        sentence="Estimates from your grades, your activities and students like you. They update as your Log grows."
        actions={
          <LinkButton href="/assessment" size="lg">
            Start the free assessment
          </LinkButton>
        }
        note="Free, about two minutes, no card needed."
        stage={<ChancesFragment ids={["edinburgh", "ucl", "imperial", "nyu"]} />}
        tone="cobalt"
      />

      {/* The one full-width band that splits the page: the range, built large */}
      <section className="frame py-10" aria-labelledby="own-title">
        <div
          data-field="ink"
          className="flex flex-col gap-8 rounded-[999px] bg-ink px-8 py-10 text-paper max-md:rounded-[2.5rem] md:flex-row md:items-center md:justify-between md:px-14 md:py-12"
        >
          <div>
            <h2 id="own-title" className="max-w-[22ch] text-[clamp(1.75rem,1.1rem+1.8vw,2.75rem)] leading-[1.08] tracking-[-0.03em]">
              See your own chances in about two minutes
            </h2>
            <p className="mt-3 max-w-[52ch] text-body text-white/80">
              Answer a few questions about your grades, activities and the universities you like. It’s free.
            </p>
          </div>
          <LinkButton href="/assessment" size="lg" tone="paper" className="shrink-0">
            Start the free assessment
          </LinkButton>
        </div>
      </section>

      <ExampleResults />
      <HowWeEstimate />
    </>
  );
}
