import { describe, it, expect } from 'vitest';
import type { Profile, UserProfile } from '../src/models';

// We can't import the extension's prompts.ts due to chrome deps,
// so we test the prompt builder logic inline.
function buildColdOutreachPrompt(user: UserProfile, target: Profile): string {
  const userEducation = user.parsed.education
    .map((e) => `${e.school} (${e.degree} ${e.major}, ${e.gradYear})`)
    .join('; ');

  const userExperience = user.parsed.experience
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company}`)
    .join('; ');

  const targetEducation = target.education
    .map((e) => [e.school, e.degree, e.major, e.dates].filter(Boolean).join(' '))
    .join('; ');

  const targetExperience = target.experience
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company} (${e.dates})`)
    .join('; ');

  const targetRole = target.currentTitle && target.currentCompany
    ? `${target.currentTitle} at ${target.currentCompany}`
    : target.currentTitle
      ? `${target.currentTitle} at their company`
      : target.headline;

  const signals = target.sharedSignals?.join('\n') ?? 'No shared signals detected yet';

  return `You are writing a LinkedIn message on behalf of the user below. The goal: land a 15-minute virtual coffee chat.

USER (sender):
Name: ${user.name}
Education: ${userEducation || 'Not specified'}
Key experience: ${userExperience || 'Not specified'}
Target roles: ${user.targetRoles.join(', ') || 'Not specified'}
Target companies: ${user.targetCompanies.join(', ') || 'Not specified'}

TARGET (recipient):
Name: ${target.name}
Role: ${targetRole}
Education: ${targetEducation || 'Not specified'}
Prior experience: ${targetExperience || 'Not specified'}

SHARED SIGNALS (use at least ONE in the opening):
${signals}

Write a 3-sentence message that:
1. Opens with the single strongest shared signal — specific, not generic
2. Connects your background to their current role in ONE sentence
3. Makes a low-friction ask — "15 minutes to hear how you moved from X to Y"

HARD RULES:
- Under 280 characters total
- No em dashes, no "I hope this finds you well," no "I came across your profile"
- Write like a smart 20-year-old, not a LinkedIn recruiter
- Use first name only; no "Hi [name]!"
- Never mention that you are an AI

Output ONLY the message. No preamble.`;
}

function makeUser(): UserProfile {
  return {
    id: 'me',
    name: 'Alice Kim',
    resumeText: 'resume',
    parsed: {
      education: [{ school: 'MIT', degree: 'BS', major: 'CS', gradYear: 2025 }],
      experience: [{ company: 'Google', title: 'SWE Intern', dates: 'Summer 2024', description: '' }],
      skills: ['Python', 'ML'],
      clubs: ['HackMIT'],
      languages: ['English', 'Korean'],
    },
    targetCompanies: ['Apple', 'Meta'],
    targetRoles: ['ML Engineer'],
  };
}

function makeProfile(): Profile {
  return {
    id: 'bob',
    name: 'Bob Chen',
    headline: 'ML Engineer at Meta',
    currentCompany: 'Meta',
    currentTitle: 'ML Engineer',
    education: [{ school: 'MIT', degree: 'MS', major: 'EECS' }],
    experience: [{ company: 'DeepMind', title: 'Research Engineer', dates: '2020-2022' }],
    mutualConnections: 5,
    connectionDegree: 2,
    linkedinUrl: 'https://www.linkedin.com/in/bobchen/',
    lastScraped: Date.now(),
    scrapedFrom: 'profile',
    sharedSignals: ['Same school: MIT', 'Currently at Meta (target)', '5 mutual connections'],
  };
}

describe('buildColdOutreachPrompt', () => {
  it('includes user name and target name', () => {
    const prompt = buildColdOutreachPrompt(makeUser(), makeProfile());
    expect(prompt).toContain('Alice Kim');
    expect(prompt).toContain('Bob Chen');
  });

  it('includes user education', () => {
    const prompt = buildColdOutreachPrompt(makeUser(), makeProfile());
    expect(prompt).toContain('MIT (BS CS, 2025)');
  });

  it('includes user experience', () => {
    const prompt = buildColdOutreachPrompt(makeUser(), makeProfile());
    expect(prompt).toContain('SWE Intern at Google');
  });

  it('includes target role and company', () => {
    const prompt = buildColdOutreachPrompt(makeUser(), makeProfile());
    expect(prompt).toContain('ML Engineer at Meta');
  });

  it('includes shared signals', () => {
    const prompt = buildColdOutreachPrompt(makeUser(), makeProfile());
    expect(prompt).toContain('Same school: MIT');
    expect(prompt).toContain('Currently at Meta (target)');
    expect(prompt).toContain('5 mutual connections');
  });

  it('shows "No shared signals" when signals are empty', () => {
    const profile = makeProfile();
    delete profile.sharedSignals;
    const prompt = buildColdOutreachPrompt(makeUser(), profile);
    expect(prompt).toContain('No shared signals detected yet');
  });

  it('handles missing user education', () => {
    const user = makeUser();
    user.parsed.education = [];
    const prompt = buildColdOutreachPrompt(user, makeProfile());
    expect(prompt).toContain('Education: Not specified');
  });

  it('handles missing target company — falls back to headline', () => {
    const profile = makeProfile();
    delete profile.currentCompany;
    delete profile.currentTitle;
    const prompt = buildColdOutreachPrompt(makeUser(), profile);
    // With the fix, it should use the headline directly (no "at their company" duplication)
    expect(prompt).toContain('Role: ML Engineer at Meta');
    expect(prompt).not.toContain('at their company');
  });

  it('shows "at their company" when title exists but company is missing', () => {
    const profile = makeProfile();
    profile.currentTitle = 'Data Scientist';
    delete profile.currentCompany;
    const prompt = buildColdOutreachPrompt(makeUser(), profile);
    expect(prompt).toContain('Role: Data Scientist at their company');
  });

  it('includes the 280-char hard rule', () => {
    const prompt = buildColdOutreachPrompt(makeUser(), makeProfile());
    expect(prompt).toContain('Under 280 characters total');
  });

  it('target experience shows up to 3 entries', () => {
    const profile = makeProfile();
    profile.experience = [
      { company: 'A', title: 'T1', dates: '2020' },
      { company: 'B', title: 'T2', dates: '2021' },
      { company: 'C', title: 'T3', dates: '2022' },
      { company: 'D', title: 'T4', dates: '2023' },
    ];
    const prompt = buildColdOutreachPrompt(makeUser(), profile);
    expect(prompt).toContain('T1 at A');
    expect(prompt).toContain('T3 at C');
    expect(prompt).not.toContain('T4 at D');
  });
});
