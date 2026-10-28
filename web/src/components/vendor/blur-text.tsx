// BlurText from React Bits (https://reactbits.dev/text-animations/blur-text), MIT + Commons Clause, (c) David Haz.
// Ported from its motion version to CSS keyframes (.blur-word in globals.css) with the same default effect:
// each word drops in from above and resolves out of a blur, staggered. As CSS it runs from the first
// paint, before hydration, so a headline is never held back by JavaScript.
import type { CSSProperties } from "react";

/**
 * Words of one headline line. `start` continues the stagger from a previous line, so a two-line
 * headline reads as one sequence.
 */
export function BlurText({ text, start = 0, className }: { text: string; start?: number; className?: string }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i}>
          <span className="blur-word" style={{ "--w": start + i } as CSSProperties}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

export const wordCount = (text: string) => text.split(" ").length;
