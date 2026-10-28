"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

const noop = () => () => {};
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, LinkButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { MotifSlider } from "@/components/ui/motif-slider";
import { Select, TextInput } from "@/components/ui/fields";
import { RangeBar, VerdictChip } from "@/components/ui/range-bar";
import { activityKinds, applyingFrom, courses, gradeScales, systemOptions, type System } from "@/content/assessment";
import { dreamUniversities, moreUniversities, verdictFor, type ExampleChance } from "@/content/universities";
import { Generated } from "@/components/motion/generated";

const allUnis = [...dreamUniversities, ...moreUniversities];
const TOTAL = 6;

type Answers = {
  system?: System;
  grade?: number;
  course?: string;
  activities: string[];
  lead: string;
  unis: string[];
  from: string;
  age13: boolean;
};

const titles = [
  "Where are you studying now?",
  "", // set from the grade scale
  "What do you want to study?",
  "What have you done outside class?",
  "Where do you dream of studying?",
  "Last thing: about you",
];

export function Assessment() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [phase, setPhase] = useState<"questions" | "building" | "results">("questions");
  const [a, setA] = useState<Answers>({ activities: [], lead: "", unis: [], from: "Greece", age13: false });

  // A university chosen on the home page arrives in the link (?uni=Edinburgh) and is added once.
  const fromLink = useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get("uni")?.trim() || null,
    () => null,
  );
  const [seeded, setSeeded] = useState<string | null>(null);
  if (fromLink && seeded !== fromLink) {
    setSeeded(fromLink);
    const match = allUnis.find((u) => u.name.toLowerCase() === fromLink.toLowerCase());
    setA((s) => ({ ...s, unis: [match ? match.id : `custom:${fromLink}`] }));
  }

  const scale = a.system ? gradeScales[a.system] : undefined;
  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return !!a.system;
      case 1:
        return a.grade !== undefined;
      case 2:
        return !!a.course?.trim();
      case 3:
        return true;
      case 4:
        return a.unis.length > 0;
      case 5:
        return a.age13;
      default:
        return false;
    }
  }, [step, a]);

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  const next = () => {
    if (!canContinue) return;
    if (step < TOTAL - 1) go(step + 1);
    else {
      setPhase("building");
      setTimeout(() => setPhase("results"), 1200);
    }
  };

  const toggle = (key: "activities" | "unis", v: string, max = 8) =>
    setA((s) => {
      const has = s[key].includes(v);
      if (!has && s[key].length >= max) {
        toast(`Choose up to ${max} for now. You can add more later.`);
        return s;
      }
      return { ...s, [key]: has ? s[key].filter((x) => x !== v) : [...s[key], v] };
    });

  const slide = {
    initial: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, transform: `translateX(${d * 48}px)` }),
    animate: { opacity: 1, transform: "translateX(0px)" },
    exit: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, transform: `translateX(${d * -32}px)` }),
  };

  if (phase !== "questions") {
    return <Results phase={phase} answers={a} onRestart={() => { setPhase("questions"); setStep(0); }} />;
  }

  const title = step === 1 && scale ? scale.question : titles[step];

  return (
    <div className="frame flex min-h-[calc(100svh-4.5rem)] flex-col pb-10 pt-6 lg:pt-10">
      {/* Progress: the band grows as you answer, its marker shows where you are */}
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between text-small text-soft">
          <span>
            Question {step + 1} of {TOTAL}
          </span>
          <span>About 2 minutes</span>
        </div>
        <div
          className="relative mt-3 h-3 rounded-full bg-surface"
          role="progressbar"
          aria-label="Assessment progress"
          aria-valuemin={1}
          aria-valuemax={TOTAL}
          aria-valuenow={step + 1}
        >
          <div
            className="absolute inset-0 rounded-full bg-cobalt transition-[clip-path] duration-500 ease-[var(--ease-in-out)]"
            style={{ clipPath: `inset(0 ${100 - ((step + 1) / TOTAL) * 100}% 0 0 round 999px)` }}
          />
        </div>
      </div>

      <div className="relative mx-auto mt-10 w-full max-w-3xl flex-1 lg:mt-14">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={slide}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
          >
            <h1 className="text-[clamp(2rem,1.2rem+2.8vw,3.5rem)] font-medium leading-[1.05] tracking-[-0.03em]" tabIndex={-1}>
              {title}
            </h1>

            {step === 0 ? (
              <div className="mt-10 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="School system">
                {systemOptions.map((s) => {
                  const on = a.system === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setA((x) => ({ ...x, system: s, grade: gradeScales[s].start }))}
                      className={clsx(
                        "press flex min-h-16 items-center justify-between rounded-full py-3 pl-6 pr-3 text-left text-lead",
                        on ? "bg-cobalt text-on-cobalt" : "bg-surface hover:bg-mid",
                      )}
                    >
                      {s}
                      <span className={clsx("size-7 rounded-full transition-colors", on ? "bg-paper" : "bg-ground")} />
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === 1 && scale ? (
              <div className="mt-12">
                <p className="tabular text-[clamp(3rem,2rem+4vw,5.5rem)] font-medium leading-none tracking-[-0.04em]">
                  {scale.format(a.grade ?? scale.start)}
                </p>
                <div className="mt-10">
                  <MotifSlider
                    value={a.grade ?? scale.start}
                    onChange={(v) => setA((x) => ({ ...x, grade: v }))}
                    min={scale.min}
                    max={scale.max}
                    step={scale.step}
                    label={scale.question}
                    format={scale.format}
                  />
                  <div className="mt-2 flex justify-between text-small text-soft tabular">
                    <span>{scale.format(scale.min)}</span>
                    <span>{scale.format(scale.max)}</span>
                  </div>
                </div>
                <p className="mt-8 max-w-[50ch] text-body text-soft">
                  {scale.lowerIsBetter ? "In this system a lower grade is stronger. " : ""}Use your predicted or expected
                  grade. You can change it any time in your Log.
                </p>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-10">
                <div className="flex flex-wrap gap-2">
                  {courses.map((c) => (
                    <Chip key={c} pressed={a.course === c} onClick={() => setA((x) => ({ ...x, course: c }))}>
                      {c}
                    </Chip>
                  ))}
                </div>
                <label className="mt-8 block max-w-md">
                  <span className="text-body font-medium">Or type your course</span>
                  <TextInput
                    className="mt-2"
                    placeholder="For example, Biomedical engineering"
                    value={courses.includes(a.course ?? "") ? "" : (a.course ?? "")}
                    onChange={(e) => setA((x) => ({ ...x, course: e.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="mt-10">
                <p className="text-body text-soft">Choose all that fit. Skip if you’re not sure yet.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {activityKinds.map((k) => (
                    <Chip key={k} pressed={a.activities.includes(k)} onClick={() => toggle("activities", k)}>
                      {k}
                    </Chip>
                  ))}
                </div>
                <label className="mt-8 block max-w-md">
                  <span className="text-body font-medium">Something you lead or are proud of (optional)</span>
                  <TextInput
                    className="mt-2"
                    placeholder="For example, Captain, robotics team"
                    value={a.lead}
                    onChange={(e) => setA((x) => ({ ...x, lead: e.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="mt-10">
                <p className="text-body text-soft">Choose up to 8. You’ll see a range for each one.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {allUnis.map((u) => (
                    <Chip key={u.id} pressed={a.unis.includes(u.id)} onClick={() => toggle("unis", u.id)}>
                      {u.name}
                    </Chip>
                  ))}
                  {a.unis
                    .filter((id) => id.startsWith("custom:"))
                    .map((id) => (
                      <Chip key={id} pressed onClick={() => toggle("unis", id)}>
                        {id.slice(7)}
                      </Chip>
                    ))}
                </div>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="mt-10 grid max-w-lg gap-8">
                <div className="flex flex-col gap-2">
                  <span id="from-label" className="text-body font-medium">
                    Where are you applying from?
                  </span>
                  <Select
                    label="Where are you applying from?"
                    value={a.from}
                    onChange={(v) => setA((x) => ({ ...x, from: v }))}
                    items={applyingFrom.map((c) => ({ value: c, label: c }))}
                  />
                </div>
                <label className="flex cursor-pointer items-start gap-4 rounded-[1.25rem] bg-surface p-5">
                  <input
                    type="checkbox"
                    checked={a.age13}
                    onChange={(e) => setA((x) => ({ ...x, age13: e.target.checked }))}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-mid transition-colors peer-checked:bg-cobalt peer-focus-visible:shadow-[0_0_0_3px_var(--ground),0_0_0_6px_var(--cobalt)]"
                  >
                    <span
                      className={clsx(
                        "absolute top-1 size-5 rounded-full bg-paper transition-transform duration-300 ease-[var(--ease-out)]",
                        a.age13 ? "translate-x-6" : "translate-x-1",
                      )}
                    />
                  </span>
                  <span>
                    <span className="block text-body font-medium">I’m 13 or older</span>
                    <span className="mt-1 block text-small text-soft">
                      Where the law requires it, a parent approves your account before you continue.
                    </span>
                  </span>
                </label>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mx-auto mt-12 flex w-full max-w-3xl items-center justify-between gap-3">
        <Button tone="quiet" dot={false} onClick={() => go(Math.max(0, step - 1))} disabled={step === 0}>
          Back
        </Button>
        <Button size="lg" onClick={next} disabled={!canContinue}>
          {step === TOTAL - 1 ? "See my chances" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function Results({ phase, answers, onRestart }: { phase: "building" | "results"; answers: Answers; onRestart: () => void }) {
  const chosen: ExampleChance[] = answers.unis.map(
    (id) =>
      allUnis.find((u) => u.id === id) ?? {
        id,
        short: id.slice(7, 9).toUpperCase(),
        name: id.slice(7),
        country: "",
        note: "More details needed",
      },
  );
  const building = phase === "building";
  return (
    <div className="frame pb-[var(--section)] pt-10 lg:pt-14" aria-live="polite" aria-busy={building}>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-[clamp(2.25rem,1.3rem+3.4vw,4.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">
          {building ? "Building your ranges" : "Your first results"}
        </h1>
        <p className="mt-5 max-w-[52ch] text-lead text-soft">
          {building
            ? "Checking each university’s published figures against students like you."
            : `${answers.course ?? "Your course"}, ${answers.system ?? ""}${answers.from ? `, applying from ${answers.from}` : ""}. Ranges, not promises.`}
        </p>

        <ul className="mt-12 flex flex-col gap-2">
          {chosen.map((u, i) => {
            const has = u.low !== undefined && u.high !== undefined;
            const content = (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-full bg-surface text-small font-bold">{u.short}</span>
                    <div>
                      <p className="text-lead font-medium leading-tight">{u.name}</p>
                      {u.country ? <p className="text-small text-soft">{u.country}</p> : null}
                    </div>
                  </div>
                  {building ? (
                    <span className="h-7 w-28 rounded-full bg-surface gen-shimmer" aria-hidden />
                  ) : (
                    <div className="flex items-center gap-3">
                      {has ? (
                        <span className="tabular text-[1.75rem] font-medium leading-none tracking-[-0.03em]">
                          {u.low}–{u.high}%
                        </span>
                      ) : null}
                      <VerdictChip verdict={verdictFor(u)} />
                    </div>
                  )}
                </div>
                <div className="mt-5">
                  {building ? (
                    <div className="h-4 rounded-full bg-surface gen-shimmer" aria-hidden />
                  ) : has ? (
                    <RangeBar low={u.low!} high={u.high!} reach={u.could} label={`${u.name}: ${u.low} to ${u.high} percent`} />
                  ) : (
                    <p className="text-body text-soft">{u.note ?? "More details needed"}</p>
                  )}
                </div>
                {!building && has && u.mover ? (
                  <p className="mt-4 flex items-center gap-2.5 text-body">
                    <span className="bullet" aria-hidden />
                    {u.mover}
                  </p>
                ) : null}
              </>
            );
            const card = "result-row rounded-[var(--radius)] bg-paper p-6 sm:p-7";
            return (
              <li key={u.id}>
                {building ? (
                  <div data-ui className={clsx(card, "is-building")} style={{ "--i": i } as React.CSSProperties}>
                    {content}
                  </div>
                ) : (
                  // Each range is drawn as it arrives, one after another (transitions.dev UI generation)
                  <Generated data-ui className={card} delay={i * 260}>
                    {content}
                  </Generated>
                )}
              </li>
            );
          })}
        </ul>

        {!building ? (
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => toast("Saved to your Log. Your chances will follow it.")}>
              Save my results
            </Button>
            <LinkButton href="/ask" size="lg" tone="quiet" dot={false}>
              Ask about my results
            </LinkButton>
            <button type="button" onClick={onRestart} className="press ml-1 rounded-full px-3 py-2 text-body font-medium text-soft hover:text-ink">
              Edit your answers
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
