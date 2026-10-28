// Text Highlighter by danielpetho (fancycomponents.dev), from 21st.dev
// (https://21st.dev/@danielpetho/components/text-highlighter).
// Adapted: clsx instead of cn; useInView is always called (rules of hooks); and the marker is a flat
// one-colour SVG image rather than a one-colour linear-gradient, so the fill reads as what it is.
"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ElementType } from "react";
import { motion, useInView, type Transition, type UseInViewOptions } from "motion/react";
import clsx from "clsx";

type HighlightDirection = "ltr" | "rtl" | "ttb" | "btt";

type TextHighlighterProps = {
  children: React.ReactNode;
  as?: ElementType;
  triggerType?: "hover" | "ref" | "inView" | "auto";
  transition?: Transition;
  useInViewOptions?: UseInViewOptions;
  className?: string;
  highlightColor?: string;
  direction?: HighlightDirection;
} & React.HTMLAttributes<HTMLElement>;

export type TextHighlighterRef = {
  animate: (direction?: HighlightDirection) => void;
  reset: () => void;
};

const flatFill = (color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' fill='${color}'/></svg>`,
  )}")`;

export const TextHighlighter = forwardRef<TextHighlighterRef, TextHighlighterProps>(
  (
    {
      children,
      as = "span",
      triggerType = "inView",
      transition = { type: "spring", duration: 1, delay: 0, bounce: 0 },
      useInViewOptions = { once: true, initial: false, amount: 0.1 },
      className,
      highlightColor = "#d9dcfa",
      direction = "ltr",
      ...props
    },
    ref,
  ) => {
    const componentRef = useRef<HTMLElement>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [currentDirection, setCurrentDirection] = useState<HighlightDirection>(direction);

    useEffect(() => {
      setCurrentDirection(direction);
    }, [direction]);

    const inView = useInView(componentRef, useInViewOptions);
    const isInView = triggerType === "inView" ? inView : false;

    useImperativeHandle(ref, () => ({
      animate: (animationDirection?: HighlightDirection) => {
        if (animationDirection) setCurrentDirection(animationDirection);
        setIsAnimating(true);
      },
      reset: () => setIsAnimating(false),
    }));

    const shouldAnimate =
      triggerType === "hover"
        ? isHovered
        : triggerType === "inView"
          ? isInView
          : triggerType === "ref"
            ? isAnimating
            : triggerType === "auto";

    const ElementTag = as || "span";

    const sizeFor = (animated: boolean) =>
      currentDirection === "ttb" || currentDirection === "btt"
        ? animated
          ? "100% 100%"
          : "100% 0%"
        : animated
          ? "100% 100%"
          : "0% 100%";

    const animatedSize = useMemo(() => sizeFor(shouldAnimate), [shouldAnimate, currentDirection]); // eslint-disable-line react-hooks/exhaustive-deps
    const initialSize = useMemo(() => sizeFor(false), [currentDirection]); // eslint-disable-line react-hooks/exhaustive-deps
    const backgroundPosition = { ltr: "0% 0%", rtl: "100% 0%", ttb: "0% 0%", btt: "0% 100%" }[currentDirection];

    const highlightStyle = {
      backgroundImage: flatFill(highlightColor),
      backgroundRepeat: "no-repeat",
      backgroundPosition,
      backgroundSize: animatedSize,
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    } as React.CSSProperties;

    return (
      <ElementTag
        ref={componentRef}
        onMouseEnter={() => triggerType === "hover" && setIsHovered(true)}
        onMouseLeave={() => triggerType === "hover" && setIsHovered(false)}
        {...props}
      >
        <motion.span
          className={clsx("inline", className)}
          style={highlightStyle}
          animate={{ backgroundSize: animatedSize }}
          initial={{ backgroundSize: initialSize }}
          transition={transition}
        >
          {children}
        </motion.span>
      </ElementTag>
    );
  },
);

TextHighlighter.displayName = "TextHighlighter";

export default TextHighlighter;
