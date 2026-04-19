import type { Profile, UserProfile } from '@alumni-graph/shared';

export function buildResumeParsePrompt(resumeText: string): string {
  return `You are a resume parser. Convert the resume below into a single JSON object that matches this exact TypeScript shape:

{
  "name": string,                       // full name of the resume owner
  "email": string | null,               // primary email or null
  "hometown": string | null,            // hometown / current location or null
  "education": Array<{
    "school": string,
    "degree": string,                   // e.g. "BS", "MS", "PhD". Use "Unknown" if missing.
    "major": string,                    // e.g. "Computer Science". Use "Unknown" if missing.
    "gradYear": number                  // 4-digit graduation year. Use the expected year if "Present".
  }>,
  "experience": Array<{
    "company": string,                  // organization, lab, or employer name
    "title": string,                    // role / position
    "dates": string,                    // human readable date range, e.g. "Sept 2025 – Present"
    "description": string               // 1-3 sentences summarizing what they did, joined into one string
  }>,
  "skills": string[],                   // technical or professional skills
  "clubs": string[],                    // clubs, organizations, leadership
  "languages": string[],                // spoken / written languages
  "targetCompanies": string[],          // companies they are targeting (if listed)
  "targetRoles": string[]               // roles they are targeting (if listed)
}

CRITICAL RULES:
- Output ONLY the JSON object. No markdown fences, no commentary.
- MERGE fragmented entries that describe the same role. Resumes often split one experience across several lines (title line, lab/company line, then bullet points). Combine them into ONE experience entry whose company is the employing organization (lab, university, or company), title is the role, dates is the date range from the title line, and description joins the bullet points.
- If a line looks like a continuation of the previous experience (no new title, no new dates, often a lab name, project list, or bullet text), DO NOT create a new experience entry; fold it into the previous one.
- If a date range is missing, use "Unknown" for dates. Do not invent dates.
- Do not duplicate entries.
- For education, prefer the most specific degree/major you can infer. Use the expected graduation year for "Present" or "Expected".
- Keep arrays empty ([]) rather than null when nothing is found.
- Use null (not empty string) for missing email or hometown.

RESUME TEXT:
"""
${resumeText}
"""`;
}

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

  const signals =
    target.sharedSignals
      ?.filter((s) => !/mutual\s+connection/i.test(s))
      .join('\n') || 'No shared signals detected yet';

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

Write a 3-4 sentence message that follows this structure:
1. Introduce yourself: "My name is ${user.name}, a ${user.targetRoles[0] || 'professional'} focused in [relevant area from user's background]."
2. Compliment their work: mention something specific and impressive about their experience or role.
3. Tie in a shared signal (same school, company, skills, etc.) if one exists.
4. End with a low-friction ask for a 15-minute coffee chat.

HARD RULES:
- No em dashes
- Never mention any specific number of mutual connections, shared connections, followers, or any numeric count of people. Do NOT invent or estimate such numbers.
- Do NOT use the @ symbol anywhere (no "@UW-Madison", no handles, no email-style mentions)
- No "I hope this finds you well," no "I came across your profile"
- Keep it professional but genuine, like a motivated student or early-career professional
- Use their first name only
- Never mention that you are an AI

Output ONLY the message. No preamble.`;
}
