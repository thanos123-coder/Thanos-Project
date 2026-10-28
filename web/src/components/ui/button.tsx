import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/**
 * The motif button: a capsule band carrying its marker. The marker leans forward on hover,
 * hinting where the press will take you; the whole capsule gives on press.
 */
export const buttonStyles = cva(
  [
    "group/btn press relative inline-flex select-none items-center justify-center gap-3 whitespace-nowrap rounded-full font-medium",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
  ],
  {
    variants: {
      tone: {
        cobalt: "bg-cobalt text-on-cobalt [--dot:var(--paper)] hover:bg-cobalt-press",
        ink: "bg-ink text-paper [--dot:var(--cobalt)] hover:bg-[#1a1f4a]",
        paper: "bg-paper text-ink [--dot:var(--cobalt)] hover:bg-white",
        quiet: "bg-surface text-ink [--dot:var(--cobalt)] hover:bg-mid",
        outline:
          "bg-transparent text-ink shadow-[inset_0_0_0_2px_var(--ink)] [--dot:var(--ink)] hover:bg-surface",
        onCobalt:
          "bg-transparent text-on-cobalt shadow-[inset_0_0_0_2px_rgba(255,255,255,0.7)] [--dot:var(--paper)] hover:bg-white/10",
      },
      size: {
        sm: "h-10 px-4 text-small",
        md: "h-12 px-5 text-body",
        lg: "h-14 px-7 text-lead",
      },
      dot: {
        true: "pl-4",
        false: "",
      },
    },
    defaultVariants: { tone: "cobalt", size: "md", dot: true },
    compoundVariants: [
      { size: "lg", dot: true, className: "pl-5" },
      { size: "sm", dot: true, className: "pl-3" },
    ],
  },
);

type StyleProps = VariantProps<typeof buttonStyles>;

function Dot() {
  return (
    <span
      aria-hidden
      className="relative block size-[0.55em] rounded-full bg-[var(--dot)] transition-transform duration-300 ease-[var(--ease-out)] group-hover/btn:translate-x-1 group-hover/btn:scale-110"
    />
  );
}

type ButtonProps = StyleProps & ComponentProps<"button"> & { children: ReactNode };

export function Button({ tone, size, dot = true, className, children, type, ...rest }: ButtonProps) {
  return (
    <button type={type ?? "button"} className={clsx(buttonStyles({ tone, size, dot }), className)} {...rest}>
      {dot ? <Dot /> : null}
      <span className="relative">{children}</span>
    </button>
  );
}

type LinkButtonProps = StyleProps &
  Omit<ComponentProps<typeof Link>, "className"> & { className?: string; children: ReactNode };

export function LinkButton({ tone, size, dot = true, className, children, ...rest }: LinkButtonProps) {
  return (
    <Link className={clsx(buttonStyles({ tone, size, dot }), className)} {...rest}>
      {dot ? <Dot /> : null}
      <span className="relative">{children}</span>
    </Link>
  );
}

/** A plain text link with the motif underline: a thin band that grows from the left on hover. */
export function TextLink({
  className,
  children,
  tone = "ink",
  ...rest
}: ComponentProps<typeof Link> & { tone?: "ink" | "cobalt" | "paper" }) {
  return (
    <Link
      className={clsx(
        "group/tl relative inline-flex items-center gap-2 font-medium",
        tone === "cobalt" && "text-cobalt",
        tone === "paper" && "text-on-cobalt",
        tone === "ink" && "text-ink",
        className,
      )}
      {...rest}
    >
      <span className="relative">
        {children}
        <span
          aria-hidden
          className="absolute -bottom-1 left-0 h-[3px] w-full origin-left scale-x-[0.25] rounded-full bg-current transition-transform duration-300 ease-[var(--ease-out)] group-hover/tl:scale-x-100 group-focus-visible/tl:scale-x-100"
        />
      </span>
    </Link>
  );
}
