import type { Profile } from '@alumni-graph/shared';

export function scrapeProfilePage(doc: Document = document): Profile | null {
  const profileId = extractProfileId(globalThis.location.href);
  const topCard = findTopCard(doc);
  const name = firstText(doc, [
    'main h1',
    '.pv-text-details__left-panel h1',
    '.ph5 h1',
  ]);

  if (!profileId || !topCard || !name) {
    return null;
  }

  const topLines = textLines(topCard);
  const headline =
    firstText(topCard, [
      '.text-body-medium',
      '.pv-text-details__left-panel .text-body-medium',
    ]) ??
    topLines.find((line) => line !== name) ??
    '';

  const profileLocation =
    firstText(topCard, ['.text-body-small.inline', '.text-body-small']) ??
    topLines.find((line) => /,/.test(line)) ??
    undefined;
  const connectionDegree = detectConnectionDegree(topLines);
  const mutualConnections = detectMutualConnections(topLines);
  const experience = extractExperience(doc);
  const education = extractEducation(doc);
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

  if (currentRole?.company) {
    profile.currentCompany = currentRole.company;
  }

  if (currentRole?.title) {
    profile.currentTitle = currentRole.title;
  }

  if (profileLocation) {
    profile.location = profileLocation;
  }

  const profilePictureUrl = firstImage(topCard, [
    'img.pv-top-card-profile-picture__image',
    'img.evi-image',
    'img',
  ]);
  if (profilePictureUrl) {
    profile.profilePictureUrl = profilePictureUrl;
  }

  return profile;
}

function extractProfileId(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function canonicalizeProfileUrl(url: string, profileId: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/in/${profileId}/`;
  } catch {
    return `https://www.linkedin.com/in/${profileId}/`;
  }
}

function findTopCard(doc: Document): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>('.pv-top-card, .profile-topcard-person-entity') ??
    doc.querySelector<HTMLElement>('main section')
  );
}

function extractExperience(doc: Document): Profile['experience'] {
  return extractSectionItems(doc, 'experience')
    .map((item) => {
      const lines = textLines(item);
      if (lines.length === 0) {
        return null;
      }

      const title = lines[0] ?? '';
      const companyLine = lines[1] ?? '';
      const dates = lines.find((line, index) => index > 0 && looksLikeDateRange(line)) ?? '';

      return {
        company: splitBulletLine(companyLine)[0] ?? companyLine,
        title,
        dates,
      };
    })
    .filter((entry): entry is Profile['experience'][number] => Boolean(entry?.company && entry.title));
}

function extractEducation(doc: Document): Profile['education'] {
  return extractSectionItems(doc, 'education')
    .map<Profile['education'][number] | null>((item) => {
      const lines = textLines(item);
      if (lines.length === 0) {
        return null;
      }

      const school = lines[0] ?? '';
      const degreeLine = lines[1] ?? '';
      const dates = lines.find((line, index) => index > 0 && looksLikeDateRange(line));
      const [degree, major] = splitDegreeAndMajor(splitBulletLine(degreeLine)[0] ?? degreeLine);

      const entry: Profile['education'][number] = { school };

      if (degree) {
        entry.degree = degree;
      }

      if (major) {
        entry.major = major;
      }

      if (dates) {
        entry.dates = dates;
      }

      return entry;
    })
    .filter((entry): entry is Profile['education'][number] => Boolean(entry && entry.school));
}

function extractSectionItems(doc: Document, heading: 'experience' | 'education'): HTMLElement[] {
  const target = normalize(heading);
  const sections = Array.from(doc.querySelectorAll<HTMLElement>('main section'));
  const section = sections.find((candidate) => {
    const headingText = firstText(candidate, ['h1', 'h2', 'h3', 'header span', 'span[aria-hidden="true"]']);
    return normalize(headingText ?? '').includes(target);
  });

  if (!section) {
    return [];
  }

  const listItems = Array.from(section.querySelectorAll<HTMLElement>('li'))
    .filter((item) => textLines(item).length >= 2)
    .filter((item) => !item.querySelector('li'));

  return dedupeElements(listItems);
}

function dedupeElements(elements: HTMLElement[]): HTMLElement[] {
  const seen = new Set<string>();

  return elements.filter((element) => {
    const signature = textLines(element).slice(0, 3).join('|');
    if (!signature || seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}

function firstText(root: ParentNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = root.querySelector<HTMLElement>(selector)?.textContent?.trim();
    if (value) {
      return collapseWhitespace(value);
    }
  }

  return null;
}

function firstImage(root: ParentNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = root.querySelector<HTMLImageElement>(selector)?.src?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function textLines(element: HTMLElement): string[] {
  const raw = element.innerText || element.textContent || '';
  const lines = raw
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);

  return lines.filter((line, index) => line !== lines[index - 1]);
}

function splitBulletLine(value: string): string[] {
  return value
    .split(/[·•]/g)
    .map((part) => collapseWhitespace(part))
    .filter(Boolean);
}

function splitDegreeAndMajor(value: string): [string, string] {
  const [degree, ...rest] = value.split(',');
  return [collapseWhitespace(degree ?? ''), collapseWhitespace(rest.join(', '))];
}

function looksLikeDateRange(value: string): boolean {
  return /(present|current|\b\d{4}\b|yr|mo|month)/i.test(value);
}

function detectConnectionDegree(lines: string[]): Profile['connectionDegree'] {
  const joined = lines.join(' ');
  if (/\b1st\b/i.test(joined)) return 1;
  if (/\b2nd\b/i.test(joined)) return 2;
  if (/\b3rd\b/i.test(joined)) return 3;
  return null;
}

function detectMutualConnections(lines: string[]): number {
  for (const line of lines) {
    const match = line.match(/(\d+)\+?\s+mutual connection/i);
    if (match) {
      return Number.parseInt(match[1] ?? '0', 10) || 0;
    }
  }

  return 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
