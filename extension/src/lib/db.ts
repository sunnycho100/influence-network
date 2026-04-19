import Dexie, { type EntityTable } from 'dexie';

import {
  canonicalSchool,
  computeWarmness,
  type GeneratedMessage,
  type GraphSnapshot,
  type Profile,
  type UserProfile,
} from '@alumni-graph/shared';

export interface ScrapeSession {
  id: string;
  route: 'profile' | 'search' | 'alumni' | 'manual' | 'unknown';
  status: 'success' | 'error' | 'skipped';
  url: string;
  profileId?: string;
  startedAt: number;
  completedAt: number;
  error?: string;
}

export interface ExtensionStats {
  profileCount: number;
  lastScrapedAt: number | null;
  lastProfile: Pick<Profile, 'id' | 'name' | 'headline' | 'linkedinUrl' | 'lastScraped'> | null;
}

interface RecordProfileScrapeInput {
  profile: Profile;
  url: string;
  startedAt: number;
  completedAt?: number;
}

interface RecordScrapeErrorInput {
  route: ScrapeSession['route'];
  url: string;
  error: string;
  startedAt: number;
  completedAt?: number;
  profileId?: string;
}

class InfluenceNetworkDatabase extends Dexie {
  profiles!: EntityTable<Profile, 'id'>;
  userProfile!: EntityTable<UserProfile, 'id'>;
  messages!: EntityTable<GeneratedMessage, 'id'>;
  sessions!: EntityTable<ScrapeSession, 'id'>;

  constructor() {
    super('alumniGraph');

    this.version(1).stores({
      profiles: 'id, currentCompany, lastScraped, scrapedFrom',
      userProfile: 'id',
      messages: 'id, profileId, createdAt, sent',
      sessions: 'id, route, status, startedAt, completedAt, profileId',
    });
  }
}

export const db = new InfluenceNetworkDatabase();

export function applyWarmness(profile: Profile, user: UserProfile | null): Profile {
  if (!user) {
    const nextProfile: Profile = { ...profile };
    delete nextProfile.warmnessScore;
    delete nextProfile.sharedSignals;
    return nextProfile;
  }

  const { score, signals } = computeWarmness(user, profile);
  return {
    ...profile,
    warmnessScore: score,
    sharedSignals: signals,
  };
}

export async function getGraphSnapshot(): Promise<GraphSnapshot> {
  const [profiles, user, messages] = await Promise.all([
    db.profiles.toArray(),
    db.userProfile.get('me'),
    db.messages.toArray(),
  ]);

  const scoredProfiles = profiles
    .map((profile) => applyWarmness(profile, user ?? null))
    .sort((left, right) => right.lastScraped - left.lastScraped);

  return {
    profiles: scoredProfiles,
    user: user ?? null,
    messages,
  };
}

export function getProfileById(profileId: string): Promise<Profile | undefined> {
  return db.profiles.get(profileId);
}

export async function getExtensionStats(): Promise<ExtensionStats> {
  const [profileCount, lastProfile] = await Promise.all([
    db.profiles.count(),
    db.profiles.orderBy('lastScraped').last(),
  ]);

  return {
    profileCount,
    lastScrapedAt: lastProfile?.lastScraped ?? null,
    lastProfile: lastProfile
      ? {
          id: lastProfile.id,
          name: lastProfile.name,
          headline: lastProfile.headline,
          linkedinUrl: lastProfile.linkedinUrl,
          lastScraped: lastProfile.lastScraped,
        }
      : null,
  };
}

export async function recordProfileScrape({
  profile,
  url,
  startedAt,
  completedAt = Date.now(),
}: RecordProfileScrapeInput): Promise<void> {
  await db.transaction('rw', db.profiles, db.sessions, db.userProfile, async () => {
    const user = (await db.userProfile.get('me')) ?? null;
    const existing = await db.profiles.get(profile.id);
    const merged = mergeProfile(existing, profile);
    const scoredProfile = applyWarmness(merged, user);

    await db.profiles.put(scoredProfile);
    await db.sessions.put({
      id: crypto.randomUUID(),
      route: scoredProfile.scrapedFrom,
      status: 'success',
      url,
      profileId: scoredProfile.id,
      startedAt,
      completedAt,
    });
  });
}

/**
 * Merge a freshly scraped profile with what's already stored. The incoming
 * scrape is authoritative for top-level fields (name, headline, current
 * role, etc.), but we union education and experience by canonical key so we
 * don't lose data captured by an earlier source — for example, the school
 * name from an alumni-page scrape when the profile-page scrape rendered
 * with a collapsed education section.
 */
function mergeProfile(existing: Profile | undefined, incoming: Profile): Profile {
  if (!existing) return incoming;

  const merged: Profile = { ...existing, ...incoming };

  // Union education entries by canonical school key. Incoming entries win
  // when keys collide (they tend to have richer degree/major/dates info).
  const eduByKey = new Map<string, Profile['education'][number]>();
  const eduExtras: Profile['education'] = [];
  const seenKeys = new Set<string>();
  for (const edu of incoming.education) {
    const key = canonicalSchool(edu.school);
    if (key) {
      eduByKey.set(key, edu);
      seenKeys.add(key);
    } else {
      eduExtras.push(edu);
    }
  }
  for (const edu of existing.education) {
    const key = canonicalSchool(edu.school);
    if (!key || seenKeys.has(key)) continue;
    eduByKey.set(key, edu);
    seenKeys.add(key);
  }
  merged.education = [...eduByKey.values(), ...eduExtras];

  // Preserve experience entries from earlier scrapes that the new scrape
  // didn't include (e.g. search-results scrapes have no experience).
  if (incoming.experience.length === 0 && existing.experience.length > 0) {
    merged.experience = existing.experience;
  }

  // Don't let an empty/missing field on the new scrape erase data we already
  // had from a richer source.
  if (!incoming.location && existing.location) merged.location = existing.location;
  if (!incoming.currentCompany && existing.currentCompany) {
    merged.currentCompany = existing.currentCompany;
  }
  if (!incoming.currentTitle && existing.currentTitle) {
    merged.currentTitle = existing.currentTitle;
  }
  if (!incoming.profilePictureUrl && existing.profilePictureUrl) {
    merged.profilePictureUrl = existing.profilePictureUrl;
  }
  if ((!incoming.skills || incoming.skills.length === 0) && existing.skills?.length) {
    merged.skills = existing.skills;
  }
  if (incoming.mutualConnections === 0 && existing.mutualConnections > 0) {
    merged.mutualConnections = existing.mutualConnections;
  }
  if (incoming.connectionDegree == null && existing.connectionDegree != null) {
    merged.connectionDegree = existing.connectionDegree;
  }

  return merged;
}

export async function saveUserProfile(profile: UserProfile): Promise<UserProfile> {
  await db.transaction('rw', db.userProfile, db.profiles, async () => {
    await db.userProfile.put(profile);

    const profiles = await db.profiles.toArray();
    if (profiles.length === 0) {
      return;
    }

    const rescoredProfiles = profiles.map((entry) => applyWarmness(entry, profile));
    await db.profiles.bulkPut(rescoredProfiles);
  });

  return profile;
}

export async function recordScrapeError({
  route,
  url,
  error,
  startedAt,
  completedAt = Date.now(),
  profileId,
}: RecordScrapeErrorInput): Promise<void> {
  await db.sessions.put({
    id: crypto.randomUUID(),
    route,
    status: 'error',
    url,
    startedAt,
    completedAt,
    error,
    ...(profileId ? { profileId } : {}),
  });
}
