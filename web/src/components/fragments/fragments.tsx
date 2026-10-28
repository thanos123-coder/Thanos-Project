"use client";

import clsx from "clsx";
import { Mark } from "@/components/brand/logo";
import { RangeBar, VerdictChip } from "@/components/ui/range-bar";
import { dreamUniversities, verdictFor } from "@/content/universities";

/*
  Interface fragments: real pieces of the Upchance app, shown as pictures of the product.
  Each root carries data-ui; inside, the product's own conventions apply.
*/

function Panel({ className, children, title, aside }: { className?: string; children: React.ReactNode; title?: string; aside?: React.ReactNode }) {
  return (
    <div data-ui className={clsx("rounded-[1.375rem] bg-paper p-5 text-ink", className)}>
      {title ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-body font-medium">{title}</p>
          {aside}
        </div>
      ) : null}
      {children}
    </div>
  );
}

const ExampleTag = () => (
  <span className="rounded-full bg-surface px-2.5 py-0.5 text-small font-medium text-soft">Example</span>
);

const pick = (id: string) => dreamUniversities.find((u) => u.id === id)!;

export function ChancesFragment({ className, ids = ["ucl", "imperial", "nyu"] }: { className?: string; ids?: string[] }) {
  return (
    <Panel title="Your chances" aside={<ExampleTag />} className={className}>
      <ul className="flex flex-col gap-4">
        {ids.map((id) => {
          const u = pick(id);
          return (
            <li key={id}>
              <div className="mb-2 flex items-baseline justify-between gap-3 text-small">
                <span className="font-medium text-ink">{u.name}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular font-medium">
                    {u.low}–{u.high}%
                  </span>
                  <VerdictChip verdict={verdictFor(u)} className="h-6! px-2.5!" />
                </span>
              </div>
              <RangeBar low={u.low!} high={u.high!} size="sm" label={`${u.name} ${u.low} to ${u.high} percent`} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function AskFragment({ className }: { className?: string }) {
  return (
    <Panel className={clsx("flex flex-col gap-4", className)}>
      <p className="ml-auto max-w-[85%] rounded-[1.25rem] rounded-br-md bg-ink px-4 py-3 text-small text-paper">
        Which volunteering would help my medicine application?
      </p>
      <div className="flex gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface">
          <Mark className="size-5" />
        </span>
        <p className="text-small leading-relaxed">
          Look for regular, hands-on roles with patients, such as a care home or hospital ward, and keep notes on what
          you learn.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 pl-11">
        {["What about research?", "How many hours?"].map((s) => (
          <span key={s} className="rounded-full bg-surface px-3 py-1.5 text-small font-medium">
            {s}
          </span>
        ))}
      </div>
    </Panel>
  );
}

export function EssayFragment({ className }: { className?: string }) {
  return (
    <Panel className={className}>
      <p className="text-small text-soft">Personal statement, draft 1</p>
      <p className="mt-3 text-body leading-[1.9]">
        <mark className="rounded-md bg-cobalt-tint px-1 text-ink">Ever since I was young,</mark>{" "}
        <mark className="rounded-md bg-cobalt-tint px-1 text-ink">I have been passionate about helping people.</mark>{" "}
        <mark className="rounded-md bg-mid px-1 text-ink">This changed my life forever.</mark>
      </p>
      <div className="mt-4 rounded-[1rem] bg-ground px-4 py-3">
        <p className="text-small font-medium text-cobalt">Admissions reader</p>
        <p className="mt-0.5 text-small">Every reader has seen this opening. Start with one real moment instead.</p>
      </div>
    </Panel>
  );
}

export function InterviewFragment({ className, live = true }: { className?: string; live?: boolean }) {
  return (
    <div data-ui className={clsx("rounded-[1.375rem] bg-ink p-5 text-paper", className)}>
      <div className="flex items-center justify-between text-small text-white/70">
        <span>Mock interview</span>
        <span className="tabular">02:14</span>
      </div>
      <div className="mt-5 flex items-center gap-5">
        <span className={clsx("orb relative grid size-20 shrink-0 place-items-center rounded-full bg-cobalt", live && "orb-live")}>
          <span className="absolute inset-0 rounded-full bg-cobalt" />
        </span>
        <div className="flex h-10 items-center gap-1" aria-hidden>
          {[10, 22, 34, 18, 40, 26, 14, 30, 20, 36, 12, 24].map((h, i) => (
            <span
              key={i}
              className={clsx("wave-bar w-1.5 rounded-full bg-paper/85", live && "wave-live")}
              style={{ height: h, animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>
      </div>
      <p className="mt-5 text-body font-medium">Why this course, and why now?</p>
      <p className="mt-1 text-small text-white/65">Oxford or Cambridge interview, voice: Zira</p>
    </div>
  );
}

export function LogFragment({ className }: { className?: string }) {
  return (
    <Panel title="Your log" className={className}>
      <ul className="flex flex-col gap-2.5">
        {[
          { t: "Captain, robotics team", s: "Leader, 2024 to now" },
          { t: "Silver, chemistry olympiad", s: "Award, 2025" },
        ].map((e) => (
          <li key={e.t} className="flex items-center justify-between gap-3 rounded-full bg-ground py-2 pl-4 pr-3">
            <span className="text-small font-medium">{e.t}</span>
            <span className="text-small text-soft">{e.s}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <div className="flex gap-1.5" aria-hidden>
          {[1, 1, 1, 0].map((on, i) => (
            <span key={i} className={clsx("h-2 flex-1 rounded-full", on ? "bg-cobalt" : "bg-surface")} />
          ))}
        </div>
        <p className="mt-2 text-small text-soft">Brag sheet: 3 of 4 sections ready</p>
      </div>
    </Panel>
  );
}

export function MemoryFragment({ className }: { className?: string }) {
  return (
    <Panel title="What Upchance remembers" className={className}>
      <ul className="flex flex-col gap-2.5">
        {["Wants to study engineering in the UK", "Predicted 40 in the IB", "Captain of the robotics team"].map((m) => (
          <li key={m} className="flex items-center gap-3 rounded-full bg-ground py-2 pl-3 pr-4 text-small">
            <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-cobalt" aria-hidden>
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {m}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between text-small">
        <span className="text-soft">Memory is on</span>
        <span className="font-medium text-cobalt">Pause or delete</span>
      </div>
    </Panel>
  );
}

export function QuestionFragment({ className }: { className?: string }) {
  const options = ["IB Diploma", "A-levels", "Greek Panhellenic exams", "US high school"];
  return (
    <Panel className={className}>
      <p className="text-small text-soft">Free assessment</p>
      <p className="mt-2 text-body font-medium">Which school system are you in?</p>
      <ul className="mt-4 flex flex-col gap-2">
        {options.map((o, i) => (
          <li
            key={o}
            className={clsx(
              "flex items-center justify-between rounded-full py-2 pl-4 pr-2 text-small font-medium",
              i === 0 ? "bg-cobalt text-on-cobalt" : "bg-ground",
            )}
          >
            {o}
            <span className={clsx("size-5 rounded-full", i === 0 ? "bg-paper" : "bg-surface")} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function RaiseFragment({ className }: { className?: string }) {
  const u = pick("imperial");
  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <Panel>
        <div className="mb-3 flex items-baseline justify-between text-small">
          <span className="font-medium">Imperial, engineering</span>
          <span className="tabular font-medium">
            {u.low}–{u.high}%
          </span>
        </div>
        <RangeBar low={u.low!} high={u.high!} reach={u.could} size="md" label="Imperial range with what would move it" />
        <p className="mt-3 flex items-center gap-2 text-small">
          <span className="bullet" aria-hidden />
          A strong essay can move this.
        </p>
      </Panel>
      <Panel>
        <p className="text-small font-medium text-cobalt">Admissions reader</p>
        <p className="mt-0.5 text-small">Great first line. Now show the moment.</p>
      </Panel>
    </div>
  );
}
