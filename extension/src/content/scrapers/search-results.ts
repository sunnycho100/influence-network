import type { Profile } from '@alumni-graph/shared';

/* ---------------------------------------------------------------------------
 * Scrape LinkedIn search results page (People tab)
 *
 * LinkedIn renders search results as a list of <li> items inside
 * `.reusable-search__result-container` or `.search-results-container`.
 * Each item has a person card with name, headline, location, and a link
 * to their profile.
 * -------------------------------------------------------------------------*/

export function scrapeSearchResults(doc: Document = document): Profile[] {
  const profiles: Profile[] = [];

  // Search result items live inside these containers
  const resultItems = doc.querySelectorAll<HTMLElement>(
    [
      'li.reusable-search__result-container',
      'div.entity-result',
      '.search-results-container li',
    ].join(', ')
  );

  for (const item of resultItems) {
    const profile = extractProfileFromResultItem(item);
    if (profile) profiles.push(profile);
  }

  return profiles;
}

function extractProfileFromResultItem(item: HTMLElement): Profile | null {
  // Find the link to the profile
  const link = item.querySelector<HTMLAnchorElement>(
    'a[href*="/in/"], a.app-aware-link[href*="/in/"]'
  );
  if (!link) return null;

  const profileId = extractProfileId(link.href);
  if (!profileId) return null;

  // Name: usually inside a span within the link
  const nameEl =
    item.querySelector<HTMLElement>('span[dir="ltr"] > span[aria-hidden="true"]') ??
    item.querySelector<HTMLElement>('.entity-result__title-text a span');
  const name = nameEl?.textContent?.trim();
  if (!name || name === 'LinkedIn Member') return null;

  // Headline / subtitle
  const headlineEl =
    item.querySelector<HTMLElement>('.entity-result__primary-subtitle') ??
    item.querySelector<HTMLElement>('.entity-result__summary');
  const headline = headlineEl?.textContent?.trim() ?? '';

  // Location
  const locationEl = item.querySelector<HTMLElement>('.entity-result__secondary-subtitle');
  const location = locationEl?.textContent?.trim();

  // Connection degree
  const degreeMatch = item.textContent?.match(/(\d)(?:st|nd|rd)/);
  const connectionDegree = degreeMatch ? Number(degreeMatch[1]) : undefined;

  // Profile picture URL
  const imgEl = item.querySelector<HTMLImageElement>(
    'img.presence-entity__image, img.EntityPhoto-circle-5'
  );
  const profilePictureUrl = imgEl?.src?.startsWith('https://') ? imgEl.src : undefined;

  const validDegree = connectionDegree === 1 || connectionDegree === 2 || connectionDegree === 3
    ? connectionDegree
    : null;

  const profile: Profile = {
    id: profileId,
    name,
    headline,
    education: [],
    experience: [],
    mutualConnections: 0,
    connectionDegree: validDegree,
    linkedinUrl: `https://www.linkedin.com/in/${profileId}/`,
    lastScraped: Date.now(),
    scrapedFrom: 'search',
  };

  if (location) profile.location = location;
  if (profilePictureUrl) profile.profilePictureUrl = profilePictureUrl;

  // Try to infer current company/title from headline
  const titleCompanyMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (titleCompanyMatch?.[1] && titleCompanyMatch[2]) {
    profile.currentTitle = titleCompanyMatch[1].trim();
    profile.currentCompany = titleCompanyMatch[2].trim();
  }

  return profile;
}

function extractProfileId(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1] ?? null;
}
