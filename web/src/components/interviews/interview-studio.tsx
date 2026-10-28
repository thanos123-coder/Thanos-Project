"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { Select, TextInput } from "@/components/ui/fields";
import { AsciiOrb, type AsciiOrbState } from "@/components/vendor/ascii-voice-orb";

const styles = [
  { value: "oxbridge", label: "Oxford or Cambridge interview" },
  { value: "mmi", label: "Medicine MMI" },
  { value: "us", label: "US alumni interview" },
];
const voices = [
  { value: "zira", label: "Zira" },
  { value: "device", label: "Your device’s default voice" },
];
const questions: Record<string, string[]> = {
  oxbridge: ["Tell me about a problem you couldn’t solve at first.", "Why this course, and why now?"],
  mmi: ["A friend asks you to cover for them at a volunteering shift. What do you do?", "Why medicine, and why now?"],
  us: ["What would you bring to our campus that isn’t on your application?", "Why this course, and why now?"],
};
const answer =
  "In physics club our bridge kept failing, so we tested one joint at a time. The gusset plates were too thin, so we doubled them, and the next one held twice the load.";

type Phase = "setup" | "asking" | "listening" | "thinking" | "feedback";

const orbState: Record<Phase, AsciiOrbState> = {
  setup: "idle",
  asking: "speaking",
  listening: "listening",
  thinking: "thinking",
  feedback: "idle",
};

/** A speech-like envelope: phrases made of syllables, read by the orb every frame. */
function voiceLevel() {
  const t = performance.now() / 1000;
  const phrase = (Math.sin(t * 0.7) + 1) / 2;
  const syllables = Math.max(0, Math.sin(t * 6.2)) * 0.7 + Math.max(0, Math.sin(t * 9.1 + 1)) * 0.3;
  return phrase * syllables;
}

