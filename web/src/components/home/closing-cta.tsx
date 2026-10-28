"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import TextType from "@/components/vendor/text-type";
import { dreamUniversities } from "@/content/universities";

const examples = ["Edinburgh", "Imperial", "TU Delft", "MIT", "Oxford", "NYU"];

/** A sentence with a blank: the blank is the form, and the sentence's last words are the button. */
export function ClosingCta() {
  const router = useRouter();
  const [uni, setUni] = useState("");
  const [focused, setFocused] = useState(false);
  const typing = !uni && !focused;

  return (
    <section className="frame section" aria-labelledby="cta-title">
      <form
        className="text-[clamp(2.25rem,0.6rem+5.2vw,6rem)] leading-[1.18] tracking-[-0.035em]"
        onSubmit={(e) => {
          e.preventDefault();
          const q = uni.trim();
          router.push(q ? `/assessment?uni=${encodeURIComponent(q)}` : "/assessment");
        }}
      >
        <h2 id="cta-title" className="inline font-medium">
          I’d love to study at
        </h2>{" "}
        <label htmlFor="cta-uni" className="sr-only">
          The university you’d love to study at
        </label>
        {/* The blank types a few dream universities to itself until you take over (React Bits TextType) */}
        <span className="relative inline-block w-[min(7em,100%)] align-[-0.12em] max-sm:my-2 max-sm:block max-sm:w-full">
          <input
            id="cta-uni"
            list="cta-unis"
            value={uni}
            onChange={(e) => setUni(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={typing ? "" : "Edinburgh"}
            maxLength={120}
            autoComplete="off"
            className="cta-blank block h-[1.12em] w-full rounded-full bg-surface px-[0.4em] font-medium tracking-[-0.03em] text-ink outline-none placeholder:text-soft focus-visible:bg-cobalt-tint"
          />
          <span
            aria-hidden
            className={clsx(
              "pointer-events-none absolute inset-y-0 left-[0.4em] flex items-center font-medium text-soft transition-opacity duration-200",
              typing ? "opacity-100" : "opacity-0",
            )}
          >
            <TextType
              as="span"
              aria-hidden
              text={examples}
              typingSpeed={75}
              deletingSpeed={40}
              pauseDuration={1800}
              initialDelay={400}
              startOnVisible
              cursorStyle="bar"
              cursorClassName="text-cobalt"
              className="whitespace-nowrap"
            />
          </span>
        </span>
        <datalist id="cta-unis">
          {dreamUniversities.map((u) => (
            <option key={u.id} value={u.name} />
          ))}
        </datalist>{" "}
        <button
          type="submit"
          className="press inline-flex h-[1.12em] items-center gap-[0.25em] rounded-full bg-cobalt px-[0.42em] align-[-0.12em] font-medium tracking-[-0.03em] text-on-cobalt hover:bg-cobalt-press"
        >
          <span aria-hidden className="size-[0.26em] rounded-full bg-paper" />
          See my chances
        </button>
      </form>
      <p className="mt-8 max-w-[52ch] text-body text-soft">
        Two minutes to know where you stand. Free for every student, no card needed: a few questions about your
        grades, activities and dream universities.
      </p>
    </section>
  );
}
