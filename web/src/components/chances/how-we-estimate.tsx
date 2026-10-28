import clsx from "clsx";
import { Scene } from "@/components/motion/scene";

/** The three steps of an estimate, each drawn with the motif: a fact, a comparison, a range. */
const admitted = [52, 55, 58, 60, 61, 63, 64, 66, 67, 68, 70, 71, 72, 74, 75, 77, 79, 81, 84, 88];

function Track({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={clsx("relative h-5 w-full rounded-full bg-surface", className)}>{children}</div>;
}

export function HowWeEstimate() {
  const steps = [
    {
      name: "Start from the facts",
      text: "Each university’s published admission or offer rate.",
      art: (
        <Track>
          <span data-pop className="absolute left-[14%] top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cobalt" />
          <span className="absolute left-[14%] top-[calc(100%+0.6rem)] -translate-x-1/4 whitespace-nowrap text-small text-soft">
            Published rate
          </span>
        </Track>
      ),
    },
    {
      name: "Compare your profile",
      text: "Your grades, tests and activities against the students it admits.",
      art: (
        <Track>
          {admitted.map((x, i) => (
            <span
              key={i}
              data-pop
              className="absolute top-1/2 size-2.5 rounded-full bg-mid"
              style={{ left: `${x}%`, translate: `-50% ${i % 2 ? -90 : -10}%` }}
            />
          ))}
          <span data-you className="marker" style={{ left: "57%", "--marker": "1.1rem", "--marker-ring": "4px" } as React.CSSProperties} />
          <span className="absolute left-[57%] top-[calc(100%+0.6rem)] -translate-x-1/2 text-small font-medium">You</span>
        </Track>
      ),
    },
    {
      name: "Show a range",
      text: "Essays, references and interviews still change things, so you see a range, not a promise.",
      art: (
        <Track>
          <span data-band className="absolute inset-y-0 left-[47%] right-[35%] rounded-full bg-cobalt" />
          <span data-you className="marker" style={{ left: "56%", "--marker": "1.1rem", "--marker-ring": "4px" } as React.CSSProperties} />
          <span className="absolute left-[56%] top-[calc(100%+0.6rem)] -translate-x-1/2 text-small font-medium tabular">
            47–65%
          </span>
        </Track>
      ),
    },
  ];
  return (
    <section id="how-we-estimate" className="frame section scroll-mt-24" aria-labelledby="estimate-title">
      <h2 id="estimate-title" className="text-head">
        How we estimate
      </h2>
      <Scene kind="estimate">
      <ol className="mt-12 grid gap-2 lg:grid-cols-3">
        {steps.map((s) => (
          <li key={s.name} data-step className="flex flex-col gap-10 rounded-[var(--radius)] bg-paper p-6 sm:p-8">
            <div className="pb-6 pt-4">{s.art}</div>
            <div>
              <h3 className="text-lead font-medium">{s.name}</h3>
              <p className="mt-2 max-w-[36ch] text-body text-soft">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      </Scene>
    </section>
  );
}
