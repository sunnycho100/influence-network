import type { Profile, UserProfile } from '@alumni-graph/shared';

export function buildColdOutreachPrompt(user: UserProfile, target: Profile): string {
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
