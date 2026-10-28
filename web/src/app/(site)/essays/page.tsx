import { PageHero } from "@/components/site/page-hero";
import { LinkButton, TextLink } from "@/components/ui/button";
import { EssayGrader } from "@/components/essays/essay-grader";
import { TextHighlighter } from "@/components/vendor/text-highlighter";

export const metadata = { title: "Essays" };

function StatementSample() {
  return (
    <div data-ui className="rounded-[var(--radius)] bg-paper p-6 text-ink sm:p-7">
      <p className="text-body font-medium">Personal statement, draft 2</p>
      <p className="mt-4 text-[1.125rem] leading-[1.8]">
        The first time I took our old radio apart,{" "}
        <TextHighlighter
          className="rounded-md px-1"
          transition={{ type: "spring", duration: 1.1, delay: 0.9, bounce: 0 }}
          useInViewOptions={{ once: true, amount: 0.8 }}
        >
          I wasn’t trying to fix it.
        </TextHighlighter>{" "}
        I wanted to know why
        my grandfather’s voice sounded different through it. Two years later, I built my own.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {["Great first line. Now show the moment.", "Tie this to why you want engineering."].map((n) => (
          <div key={n} className="rounded-[1rem] bg-ground px-4 py-3">
            <p className="text-small font-medium text-cobalt">Admissions reader</p>
            <p className="text-body">{n}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {["Story: strong", "Voice: clear", "Fit: needs work"].map((t, i) => (
          <span key={t} className={`rounded-full px-3 py-1.5 text-small font-medium ${i === 2 ? "bg-mid" : "bg-cobalt-tint"}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const points = [
  { title: "Find your story", text: "A short interview brings out the moments only you can write about." },
  { title: "Notes like a reader’s", text: "Clear comments on structure, voice and fit for each university." },
  { title: "Your words, always", text: "No ghostwriting. We check each university’s AI rules for you." },
];

export default function EssaysPage() {
  return (
    <>
      <PageHero
        title={["Write an essay", "they remember"]}
        sentence="Find your story, then get notes like an admissions reader would write."
        actions={
          <>
            <LinkButton href="#grader" size="lg">
              Get essay feedback
            </LinkButton>
            <TextLink href="/assessment" className="ml-2 text-lead">
              Or see your chances, free
            </TextLink>
          </>
        }
        stage={<StatementSample />}
        tone="tint"
      />

      <EssayGrader />

      <section className="frame section" aria-labelledby="essay-points-title">
        <h2 id="essay-points-title" className="sr-only">
          How essay feedback works
        </h2>
        <ul className="grid gap-x-10 gap-y-12 md:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="flex flex-col gap-4">
              <span className="relative block h-7 w-14 rounded-full bg-cobalt" aria-hidden>
                <span className="absolute right-1.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-paper" />
              </span>
              <h3 className="text-[clamp(1.5rem,1.2rem+1vw,2rem)] font-medium leading-tight tracking-[-0.02em]">{p.title}</h3>
              <p className="max-w-[34ch] text-lead text-soft">{p.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-20 flex flex-col items-start gap-4 rounded-[2.5rem] bg-surface p-8 sm:flex-row sm:items-center sm:justify-between sm:rounded-[999px] sm:px-12 sm:py-10">
          <p className="max-w-[30ch] text-lead">Essay reviews start with Basic. Cancel anytime.</p>
          <LinkButton href="#grader" size="lg">
            Get essay feedback
          </LinkButton>
        </div>
      </section>
    </>
  );
}
