import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

import type { UserProfile } from '@alumni-graph/shared';

const SECTION_ALIASES: Record<string, string[]> = {
  education: ['education', 'academic background'],
  experience: ['experience', 'work experience', 'employment', 'professional experience'],
  skills: ['skills', 'technical skills', 'core competencies'],
  clubs: ['clubs', 'activities', 'extracurricular', 'leadership', 'involvement'],
  languages: ['languages'],
  targetCompanies: ['target companies', 'companies of interest'],
  targetRoles: ['target roles', 'roles of interest'],
};

const CONTACT_LINE_PATTERN = /(@|linkedin\.com|github\.com|\+\d|mailto:)/i;
let workerConfigured = false;

interface ResumeParseOptions {
  fallbackName?: string;
}

type SectionKey =
  | 'header'
  | 'education'
  | 'experience'
  | 'skills'
  | 'clubs'
  | 'languages'
  | 'targetCompanies'
  | 'targetRoles';

interface ResumeSections {
  header: string[];
  education: string[];
  experience: string[];
  skills: string[];
  clubs: string[];
  languages: string[];
  targetCompanies: string[];
  targetRoles: string[];
}

export async function extractTextFromPdf(file: File): Promise<string> {
  configurePdfWorker();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const documentTask = getDocument({ data: bytes });
  const pdf = await documentTask.promise;

  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine: string[] = [];

    for (const item of content.items) {
      if (typeof item !== 'object' || !item) {
        continue;
      }

      const text = (item as { str?: unknown }).str;
      const hasEol = Boolean((item as { hasEOL?: unknown }).hasEOL);
      const nextToken = typeof text === 'string' ? collapseWhitespace(text) : '';

      if (nextToken) {
        currentLine.push(nextToken);
      }

      if (hasEol && currentLine.length > 0) {
        lines.push(collapseWhitespace(currentLine.join(' ')));
        currentLine = [];
      }
    }

    if (currentLine.length > 0) {
      lines.push(collapseWhitespace(currentLine.join(' ')));
    }

    if (lines.length > 0) {
      pageTexts.push(lines.join('\n'));
    }
  }

  return pageTexts
    .join('\n\n')
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function parseResumeTextToUserProfile(
  resumeText: string,
  options: ResumeParseOptions = {},
): UserProfile {
  const normalizedText = normalizeResumeText(resumeText);
  if (!normalizedText) {
    throw new Error('Resume text is empty. Paste resume text or upload a PDF first.');
  }

  const lines = normalizedText
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);

  const sections = splitIntoSections(lines);
  const email = extractEmail(normalizedText);
  const hometown = extractHometown(lines);
  const parsed = {
    education: parseEducation(sections.education),
    experience: parseExperience(sections.experience),
    skills: parseKeywordList(sections.skills),
    clubs: parseKeywordList(sections.clubs),
    languages: parseKeywordList(sections.languages),
    ...(hometown ? { hometown } : {}),
  };

  const targetCompanies = parseKeywordList(sections.targetCompanies);
  const targetRoles = parseKeywordList(sections.targetRoles);

  const name = extractName(sections.header, options.fallbackName ?? 'LinkedIn User');

  const profile: UserProfile = {
    id: 'me',
    name,
    resumeText: normalizedText,
    parsed,
    targetCompanies,
    targetRoles,
  };

  if (email) {
    profile.email = email;
  }

  return profile;
}

function configurePdfWorker(): void {
  if (workerConfigured) {
    return;
  }

  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerConfigured = true;
}

function normalizeResumeText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoSections(lines: string[]): ResumeSections {
  const sections: ResumeSections = {
    header: [],
    education: [],
    experience: [],
    skills: [],
    clubs: [],
    languages: [],
    targetCompanies: [],
    targetRoles: [],
  };

  let current: SectionKey = 'header';

  for (const line of lines) {
    const section = detectSection(line);
    if (section) {
      current = section;
      continue;
    }

    sections[current].push(line);
  }

  return sections;
}

