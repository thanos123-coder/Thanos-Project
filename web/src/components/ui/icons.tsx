import clsx from "clsx";
import type { ReactNode } from "react";

/** One stroke family for the app's few icons: 24px grid, 2px rounded strokes, like the mark. */
const paths = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  home: <path d="M4 11.5 12 5l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z" />,
  memory: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="3" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3" />
    </>
  ),
  clip: <path d="m15.5 7.5-6.4 6.4a2 2 0 0 0 2.8 2.8l7-7a4 4 0 0 0-5.6-5.6l-7.2 7.2a6 6 0 0 0 8.5 8.5l5.4-5.3" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  thumbUp: (
    <path d="M7.5 10.5v9H5.5a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5zm0 0L11 4a2 2 0 0 1 2.9 2.2l-.7 3.3h5a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.5" />
  ),
  thumbDown: (
    <path
      transform="rotate(180 12 12)"
      d="M7.5 10.5v9H5.5a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5zm0 0L11 4a2 2 0 0 1 2.9 2.2l-.7 3.3h5a2 2 0 0 1 2 2.4l-1.3 6a2 2 0 0 1-2 1.6H7.5"
    />
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12a1.5 1.5 0 0 0 1.5 1.4h5a1.5 1.5 0 0 0 1.5-1.4L17 7" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  compose: (
    <>
      <path d="M12 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-5" />
      <path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L13 14l-4 1 1-4z" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx("size-5 shrink-0", className)}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
