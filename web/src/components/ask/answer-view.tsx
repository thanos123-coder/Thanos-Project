"use client";

import { memo, useState, type CSSProperties } from "react";
import clsx from "clsx";
import { toast } from "sonner";
import { Mark } from "@/components/brand/logo";
import { Icon } from "@/components/ui/icons";
import { RangeBar } from "@/components/ui/range-bar";
import { Tip } from "@/components/ui/tip";
import { specialistSteps, type Answer, type AnswerBlock } from "@/content/ask";
import { dreamUniversities } from "@/content/universities";

export type Phase = "thinking" | "streaming" | "done" | "stopped";

export type AssistantMessage = {
  id: string;
  role: "assistant";
  answer: Answer;
  phase: Phase;
  /** How many thinking steps have finished */
  step: number;
  /** How many units of the answer are on screen (a unit is a word; a block counts as a few) */
  shown: number;
  /** Streamed in this visit, so words arrive one by one; old chats render whole */
  streamed: boolean;
  feedback?: "up" | "down";
};

const words = (s: string) => s.split(" ");

function unitsOf(block: AnswerBlock) {
  switch (block.kind) {
    case "p":
      return words(block.text).length;
    case "list":
      return block.items.reduce((n, item) => n + words(item).length, 0);
    case "tiers":
      return 10;
    case "sources":
      return 4;
  }
}

export const totalUnits = (a: Answer) => a.blocks.reduce((n, b) => n + unitsOf(b), 0);

export function plainText(a: Answer) {
  return a.blocks
    .map((b) => {
      if (b.kind === "p") return b.text;
      if (b.kind === "list") return b.items.map((i) => `- ${i}`).join("\n");
      if (b.kind === "sources") return `Checked against: ${b.items.join(", ")}`;
      return b.tiers
        .map((t) => `${t.name}: ${t.unis.map((id) => dreamUniversities.find((u) => u.id === id)?.name ?? id).join(", ")}`)
        .join("\n");
    })
    .join("\n\n");
}

