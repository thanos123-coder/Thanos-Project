"use client";

import { useState } from "react";
import { ChanceCard } from "@/components/home/chance-card";
import { DreamPicker } from "@/components/home/dream-picker";
import { HeroActions, Reassurance, heroHeadline, heroSupport } from "@/components/home/hero-copy";
import { dreamUniversities, type ExampleChance } from "@/content/universities";
import { BlurText, wordCount } from "@/components/vendor/blur-text";

const start = dreamUniversities.find((u) => u.id === "imperial")!;

/**
 * Home hero (prototype "Field", promoted): the headline sits on the cobalt field, whose right edge is the
 * range band's giant rounded end; the live range for your dream university sits beside it.
 */
export function HomeHero() {
  const [uni, setUni] = useState<ExampleChance>(start);
  return (
    <section className="relative isolate" aria-labelledby="hero-title">
      <div className="grid grid-cols-[minmax(0,1fr)] lg:min-h-[calc(100svh-4.5rem)] lg:grid-cols-[minmax(0,1.18fr)_minmax(0,1fr)]">
        <div
          data-field="cobalt"
          className="hero-field relative flex flex-col justify-center rounded-b-[2.5rem] bg-cobalt px-[var(--margin)] pb-12 pt-10 text-on-cobalt lg:rounded-b-none lg:rounded-r-[50vh] lg:py-16 lg:pr-[14vh]"
        >
          <div className="w-full [container-type:inline-size] lg:ml-auto lg:max-w-[44rem]">
            <h1
              id="hero-title"
              className="hero-title text-[clamp(1.75rem,11.2cqi,6rem)] font-medium leading-[1.02] tracking-[-0.035em]"
            >
              <BlurText text={heroHeadline[0]} className="block whitespace-nowrap" />
              <BlurText text={heroHeadline[1]} start={wordCount(heroHeadline[0])} className="block whitespace-nowrap" />
            </h1>
            <p className="hero-support mt-7 max-w-[42ch] text-lead text-white/90">{heroSupport}</p>
            <HeroActions onField className="hero-actions mt-9" />
            <Reassurance onField className="hero-reassure mt-6" />
          </div>
        </div>

        <div className="hero-live frame flex flex-col justify-center gap-7 py-10 lg:max-w-none lg:py-16 lg:pl-12 lg:pr-[var(--margin)]">
          <DreamPicker value={uni.id} onChange={setUni} />
          <ChanceCard uni={uni} size="lg" moverToggle className="hero-card" />
        </div>
      </div>
    </section>
  );
}
