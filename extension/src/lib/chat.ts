import type { ChatCitation, Profile, UserProfile } from '@alumni-graph/shared';

import { getGraphSnapshot } from './db';

interface LlmConfig {
  apiKey: string;
  model: string;
}

const STOP_WORDS = new Set([
  'a','an','and','any','are','as','at','be','by','can','contact','could','do','does','for','from','get','give','go','has','have','he','her','him','his','how','i','in','is','it','its','let','list','me','my','of','on','or','people','person','please','show','should','so','some','someone','that','the','their','them','they','this','to','was','we','were','what','when','where','which','who','whom','why','will','with','would','you','your','about','help','know','tell','want','find','best','good','top','need','experience','experiences','question','questions','recommend','related','regarding','around','please','hi','hello','hey','use','used','using','work','works','worked','working',
]);

interface ScoredProfile {
  profile: Profile;
  score: number;
  matched: string[];
}

export async function chatQuery(question: string): Promise<{
  answer: string;
  citations: ChatCitation[];
  usedLlm: boolean;
}> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error('Question is empty.');
  }

  const snapshot = await getGraphSnapshot();
  if (snapshot.profiles.length === 0) {
    return {
      answer:
        'No profiles have been scraped yet. Visit a LinkedIn search or alumni page to start collecting people, then ask again.',
      citations: [],
      usedLlm: false,
    };
  }

  const tokens = tokenize(trimmed);
  const ranked = rankProfiles(snapshot.profiles, tokens, trimmed.toLowerCase());
  const topMatches = ranked.slice(0, 8);

  const config = await getStoredConfig();
  if (!config) {
    return {
      answer: buildOfflineAnswer(trimmed, topMatches),
      citations: matchesToCitations(topMatches),
      usedLlm: false,
    };
  }

  try {
    const result = await callGeminiChat(config, trimmed, snapshot.user, topMatches);
    return {
      answer: result.answer,
      citations: matchesToCitations(topMatches.slice(0, 5), result.citedNames),
      usedLlm: true,
    };
  } catch (error) {
    return {
      answer:
        buildOfflineAnswer(trimmed, topMatches) +
        `\n\n(Note: Gemini call failed — ${error instanceof Error ? error.message : 'unknown error'}.)`,
      citations: matchesToCitations(topMatches),
      usedLlm: false,
    };
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s+/.-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function rankProfiles(
  profiles: Profile[],
  tokens: string[],
  rawLower: string,
): ScoredProfile[] {
  if (tokens.length === 0) {
    // No keywords — fall back to warmness-ranked listing.
    return profiles
      .slice()
      .sort((a, b) => (b.warmnessScore ?? 0) - (a.warmnessScore ?? 0))
      .slice(0, 12)
      .map((profile) => ({ profile, score: 0, matched: [] }));
  }

  const scored: ScoredProfile[] = [];

  for (const profile of profiles) {
    const haystack = profileHaystack(profile);
    const haystackLower = haystack.toLowerCase();
    let score = 0;
    const matched = new Set<string>();

    for (const token of tokens) {
      if (!token) continue;
      // Word-boundary match scores higher than substring match.
      const wordRegex = new RegExp(`\\b${escapeRegex(token)}\\b`, 'i');
      if (wordRegex.test(haystack)) {
        score += 4;
        matched.add(token);
      } else if (haystackLower.includes(token)) {
        score += 1.5;
        matched.add(token);
      }
    }

    // Bonus for matching the full phrase.
    if (rawLower.length > 4 && haystackLower.includes(rawLower)) {
      score += 3;
    }

    // Tiny bias toward warmer / closer-degree people on ties.
    score += (profile.warmnessScore ?? 0) / 200;
    if (profile.connectionDegree === 1) score += 0.4;
    else if (profile.connectionDegree === 2) score += 0.2;

    if (score > 0) {
      scored.push({ profile, score, matched: [...matched] });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function profileHaystack(profile: Profile): string {
  const parts: string[] = [
    profile.name,
    profile.headline,
    profile.currentTitle ?? '',
    profile.currentCompany ?? '',
    profile.location ?? '',
    ...(profile.skills ?? []),
    ...(profile.sharedSignals ?? []),
  ];

  for (const exp of profile.experience) {
    parts.push(exp.company, exp.title, exp.dates);
  }
  for (const ed of profile.education) {
    parts.push(ed.school, ed.degree ?? '', ed.major ?? '', ed.dates ?? '');
  }

  return parts.filter(Boolean).join(' • ');
}

function matchesToCitations(
  matches: ScoredProfile[],
  citedNames?: string[],
): ChatCitation[] {
  const ordered = citedNames && citedNames.length > 0
    ? sortMatchesByCitedNames(matches, citedNames)
    : matches;

  return ordered.slice(0, 5).map(({ profile, matched }) => ({
    profileId: profile.id,
    name: profile.name,
    reason: matched.length > 0
      ? `matched: ${matched.slice(0, 4).join(', ')}`
      : profile.currentTitle && profile.currentCompany
        ? `${profile.currentTitle} at ${profile.currentCompany}`
        : profile.headline,
  }));
}

function sortMatchesByCitedNames(
  matches: ScoredProfile[],
  citedNames: string[],
): ScoredProfile[] {
  const lowerCited = citedNames.map((n) => n.toLowerCase());
  const cited: ScoredProfile[] = [];
  const rest: ScoredProfile[] = [];

  for (const match of matches) {
    const name = match.profile.name.toLowerCase();
    if (lowerCited.some((c) => name.includes(c) || c.includes(name))) {
      cited.push(match);
    } else {
      rest.push(match);
    }
  }

  return [...cited, ...rest];
}

function buildOfflineAnswer(question: string, matches: ScoredProfile[]): string {
  if (matches.length === 0) {
    return `No profiles in the local database match "${question}". Try a broader keyword (a company, school, or skill).`;
  }

  const lines = matches.slice(0, 5).map(({ profile, matched }) => {
    const role = profile.currentTitle && profile.currentCompany
      ? `${profile.currentTitle} at ${profile.currentCompany}`
      : profile.headline;
    const reason = matched.length > 0 ? ` (matched: ${matched.slice(0, 4).join(', ')})` : '';
    return `• ${profile.name} — ${role}${reason}`;
  });

  return `Top matches for "${question}":\n${lines.join('\n')}`;
}

async function getStoredConfig(): Promise<LlmConfig | null> {
  const result = await chrome.storage.local.get(['geminiApiKey', 'llmModel']);
  const apiKey = result.geminiApiKey as string | undefined;
  if (!apiKey) return null;
  return {
    apiKey,
    model: (result.llmModel as string | undefined) ?? 'gemini-2.5-flash',
  };
}

async function callGeminiChat(
  config: LlmConfig,
  question: string,
  user: UserProfile | null,
  matches: ScoredProfile[],
): Promise<{ answer: string; citedNames: string[] }> {
  const prompt = buildChatPrompt(question, user, matches);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 600,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 160)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  const citedNames = matches
    .map((m) => m.profile.name)
    .filter((name) => text.toLowerCase().includes(name.toLowerCase()));

  return { answer: text, citedNames };
}

function buildChatPrompt(
  question: string,
  user: UserProfile | null,
  matches: ScoredProfile[],
): string {
  const profileBlock = matches
    .map((match, index) => formatProfileForPrompt(match.profile, index + 1, match.matched))
    .join('\n\n');

  const userBlock = user
    ? `USER (the person asking):\nName: ${user.name}\nTarget roles: ${user.targetRoles.join(', ') || 'n/a'}\nTarget companies: ${user.targetCompanies.join(', ') || 'n/a'}`
    : 'USER: unknown';

  return `You are an assistant helping the user query their personal LinkedIn alumni network. Answer the user's question using ONLY the candidate profiles below. Recommend specific people by full name when relevant.

${userBlock}

CANDIDATE PROFILES (already keyword-matched, ranked by relevance):
${profileBlock || '(no candidates returned)'}

USER QUESTION:
"${question}"

RULES:
- Recommend at most 5 people, ordered by relevance.
- For each recommendation, give one short sentence explaining why (cite the matching company, school, skill, or role).
- If no candidate is a good fit, say so honestly. Do not invent profiles or attributes that are not listed above.
- Keep the total response under 140 words. Use plain text, no markdown headings.
- Refer to people by full name on first mention.

ANSWER:`;
}

function formatProfileForPrompt(
  profile: Profile,
  index: number,
  matched: string[],
): string {
  const role = [profile.currentTitle, profile.currentCompany].filter(Boolean).join(' at ');
  const experience = profile.experience
    .slice(0, 3)
    .map((e) => `${e.title} @ ${e.company} (${e.dates})`)
    .join('; ');
  const education = profile.education
    .slice(0, 2)
    .map((e) => [e.school, e.degree, e.major].filter(Boolean).join(' '))
    .join('; ');
  const skills = (profile.skills ?? []).slice(0, 8).join(', ');

  return [
    `#${index} ${profile.name}`,
    role ? `  Current: ${role}` : '',
    profile.headline ? `  Headline: ${profile.headline}` : '',
    profile.location ? `  Location: ${profile.location}` : '',
    experience ? `  Experience: ${experience}` : '',
    education ? `  Education: ${education}` : '',
    skills ? `  Skills: ${skills}` : '',
    matched.length > 0 ? `  Matched keywords: ${matched.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
