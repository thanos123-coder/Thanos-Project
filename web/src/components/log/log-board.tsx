"use client";

import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, LinkButton, TextLink } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Select, TextArea, TextInput, shake } from "@/components/ui/fields";
import { Segmented } from "@/components/ui/tabs";
import { MotifSlider } from "@/components/ui/motif-slider";
import { Swap } from "@/components/ui/range-bar";
import { ChancesFragment } from "@/components/fragments/fragments";
import { gradeScales, systemOptions, type System } from "@/content/assessment";

type Kind = "Activity" | "Award" | "Experience";
type Entry = { id: number; kind: Kind; title: string; role: string; when: string; hours?: string; text: string };

const example: Entry[] = [
  { id: 1, kind: "Activity", title: "Captain, robotics team", role: "Leader", when: "2024 to now", hours: "6", text: "Led a team of 9 to the national final; ran the build schedule." },
  { id: 2, kind: "Award", title: "Silver, chemistry olympiad", role: "National round", when: "2025", text: "Top 5% of 2,400 entrants." },
  { id: 3, kind: "Experience", title: "Summer lab placement", role: "Volunteer", when: "July 2025", hours: "20", text: "Four weeks measuring signal loss in old radio receivers." },
  { id: 4, kind: "Activity", title: "Volunteer, village radio archive", role: "Member", when: "2023 to now", hours: "2", text: "Digitising my grandfather’s weather recordings." },
];

const tests = ["SAT", "ACT", "IELTS", "TOEFL", "UCAT"] as const;

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col rounded-[var(--radius)] bg-paper p-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-body font-medium text-soft">{title}</h2>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

const EditButton = (props: React.ComponentProps<"button">) => (
  <button type="button" className="press rounded-full bg-surface px-4 py-1.5 text-small font-medium hover:bg-mid" {...props}>
    Edit
  </button>
);

