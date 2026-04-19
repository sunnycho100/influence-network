/**
 * Canonicalization helpers for matching free-text fields like school and
 * company names that arrive with inconsistent punctuation, casing, or
 * abbreviations from different scrape sources.
 */

const SCHOOL_STOPWORDS = new Set([
  'university',
  'universidad',
  'college',
  'school',
  'institute',
  'polytechnic',
  'academy',
  'state',
  'the',
  'of',
  'at',
  'and',
  'for',
  'a',
  'an',
]);

/**
 * Map of well-known school abbreviations to a multi-word canonical form.
 * Expansion happens BEFORE stopword removal, so the output should not
 * contain stopwords like "university" or "of".
 */
const SCHOOL_ALIASES: Record<string, string> = {
  uw: 'wisconsin madison',
  'uw-madison': 'wisconsin madison',
  uwm: 'wisconsin milwaukee',
  ucla: 'california los angeles',
  usc: 'southern california',
  ucb: 'berkeley california',
  ucsd: 'san diego california',
  ucsb: 'santa barbara california',
  ucd: 'davis california',
  uci: 'irvine california',
  ucsc: 'santa cruz california',
  cmu: 'carnegie mellon',
  mit: 'mit',
  caltech: 'caltech',
  nyu: 'new york',
  ut: 'texas',
  utc: 'tennessee chattanooga',
  utk: 'tennessee knoxville',
  asu: 'arizona',
  uiuc: 'illinois urbana champaign',
  umn: 'minnesota',
  umich: 'michigan ann arbor',
  upenn: 'pennsylvania',
  vt: 'virginia tech',
  vcu: 'virginia commonwealth',
  ucf: 'central florida',
  fsu: 'florida',
  uf: 'florida',
  uga: 'georgia',
  gt: 'georgia tech',
  bu: 'boston',
  bc: 'boston',
  uconn: 'connecticut',
  uw_madison: 'wisconsin madison',
};

function basicNormalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Returns a canonical key for a school name so equivalent variants compare
 * equal (e.g. "University of Wisconsin-Madison", "UW-Madison", and
 * "University of Wisconsin–Madison" all → "madison wisconsin").
 *
 * Returns an empty string when the input is missing or yields no
 * meaningful tokens.
 */
export function canonicalSchool(value?: string): string {
  if (!value) return '';

  const normalized = basicNormalize(value);
  if (!normalized) return '';

  const rawTokens = normalized.split(/\s+/).filter(Boolean);

  // Expand abbreviations into their full token list (handles things like
  // "UW Madison" → ["wisconsin", "madison", "madison"], deduped later).
  const expanded: string[] = [];
  for (const token of rawTokens) {
    const alias = SCHOOL_ALIASES[token];
    if (alias) {
      expanded.push(...alias.split(' '));
    } else {
      expanded.push(token);
    }
  }

  // Remove generic words that don't help distinguish schools.
  const filtered = expanded.filter((token) => !SCHOOL_STOPWORDS.has(token));

  // If stripping wiped everything (rare — e.g. "The College") fall back to
  // the expanded list so we don't return an empty key for a non-empty name.
  const tokens = filtered.length > 0 ? filtered : expanded;

  // Sort + dedupe so token order doesn't matter ("Wisconsin Madison" ≡
  // "Madison Wisconsin").
  return Array.from(new Set(tokens)).sort().join(' ');
}
