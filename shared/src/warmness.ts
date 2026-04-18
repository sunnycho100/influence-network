import type { Profile, UserProfile } from './models.js';

export interface WarmnessResult {
  score: number;
  signals: string[];
}

export function computeWarmness(user: UserProfile, target: Profile): WarmnessResult {
  let score = 0;
  const signals: string[] = [];

  const userSchools = user.parsed.education.map((entry) => normalize(entry.school));
  const targetSchools = target.education.map((entry) => normalize(entry.school));
  const sharedSchool = userSchools.find((school) => targetSchools.includes(school));
  if (sharedSchool) {
    score += 30;
    signals.push(`Same school: ${sharedSchool}`);
  }

  const userMajors = user.parsed.education.map((entry) => normalize(entry.major));
  const targetMajors = target.education.map((entry) => normalize(entry.major ?? ''));
  if (userMajors.some((major) => major && targetMajors.includes(major))) {
    score += 15;
    signals.push('Same major');
  }

  const userCompanies = user.parsed.experience.map((entry) => normalize(entry.company));
  const targetCompanies = target.experience.map((entry) => normalize(entry.company));
  const sharedCompany = userCompanies.find((company) => targetCompanies.includes(company));
  if (sharedCompany) {
    score += 25;
    signals.push(`Same company: ${sharedCompany}`);
  }

  if (
    target.currentCompany &&
    user.targetCompanies.map(normalize).includes(normalize(target.currentCompany))
  ) {
    score += 20;
    signals.push(`Currently at ${target.currentCompany} (target)`);
  }

  const userSkills = new Set(user.parsed.skills.map(normalize));
  const targetSkills = (target.skills ?? []).map(normalize);
  const sharedSkills = targetSkills.filter((skill) => userSkills.has(skill));
  if (sharedSkills.length > 0) {
    score += Math.min(sharedSkills.length * 5, 15);
    signals.push(`${sharedSkills.length} shared skills`);
  }

  if (target.mutualConnections > 0) {
    score += Math.min(target.mutualConnections * 2, 20);
    signals.push(`${target.mutualConnections} mutual connections`);
  }

  return { score: Math.min(score, 100), signals };
}

function normalize(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}