export function LogBoard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<"All" | Kind>("All");
  const [addOpen, setAddOpen] = useState(false);
  const [gradesOpen, setGradesOpen] = useState(false);
  const [testsOpen, setTestsOpen] = useState(false);
  const [grades, setGrades] = useState<{ system: System; value: number } | null>(null);
  const [scores, setScores] = useState<Partial<Record<(typeof tests)[number], string>>>({});

  // Add-to-log form
  const [kind, setKind] = useState<Kind>("Activity");
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const titleId = useId();
  const [role, setRole] = useState("");
  const [when, setWhen] = useState("");
  const [hours, setHours] = useState("");
  const [text, setText] = useState("");

  // Grades form
  const [gSystem, setGSystem] = useState<System>("IB Diploma");
  const [gValue, setGValue] = useState(gradeScales["IB Diploma"].start);
  const [draftScores, setDraftScores] = useState<Partial<Record<(typeof tests)[number], string>>>({});

  const counts = useMemo(
    () => ({
      All: entries.length,
      Activity: entries.filter((e) => e.kind === "Activity").length,
      Award: entries.filter((e) => e.kind === "Award").length,
      Experience: entries.filter((e) => e.kind === "Experience").length,
    }),
    [entries],
  );
  const shown = filter === "All" ? entries : entries.filter((e) => e.kind === filter);
  const hasLog = entries.length > 0;

  const resetForm = () => {
    setKind("Activity");
    setTitle("");
    setTitleError("");
    setRole("");
    setWhen("");
    setHours("");
    setText("");
  };

  const addEntry = () => {
    if (!title.trim()) {
      setTitleError("Give it a title, like ‘Captain, robotics team’.");
      const input = document.getElementById(titleId);
      shake(input);
      input?.focus();
      return;
    }
    setEntries((list) => [{ id: Date.now(), kind, title: title.trim(), role: role.trim(), when: when.trim(), hours: hours.trim(), text: text.trim() }, ...list]);
    setAddOpen(false);
    resetForm();
    toast("Added to your log. Your chances follow it.");
  };

  const loadExample = () => {
    setEntries(example);
    setGrades({ system: "IB Diploma", value: 40 });
    setScores({ IELTS: "8.0" });
    toast("Showing Eleni’s example log.");
  };

  return (
    <div className="frame pb-[var(--section)] pt-10 lg:pt-14">
      <div className="grid-12 gap-y-6">
        <div className="col-span-12 lg:col-span-8">
          <h1 className="text-[clamp(2.75rem,1.4rem+4.6vw,6rem)] font-medium leading-[1] tracking-[-0.035em]">Your log</h1>
          <p className="mt-6 max-w-[52ch] text-lead text-ink/85">
            Your grades, activities and achievements in one place. Everything you add here, or mention in the chat,
            updates your chances straight away.
          </p>
        </div>
        <div className="col-span-12 flex flex-wrap items-end gap-3 lg:col-span-4 lg:justify-end">
          {!hasLog ? (
            <button type="button" onClick={loadExample} className="press rounded-full px-4 py-3 text-body font-medium text-cobalt hover:bg-surface">
              See an example log
            </button>
          ) : null}
          <Button size="lg" onClick={() => setAddOpen(true)}>
            Add to your log
          </Button>
        </div>
      </div>

      <div className="mt-12 grid gap-2 lg:grid-cols-12">
        <div className="grid gap-2 sm:grid-cols-2 lg:col-span-8">
          <Card title="Grades" action={<EditButton onClick={() => setGradesOpen(true)} aria-label="Edit grades" />}>
            {grades ? (
              <div>
                <p className="text-[2.5rem] font-medium leading-none tracking-[-0.03em] tabular">
                  <Swap value={gradeScales[grades.system].format(grades.value)} />
                </p>
                <p className="mt-2 text-body text-soft">
                  <Swap value={`Predicted, ${grades.system}`} />
                </p>
              </div>
            ) : (
              <p className="text-body text-soft">Add your grades to see them here.</p>
            )}
          </Card>
          <Card title="Admissions tests" action={<EditButton onClick={() => { setDraftScores(scores); setTestsOpen(true); }} aria-label="Edit admissions tests" />}>
            {Object.values(scores).some(Boolean) ? (
              <ul className="flex flex-wrap gap-2">
                {Object.entries(scores)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <li key={k} className="rounded-full bg-ground px-4 py-2 text-body">
                      <span className="font-medium">{k}</span>{" "}
                      <span className="tabular">
                        <Swap value={String(v)} />
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-lead text-soft">No tests yet</p>
            )}
          </Card>
          {(["Activity", "Award"] as const).map((k) => (
            <Card key={k} title={k === "Activity" ? "Activities" : "Awards"}>
              <p className="text-[2.5rem] font-medium leading-none tracking-[-0.03em] tabular">{counts[k] || "–"}</p>
              {k === "Activity" ? (
                <div className="mt-4 flex gap-1.5" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={clsx("h-2 flex-1 rounded-full", i < counts.Activity ? "bg-cobalt" : "bg-surface")} />
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-body text-soft">{hasLog ? "From your log" : "From your free check"}</p>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-2 lg:col-span-4">
          <Card title="Your chances">
            {hasLog ? (
              <ChancesFragment className="-m-5 bg-transparent" />
            ) : (
              <>
                <p className="text-body">Choose universities in the free check to see your chances here.</p>
                <LinkButton href="/assessment" tone="outline" dot={false} className="mt-5">
                  Edit your answers
                </LinkButton>
              </>
            )}
          </Card>
          <Card title="About you">
            <div className="flex flex-col items-start gap-3">
              <TextLink href="/assessment" tone="cobalt">
                Edit your answers
              </TextLink>
              <TextLink href="/ask?panel=memory" tone="cobalt">
                What Upchance remembers
              </TextLink>
            </div>
          </Card>
        </div>

        <section className="rounded-[var(--radius)] bg-paper p-6 sm:p-8 lg:col-span-8" aria-labelledby="entries-title">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="entries-title" className="flex items-center gap-3 text-[1.75rem] font-medium tracking-[-0.02em]">
              Activities and achievements
              <span className="rounded-full bg-surface px-3 py-0.5 text-body tabular">{entries.length}</span>
            </h2>
          </div>
          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter">
            {(["All", "Activity", "Award", "Experience"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={clsx(
                  "press rounded-full px-4 py-2 text-small font-medium tabular",
                  filter === f ? "bg-ink text-paper" : "bg-surface hover:bg-mid",
                )}
              >
                {f === "All" ? "All" : `${f === "Activity" ? "Activities" : f === "Award" ? "Awards" : "Experiences"}`} {counts[f]}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-center">
              <span className="relative block h-9 w-[4.5rem] rounded-full bg-surface" aria-hidden>
                <span className="absolute left-2 top-1/2 size-5 -translate-y-1/2 rounded-full bg-paper shadow-[0_0_0_4px_var(--mid)]" />
              </span>
              <p className="mt-6 max-w-[40ch] text-lead text-soft">
                Nothing logged yet. Add your activities, awards and experiences, or just tell the chat what you’ve done.
              </p>
              <Button className="mt-8" size="lg" onClick={() => setAddOpen(true)}>
                Add to your log
              </Button>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-2">
              {shown.map((e, i) => (
                <li key={e.id} className="log-entry flex flex-col gap-2 rounded-[1.25rem] bg-ground p-5 sm:flex-row sm:items-start sm:justify-between" style={{ "--i": i } as React.CSSProperties}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-cobalt-tint px-2.5 py-0.5 text-small font-medium">{e.kind}</span>
                      <span className="text-lead font-medium">{e.title}</span>
                    </p>
                    {e.text ? <p className="mt-2 max-w-[60ch] text-body text-soft">{e.text}</p> : null}
                  </div>
                  <p className="shrink-0 text-body text-soft">
                    {[e.role, e.when, e.hours ? `${e.hours} h a week` : ""].filter(Boolean).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal open={addOpen} onOpenChange={setAddOpen} title="Add to your log" description="Your chances update as soon as you save." wide>
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            addEntry();
          }}
        >
          <div className="sm:col-span-2">
            <Segmented
              label="What are you adding?"
              value={kind}
              onChange={setKind}
              options={[
                { value: "Activity", label: "Activity" },
                { value: "Award", label: "Award" },
                { value: "Experience", label: "Experience" },
              ]}
            />
          </div>
          <Field label="Title" className="sm:col-span-2" htmlFor={titleId} error={titleError}>
            {({ id, hintId, invalid }) => (
              <TextInput
                id={id}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError("");
                }}
                placeholder="For example, Captain, robotics team"
                aria-invalid={invalid}
                aria-describedby={hintId}
                autoFocus
              />
            )}
          </Field>
          <Field label={kind === "Award" ? "Level" : "Your role"}>
            {({ id }) => <TextInput id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder={kind === "Award" ? "For example, National round" : "For example, Leader"} />}
          </Field>
          <Field label="When">
            {({ id }) => <TextInput id={id} value={when} onChange={(e) => setWhen(e.target.value)} placeholder="For example, 2024 to now" />}
          </Field>
          {kind !== "Award" ? (
            <Field label="Hours a week">
              {({ id }) => <TextInput id={id} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ""))} placeholder="For example, 6" />}
            </Field>
          ) : null}
          <Field label="What you did" hint="One or two sentences. Numbers help: people, results, hours." className="sm:col-span-2">
            {({ id, hintId }) => <TextArea id={id} aria-describedby={hintId} value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button tone="quiet" dot={false} onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save to your log</Button>
          </div>
        </form>
      </Modal>

      <Modal open={gradesOpen} onOpenChange={setGradesOpen} title="Your grades" description="Predicted or expected grades are fine.">
        <div className="grid gap-6">
          <Field label="School system">
            {({ id }) => (
              <Select
                id={id}
                label="School system"
                value={gSystem}
                onChange={(v) => {
                  setGSystem(v);
                  setGValue(gradeScales[v].start);
                }}
                items={systemOptions.map((s) => ({ value: s, label: s }))}
              />
            )}
          </Field>
          <div>
            <p className="text-body font-medium">{gradeScales[gSystem].question}</p>
            <p className="mt-3 text-[2.25rem] font-medium leading-none tracking-[-0.03em] tabular">{gradeScales[gSystem].format(gValue)}</p>
            <div className="mt-4">
              <MotifSlider
                value={gValue}
                onChange={setGValue}
                min={gradeScales[gSystem].min}
                max={gradeScales[gSystem].max}
                step={gradeScales[gSystem].step}
                label={gradeScales[gSystem].question}
                format={gradeScales[gSystem].format}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button tone="quiet" dot={false} onClick={() => setGradesOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setGrades({ system: gSystem, value: gValue });
                setGradesOpen(false);
                toast("Grades saved. Your chances follow them.");
              }}
            >
              Save grades
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={testsOpen} onOpenChange={setTestsOpen} title="Admissions tests" description="Add the ones you’ve taken or booked. Leave the rest empty.">
        <div className="grid grid-cols-2 gap-4">
          {tests.map((t) => (
            <Field key={t} label={t}>
              {({ id }) => (
                <TextInput
                  id={id}
                  inputMode="decimal"
                  value={draftScores[t] ?? ""}
                  onChange={(e) => setDraftScores((s) => ({ ...s, [t]: e.target.value }))}
                  placeholder={t === "SAT" ? "e.g. 1480" : t === "ACT" ? "e.g. 33" : t === "IELTS" ? "e.g. 7.5" : t === "TOEFL" ? "e.g. 105" : "e.g. 2900"}
                />
              )}
            </Field>
          ))}
          <div className="col-span-2 mt-2 flex justify-end gap-2">
            <Button tone="quiet" dot={false} onClick={() => setTestsOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setScores(draftScores);
                setTestsOpen(false);
                toast("Tests saved.");
              }}
            >
              Save tests
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