function detectSection(line: string): SectionKey | null {
  const normalized = normalizeSectionHeader(line);

  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as Array<
    [Exclude<SectionKey, 'header'>, string[]]
  >) {
    if (aliases.some((alias) => normalized === normalizeSectionHeader(alias))) {
      return key;
    }
  }

  return null;
}

function normalizeSectionHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractName(headerLines: string[], fallbackName: string): string {
  for (const line of headerLines.slice(0, 5)) {
    if (
      !CONTACT_LINE_PATTERN.test(line) &&
      /^[a-z ,.'-]{3,}$/i.test(line) &&
      line.split(/\s+/).length <= 5
    ) {
      return toTitleCase(line);
    }
  }

  return fallbackName;
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match?.[0]?.toLowerCase();
}

function extractHometown(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 10)) {
    const match = line.match(/(?:based in|location|hometown)\s*[:\-]\s*(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function parseEducation(lines: string[]): UserProfile['parsed']['education'] {
  return lines
    .slice(0, 10)
    .map((line) => parseEducationLine(line))
    .filter((entry): entry is UserProfile['parsed']['education'][number] => Boolean(entry));
}

function parseEducationLine(
  line: string,
): UserProfile['parsed']['education'][number] | null {
  const clean = stripBulletPrefix(line);
  if (!clean) {
    return null;
  }

  const parts = clean
    .split(/\s*[|•]\s*|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const school = parts[0] ?? '';
  if (!school || school.length < 2) {
    return null;
  }

  const degreeMajor = parts.slice(1).join(', ');
  const [degree, major] = splitDegreeAndMajor(degreeMajor);
  const gradYear = extractGradYear(clean);

  return {
    school,
    degree: degree || 'Unknown',
    major: major || 'Unknown',
    gradYear,
  };
}

function parseExperience(lines: string[]): UserProfile['parsed']['experience'] {
  return lines
    .slice(0, 20)
    .map((line) => parseExperienceLine(line))
    .filter((entry): entry is UserProfile['parsed']['experience'][number] => Boolean(entry));
}

function parseExperienceLine(
  line: string,
): UserProfile['parsed']['experience'][number] | null {
  const clean = stripBulletPrefix(line);
  if (!clean || clean.length < 4) {
    return null;
  }

  const parts = clean
    .split(/\s*[|•]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  let title = parts[0] ?? '';
  let company = parts[1] ?? '';
  let dates = parts.find((part) => /\b(19|20)\d{2}\b|present|current/i.test(part)) ?? '';

  if (!company && / at /i.test(clean)) {
    const [left, right] = clean.split(/\s+at\s+/i);
    title = left?.trim() ?? title;
    company = right?.split(/\s*[|•]\s*|\s+-\s+/)[0]?.trim() ?? company;
  }

  if (!company && parts.length > 0) {
    company = parts[0] ?? '';
  }

  if (!title) {
    title = company;
  }

  if (!dates) {
    dates = 'Unknown';
  }

  if (!title || !company) {
    return null;
  }

  return {
    company,
    title,
    dates,
    description: '',
  };
}

function parseKeywordList(lines: string[]): string[] {
  const values = lines
    .flatMap((line) =>
      line
        .split(/[,|•]/)
        .map((part) => stripBulletPrefix(part))
        .map((part) => collapseWhitespace(part))
        .filter(Boolean),
    )
    .filter((part) => part.length > 1);

  const unique = new Set<string>();
  for (const value of values) {
    unique.add(toTitleCase(value));
  }

  return [...unique].slice(0, 50);
}

function stripBulletPrefix(value: string): string {
  return value.replace(/^[\s\-•*]+/, '').trim();
}

function splitDegreeAndMajor(value: string): [string, string] {
  if (!value) {
    return ['', ''];
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return ['', ''];
  }

  if (parts.length === 1) {
    return [parts[0] ?? '', ''];
  }

  return [parts[0] ?? '', parts.slice(1).join(', ')];
}

function extractGradYear(value: string): number {
  const matches = value.match(/\b(19|20)\d{2}\b/g);
  if (!matches || matches.length === 0) {
    return new Date().getFullYear();
  }

  const last = matches[matches.length - 1];
  const parsed = Number.parseInt(last ?? '', 10);
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
