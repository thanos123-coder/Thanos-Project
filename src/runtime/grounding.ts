/**
 * Grounding check for generated text.
 *
 * Model-written summaries and explanations must not introduce consequential
 * facts that are absent from the validated structured payload ("The overall
 * summary must be derived from these states, not generated independently",
 * 06R10; "If a result includes a factual claim absent from its payload or
 * evidence, request a bounded repair", 01R07). Dates, money amounts, scores
 * and percentages are the tokens most likely to mislead, so each one in the text
 * must be traceable to the payload.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};

export interface ConsequentialToken {
  kind: 'date' | 'money' | 'percent' | 'number';
  text: string;
  /** Normalized candidates, any of which appearing in the payload grounds the token. */
  normalized: string[];
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function extractConsequentialTokens(text: string): ConsequentialToken[] {
  const tokens: ConsequentialToken[] = [];
  const seen = new Set<string>();
  const push = (t: ConsequentialToken): void => {
    const key = `${t.kind}:${t.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(t);
    }
  };

  // ISO dates and year-months.
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/g)) push({ kind: 'date', text: m[0], normalized: [m[0]] });

  // "15 March 2027", "March 15, 2027", "March 2027"
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) push({ kind: 'date', text: m[0], normalized: [`${m[3]}-${pad(month)}-${pad(Number(m[1]))}`] });
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (month) push({ kind: 'date', text: m[0], normalized: [`${m[3]}-${pad(month)}-${pad(Number(m[2]))}`] });
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (month) push({ kind: 'date', text: m[0], normalized: [`${m[2]}-${pad(month)}`] });
  }

  // Money: €150, $1,050.50, £20, 150 EUR, 150 euros
  for (const m of text.matchAll(/([€$£¥])\s?(\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g)) {
    push({ kind: 'money', text: m[0], normalized: numberForms(m[2]!) });
  }
  for (const m of text.matchAll(/\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s?(EUR|USD|GBP|CHF|JPY|CAD|AUD|euros?|dollars?|pounds?)\b/gi)) {
    push({ kind: 'money', text: m[0], normalized: numberForms(m[1]!) });
  }

  // Percentages.
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s?(%|percent\b)/gi)) push({ kind: 'percent', text: m[0], normalized: numberForms(m[1]!) });

  return tokens;
}

function numberForms(raw: string): string[] {
  const plain = raw.replace(/[,\s]/g, '');
  const n = Number(plain);
  const forms = new Set<string>([plain]);
  if (Number.isFinite(n)) {
    forms.add(String(n));
    forms.add(n.toFixed(2));
    if (Number.isInteger(n)) forms.add(n.toFixed(0));
  }
  return [...forms];
}

/**
 * Tokens in `text` that do not appear in the serialized payload. An empty
 * result means every consequential token is grounded.
 */
export function ungroundedTokens(text: string, payload: unknown): ConsequentialToken[] {
  const haystack = typeof payload === 'string' ? payload : JSON.stringify(payload);
  // A token is grounded when its normalized form or its exact wording appears in the payload.
  return extractConsequentialTokens(text).filter((t) => !t.normalized.some((n) => containsToken(haystack, n)) && !containsToken(haystack, t.text));
}

function containsToken(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? '' : haystack[i - 1]!;
    const after = haystack[i + needle.length] ?? '';
    // Require a token boundary so "150" does not match inside "1500".
    const boundaryBefore = !/[0-9.]/.test(before);
    const boundaryAfter = !/[0-9]/.test(after) && !(after === '.' && /[0-9]/.test(haystack[i + needle.length + 1] ?? ''));
    if (boundaryBefore && boundaryAfter) return true;
    from = i + 1;
  }
}
