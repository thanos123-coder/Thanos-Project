/**
 * Places and languages mentioned in free text: countries (ISO 3166-1 alpha-2),
 * a small set of cities with their IANA timezone, and languages (ISO 639 codes).
 *
 * Country and language names come from the runtime's CLDR data
 * (Intl.DisplayNames), so coverage is not limited to a hand-picked list. Common
 * aliases are added explicitly. Matching is conservative:
 * - the longest mention wins ("Papua New Guinea" is not also "Guinea");
 * - a negated mention ("not the US") is ignored;
 * - demonyms ("Greek") are only used when the caller allows them, and
 *   compound heritage terms ("African American", "Greek-American") are never
 *   read as a country, because heritage is not citizenship or location;
 * - names that are also common words or places elsewhere (Georgia, Jordan,
 *   Chad, Jersey) are reported as needing confirmation.
 */

export interface CountryMention {
  code: string;
  /** Exact text that matched. */
  text: string;
  index: number;
  via: 'name' | 'alias' | 'demonym';
  /** The name has another common meaning and should be confirmed. */
  needsConfirmation: boolean;
}

/** Codes Intl knows that are not ISO 3166-1 countries or territories. */
const NOT_COUNTRIES = new Set(['AA', 'AC', 'CP', 'DG', 'EA', 'EU', 'EZ', 'IC', 'TA', 'UN', 'ZZ']);
function isExcludedCode(code: string): boolean {
  if (NOT_COUNTRIES.has(code)) return true;
  if (code[0] === 'Q' && code[1]! >= 'M') return true;
  if (code[0] === 'X' && code !== 'XK') return true;
  // Deprecated codes (DD, BU, YU, ZR, ...) canonicalize to their successor and are skipped.
  try {
    return Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`;
  } catch {
    return true;
  }
}

const ALIASES: Record<string, readonly string[]> = {
  US: ['united states of america', 'united states', 'usa', 'u.s.a.', 'u.s.a', 'u.s.', 'the states', 'america'],
  GB: ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  GR: ['hellas', 'hellenic republic'],
  KR: ['korea', 'republic of korea'],
  KP: ['dprk'],
  AE: ['uae', 'u.a.e.', 'emirates'],
  NL: ['holland', 'the netherlands'],
  CZ: ['czech republic'],
  TR: ['turkey', 'türkiye', 'turkiye'],
  CI: ['ivory coast', "cote d'ivoire", 'côte d’ivoire', "côte d'ivoire"],
  MM: ['burma'],
  CD: ['drc', 'democratic republic of the congo', 'dr congo'],
  CG: ['republic of the congo'],
  SZ: ['swaziland'],
  CV: ['cape verde'],
  TL: ['east timor'],
  VA: ['vatican', 'vatican city', 'holy see'],
  PS: ['palestine'],
  HK: ['hong kong'],
  MO: ['macau', 'macao'],
  RU: ['russian federation'],
  MK: ['macedonia'],
  BA: ['bosnia'],
  KN: ['saint kitts and nevis', 'st kitts'],
  LC: ['saint lucia'],
  VC: ['saint vincent'],
};

const DEMONYMS: Record<string, readonly string[]> = {
  GR: ['greek', 'hellenic'],
  US: ['american'],
  GB: ['british'],
  CY: ['cypriot'],
  DE: ['german'],
  FR: ['french'],
  IT: ['italian'],
  ES: ['spanish'],
  PT: ['portuguese'],
  NL: ['dutch'],
  IE: ['irish'],
  CA: ['canadian'],
  AU: ['australian'],
  NZ: ['new zealander', 'kiwi'],
  IN: ['indian'],
  CN: ['chinese'],
  JP: ['japanese'],
  KR: ['korean', 'south korean'],
  NG: ['nigerian'],
  GH: ['ghanaian'],
  KE: ['kenyan'],
  ZA: ['south african'],
  EG: ['egyptian'],
  BR: ['brazilian'],
  MX: ['mexican'],
  AR: ['argentine', 'argentinian'],
  TR: ['turkish'],
  CH: ['swiss'],
  AT: ['austrian'],
  BE: ['belgian'],
  SE: ['swedish'],
  NO: ['norwegian'],
  DK: ['danish'],
  FI: ['finnish'],
  PL: ['polish'],
  RO: ['romanian'],
  BG: ['bulgarian'],
  AL: ['albanian'],
  UA: ['ukrainian'],
  RU: ['russian'],
  IL: ['israeli'],
  LB: ['lebanese'],
  SA: ['saudi', 'saudi arabian'],
  AE: ['emirati'],
  PK: ['pakistani'],
  BD: ['bangladeshi'],
  VN: ['vietnamese'],
  TH: ['thai'],
  PH: ['filipino', 'philippine'],
  ID: ['indonesian'],
  MY: ['malaysian'],
  SG: ['singaporean'],
};

/** Words that make a following demonym a heritage or regional term, not a country ("African American"). */
const HERITAGE_WORDS = new Set([
  'african', 'asian', 'latin', 'latino', 'latina', 'latinx', 'hispanic', 'native', 'indigenous', 'south', 'north', 'central', 'east', 'west',
  'arab', 'caribbean', 'european', 'anglo', 'afro', 'euro', 'middle', 'eastern', 'pacific', 'jewish', 'black', 'white',
]);
function isHeritagePrefix(before: string): boolean {
  if (/-\s*$/.test(before)) return true;
  const w = /([\p{L}]+)\s+$/u.exec(before)?.[1]?.toLowerCase();
  if (!w) return false;
  if (HERITAGE_WORDS.has(w)) return true;
  return Object.values(DEMONYMS).some((list) => list.includes(w));
}
/** Common prefixes that turn a country name into another place ("New Mexico", "New Jersey", "West Virginia"). */
const PLACE_PREFIX = /(?:new|west|north|south)\s+$/i;
const NEEDS_CONFIRMATION = new Set(['GE', 'JO', 'TD', 'JE', 'NE', 'GN']);

interface Pattern {
  code: string;
  re: RegExp;
  via: CountryMention['via'];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameVariants(name: string): string[] {
  const out = new Set<string>();
  const base = name.toLowerCase();
  out.add(base);
  // "Myanmar (Burma)" -> "myanmar", "burma"
  const paren = /^(.*?)\s*\((.*?)\)\s*$/.exec(base);
  if (paren) {
    out.add(paren[1]!.trim());
    out.add(paren[2]!.trim());
  }
  for (const v of [...out]) {
    if (v.includes('&')) out.add(v.replace(/&/g, 'and'));
    if (/\bst\.\s/.test(v)) {
      out.add(v.replace(/\bst\.\s/g, 'saint '));
      out.add(v.replace(/\bst\.\s/g, 'st '));
    }
    if (v.includes(' sar china')) out.add(v.replace(' sar china', ''));
    if (v.includes('’')) out.add(v.replace(/’/g, "'"));
    // "Congo - Kinshasa" style names are covered by explicit aliases.
    if (v.includes(' - ')) out.delete(v);
  }
  return [...out].filter((v) => v.length >= 3 || v === 'uk');
}

let patternsCache: Pattern[] | null = null;
let namesCache: Map<string, string> | null = null;

function buildPatterns(): Pattern[] {
  if (patternsCache) return patternsCache;
  const display = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });
  const names = new Map<string, string>();
  const patterns: Pattern[] = [];
  const add = (code: string, phrase: string, via: Pattern['via']) => {
    patterns.push({ code, via, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase).replace(/\\ /g, '\\s+').replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu') });
  };
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      if (isExcludedCode(code)) continue;
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        name = undefined;
      }
      if (!name || name === code) continue;
      names.set(code, name);
      for (const v of nameVariants(name)) add(code, v, 'name');
    }
  }
  for (const [code, list] of Object.entries(ALIASES)) for (const v of list) add(code, v, 'alias');
  // Upper-case abbreviations that are also ordinary words in lower case ("tell us").
  for (const [abbr, code] of [['US', 'US'], ['UK', 'GB']] as const) {
    patterns.push({ code, via: 'alias', re: new RegExp(`(?<![\\p{L}\\p{N}.])${abbr}(?![\\p{L}\\p{N}])`, 'gu') });
  }
  for (const [code, list] of Object.entries(DEMONYMS)) for (const v of list) add(code, v, 'demonym');
  patternsCache = patterns;
  namesCache = names;
  return patterns;
}

/** English display name for a country code ("GR" -> "Greece"). */
export function countryName(code: string): string {
  buildPatterns();
  return namesCache!.get(code.toUpperCase()) ?? code.toUpperCase();
}

export function isKnownCountryCode(code: string): boolean {
  buildPatterns();
  return namesCache!.has(code.toUpperCase());
}

/**
 * Countries explicitly mentioned in the text, in order of appearance.
 * `demonyms: false` ignores words like "Greek" that describe a language or
 * heritage as often as a country.
 */
export function findCountryMentions(text: string, opts: { demonyms: boolean } = { demonyms: true }): CountryMention[] {
  const found: CountryMention[] = [];
  for (const p of buildPatterns()) {
    if (p.via === 'demonym' && !opts.demonyms) continue;
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      const index = m.index!;
      const before = text.slice(Math.max(0, index - 24), index);
      if (p.via === 'demonym') {
        // "Greek-American", "African American": heritage, not a country.
        if (isHeritagePrefix(before)) continue;
        const after = text.slice(index + m[0].length, index + m[0].length + 2);
        if (/^-\p{L}/u.test(after)) continue;
      }
      if (p.code === 'US' && /^america$/i.test(m[0]) && /(?:latin|south|north|central)\s+$/i.test(before)) continue;
      // "New Mexico", "New Jersey", "West Virginia"-style places are not the country.
      if (PLACE_PREFIX.test(before) && ['MX', 'JE', 'GN'].includes(p.code)) continue;
      found.push({ code: p.code, text: m[0], index, via: p.via, needsConfirmation: NEEDS_CONFIRMATION.has(p.code) });
    }
  }
  // Longest match wins; drop matches contained in a longer one.
  found.sort((a, b) => b.text.length - a.text.length || a.index - b.index);
  const kept: CountryMention[] = [];
  for (const f of found) {
    const overlaps = kept.some((k) => f.index < k.index + k.text.length && k.index < f.index + f.text.length);
    if (!overlaps) kept.push(f);
  }
  // Negated mentions ("not the US", "except France") are not selections.
  const affirmative = kept.filter((k) => !/\b(?:not|no|never|except|excluding|apart from|other than)\s+(?:the\s+|in\s+|to\s+)?$/i.test(text.slice(Math.max(0, k.index - 20), k.index)));
  return affirmative.sort((a, b) => a.index - b.index);
}

/** Distinct country codes mentioned, in order. */
export function findCountryCodes(text: string, opts: { demonyms: boolean } = { demonyms: true }): string[] {
  return [...new Set(findCountryMentions(text, opts).map((m) => m.code))];
}

// ------------------------------------------------------------------ cities

export interface CityInfo {
  city: string;
  country: string;
  region: string | null;
  zone: string;
}

const CITIES: ReadonlyArray<CityInfo & { names: readonly string[] }> = [
  { city: 'Athens', country: 'GR', region: 'Attica', zone: 'Europe/Athens', names: ['athens', 'athina'] },
  { city: 'Thessaloniki', country: 'GR', region: 'Central Macedonia', zone: 'Europe/Athens', names: ['thessaloniki', 'salonica'] },
  { city: 'Patras', country: 'GR', region: 'Western Greece', zone: 'Europe/Athens', names: ['patras', 'patra'] },
  { city: 'Heraklion', country: 'GR', region: 'Crete', zone: 'Europe/Athens', names: ['heraklion', 'iraklio'] },
  { city: 'Nicosia', country: 'CY', region: null, zone: 'Asia/Nicosia', names: ['nicosia', 'lefkosia'] },
  { city: 'Limassol', country: 'CY', region: null, zone: 'Asia/Nicosia', names: ['limassol'] },
  { city: 'London', country: 'GB', region: null, zone: 'Europe/London', names: ['london'] },
  { city: 'Manchester', country: 'GB', region: null, zone: 'Europe/London', names: ['manchester'] },
  { city: 'Edinburgh', country: 'GB', region: 'Scotland', zone: 'Europe/London', names: ['edinburgh'] },
  { city: 'Dublin', country: 'IE', region: null, zone: 'Europe/Dublin', names: ['dublin'] },
  { city: 'Paris', country: 'FR', region: 'Île-de-France', zone: 'Europe/Paris', names: ['paris'] },
  { city: 'Berlin', country: 'DE', region: null, zone: 'Europe/Berlin', names: ['berlin'] },
  { city: 'Munich', country: 'DE', region: 'Bavaria', zone: 'Europe/Berlin', names: ['munich', 'münchen'] },
  { city: 'Madrid', country: 'ES', region: null, zone: 'Europe/Madrid', names: ['madrid'] },
  { city: 'Barcelona', country: 'ES', region: 'Catalonia', zone: 'Europe/Madrid', names: ['barcelona'] },
  { city: 'Rome', country: 'IT', region: 'Lazio', zone: 'Europe/Rome', names: ['rome', 'roma'] },
  { city: 'Milan', country: 'IT', region: 'Lombardy', zone: 'Europe/Rome', names: ['milan', 'milano'] },
  { city: 'Amsterdam', country: 'NL', region: null, zone: 'Europe/Amsterdam', names: ['amsterdam'] },
  { city: 'Zurich', country: 'CH', region: null, zone: 'Europe/Zurich', names: ['zurich', 'zürich'] },
  { city: 'Geneva', country: 'CH', region: null, zone: 'Europe/Zurich', names: ['geneva'] },
  { city: 'Vienna', country: 'AT', region: null, zone: 'Europe/Vienna', names: ['vienna', 'wien'] },
  { city: 'Stockholm', country: 'SE', region: null, zone: 'Europe/Stockholm', names: ['stockholm'] },
  { city: 'Warsaw', country: 'PL', region: null, zone: 'Europe/Warsaw', names: ['warsaw'] },
  { city: 'Istanbul', country: 'TR', region: null, zone: 'Europe/Istanbul', names: ['istanbul'] },
  { city: 'New York', country: 'US', region: 'New York', zone: 'America/New_York', names: ['new york city', 'new york', 'nyc'] },
  { city: 'Boston', country: 'US', region: 'Massachusetts', zone: 'America/New_York', names: ['boston'] },
  { city: 'Chicago', country: 'US', region: 'Illinois', zone: 'America/Chicago', names: ['chicago'] },
  { city: 'Houston', country: 'US', region: 'Texas', zone: 'America/Chicago', names: ['houston'] },
  { city: 'Denver', country: 'US', region: 'Colorado', zone: 'America/Denver', names: ['denver'] },
  { city: 'Los Angeles', country: 'US', region: 'California', zone: 'America/Los_Angeles', names: ['los angeles'] },
  { city: 'San Francisco', country: 'US', region: 'California', zone: 'America/Los_Angeles', names: ['san francisco'] },
  { city: 'Seattle', country: 'US', region: 'Washington', zone: 'America/Los_Angeles', names: ['seattle'] },
  { city: 'Toronto', country: 'CA', region: 'Ontario', zone: 'America/Toronto', names: ['toronto'] },
  { city: 'Vancouver', country: 'CA', region: 'British Columbia', zone: 'America/Vancouver', names: ['vancouver'] },
  { city: 'Mexico City', country: 'MX', region: null, zone: 'America/Mexico_City', names: ['mexico city'] },
  { city: 'São Paulo', country: 'BR', region: null, zone: 'America/Sao_Paulo', names: ['são paulo', 'sao paulo'] },
  { city: 'Dubai', country: 'AE', region: null, zone: 'Asia/Dubai', names: ['dubai'] },
  { city: 'Mumbai', country: 'IN', region: 'Maharashtra', zone: 'Asia/Kolkata', names: ['mumbai', 'bombay'] },
  { city: 'Delhi', country: 'IN', region: 'Delhi', zone: 'Asia/Kolkata', names: ['new delhi', 'delhi'] },
  { city: 'Bengaluru', country: 'IN', region: 'Karnataka', zone: 'Asia/Kolkata', names: ['bengaluru', 'bangalore'] },
  { city: 'Singapore', country: 'SG', region: null, zone: 'Asia/Singapore', names: ['singapore'] },
  { city: 'Hong Kong', country: 'HK', region: null, zone: 'Asia/Hong_Kong', names: ['hong kong'] },
  { city: 'Shanghai', country: 'CN', region: null, zone: 'Asia/Shanghai', names: ['shanghai'] },
  { city: 'Beijing', country: 'CN', region: null, zone: 'Asia/Shanghai', names: ['beijing'] },
  { city: 'Tokyo', country: 'JP', region: null, zone: 'Asia/Tokyo', names: ['tokyo'] },
  { city: 'Seoul', country: 'KR', region: null, zone: 'Asia/Seoul', names: ['seoul'] },
  { city: 'Lagos', country: 'NG', region: 'Lagos', zone: 'Africa/Lagos', names: ['lagos'] },
  { city: 'Nairobi', country: 'KE', region: null, zone: 'Africa/Nairobi', names: ['nairobi'] },
  { city: 'Cairo', country: 'EG', region: null, zone: 'Africa/Cairo', names: ['cairo'] },
  { city: 'Johannesburg', country: 'ZA', region: 'Gauteng', zone: 'Africa/Johannesburg', names: ['johannesburg'] },
  { city: 'Sydney', country: 'AU', region: 'New South Wales', zone: 'Australia/Sydney', names: ['sydney'] },
  { city: 'Melbourne', country: 'AU', region: 'Victoria', zone: 'Australia/Melbourne', names: ['melbourne'] },
];

let cityPatterns: Array<{ info: CityInfo; re: RegExp; len: number }> | null = null;

export function findCity(text: string): CityInfo | null {
  cityPatterns ??= CITIES.flatMap((c) => c.names.map((n) => ({ info: { city: c.city, country: c.country, region: c.region, zone: c.zone }, re: new RegExp(`(?<![\\p{L}])${escapeRe(n).replace(/ /g, '\\s+')}(?![\\p{L}])`, 'iu'), len: n.length })));
  let best: { info: CityInfo; len: number } | null = null;
  for (const p of cityPatterns) if (p.re.test(text) && (!best || p.len > best.len)) best = { info: p.info, len: p.len };
  return best ? { ...best.info } : null;
}

/** Countries whose whole territory uses one IANA zone (so a country answer is enough for a timezone). */
export const SINGLE_ZONE_COUNTRIES: Readonly<Record<string, string>> = {
  GR: 'Europe/Athens', CY: 'Asia/Nicosia', GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', DE: 'Europe/Berlin',
  IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna', SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw', CZ: 'Europe/Prague', RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia', HU: 'Europe/Budapest', TR: 'Europe/Istanbul', IL: 'Asia/Jerusalem', AE: 'Asia/Dubai', IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
  EG: 'Africa/Cairo', ZA: 'Africa/Johannesburg', CN: 'Asia/Shanghai', PK: 'Asia/Karachi', BD: 'Asia/Dhaka', TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila', LB: 'Asia/Beirut', SA: 'Asia/Riyadh', GH: 'Africa/Accra', NZ: 'Pacific/Auckland',
};

// ------------------------------------------------------------------ languages

export interface LanguageMention {
  code: string;
  name: string;
  text: string;
  index: number;
}

const LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  zh: ['mandarin', 'mandarin chinese'],
  yue: ['cantonese'],
  fa: ['farsi', 'persian'],
  el: ['modern greek'],
  es: ['castilian'],
  pa: ['punjabi'],
  tl: ['tagalog'],
  fil: ['filipino'],
};

let languagePatterns: Array<{ code: string; name: string; re: RegExp }> | null = null;

function buildLanguagePatterns() {
  if (languagePatterns) return languagePatterns;
  const display = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });
  const out: Array<{ code: string; name: string; re: RegExp }> = [];
  const add = (code: string, name: string, phrase: string) => out.push({ code, name, re: new RegExp(`(?<![\\p{L}])${escapeRe(phrase.toLowerCase()).replace(/ /g, '\\s+')}(?![\\p{L}])`, 'giu') });
  for (let a = 97; a <= 122; a += 1) {
    for (let b = 97; b <= 122; b += 1) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        name = undefined;
      }
      if (!name || name.toLowerCase() === code || name.length < 3) continue;
      add(code, name, name);
    }
  }
  for (const [code, list] of Object.entries(LANGUAGE_ALIASES)) {
    const name = (() => {
      try {
        return display.of(code) ?? code;
      } catch {
        return code;
      }
    })();
    for (const phrase of list) add(code, name, phrase);
  }
  languagePatterns = out;
  return out;
}

/** Languages explicitly named in the text, longest mention first when overlapping, in order of appearance. */
export function findLanguages(text: string): LanguageMention[] {
  const found: LanguageMention[] = [];
  for (const p of buildLanguagePatterns()) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) found.push({ code: p.code, name: p.name, text: m[0], index: m.index! });
  }
  found.sort((a, b) => b.text.length - a.text.length || a.index - b.index);
  const kept: LanguageMention[] = [];
  for (const f of found) if (!kept.some((k) => f.index < k.index + k.text.length && k.index < f.index + f.text.length)) kept.push(f);
  const seen = new Set<string>();
  return kept.sort((a, b) => a.index - b.index).filter((k) => (seen.has(k.code) ? false : (seen.add(k.code), true)));
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' }).of(code) ?? code;
  } catch {
    return code;
  }
}

// ------------------------------------------------------------------ scripts

/**
 * Share of letters outside the Latin script. Used to notice answers in a
 * language the deterministic parsers do not support (02T15), so they are not
 * silently misread.
 */
export function nonLatinLetterShare(text: string): number {
  const letters = [...text.matchAll(/\p{L}/gu)].length;
  if (letters === 0) return 0;
  const latin = [...text.matchAll(/\p{Script=Latin}/gu)].length;
  return (letters - latin) / letters;
}
