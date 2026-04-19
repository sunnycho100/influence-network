import type { Profile } from '@alumni-graph/shared';

/* ---------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------*/

export function scrapeProfilePage(doc: Document = document): Profile | null {
  const profileId = extractProfileId(globalThis.location.href);
  if (!profileId) return null;

  const topCard = findTopCard(doc);
  const name = visibleText(doc, [
    'main h1',
    '.pv-text-details__left-panel h1',
    '.ph5 h1',
  ]);

  if (!topCard || !name) return null;

  const headline = visibleText(topCard, [
    'div.text-body-medium.break-words',
    '.text-body-medium',
  ]) ?? '';

  const profileLocation = visibleText(topCard, [
    'span.text-body-small.inline.t-black--light.break-words',
    'span.text-body-small.inline',
  ]);

  const connectionDegree = detectConnectionDegree(topCard);
  const mutualConnections = detectMutualConnections(topCard);
  const experience = extractExperience(doc);
  const education = extractEducation(doc);
  const skills = extractSkills(doc);
  const currentRole = experience[0];

  const profile: Profile = {
    id: profileId,
    name,
    headline,
    education,
    experience,
    mutualConnections,
    connectionDegree,
    linkedinUrl: canonicalizeProfileUrl(globalThis.location.href, profileId),
    lastScraped: Date.now(),
    scrapedFrom: 'profile',
  };

  if (currentRole?.company) profile.currentCompany = currentRole.company;
  if (currentRole?.title) profile.currentTitle = currentRole.title;
  if (profileLocation) profile.location = profileLocation;
  if (skills.length > 0) profile.skills = skills;

  const profilePictureUrl = firstImage(topCard, [
    'img.pv-top-card-profile-picture__image',
    'img.evi-image',
  ]);
  if (profilePictureUrl) profile.profilePictureUrl = profilePictureUrl;

  return profile;
}

/* ---------------------------------------------------------------------------
 * URL helpers
 * -------------------------------------------------------------------------*/

function extractProfileId(url: string): string | null {
  return url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] ?? null;
}

function canonicalizeProfileUrl(url: string, profileId: string): string {
  try {
    return `${new URL(url).origin}/in/${profileId}/`;
  } catch {
    return `https://www.linkedin.com/in/${profileId}/`;
  }
}

/* ---------------------------------------------------------------------------
 * Top-card helpers
 * -------------------------------------------------------------------------*/

function findTopCard(doc: Document): HTMLElement | null {
  // The top card is the <section> that contains the profile <h1>.
  // We deliberately do NOT match `.pv-top-card` because LinkedIn applies that
  // class to inner sub-elements (like the photo container), which would miss
  // the mutual-connections anchor and the headline.
  const h1 = doc.querySelector<HTMLElement>('main h1');
  const section = h1?.closest<HTMLElement>('section');
  if (section) return section;

  return (
    doc.querySelector<HTMLElement>('.profile-topcard-person-entity') ??
    doc.querySelector<HTMLElement>('main section')
  );
}

function detectConnectionDegree(topCard: HTMLElement): Profile['connectionDegree'] {
  // Stable selector: span.dist-value contains "1st", "2nd", "3rd"
  const distValue = topCard.querySelector<HTMLElement>('span.dist-value')?.textContent?.trim() ?? '';
  if (/\b1st\b/i.test(distValue)) return 1;
  if (/\b2nd\b/i.test(distValue)) return 2;
  if (/\b3rd\b/i.test(distValue)) return 3;

  // Fallback: scan visually-hidden badges
  const badge = topCard.querySelector<HTMLElement>('.distance-badge .visually-hidden')?.textContent ?? '';
  if (/1st/i.test(badge)) return 1;
  if (/2nd/i.test(badge)) return 2;
  if (/3rd/i.test(badge)) return 3;
  return null;
}

