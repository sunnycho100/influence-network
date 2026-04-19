import type { Profile } from '@alumni-graph/shared';

/* ---------------------------------------------------------------------------
 * Scrape LinkedIn school alumni page (/school/<slug>/people/)
 *
 * The alumni page renders profile cards in a grid. Each card contains:
 * - Name (link to /in/<id>/)
 * - Headline / current role
 * - Shared education info
 * - Profile picture
 * -------------------------------------------------------------------------*/

export function scrapeAlumniPage(doc: Document = document): Profile[] {
  const profiles: Profile[] = [];

  // Alumni page result cards
  const cards = doc.querySelectorAll<HTMLElement>(
    [
      'li.org-people-profile-card__profile-card-spacing',
      '.org-people-profiles-module__profile-list li',
      'div[data-view-name="org-people-profile-card"]',
    ].join(', ')
  );

  for (const card of cards) {
    const profile = extractAlumniProfile(card);
    if (profile) profiles.push(profile);
  }

  return profiles;
}

function extractAlumniProfile(card: HTMLElement): Profile | null {
  const link = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]');
  if (!link) return null;

  const profileId = extractProfileId(link.href);
  if (!profileId) return null;

  // Name
  const nameEl =
    card.querySelector<HTMLElement>('.org-people-profile-card__profile-title') ??
    card.querySelector<HTMLElement>('.artdeco-entity-lockup__title');
  const name = nameEl?.textContent?.trim();
  if (!name || name === 'LinkedIn Member') return null;

  // Subtitle / headline
  const subtitleEl =
    card.querySelector<HTMLElement>('.artdeco-entity-lockup__subtitle') ??
    card.querySelector<HTMLElement>('.org-people-profile-card__profile-info');
  const headline = subtitleEl?.textContent?.trim() ?? '';

  // Profile picture
  const imgEl = card.querySelector<HTMLImageElement>('img');
  const profilePictureUrl =
    imgEl?.src?.startsWith('https://') && !imgEl.src.includes('ghost-person')
      ? imgEl.src
      : undefined;

  // School name from breadcrumbs or page heading
  const schoolName = extractSchoolName();

  const profile: Profile = {
    id: profileId,
    name,
    headline,
    education: schoolName ? [{ school: schoolName, degree: '', major: '' }] : [],
    experience: [],
    mutualConnections: 0,
    connectionDegree: null,
    linkedinUrl: `https://www.linkedin.com/in/${profileId}/`,
    lastScraped: Date.now(),
    scrapedFrom: 'alumni',
  };

  if (profilePictureUrl) profile.profilePictureUrl = profilePictureUrl;

  // Try to infer current company/title from headline
  const titleCompanyMatch = headline.match(/^(.+?)\s+at\s+(.+)$/i);
  if (titleCompanyMatch?.[1] && titleCompanyMatch[2]) {
    profile.currentTitle = titleCompanyMatch[1].trim();
    profile.currentCompany = titleCompanyMatch[2].trim();
  }

  return profile;
}

function extractSchoolName(): string {
  const heading =
    document.querySelector<HTMLElement>('.org-top-card-summary__title') ??
    document.querySelector<HTMLElement>('.org-top-card-layout__entity-title') ??
    document.querySelector<HTMLElement>('h1');
  return heading?.textContent?.trim() ?? '';
}

function extractProfileId(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1] ?? null;
}
