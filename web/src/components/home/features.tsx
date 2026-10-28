"use client";

import { useState } from "react";
import clsx from "clsx";
import { Switch } from "@/components/ui/switch";
import { TextLink } from "@/components/ui/button";
import {
  AskFragment,
  ChancesFragment,
  EssayFragment,
  InterviewFragment,
  LogFragment,
  MemoryFragment,
} from "@/components/fragments/fragments";
import { features, type FeatureId } from "@/content/home";

const fragments: Record<FeatureId, React.ReactNode> = {
  chances: <ChancesFragment />,
  ask: <AskFragment />,
  essays: <EssayFragment />,
  interviews: <InterviewFragment />,
  log: <LogFragment />,
  memory: <MemoryFragment />,
};

const fieldOn: Record<(typeof features)[number]["field"], string> = {
  cobalt: "bg-cobalt text-on-cobalt",
  ink: "bg-ink text-paper",
  tint: "bg-cobalt-tint text-ink",
};

/**
 * Sentences with switches: each capability is one plain sentence ending in the motif itself.
 * Switch it on and the band fills with colour and shows what it does, with a piece of the product.
 */
export function Features() {
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(features.map((f) => [f.id, f.on])),
  );

  return (
    <section className="section" aria-labelledby="features-title">
      <div className="frame grid-12 mb-12 gap-y-6 lg:mb-16">
        <h2 id="features-title" className="col-span-12 text-head lg:col-span-7">
          One counsellor for the whole journey
        </h2>
        <p className="col-span-12 max-w-[34ch] self-end text-lead text-soft lg:col-span-4 lg:col-start-9">
          Everything you need to apply with confidence, in one place. Switch each one on to see it.
        </p>
      </div>

      <ul>
        {features.map((f) => {
          const isOn = on[f.id];
          const sentenceId = `feature-${f.id}`;
          return (
            <li
              key={f.id}
              data-on={isOn ? "" : undefined}
              data-field={isOn ? f.field : undefined}
              className={clsx(
                "feature-band transition-colors duration-300 ease-[ease]",
                isOn ? fieldOn[f.field] : "bg-ground text-soft hover:bg-surface",
              )}
            >
              <div className="frame grid-12 py-7 lg:py-9">
                <h3
                  id={sentenceId}
                  className="col-span-10 flex cursor-pointer items-center text-[clamp(1.625rem,0.9rem+3vw,4rem)] leading-[1.08] tracking-[-0.03em] lg:col-span-11"
                  onClick={() => setOn((s) => ({ ...s, [f.id]: !s[f.id] }))}
                >
                  <span className={clsx("transition-colors duration-300", isOn ? "" : "text-soft")}>{f.sentence}</span>
                </h3>
                <div className="col-span-2 flex items-center justify-end text-[clamp(1.625rem,0.9rem+3vw,4rem)] lg:col-span-1">
                  <Switch
                    checked={isOn}
                    onCheckedChange={(v) => setOn((s) => ({ ...s, [f.id]: v }))}
                    label={`${f.title}: ${f.sentence}`}
                    tone={f.field === "cobalt" ? "paper" : "cobalt"}
                    className="before:absolute before:-inset-2 before:content-['']"
                  />
                </div>

                <div
                  className="feature-reveal col-span-12 grid transition-[grid-template-rows] duration-400 ease-[var(--ease-in-out)]"
                  style={{ gridTemplateRows: isOn ? "1fr" : "0fr" }}
                  aria-hidden={!isOn}
                  inert={!isOn}
                >
                  <div className="overflow-hidden">
                    <div className="grid-12 gap-y-6 pb-2 pt-7">
                      <div className="col-span-12 flex flex-col items-start gap-5 lg:col-span-5">
                        <p className="max-w-[40ch] text-lead">{f.consequence}</p>
                        <TextLink href={f.link.href} tone={f.field === "tint" ? "cobalt" : "paper"}>
                          {f.link.label}
                        </TextLink>
                      </div>
                      <div className="feature-fragment col-span-12 lg:col-span-5 lg:col-start-8">{fragments[f.id]}</div>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