export function InterviewStudio() {
  const [course, setCourse] = useState("");
  const [style, setStyle] = useState("oxbridge");
  const [voice, setVoice] = useState("zira");
  const [left, setLeft] = useState(5);
  const [phase, setPhase] = useState<Phase>("setup");
  const [qIndex, setQIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [heard, setHeard] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const level = useCallback(
    () => (phaseRef.current === "asking" || phaseRef.current === "listening" ? voiceLevel() : 0),
    [],
  );

  const q = questions[style][qIndex % questions[style].length];
  const words = answer.split(" ");

  // The question types out while the interviewer speaks, then the room listens.
  useEffect(() => {
    if (phase !== "asking") return;
    const id = setInterval(() => setTyped((n) => (n >= q.length ? n : n + 1)), 28);
    const done = setTimeout(() => {
      setHeard(0);
      setPhase("listening");
    }, q.length * 28 + 700);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [phase, q]);

  useEffect(() => {
    if (phase !== "listening") return;
    const id = setInterval(() => setHeard((n) => (n >= words.length ? n : n + 1)), 190);
    return () => clearInterval(id);
  }, [phase, words.length]);

  // A moment to read the answer before the feedback lands
  useEffect(() => {
    if (phase !== "thinking") return;
    const id = setTimeout(() => setPhase("feedback"), 1600);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "setup") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const ask = () => {
    setTyped(0);
    setPhase("asking");
  };

  const start = () => {
    setLeft((n) => Math.max(0, n - 1));
    setSeconds(0);
    setQIndex(0);
    ask();
    requestAnimationFrame(() => panel.current?.focus());
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <section id="practice" className="frame section scroll-mt-24" aria-labelledby="practice-title">
      <div
        ref={panel}
        tabIndex={-1}
        data-field="ink"
        className="interview-panel grid overflow-hidden rounded-[var(--radius)] bg-ink text-paper outline-none lg:grid-cols-12"
      >
        {/* The interviewer, drawn in dots: it breathes when idle, ripples out as it speaks, draws in as it
            listens and scans while it reads your answer (21st.dev ASCII Voice Orb) */}
        <div className="relative flex min-h-72 items-center justify-center p-6 lg:col-span-5 lg:min-h-[34rem]">
          <AsciiOrb
            aria-hidden
            state={orbState[phase]}
            level={level}
            color="#d9dcfa"
            charset=" ·•●"
            fontSize={11}
            size="min(24rem, 80vw)"
            glow={0}
          />
          {phase !== "setup" ? (
            <p className="absolute left-6 top-6 text-small tabular text-white/70 sm:left-8 sm:top-8" aria-live="off">
              {mm}:{ss}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col justify-center p-6 sm:p-10 lg:col-span-7">
          {phase === "setup" ? (
            <>
              <h2 id="practice-title" className="text-[clamp(1.75rem,1.1rem+2vw,3rem)] leading-[1.05] tracking-[-0.03em]">
                Practise a real interview, out loud
              </h2>
              <p className="mt-4 max-w-[52ch] text-body text-white/80">
                Upchance asks the questions out loud and listens to your spoken answers, like a real interview. Find a
                quiet place and allow your microphone.
              </p>
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-body font-medium">Course you’re applying for</span>
                  <TextInput
                    placeholder="For example, Engineering"
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                    className="bg-white/10 text-paper placeholder:text-white/50 hover:bg-white/15 focus-visible:bg-white/15"
                  />
                </label>
                <div className="flex flex-col gap-2">
                  <span className="text-body font-medium">Interview style</span>
                  <Select label="Interview style" tone="onInk" value={style} onChange={setStyle} items={styles} />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-body font-medium">Interviewer’s voice</span>
                  <Select label="Interviewer’s voice" tone="onInk" value={voice} onChange={setVoice} items={voices} />
                </div>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button size="lg" onClick={start} disabled={left === 0}>
                  <span className="flex items-center gap-2">
                    <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
                      <rect x="7" y="2.5" width="6" height="10" rx="3" fill="currentColor" />
                      <path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    Start the interview
                  </span>
                </Button>
                <p className="text-body text-white/75 tabular">Interviews left this month: {left}</p>
              </div>
              <p className="mt-6 max-w-[56ch] text-small text-white/65">
                Your browser turns your speech into text; Upchance receives only the text, never a recording.
              </p>
            </>
          ) : (
            <div aria-live="polite">
              <p className="text-small text-white/70">
                {styles.find((s) => s.value === style)?.label}
                {course ? `, ${course}` : ""}. Voice: {voices.find((v) => v.value === voice)?.label}
              </p>
              <h2 id="practice-title" className="mt-4 min-h-[3.3em] text-[clamp(1.5rem,1rem+1.8vw,2.5rem)] font-medium leading-[1.15] tracking-[-0.02em]">
                {phase === "asking" ? q.slice(0, typed) : q}
                {phase === "asking" ? <span className="type-caret" aria-hidden /> : null}
              </h2>

              <div className="mt-6 rounded-[1.25rem] bg-white/8 p-5">
                <div className="flex items-center gap-3 text-small text-white/70">
                  <span
                    className={clsx(
                      "size-2.5 rounded-full",
                      phase === "listening" || phase === "thinking" ? "bg-paper live-dot" : "bg-white/30",
                    )}
                  />
                  {phase === "asking"
                    ? `${voices.find((v) => v.value === voice)?.label === "Zira" ? "Zira" : "The interviewer"} is asking`
                    : phase === "listening"
                      ? "Listening. Speak when you’re ready."
                      : phase === "thinking"
                        ? "Reading your answer"
                        : "Your answer"}
                </div>
                {phase === "listening" ? (
                  <div className="mt-4 flex h-8 items-center gap-1" aria-hidden>
                    {Array.from({ length: 28 }).map((_, i) => (
                      <span key={i} className="wave-bar wave-live w-1 rounded-full bg-paper/80" style={{ height: 8 + ((i * 37) % 24), animationDelay: `${i * 45}ms` }} />
                    ))}
                  </div>
                ) : null}
                {phase !== "asking" ? (
                  <p className="mt-4 text-body leading-relaxed">
                    {words.slice(0, phase === "feedback" || phase === "thinking" ? words.length : heard).join(" ")}
                  </p>
                ) : null}
              </div>

              {phase === "feedback" ? (
                <div className="result-reveal mt-4 rounded-[1.25rem] bg-paper p-5 text-ink" data-ui>
                  <p className="text-body font-medium">Feedback</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Clear structure", "Good example", "Add one example"].map((t, i) => (
                      <span key={t} className={clsx("rounded-full px-3 py-1.5 text-small font-medium", i === 2 ? "bg-mid" : "bg-cobalt-tint")}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-body text-soft">Try again: start with the result, then explain how you got there.</p>
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-3">
                {phase === "listening" ? (
                  <Button tone="paper" onClick={() => setPhase("thinking")}>
                    I’ve finished my answer
                  </Button>
                ) : null}
                {phase === "feedback" ? (
                  <>
                    <Button tone="paper" onClick={ask}>
                      Try this question again
                    </Button>
                    <Button
                      tone="onCobalt"
                      dot={false}
                      onClick={() => {
                        setQIndex((i) => i + 1);
                        ask();
                      }}
                    >
                      Next question
                    </Button>
                  </>
                ) : null}
                <button type="button" onClick={() => setPhase("setup")} className="press rounded-full px-4 py-2.5 text-body font-medium text-white/75 hover:text-white">
                  End interview
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
