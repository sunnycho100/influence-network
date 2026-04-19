import { describe, it, expect } from 'vitest';
import { buildMindMapData } from '../src/graph';
import type { GraphSnapshot, Profile } from '../src/models';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'test-1',
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

describe('buildMindMapData', () => {
  it('returns empty graph for empty snapshot', () => {
    const data = buildMindMapData({ profiles: [], user: null });
    expect(data.profileCount).toBe(0);
    expect(data.companyCount).toBe(0);
    // Should still have a root node
    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]!.kind).toBe('root');
    expect(data.edges).toHaveLength(0);
  });

  it('clusters profiles by company', () => {
    const data = buildMindMapData({
      profiles: [
        makeProfile({ id: 'a', currentCompany: 'Google' }),
        makeProfile({ id: 'b', currentCompany: 'Google' }),
        makeProfile({ id: 'c', currentCompany: 'Meta' }),
      ],
      user: null,
    });
    expect(data.companyCount).toBe(2);
    expect(data.profileCount).toBe(3);
    // root + 2 company nodes + 3 profile nodes = 6
    expect(data.nodes).toHaveLength(6);
  });

  it('uses user root node when user profile exists', () => {
    const data = buildMindMapData({
      profiles: [],
      user: {
        id: 'me',
        name: 'Alice',
        resumeText: 'test',
        parsed: { education: [], experience: [], skills: [], clubs: [], languages: [] },
        targetCompanies: [],
        targetRoles: [],
      },
    });
    expect(data.nodes[0]!.kind).toBe('user');
    expect(data.nodes[0]!.label).toBe('Alice');
  });

  it('groups profiles with no company under "Independent"', () => {
    const data = buildMindMapData({
      profiles: [makeProfile({ id: 'solo', currentCompany: undefined })],
      user: null,
    });
    const companyNodes = data.nodes.filter((n) => n.kind === 'company');
    expect(companyNodes).toHaveLength(1);
    expect(companyNodes[0]!.label).toBe('Independent');
  });

  it('limits to 10 companies', () => {
    const profiles: Profile[] = [];
    for (let i = 0; i < 15; i++) {
      profiles.push(makeProfile({ id: `p${i}`, currentCompany: `Company ${i}` }));
    }
    const data = buildMindMapData({ profiles, user: null });
    expect(data.companyCount).toBeLessThanOrEqual(10);
  });

  it('limits to 14 profiles per company', () => {
    const profiles: Profile[] = [];
    for (let i = 0; i < 20; i++) {
      profiles.push(makeProfile({ id: `p${i}`, currentCompany: 'BigCo' }));
    }
    const data = buildMindMapData({ profiles, user: null });
    const profileNodes = data.nodes.filter((n) => n.kind === 'profile');
    expect(profileNodes).toHaveLength(14);
  });

  it('sorts profiles by warmness score then mutual connections', () => {
    const data = buildMindMapData({
      profiles: [
        makeProfile({ id: 'low', warmnessScore: 10, mutualConnections: 0, currentCompany: 'X' }),
        makeProfile({ id: 'high', warmnessScore: 80, mutualConnections: 0, currentCompany: 'X' }),
        makeProfile({ id: 'mid', warmnessScore: 50, mutualConnections: 5, currentCompany: 'X' }),
      ],
      user: null,
    });
    const profileNodes = data.nodes.filter((n) => n.kind === 'profile');
    expect(profileNodes[0]!.profileId).toBe('high');
    expect(profileNodes[1]!.profileId).toBe('mid');
    expect(profileNodes[2]!.profileId).toBe('low');
  });

  it('creates correct edges between root, company, and profiles', () => {
    const data = buildMindMapData({
      profiles: [makeProfile({ id: 'a', currentCompany: 'Google' })],
      user: null,
    });
    expect(data.edges).toHaveLength(2); // root->company, company->profile
    expect(data.edges[0]!.kind).toBe('root-company');
    expect(data.edges[1]!.kind).toBe('company-profile');
  });
});