function detectMutualConnections(topCard: HTMLElement): number {
  // Find the mutual-connections anchor: it contains the text "mutual connection(s)".
  // Stable signal: it's the only <a> in the top card that mentions "mutual".
  const mutualAnchor =
    Array.from(topCard.querySelectorAll<HTMLElement>('a')).find((a) =>
      /mutual\s+connection/i.test(a.textContent ?? ''),
    ) ?? null;

  // Prefer the visually-hidden full sentence (it's a clean, screen-reader copy
  // without DOM fragmentation noise). Fallback to the anchor's own textContent,
  // and finally to the entire top-card text.
  const sources: string[] = [];
  if (mutualAnchor) {
    const hidden = mutualAnchor.querySelector<HTMLElement>('.visually-hidden')?.textContent;
    if (hidden) sources.push(hidden);
    sources.push(mutualAnchor.textContent ?? '');
  }
  sources.push(topCard.textContent ?? '');

  for (const raw of sources) {
    if (!raw) continue;
    // "and 12 other mutual connections" → 12 others + named mutuals (counted via <strong>)
    const otherMatch = raw.match(/and\s+(\d+)\+?\s+other\s+mutual\s+connection/i);
    if (otherMatch) {
      const others = Number.parseInt(otherMatch[1] ?? '0', 10) || 0;
      const named = mutualAnchor?.querySelectorAll('strong').length ?? 0;
      // Anchor renders each <strong> twice (once visible, once visually-hidden).
      const dedupedNamed = Math.ceil(named / 2);
      return dedupedNamed + others;
    }
    // "5 mutual connections" (no "other" — just a count)
    const directMatch = raw.match(/(\d+)\+?\s+mutual\s+connection/i);
    if (directMatch) {
      return Number.parseInt(directMatch[1] ?? '0', 10) || 0;
    }
  }

  // Fallback: count <strong> names in the anchor (deduped for visually-hidden copy).
  if (mutualAnchor) {
    const named = mutualAnchor.querySelectorAll('strong').length;
    if (named > 0) return Math.ceil(named / 2);
  }

  return 0;
}

/* ---------------------------------------------------------------------------
 * Section locator — uses the stable `id` attribute on the anchor div
 * (e.g. <div id="experience">, <div id="education">, <div id="skills">)
 * Falls back to heading-text matching.
 * -------------------------------------------------------------------------*/

function findSection(doc: Document, sectionId: string): HTMLElement | null {
  // Primary: LinkedIn renders <div id="experience"> etc. inside a <section>
  const anchor = doc.querySelector<HTMLElement>(`#${sectionId}`);
  if (anchor) {
    const section = anchor.closest<HTMLElement>('section');
    if (section) return section;
  }

  // Fallback: search section headings
  const target = sectionId.toLowerCase();
  for (const section of doc.querySelectorAll<HTMLElement>('main section')) {
    const heading = visibleText(section, ['h2 span', 'h2', 'h3 span', 'h3']);
    if (heading && heading.toLowerCase().includes(target)) return section;
  }

  return null;
}

/** Return top-level entity `li`s inside a section (ones with `data-view-name`). */
function sectionEntities(doc: Document, sectionId: string): HTMLElement[] {
  const section = findSection(doc, sectionId);
  if (!section) return [];

  // Each entry is an `li` containing a `div[data-view-name="profile-component-entity"]`
  const items = Array.from(
    section.querySelectorAll<HTMLElement>(
      'li div[data-view-name="profile-component-entity"]',
    ),
  );

  // Only keep top-level entities: exclude those nested inside `.pvs-entity__sub-components`
  return items
    .filter((entity) => !entity.closest('.pvs-entity__sub-components'))
    .map((entity) => entity.closest<HTMLElement>('li')!)
    .filter(Boolean);
}

/* ---------------------------------------------------------------------------
 * Experience extraction
 *
 * Two LinkedIn patterns:
 *   1. Multi-role at one company — outer entity shows company name + "Full-time · 2 yr",
 *      nested `.pvs-entity__sub-components li` for each role.
 *   2. Single role — outer entity shows title, subtitle has company · employment type,
 *      then dates and optional location.
 * -------------------------------------------------------------------------*/

function extractExperience(doc: Document): Profile['experience'] {
  const results: Profile['experience'] = [];

  for (const li of sectionEntities(doc, 'experience')) {
    const subRoles = li.querySelectorAll<HTMLElement>(
      '.pvs-entity__sub-components li div[data-view-name="profile-component-entity"]',
    );

    if (subRoles.length > 0) {
      // Multi-role: outer bold text = company name
      const company = entityBoldText(li) ?? '';

      for (const role of subRoles) {
        const title = entityBoldText(role) ?? '';
        const dates = entityCaptionText(role);
        const location = entityLightSubtitle(role);

        if (title || company) {
          const entry: Profile['experience'][number] = { company, title, dates };
          if (location) (entry as Record<string, unknown>)['location'] = location;
          results.push(entry);
        }
      }
    } else {
      // Single role: bold = title, first subtitle = company · type
      const title = entityBoldText(li) ?? '';
      const subtitle = entitySubtitleText(li);
      const company = subtitle
        ? subtitle.split(/\s*[·•]\s*/)[0] ?? subtitle
        : '';
      const dates = entityCaptionText(li);
      const location = entityLightSubtitle(li);

      if (title || company) {
        const entry: Profile['experience'][number] = { company, title, dates };
        if (location) (entry as Record<string, unknown>)['location'] = location;
        results.push(entry);
      }
    }
  }

  return results;
}

/* ---------------------------------------------------------------------------
 * Education extraction
 * -------------------------------------------------------------------------*/

