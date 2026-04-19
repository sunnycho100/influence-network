import type { Profile, UserProfile } from '@alumni-graph/shared';
import { buildColdOutreachPrompt, buildResumeParsePrompt } from './prompts';

interface LlmConfig {
  apiKey: string;
  model?: string;
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

export async function hasLlmConfigured(): Promise<boolean> {
  return (await getStoredConfig()) !== null;
}

export async function generateMessage(
  user: UserProfile,
  target: Profile,
): Promise<string> {
  const config = await getStoredConfig();
  if (!config) {
    throw new Error('No API key configured. Open the extension settings to add your Gemini API key.');
  }

  const prompt = buildColdOutreachPrompt(user, target);
  return callGemini(config, prompt);
}

async function callGemini(config: LlmConfig, prompt: string): Promise<string> {
  const model = config.model ?? 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.85,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    const reason = candidate?.finishReason ?? 'unknown';
    throw new Error(`Gemini returned an empty response (finishReason: ${reason})`);
  }

  return text;
}

interface ParsedResumeJson {
  name?: string;
  email?: string | null;
  hometown?: string | null;
  education?: Array<{
    school?: string;
    degree?: string;
    major?: string;
    gradYear?: number | string;
  }>;
  experience?: Array<{
    company?: string;
    title?: string;
    dates?: string;
    description?: string;
  }>;
  skills?: string[];
  clubs?: string[];
  languages?: string[];
  targetCompanies?: string[];
  targetRoles?: string[];
}

interface ParseResumeOptions {
  fallbackName?: string;
}

export async function parseResumeWithLlm(
  resumeText: string,
  options: ParseResumeOptions = {},
): Promise<UserProfile> {
  const trimmed = resumeText.trim();
  if (!trimmed) {
    throw new Error('Resume text is empty.');
  }

  const config = await getStoredConfig();
  if (!config) {
    throw new Error(
      'No Gemini API key configured. Open the extension settings to add your Gemini API key.',
    );
  }

  const prompt = buildResumeParsePrompt(trimmed);
  const model = config.model ?? 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.1,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!raw) {
    throw new Error('Gemini returned an empty resume parse response.');
  }

  const parsed = parseJsonLoose(raw);
  return buildUserProfileFromJson(parsed, trimmed, options.fallbackName);
}

function parseJsonLoose(value: string): ParsedResumeJson {
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as ParsedResumeJson;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as ParsedResumeJson;
    }
    throw new Error('Could not parse Gemini resume JSON response.');
  }
}

function buildUserProfileFromJson(
  parsed: ParsedResumeJson,
  resumeText: string,
  fallbackName?: string,
): UserProfile {
  const name = (parsed.name || fallbackName || 'LinkedIn User').trim() || 'LinkedIn User';
  const currentYear = new Date().getFullYear();

  const education = (parsed.education ?? [])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.school))
    .map((entry) => {
      const yearValue = entry.gradYear;
      const yearNum =
        typeof yearValue === 'number'
          ? yearValue
          : Number.parseInt(String(yearValue ?? ''), 10);
      return {
        school: String(entry.school ?? '').trim(),
        degree: String(entry.degree ?? 'Unknown').trim() || 'Unknown',
        major: String(entry.major ?? 'Unknown').trim() || 'Unknown',
        gradYear: Number.isFinite(yearNum) ? yearNum : currentYear,
      };
    });

  const experience = (parsed.experience ?? [])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.company || entry?.title))
    .map((entry) => ({
      company: String(entry.company ?? entry.title ?? '').trim(),
      title: String(entry.title ?? entry.company ?? '').trim(),
      dates: String(entry.dates ?? 'Unknown').trim() || 'Unknown',
      description: String(entry.description ?? '').trim(),
    }))
    .filter((entry) => entry.company && entry.title);

  const toStringArray = (values: unknown): string[] => {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  };

  const hometown = parsed.hometown ? String(parsed.hometown).trim() : '';
  const email = parsed.email ? String(parsed.email).trim().toLowerCase() : '';

  const profile: UserProfile = {
    id: 'me',
    name,
    resumeText,
    parsed: {
      education,
      experience,
      skills: toStringArray(parsed.skills),
      clubs: toStringArray(parsed.clubs),
      languages: toStringArray(parsed.languages),
      ...(hometown ? { hometown } : {}),
    },
    targetCompanies: toStringArray(parsed.targetCompanies),
    targetRoles: toStringArray(parsed.targetRoles),
  };

  if (email) {
    profile.email = email;
  }

  return profile;
}

