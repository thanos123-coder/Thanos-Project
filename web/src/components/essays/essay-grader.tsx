"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { TextHighlighter } from "@/components/vendor/text-highlighter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/fields";
import { Tabs } from "@/components/ui/tabs";
import { draftStages, feedback, promptTypes, sampleEssay, scanLevels, type ScanVerdict } from "@/content/essays";

type Mode = "feedback" | "scan";
type Phase = "empty" | "working" | "done";

const aiTells = /(rapidly evolving|crucial role|ideal candidate|shaping the future|passion for|in today's|in today’s)/i;

/** A reader's marker sweeps over the quoted words a comment is about (21st.dev Text Highlighter). */
function Quoted({ text, tag, delay }: { text: string; tag: string; delay: number }) {
  const m = text.match(/^(.*?)(“[^”]+”)(.*)$/);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <TextHighlighter
        highlightColor={tag === "Cut" ? "#cdd2da" : "#d9dcfa"}
        className="rounded-[0.3em] px-0.5"
        transition={{ type: "spring", duration: 0.9, delay, bounce: 0 }}
        useInViewOptions={{ once: true, amount: 0.6 }}
      >
        {m[2]}
      </TextHighlighter>
      {m[3]}
    </>
  );
}

function sentences(text: string) {
  return (text.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function verdictFor(s: string): ScanVerdict {
  if (aiTells.test(s)) return "Reads as AI-written";
  if (/\bI believe\b|\bI want to study\b/i.test(s)) return "Mixed";
  return "Reads as written by you";
}

const PencilIcon = () => (
  <svg viewBox="0 0 20 20" className="size-[1.05em]" aria-hidden>
    <path d="M4 14.5V16h1.5l8.6-8.6-1.5-1.5L4 14.5zM14.9 4.1l1 1a1 1 0 010 1.4l-1 1-2.4-2.4 1-1a1 1 0 011.4 0z" fill="currentColor" />
  </svg>
);
const ScanIcon = () => (
  <svg viewBox="0 0 20 20" className="size-[1.05em]" aria-hidden>
    <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3M5 10h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function EssayGrader() {
  const [mode, setMode] = useState<Mode>("feedback");
  const [essay, setEssay] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptType, setPromptType] = useState("detect");
  const [limit, setLimit] = useState("");
  const [unit, setUnit] = useState("words");
  const [college, setCollege] = useState("");
  const [major, setMajor] = useState("");
  const [stage, setStage] = useState("middle");
  const [phase, setPhase] = useState<Phase>("empty");
  const [left, setLeft] = useState(20);
  const resultsRef = useRef<HTMLDivElement>(null);

  const words = useMemo(() => (essay.trim() ? essay.trim().split(/\s+/).length : 0), [essay]);
  const over = limit && unit === "words" && words > Number(limit);

  const scan = () => {
    if (words < 40) {
      toast("Paste at least 40 words, or load the sample essay.");
      return;
    }
    setPhase("working");
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
    setTimeout(() => {
      setPhase("done");
      if (mode === "feedback") setLeft((n) => Math.max(0, n - 1));
    }, 2200);
  };

  return (
    <section id="grader" className="frame section scroll-mt-24" aria-labelledby="grader-title">
      <div className="grid-12 gap-y-6">
        <h2 id="grader-title" className="col-span-12 text-head lg:col-span-6">
          Essay grader
        </h2>
        <p className="col-span-12 max-w-[52ch] self-end text-lead text-soft lg:col-span-6">
          Paste your essay and choose a scan. Writing feedback marks what works and what to change; the AI scan shows
          which sentences read as AI-written.
        </p>
      </div>

      <div className="mt-12 grid gap-2 lg:grid-cols-12">
        <form
          className="rounded-[var(--radius)] bg-paper p-5 sm:p-8 lg:col-span-7"
          onSubmit={(e) => {
            e.preventDefault();
            scan();
          }}
          data-ui
        >
          <Tabs
            label="Choose a scan"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setPhase("empty");
            }}
            tabs={[
              { value: "feedback", label: <><PencilIcon /> Writing feedback</> },
              { value: "scan", label: <><ScanIcon /> AI scan</> },
            ]}
          />

          {mode === "feedback" ? (
            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              <Field label="Essay type" className="sm:col-span-2">
                {({ id }) => <Select id={id} label="Essay type" value={promptType} onChange={setPromptType} items={promptTypes} />}
              </Field>
              <Field label="The exact prompt" hint="Paste the prompt, or the platform and prompt number. Without it the evaluation is provisional." className="sm:col-span-2">
                {({ id, hintId }) => (
                  <TextArea id={id} aria-describedby={hintId} rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-20" />
                )}
              </Field>
              <Field label="Limit">
                {({ id }) => (
                  <div className="flex gap-2">
                    <TextInput id={id} inputMode="numeric" placeholder="e.g. 650" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} className="w-28 shrink-0" />
                    <Select label="Limit unit" value={unit} onChange={setUnit} items={[{ value: "words", label: "words" }, { value: "characters", label: "characters" }]} />
                  </div>
                )}
              </Field>
              <Field label="Target college (optional)">
                {({ id }) => <TextInput id={id} placeholder="e.g. Yale" value={college} onChange={(e) => setCollege(e.target.value)} />}
              </Field>
              <Field label="Intended major (optional)">
                {({ id }) => <TextInput id={id} placeholder="e.g. Biology" value={major} onChange={(e) => setMajor(e.target.value)} />}
              </Field>
              <Field label="Draft stage">
                {({ id }) => <Select id={id} label="Draft stage" value={stage} onChange={setStage} items={draftStages} />}
              </Field>
            </div>
          ) : (
            <p className="mt-7 max-w-[52ch] text-body text-soft">
              The AI scan runs privately in your browser. Nothing you paste here leaves your device.
            </p>
          )}

          <label className="mt-6 block">
            <span className="sr-only">Your essay</span>
            <textarea
              value={essay}
              onChange={(e) => setEssay(e.target.value)}
              placeholder="Paste your essay here…"
              className="essay-input min-h-[22rem] w-full resize-y rounded-[1.25rem] bg-ground p-5 text-[1.125rem] leading-[1.75] text-ink outline-none transition-shadow placeholder:text-soft/70 focus-visible:shadow-[0_0_0_3px_var(--cobalt)] sm:p-6"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className={clsx("text-body tabular", over ? "font-medium text-danger" : "text-soft")} aria-live="polite">
              {words} {words === 1 ? "word" : "words"}
              {limit ? ` of ${limit}` : ""}
              {over ? ", over the limit" : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="press rounded-full px-4 py-2.5 text-body font-medium text-cobalt hover:bg-surface"
                onClick={() => {
                  setEssay(sampleEssay);
                  setPrompt("Why do you want to study your chosen course?");
                  setMajor("Electrical engineering");
                }}
              >
                Load a sample essay
              </button>
              <button
                type="button"
                className="press rounded-full px-4 py-2.5 text-body font-medium text-soft hover:bg-surface hover:text-ink"
                onClick={() => {
                  setEssay("");
                  setPhase("empty");
                }}
              >
                Clear
              </button>
              <Button type="submit" size="md" disabled={phase === "working"}>
                {phase === "working" ? "Scanning…" : "Scan essay"}
              </Button>
            </div>
          </div>
          <p className="mt-4 text-small text-soft">
            {mode === "feedback" ? `Essay reviews left this month: ${left} of 20` : "AI scans are included in every plan, Free too."}
          </p>
        </form>

        <div ref={resultsRef} className="scroll-mt-24 lg:col-span-5">
          <div className="lg:sticky lg:top-24">
            <Results mode={mode} phase={phase} essay={essay} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Results({ mode, phase, essay }: { mode: Mode; phase: Phase; essay: string }) {
  if (phase === "empty") {
    return (
      <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-[var(--radius)] bg-surface p-8 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-paper text-cobalt">
          {mode === "feedback" ? <PencilIcon /> : <ScanIcon />}
        </span>
        <p className="mt-5 text-lead font-medium">Your results will appear here</p>
        <p className="mt-3 max-w-[38ch] text-body text-soft">
          {mode === "feedback"
            ? "Writing feedback reads your essay the way an admissions reader does, with a published rubric: a first impression, scores on every criterion with quoted evidence, the highest-leverage opportunities, tagged line comments, what to protect and a next-draft plan. It asks questions and never rewrites your words."
            : "The AI scan marks each sentence: written by you, mixed, or reading as AI-written, so you can rewrite those parts in your own voice."}
        </p>
      </div>
    );
  }

  if (phase === "working") {
    return (
      <div className="gen-panel rounded-[var(--radius)] bg-paper p-6 sm:p-8" data-ui aria-busy>
        <p className="text-lead font-medium">{mode === "feedback" ? "Reading like an admissions reader" : "Scanning each sentence"}</p>
        <ul className="mt-6 flex flex-col gap-4" aria-hidden>
          {[78, 92, 64, 86, 70].map((w, i) => (
            <li key={i} className="gen-line h-4 rounded-full bg-surface" style={{ width: `${w}%`, "--i": i } as React.CSSProperties} />
          ))}
        </ul>
        <p className="mt-6 text-small text-soft">This takes a few seconds.</p>
      </div>
    );
  }

  if (mode === "scan") {
    const all = sentences(essay);
    const counts = all.reduce<Record<string, number>>((m, s) => ((m[verdictFor(s)] = (m[verdictFor(s)] ?? 0) + 1), m), {});
    return (
      <div className="result-reveal rounded-[var(--radius)] bg-paper p-6 sm:p-8" data-ui>
        <p className="text-small text-soft">AI scan, private in your browser</p>
        <p className="mt-2 text-lead font-medium">
          {counts["Reads as AI-written"] ?? 0} of {all.length} sentences read as AI-written
        </p>
        <ul className="mt-6 flex max-h-[30rem] flex-col gap-3 overflow-y-auto pr-1">
          {all.map((s, i) => {
            const v = verdictFor(s);
            return (
              <li key={i} className="reveal-item rounded-[1rem] bg-ground p-4" style={{ "--i": i } as React.CSSProperties}>
                <p className="text-body leading-relaxed">{s}</p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="relative h-2 flex-1 rounded-full bg-surface">
                    <span
                      className={clsx("absolute inset-y-0 left-0 rounded-full", v === "Reads as AI-written" ? "bg-cobalt" : v === "Mixed" ? "bg-cobalt/50" : "bg-mid")}
                      style={{ width: `${scanLevels[v]}%` }}
                    />
                  </div>
                  <span className={clsx("shrink-0 text-small font-medium", v === "Reads as AI-written" ? "text-cobalt" : "text-soft")}>{v}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="result-reveal flex flex-col gap-2" data-ui>
      <div className="reveal-item rounded-[var(--radius)] bg-paper p-6" style={{ "--i": 0 } as React.CSSProperties}>
        <p className="text-small font-medium text-cobalt">First impression</p>
        <p className="mt-2 text-body leading-relaxed">{feedback.impression}</p>
      </div>
      <div className="reveal-item rounded-[var(--radius)] bg-paper p-6" style={{ "--i": 1 } as React.CSSProperties}>
        <p className="text-small font-medium text-cobalt">Scores, with the evidence</p>
        <ul className="mt-4 flex flex-col gap-4">
          {feedback.scores.map((s) => (
            <li key={s.name}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-body font-medium">{s.name}</span>
                <span className="tabular text-small text-soft">{s.score} of 5</span>
              </div>
              <div className="mt-2 flex gap-1" aria-hidden>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={clsx("h-2 flex-1 rounded-full", n <= s.score ? "bg-cobalt" : "bg-surface")} />
                ))}
              </div>
              <p className="mt-1.5 text-small text-soft">{s.evidence}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="reveal-item rounded-[var(--radius)] bg-paper p-6" style={{ "--i": 2 } as React.CSSProperties}>
        <p className="text-small font-medium text-cobalt">Highest-leverage changes</p>
        <ol className="mt-3 flex flex-col gap-2.5">
          {feedback.opportunities.map((o) => (
            <li key={o} className="flex gap-3 text-body">
              <span className="bullet mt-2" aria-hidden />
              {o}
            </li>
          ))}
        </ol>
      </div>
      <div className="reveal-item rounded-[var(--radius)] bg-paper p-6" style={{ "--i": 3 } as React.CSSProperties}>
        <p className="text-small font-medium text-cobalt">Line comments</p>
        <ul className="mt-3 flex flex-col gap-2">
          {feedback.lines.map((l, i) => (
            <li key={l.text} className="flex items-start gap-3 rounded-[1rem] bg-ground p-3">
              <span className="shrink-0 rounded-full bg-cobalt-tint px-2.5 py-0.5 text-small font-medium">{l.tag}</span>
              <span className="text-body">
                <Quoted text={l.text} tag={l.tag} delay={0.35 + i * 0.25} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="reveal-item rounded-[var(--radius)] bg-ink p-6 text-paper" style={{ "--i": 4 } as React.CSSProperties}>
        <p className="text-small font-medium text-white/70">What to protect</p>
        <p className="mt-2 text-body">{feedback.protect}</p>
        <p className="mt-5 text-small font-medium text-white/70">Your next-draft plan</p>
        <ol className="mt-2 flex list-inside list-decimal flex-col gap-1.5 text-body">
          {feedback.plan.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <p className="mt-5 text-small text-white/70">Upchance asks questions and never rewrites your words.</p>
      </div>
    </div>
  );
}