function extractEducation(doc: Document): Profile['education'] {
  return sectionEntities(doc, 'education')
    .map<Profile['education'][number] | null>((li) => {
      const school = entityBoldText(li);
      if (!school) return null;

      const subtitle = entitySubtitleText(li); // e.g. "Bachelor's Degree, Economics and Finance"
      const dates = entityCaptionText(li);      // e.g. "2014 - 2018"

      const entry: Profile['education'][number] = { school };

      if (subtitle) {
        const [degree, major] = splitDegreeAndMajor(subtitle);
        if (degree) entry.degree = degree;
        if (major) entry.major = major;
      }

      if (dates) entry.dates = dates;
      return entry;
    })
    .filter((e): e is Profile['education'][number] => e !== null);
}

/* ---------------------------------------------------------------------------
 * Skills extraction
 * -------------------------------------------------------------------------*/

function extractSkills(doc: Document): string[] {
  return sectionEntities(doc, 'skills')
    .map((li) => entityBoldText(li))
    .filter((s): s is string => Boolean(s));
}

/* ---------------------------------------------------------------------------
 * Entity field extractors — work on a single `li` or entity `div`.
 *
 * These target the stable DOM structure inside
 * `div[data-view-name="profile-component-entity"]`:
 *
 *   .t-bold span:not(.visually-hidden)       → primary text (title / company / school)
 *   span.t-14.t-normal:not(.t-black--light)  → subtitle (company · type, or degree)
 *   span.pvs-entity__caption-wrapper          → dates
 *   span.t-14.t-normal.t-black--light         → location / light metadata
 * -------------------------------------------------------------------------*/

/** Bold primary text (title, company name, school, skill). */
function entityBoldText(root: HTMLElement): string | null {
  // Target the visible (non-screen-reader) span inside the bold container
  const bold = root.querySelector<HTMLElement>(
    '.t-bold span[aria-hidden="true"]',
  );
  if (bold) return collapse(bold.textContent);

  // Fallback: first .t-bold span that isn't .visually-hidden
  for (const span of root.querySelectorAll<HTMLElement>('.t-bold span')) {
    if (!span.classList.contains('visually-hidden') && span.textContent?.trim()) {
      return collapse(span.textContent);
    }
  }

  return null;
}

/** Subtitle text (e.g. "Full-time · 1 yr" or "Bachelor's Degree, Economics"). */
function entitySubtitleText(root: HTMLElement): string | null {
  // The subtitle sits in span.t-14.t-normal (without .t-black--light)
  // and is NOT inside .pvs-entity__sub-components
  for (const span of root.querySelectorAll<HTMLElement>('span.t-14.t-normal')) {
    if (span.closest('.pvs-entity__sub-components')) continue;
    if (span.classList.contains('t-black--light')) continue;
    const inner =
      span.querySelector<HTMLElement>('span[aria-hidden="true"]')?.textContent ??
      span.querySelector<HTMLElement>('span:not(.visually-hidden)')?.textContent ??
      span.textContent;
    const text = collapse(inner);
    if (text) return text;
  }
  return null;
}

/** Dates text from the stable `.pvs-entity__caption-wrapper`. */
function entityCaptionText(root: HTMLElement): string {
  return (
    collapse(
      root.querySelector<HTMLElement>('span.pvs-entity__caption-wrapper')?.textContent,
    ) ?? ''
  );
}

/** Light subtitle (location, secondary metadata). */
function entityLightSubtitle(root: HTMLElement): string | null {
  for (const span of root.querySelectorAll<HTMLElement>(
    'span.t-14.t-normal.t-black--light',
  )) {
    if (span.closest('.pvs-entity__sub-components')) continue;
    if (span.querySelector('.pvs-entity__caption-wrapper')) continue;
    const inner =
      span.querySelector<HTMLElement>('span[aria-hidden="true"]')?.textContent ??
      span.querySelector<HTMLElement>('span:not(.visually-hidden)')?.textContent ??
      span.textContent;
    const text = collapse(inner);
    if (text) return text;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Generic DOM utilities
 * -------------------------------------------------------------------------*/

/** Get the visible text from the first matching selector (deduped, collapsed). */
function visibleText(root: ParentNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) continue;
    // Prefer aria-hidden span to avoid the visually-hidden duplicate
    const ariaSpan = el.querySelector<HTMLElement>('span[aria-hidden="true"]');
    const text = collapse(ariaSpan?.textContent ?? el.textContent);
    if (text) return text;
  }
  return null;
}

function firstImage(root: ParentNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const src = root.querySelector<HTMLImageElement>(selector)?.src?.trim();
    if (src) return src;
  }
  return null;
}

function splitDegreeAndMajor(value: string): [string, string] {
  const [degree, ...rest] = value.split(',');
  return [collapse(degree) ?? '', collapse(rest.join(', ')) ?? ''];
}

function collapse(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed || null;
}
