import { PageHero } from "@/components/site/page-hero";
import { LinkButton, TextLink } from "@/components/ui/button";
import { InterviewStudio } from "@/components/interviews/interview-studio";

export const metadata = { title: "Interviews" };

function Exchange() {
  return (
    <div className="flex flex-col gap-3" data-ui>
      <p className="max-w-[90%] rounded-[1.5rem] rounded-bl-md bg-paper px-5 py-4 text-body text-ink">
        Tell me about a problem you couldn’t solve at first.
      </p>
      <p className="ml-auto max-w-[90%] rounded-[1.5rem] rounded-br-md bg-cobalt px-5 py-4 text-body text-on-cobalt">
        In physics club our bridge kept failing, so we tested one joint at a time.
      </p>
      <div className="rounded-[1.5rem] bg-paper p-5 text-ink">
        <p className="text-body font-medium">Feedback</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Clear structure", "Good example", "Add one example"].map((t, i) => (
            <span key={t} className={`rounded-full px-3 py-1.5 text-small font-medium ${i === 2 ? "bg-mid" : "bg-cobalt-tint"}`}>
              {t}
            </span>
          ))}
        </div>
        <p className="mt-3 text-body text-soft">Try again: start with the result, then explain how you got there.</p>
      </div>
    </div>
  );
}

const points = [
  { title: "Oxbridge, MMI and US styles", text: "Questions modelled on how each university really interviews." },
  { title: "Speak, don’t type", text: "Voice practice builds the calm you need on the day." },
  { title: "Feedback on every answer", text: "Structure, examples and clarity, with one thing to try next." },
];

export default function InterviewsPage() {
  return (
    <>
      <PageHero
        title={["Practise the interview", "before it counts"]}
        sentence="Answer real interview questions out loud and get clear feedback in seconds."
        actions={
          <>
            <LinkButton href="#practice" size="lg">
              Start an interview
            </LinkButton>
            <TextLink href="/assessment" className="ml-2 text-lead">
              Or see your chances, free
            </TextLink>
          </>
        }
        note="In Plus and Pro."
        stage={<Exchange />}
        tone="ink"
      />

      <InterviewStudio />

      <section className="frame section" aria-labelledby="interview-points-title">
        <h2 id="interview-points-title" className="sr-only">
          What interview practice includes
        </h2>
        <ul className="grid gap-x-10 gap-y-12 md:grid-cols-3">
          {points.map((p) => (
            <li key={p.title} className="flex flex-col gap-4">
              <span className="relative block h-7 w-14 rounded-full bg-ink" aria-hidden>
                <span className="absolute right-1.5 top-1/2 size-4 -translate-y-1/2 rounded-full bg-cobalt" />
              </span>
              <h3 className="text-[clamp(1.5rem,1.2rem+1vw,2rem)] font-medium leading-tight tracking-[-0.02em]">{p.title}</h3>
              <p className="max-w-[34ch] text-lead text-soft">{p.text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-20 flex flex-col items-start gap-4 rounded-[2.5rem] bg-surface p-8 sm:flex-row sm:items-center sm:justify-between sm:rounded-[999px] sm:px-12 sm:py-10">
          <p className="max-w-[34ch] text-lead">Mock interviews come with Plus and Pro. Cancel anytime.</p>
          <LinkButton href="#practice" size="lg">
            Start an interview
          </LinkButton>
        </div>
      </section>
    </>
  );
}
