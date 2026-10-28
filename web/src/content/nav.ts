export const mainNav = [
  { href: "/", label: "Home" },
  { href: "/ask", label: "Ask" },
  { href: "/chances", label: "Chances" },
  { href: "/essays", label: "Essays" },
  { href: "/interviews", label: "Interviews" },
  { href: "/log", label: "Log" },
  { href: "/plans", label: "Plans" },
] as const;

export const footerColumns = [
  {
    title: "Upchance",
    links: [...mainNav.map((l) => ({ href: l.href, label: l.label })), { href: "/assessment", label: "Free assessment" }],
  },
  {
    title: "Help",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/ai-notice", label: "AI Notice" },
      { href: "/company", label: "Company details" },
      { href: "/cancel", label: "Cancel subscription" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms and Conditions" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/refunds", label: "Refund Policy" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
];

export const legalNotes = [
  "Prices shown in US dollars. Exchange rates from October 2, 2026; prices are reviewed monthly.",
  "[COMPANY LEGAL NAME], [REGISTERED OFFICE ADDRESS IN GREECE]. VAT [VAT NUMBER (ΑΦΜ)]. G.E.MI. [G.E.MI. NUMBER].",
];
