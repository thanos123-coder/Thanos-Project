import Link from "next/link";
import clsx from "clsx";

/**
 * The Upchance mark: a rising U drawn as one rounded band, its right arm taller than its left,
 * with the range marker resting at the high end. Name (U), promise (up) and product (the band
 * and its marker) in one shape.
 */
export function Mark({
  className,
  tone = "cobalt",
  title,
}: {
  className?: string;
  tone?: "cobalt" | "ink" | "paper";
  title?: string;
}) {
  const stroke =
    tone === "cobalt" ? "var(--cobalt)" : tone === "ink" ? "var(--ink)" : "var(--paper)";
  const dot = tone === "paper" ? "var(--cobalt)" : "var(--paper)";
  return (
    <svg
      viewBox="0 0 32 32"
      className={clsx("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d="M8 12.5V18a8 8 0 0 0 16 0V5.5"
        fill="none"
        stroke={stroke}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="5.5" r="2.05" fill={dot} />
    </svg>
  );
}

export function Logo({
  className,
  tone = "ink",
  href = "/",
}: {
  className?: string;
  tone?: "ink" | "paper";
  href?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Upchance home"
      className={clsx(
        "group/logo press inline-flex items-center gap-2 rounded-full",
        tone === "paper" ? "text-on-cobalt" : "text-ink",
        className,
      )}
    >
      <Mark
        tone={tone === "paper" ? "paper" : "cobalt"}
        className="size-[1.6em] transition-transform duration-200 ease-[var(--ease-out)] group-hover/logo:-translate-y-0.5"
      />
      <span className="text-[1.375em] font-bold leading-none tracking-[-0.035em]">Upchance</span>
    </Link>
  );
}
