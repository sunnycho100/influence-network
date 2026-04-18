import Dexie, { type EntityTable } from 'dexie';

import {
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

class AlumniGraphDatabase extends Dexie {
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

export const db = new AlumniGraphDatabase();

function applyWarmness(profile: Profile, user: UserProfile | null): Profile {
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

  return {
    profiles: profiles.sort((left, right) => right.lastScraped - left.lastScraped),
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
    const scoredProfile = applyWarmness(profile, user);

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
