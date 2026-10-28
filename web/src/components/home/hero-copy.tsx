import clsx from "clsx";
import { LinkButton } from "@/components/ui/button";

export const heroHeadline = ["Know your chances.", "Then raise them."];

export const heroSupport =
  "Upchance shows where you stand at the universities you want, then helps you get in: essays, interviews, activities and every next step, with an AI counsellor that remembers you.";

export function HeroActions({ onField = false, className }: { onField?: boolean; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-3", className)}>
      <LinkButton href="/assessment" size="lg" tone={onField ? "paper" : "cobalt"}>
        See my chances
      </LinkButton>
      <LinkButton href="/ask" size="lg" tone={onField ? "onCobalt" : "quiet"} dot={false}>
        Ask a question first
      </LinkButton>
    </div>
  );
}

export function Reassurance({ onField = false, className }: { onField?: boolean; className?: string }) {
  return (
    <ul className={clsx("flex flex-wrap gap-x-6 gap-y-2 text-body", onField ? "text-white/85" : "text-soft", className)}>
      {["Free", "About 2 minutes", "No card needed"].map((t) => (
        <li key={t} className="flex items-center gap-2.5">
          <span
            className="bullet"
            aria-hidden
            style={onField ? ({ "--band": "rgba(255,255,255,0.9)", "--bullet-dot": "var(--cobalt)" } as React.CSSProperties) : undefined}
          />
          {t}
        </li>
      ))}
    </ul>
  );
}