/** Words arrive one at a time and settle from a soft blur (transitions-dev streaming text). */
function Stream({ text, count, live }: { text: string; count: number; live: boolean }) {
  if (!live) return <>{text}</>;
  const ws = words(text);
  const n = Math.max(0, Math.min(ws.length, count));
  return (
    <>
      {ws.slice(0, n).map((w, i) => (
        <span key={i} className="stream-word">
          {w}
          {i < ws.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

const tierTone = {
  Reach: "bg-mid text-ink",
  Match: "bg-cobalt-tint text-ink",
  Safety: "bg-cobalt text-on-cobalt",
};

function Tiers({ tiers }: { tiers: Extract<AnswerBlock, { kind: "tiers" }>["tiers"] }) {
  return (
    <div className="my-5 grid gap-2 sm:grid-cols-3" data-ui>
      {tiers.map((t, i) => (
        <div
          key={t.name}
          className="block-in rounded-[1.25rem] bg-ground p-4"
          style={{ "--i": i } as CSSProperties}
        >
          <span className={clsx("inline-flex h-7 items-center rounded-full px-3 text-small font-medium", tierTone[t.name])}>
            {t.name}
          </span>
          <ul className="mt-4 flex flex-col gap-4">
            {t.unis.map((id) => {
              const u = dreamUniversities.find((d) => d.id === id);
              if (!u || u.low === undefined || u.high === undefined) return null;
              return (
                <li key={id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{u.name}</span>
                    <span className="tabular text-small text-soft">
                      {u.low}–{u.high}%
                    </span>
                  </div>
                  <RangeBar
                    low={u.low}
                    high={u.high}
                    size="sm"
                    track="paper"
                    className="mt-2"
                    label={`${u.name}: estimated ${u.low} to ${u.high} percent`}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function StepMark({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "active")
    return (
      <span className="relative block h-3 w-6 rounded-full bg-cobalt-tint" aria-hidden>
        <span className="think-dot absolute left-0.5 top-0.5 size-2 rounded-full bg-cobalt" />
      </span>
    );
  if (state === "done")
    return (
      <span className="grid h-3 w-6 place-items-center" aria-hidden>
        <span className="grid size-5 place-items-center rounded-full bg-cobalt text-on-cobalt">
          <svg viewBox="0 0 24 24" className="check-draw size-3" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" pathLength={1} />
          </svg>
        </span>
      </span>
    );
  return (
    <span className="grid h-3 w-6 place-items-center" aria-hidden>
      <span className="size-2 rounded-full bg-mid" />
    </span>
  );
}

/** The specialist checks: shown while thinking, folded into one line once the answer arrives. */
function Steps({ step, thinking }: { step: number; thinking: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = thinking || open;
  return (
    <div className="mb-3">
      {!thinking ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="press -ml-2 flex h-9 items-center gap-2 rounded-full px-2 text-small font-medium text-soft hover:bg-surface hover:text-ink"
        >
          <span className="bullet" aria-hidden />
          Checked your log, official sources and students like you
          <Icon name="chevron" className={clsx("size-4 transition-transform duration-200 ease-[var(--ease-out)]", open && "rotate-180")} />
        </button>
      ) : null}
      <div className="reveal-rows" data-open={expanded ? "" : undefined}>
        <div className="min-h-0 overflow-hidden" inert={!expanded}>
          <ol className={clsx("flex flex-col gap-2.5 rounded-[1.25rem] bg-ground p-4", !thinking && "mt-2")}>
            {specialistSteps.map((s, i) => {
              const state = i < step ? "done" : i === step && thinking ? "active" : "pending";
              return (
                <li key={s} className="flex items-center gap-3 text-small">
                  <StepMark state={state} />
                  <span className={clsx(state === "pending" ? "text-soft" : "text-ink", state === "active" && "think-text")}>
                    {s}
                  </span>
                  <span className="sr-only">{state === "done" ? ", done" : state === "active" ? ", in progress" : ""}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Blocks({ msg }: { msg: AssistantMessage }) {
  let offset = 0;
  const live = msg.streamed;
  const out = [];
  for (const [bi, block] of msg.answer.blocks.entries()) {
    const start = offset;
    offset += unitsOf(block);
    const budget = msg.shown - start;
    if (budget <= 0) break;
    if (block.kind === "p") {
      out.push(
        <p key={bi} className="mb-4 max-w-[62ch] text-body leading-[1.7]">
          <Stream text={block.text} count={budget} live={live} />
        </p>,
      );
    } else if (block.kind === "list") {
      // Each item's share of the budget: what's left after the items before it
      const before = block.items.map((_, ii) =>
        block.items.slice(0, ii).reduce((n, item) => n + words(item).length, 0),
      );
      out.push(
        <ul key={bi} className="mb-4 flex max-w-[62ch] flex-col gap-2.5">
          {block.items.map((item, ii) => {
            const count = budget - before[ii];
            if (count <= 0) return null;
            return (
              <li key={ii} className="flex gap-3 text-body leading-[1.6]">
                <span className="bullet mt-[0.55em]" aria-hidden />
                <span>
                  <Stream text={item} count={count} live={live} />
                </span>
              </li>
            );
          })}
        </ul>,
      );
    } else if (block.kind === "tiers") {
      out.push(<Tiers key={bi} tiers={block.tiers} />);
    } else {
      out.push(
        <div key={bi} className="block-in mb-2 mt-1 flex flex-wrap items-center gap-2" data-ui>
          <span className="mr-1 text-small text-soft">Checked against</span>
          {block.items.map((s) => (
            <span key={s} className="inline-flex h-8 items-center gap-2 rounded-full bg-surface px-3 text-small font-medium">
              <span className="size-1.5 rounded-full bg-cobalt" aria-hidden />
              {s}
            </span>
          ))}
        </div>,
      );
    }
  }
  return <>{out}</>;
}

/** Memoised: while one answer streams, the finished ones above it don't re-render. */
export const AnswerView = memo(function AnswerView({
  msg,
  onFeedback,
  onFollowUp,
  last,
}: {
  msg: AssistantMessage;
  onFeedback: (msgId: string, v: "up" | "down") => void;
  onFollowUp: (text: string) => void;
  last: boolean;
}) {
  const thinking = msg.phase === "thinking";
  const settled = msg.phase === "done" || msg.phase === "stopped";

  return (
    <div className="msg-in flex gap-3 sm:gap-4" aria-busy={!settled}>
      <Mark className="mt-1 size-7" />
      <div className="min-w-0 flex-1">
        <p className="sr-only">Upchance said:</p>
        <Steps step={msg.step} thinking={thinking} />
        <Blocks msg={msg} />

        {msg.phase === "stopped" ? (
          <p className="mb-3 text-small text-soft">
            {msg.shown === 0 ? "Stopped before answering. Ask again, or try another question." : "Stopped. Ask Upchance to carry on whenever you like."}
          </p>
        ) : null}

        {settled && msg.shown > 0 ? (
          <div className="fade-in mt-1 flex items-center gap-1">
            <Tip label="Copy">
              <button
                type="button"
                aria-label="Copy answer"
                onClick={() => {
                  navigator.clipboard?.writeText(plainText(msg.answer)).then(
                    () => toast("Answer copied"),
                    () => toast("Couldn’t copy. Select the text instead."),
                  );
                }}
                className="press grid size-10 place-items-center rounded-full text-soft hover:bg-surface hover:text-ink"
              >
                <Icon name="copy" className="size-[1.125rem]" />
              </button>
            </Tip>
            <Tip label="Helpful">
              <button
                type="button"
                aria-label="Helpful"
                aria-pressed={msg.feedback === "up"}
                onClick={() => onFeedback(msg.id, "up")}
                className="press grid size-10 place-items-center rounded-full text-soft hover:bg-surface hover:text-ink aria-pressed:bg-cobalt-tint aria-pressed:text-cobalt"
              >
                <Icon name="thumbUp" className="size-[1.125rem]" />
              </button>
            </Tip>
            <Tip label="Not helpful">
              <button
                type="button"
                aria-label="Not helpful"
                aria-pressed={msg.feedback === "down"}
                onClick={() => onFeedback(msg.id, "down")}
                className="press grid size-10 place-items-center rounded-full text-soft hover:bg-surface hover:text-ink aria-pressed:bg-surface aria-pressed:text-ink"
              >
                <Icon name="thumbDown" className="size-[1.125rem]" />
              </button>
            </Tip>
          </div>
        ) : null}

        {last && msg.phase === "done" && msg.answer.followUps.length ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Ask a follow-up">
            {msg.answer.followUps.map((f, i) => (
              <li key={f} className="block-in" style={{ "--i": i } as CSSProperties}>
                <button
                  type="button"
                  onClick={() => onFollowUp(f)}
                  className="press flex h-10 items-center gap-2.5 rounded-full bg-surface px-4 text-small font-medium hover:bg-mid"
                >
                  <span className="size-1.5 rounded-full bg-cobalt" aria-hidden />
                  {f}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
});
