import { describe, it, expect } from 'vitest';
import { computeWarmness } from '../src/warmness';
import type { Profile, UserProfile } from '../src/models';

function makeUser(overrides: Partial<UserProfile['parsed']> = {}): UserProfile {
  return {
    id: 'me',
    name: 'Test User',
    resumeText: 'test',
    parsed: {
      education: [{ school: 'MIT', degree: 'BS', major: 'Computer Science', gradYear: 2024 }],
      experience: [{ company: 'Google', title: 'SWE Intern', dates: '2023', description: '' }],
      skills: ['Python', 'React', 'TypeScript'],
      clubs: [],
      languages: ['English'],
      ...overrides,
    },
    targetCompanies: ['Apple', 'Meta'],
    targetRoles: ['Software Engineer'],
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'test-profile',
    name: 'Jane Doe',
    headline: 'Engineer at Acme',
    education: [],
    experience: [],
    mutualConnections: 0,
    connectionDegree: 2,
    linkedinUrl: 'https://www.linkedin.com/in/janedoe/',
    lastScraped: Date.now(),
    scrapedFrom: 'profile',
    ...overrides,
  };
}

describe('computeWarmness', () => {
  it('returns 0 with no shared signals', () => {
    const result = computeWarmness(makeUser(), makeProfile());
    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('scores shared school (+30)', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({ education: [{ school: 'MIT', degree: 'MS', major: 'EE' }] }),
    );
    expect(result.score).toBe(30);
    expect(result.signals).toContain('Same school: mit');
  });

  it('scores shared major (+15)', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({
        education: [{ school: 'Stanford', degree: 'BS', major: 'Computer Science' }],
      }),
    );
    expect(result.score).toBe(15);
    expect(result.signals).toContain('Same major');
  });

  it('scores shared company (+25)', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({
        experience: [{ company: 'Google', title: 'PM', dates: '2022-2023' }],
      }),
    );
    expect(result.score).toBe(25);
    expect(result.signals).toContain('Same company: google');
  });

  it('scores target company (+20)', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({ currentCompany: 'Apple' }),
    );
    expect(result.score).toBe(20);
    expect(result.signals).toContain('Currently at Apple (target)');
  });

  it('scores shared skills (5 each, max 15)', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({ skills: ['Python', 'React', 'TypeScript', 'Go'] }),
    );
    expect(result.score).toBe(15); // 3 * 5 = 15, capped at 15
    expect(result.signals).toContain('3 shared skills');
  });

  it('scores mutual connections (2 each, max 20)', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({ mutualConnections: 15 }),
    );
    expect(result.score).toBe(20); // 15 * 2 = 30, capped at 20
    expect(result.signals).toContain('15 mutual connections');
  });

  it('caps total at 100', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({
        education: [{ school: 'MIT', degree: 'BS', major: 'Computer Science' }],
        experience: [{ company: 'Google', title: 'SWE', dates: '2023' }],
        currentCompany: 'Apple',
        skills: ['Python', 'React', 'TypeScript'],
        mutualConnections: 15,
      }),
    );
    // 30 + 15 + 25 + 20 + 15 + 20 = 125, capped at 100
    expect(result.score).toBe(100);
  });

  it('is case-insensitive for matching', () => {
    const result = computeWarmness(
      makeUser(),
      makeProfile({
        education: [{ school: 'mit', degree: 'BS' }],
        skills: ['python', 'REACT'],
      }),
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.signals.some((s) => s.includes('school'))).toBe(true);
  });

  it('handles empty user data gracefully', () => {
    const emptyUser = makeUser({
      education: [],
      experience: [],
      skills: [],
    });
    const result = computeWarmness(emptyUser, makeProfile({ mutualConnections: 5 }));
    expect(result.score).toBe(10); // 5 * 2 = 10
  });
});
