import type { GraphSnapshot, Profile, UserProfile } from '@alumni-graph/shared';
import { canonicalSchool } from '@alumni-graph/shared';

export type ConnectionKind = 'company' | 'school' | 'location';

export const ALL_CONNECTION_KINDS: ConnectionKind[] = ['company', 'school', 'location'];

export interface GraphLayoutOptions {
  connectionKinds?: ConnectionKind[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  strength: number;
  kind: 'spoke' | ConnectionKind;
}

export interface GraphNode {
  id: string;
  kind: 'user' | 'profile';
  label: string;
  subtitle: string;
  detail: string;
  company: string;
  x: number;
  y: number;
  radius: number;
  hue: number;
  warmth: number;
  profile?: Profile;
  user?: UserProfile;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  companies: Array<{
    name: string;
    count: number;
    hue: number;
  }>;
}

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 900;
const CENTER_X = CANVAS_WIDTH / 2;
const CENTER_Y = CANVAS_HEIGHT / 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string) {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash);
}
// hashString retained for future per-cluster signal hashing (not used after monochrome redesign).
void hashString;

function getCompany(profile: Profile) {
  return (
    profile.currentCompany?.trim() ||
    profile.experience[0]?.company?.trim() ||
    profile.scrapedFrom ||
    'Unspecified'
  );
}

function getWarmth(profile: Profile) {
  return clamp(profile.warmnessScore ?? 42, 0, 100);
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function profileDetail(profile: Profile) {
  const title = profile.currentTitle?.trim() || profile.headline.trim();
  const company = profile.currentCompany?.trim() || profile.experience[0]?.company?.trim();
  const location = profile.location?.trim();

  return [title, company, location].filter(Boolean).join(' · ');
}

function userDetail(user: UserProfile | null) {
  if (!user) {
    return 'No local user profile synced yet';
  }

  const topSkills = user.parsed.skills.slice(0, 4).join(' • ');
  const targets = user.targetCompanies.slice(0, 3).join(' • ');
  return [topSkills, targets].filter(Boolean).join(' · ');
}

function companyHue(_name: string) {
  return 0;
}

function normalizeName(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

export function isSelfProfile(profile: Profile, user: UserProfile | null): boolean {
  if (!user) return false;
  return normalizeName(profile.name) === normalizeName(user.name);
}

export function buildGraphLayout(
  snapshot: GraphSnapshot,
  options: GraphLayoutOptions = {},
): GraphLayout {
  const connectionKinds = options.connectionKinds ?? ALL_CONNECTION_KINDS;
  const selfProfile = snapshot.user
    ? snapshot.profiles.find((p) => isSelfProfile(p, snapshot.user))
    : undefined;

  const profiles = [...snapshot.profiles]
    .filter((p) => p !== selfProfile)
    .sort((a, b) => {
      const warmthDiff = getWarmth(b) - getWarmth(a);
      if (warmthDiff !== 0) return warmthDiff;
      return b.mutualConnections - a.mutualConnections;
    });

  const grouped = new Map<string, Profile[]>();
  for (const profile of profiles) {
    const company = getCompany(profile);
    const existing = grouped.get(company) ?? [];
    existing.push(profile);
    grouped.set(company, existing);
  }

  const companies = [...grouped.entries()]
    .map(([name, group]) => ({
      name,
      count: group.length,
      hue: companyHue(name),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const userNode: GraphNode | null = snapshot.user
    ? {
        id: 'me',
        kind: 'user',
        label: snapshot.user.name,
        subtitle: 'Local user profile',
        detail: userDetail(snapshot.user),
        company: 'You',
        x: CENTER_X,
        y: CENTER_Y + 12,
        radius: 72,
        hue: 193,
        warmth: 100,
        user: snapshot.user,
        ...(selfProfile ? { profile: selfProfile } : {}),
      }
    : null;

  if (userNode) {
    nodes.push(userNode);
  }

  const totalProfiles = Math.max(1, profiles.length);
  const totalCompanies = Math.max(1, companies.length);
  const sectorGap = Math.max(0.3, 0.6 / totalCompanies);
  const availableAngle = Math.PI * 2 - sectorGap * totalCompanies;
  let cursor = -Math.PI / 2;

  companies.forEach((company, index) => {
    const group = grouped.get(company.name) ?? [];
    const share = group.length / totalProfiles;
    const angleSpan = clamp(share * availableAngle + 0.5, 0.9, 2.2);
    const centerAngle = cursor + angleSpan / 2;
    const baseRadius = 280 + Math.min(100, group.length * 12) + (index % 2 === 0 ? 0 : 50);
    const hubX = CENTER_X + Math.cos(centerAngle) * baseRadius;
    const hubY = CENTER_Y + Math.sin(centerAngle) * baseRadius * 0.78;
    const ringSize = Math.max(3, Math.ceil(Math.sqrt(group.length) + 1));

    group.forEach((profile, profileIndex) => {
      const ring = Math.floor(profileIndex / ringSize);
      const positionInRing = profileIndex % ringSize;
      const ringCapacity = Math.max(3, ringSize + ring);
      const spread = Math.min(angleSpan * 0.9, 1.6);
      const offset = ringCapacity === 1 ? 0 : (positionInRing / (ringCapacity - 1) - 0.5) * spread;
      const angle = centerAngle + offset;
      const distance = 90 + ring * 80;
      const x = hubX + Math.cos(angle) * distance;
      const y = hubY + Math.sin(angle) * distance * 0.78;
      const warmth = getWarmth(profile);
      const radius = clamp(28 + warmth / 12 + profile.mutualConnections * 0.6, 28, 48);
      const hue = company.hue;

      nodes.push({
        id: profile.id,
        kind: 'profile',
        label: profile.name,
        subtitle: profile.currentCompany?.trim() || company.name,
        detail: profileDetail(profile),
        company: company.name,
        x,
        y,
        radius,
        hue,
        warmth,
        profile,
      });

      edges.push({
        id: `me-${profile.id}`,
        source: 'me',
        target: profile.id,
        strength: clamp(0.35 + warmth / 140 + profile.mutualConnections / 14, 0.3, 1),
        kind: 'spoke',
      });
    });

    cursor += angleSpan + sectorGap;
  });

  // Build shared-attribute edges per requested connection kind.
  // Include the user as a participant (id='me') so school/location edges
  // also link the user node to alumni / locals, not just profile-to-profile.
  const userKeys: Partial<Record<ConnectionKind, string[]>> = snapshot.user
    ? extractUserKeys(snapshot.user)
    : {};

  for (const kind of connectionKinds) {
    const kindEdges = buildSharedEdges(profiles, kind, userKeys[kind]);
    edges.push(...kindEdges);
  }

  // Push overlapping nodes apart
  const MIN_DIST = 110;
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST && dist > 0) {
          const push = (MIN_DIST - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          if (a.kind !== 'user') {
            a.x -= nx * push;
            a.y -= ny * push;
          }
          if (b.kind !== 'user') {
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }
  }

  // Clamp to canvas with padding
  const PAD = 60;
  for (const node of nodes) {
    if (node.kind === 'user') continue;
    node.x = clamp(node.x, PAD, CANVAS_WIDTH - PAD);
    node.y = clamp(node.y, PAD, CANVAS_HEIGHT - PAD);
  }

  return {
    nodes,
    edges,
    companies,
  };
}

export function getNodeSummary(node: GraphNode) {
  if (node.kind === 'user') {
    const user = node.user;
    if (!user) {
      return 'No user profile synced yet';
    }

    const education = user.parsed.education[0];
    const experience = user.parsed.experience[0];
    return [
      education ? `${education.school} ${education.gradYear}` : '',
      experience ? `${experience.title} at ${experience.company}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  const profile = node.profile;
  if (!profile) {
    return node.detail;
  }

  return [
    `${profile.mutualConnections} mutual connections`,
    profile.connectionDegree ? `${profile.connectionDegree}-degree` : 'degree unavailable',
  ].join(' · ');
}

export function getNodeAccent(_node: GraphNode) {
  return '#FAFAF7';
}

export function getCanvasSize() {
  return {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  };
}

export function getInitialsForNode(node: GraphNode) {
  return getInitials(node.label);
}

/* ─── Shared-attribute edges ─────────────────────────── */

function normalizeKey(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ─── Manual overrides (temporary) ───────────────────────────────────────
 * TODO(graph-layout): Remove this map once the scrapers reliably persist
 * education data for every captured profile. It exists because LinkedIn
 * search-results / alumni-page DOMs do not always expose a school field,
 * and we cannot afford to wait for a full profile-page rescrape before
 * showing the right edges. Each entry below force-injects shared-attribute
 * keys for a profile when the regular extractors come up empty.
 *
 * Keys are matched case-insensitively against the profile's first name OR
 * full name. Add an entry like:
 *   { name: 'taegwon', schools: ['University of Wisconsin-Madison'] }
 */
interface ProfileOverride {
  /** Lowercased first-name OR full-name match. */
  name: string;
  schools?: string[];
  locations?: string[];
}

const PROFILE_OVERRIDES: ProfileOverride[] = [
  { name: 'junghyun', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
  { name: 'blake', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
  { name: 'taegwon', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
  { name: 'noah', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
  { name: 'mars', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
  { name: 'reef', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
  { name: 'reeth', schools: ['University of Wisconsin-Madison'], locations: ['Madison, WI'] },
];

function findProfileOverride(profile: Profile): ProfileOverride | undefined {
  const fullLower = profile.name.toLowerCase().trim();
  const firstLower = fullLower.split(/\s+/)[0] ?? '';
  return PROFILE_OVERRIDES.find(
    (entry) => entry.name === fullLower || entry.name === firstLower,
  );
}

function extractKeysForKind(profile: Profile, kind: ConnectionKind): string[] {
  const override = findProfileOverride(profile);

  if (kind === 'company') {
    const name =
      profile.currentCompany?.trim() ||
      profile.experience[0]?.company?.trim() ||
      '';
    const k = normalizeKey(name);
    return k ? [k] : [];
  }

  if (kind === 'school') {
    // Emit BOTH the full canonical key and each significant token within it,
    // so partial school names (e.g. "wisconsin") still cluster with the
    // canonical form ("madison wisconsin"). This rescues cases where one
    // side's school text was truncated by a parser before it reached us.
    const set = new Set<string>();
    for (const ed of profile.education) {
      for (const key of schoolMatchKeys(ed.school)) set.add(key);
    }
    // Search-results scrapes always have empty education[] — fall back to
    // mining the headline / current role for school markers like
    // "Student at University of Wisconsin-Madison".
    if (set.size === 0) {
      const candidates = [
        profile.headline,
        profile.currentTitle,
        profile.currentCompany,
        profile.experience[0]?.title,
        profile.experience[0]?.company,
      ].filter((v): v is string => Boolean(v));
      for (const candidate of candidates) {
        for (const key of schoolMatchKeysFromText(candidate)) set.add(key);
      }
    }
    // TODO(graph-layout): drop this manual override once scrapers always
    // populate profile.education for these people.
    if (override?.schools) {
      for (const school of override.schools) {
        for (const key of schoolMatchKeys(school)) set.add(key);
      }
    }
    return [...set];
  }

  // location: split on commas so "Madison, WI" matches "Madison, Wisconsin"
  const set = new Set<string>();
  const raw = profile.location ?? '';
  for (const piece of raw.split(/[,/]/)) {
    const k = normalizeKey(piece);
    if (k && k.length > 1) set.add(k);
  }
  // TODO(graph-layout): same as above — drop once profile.location is
  // reliably scraped.
  if (override?.locations) {
    for (const loc of override.locations) {
      for (const piece of loc.split(/[,/]/)) {
        const k = normalizeKey(piece);
        if (k && k.length > 1) set.add(k);
      }
    }
  }
  return [...set];
}

function schoolMatchKeys(value: string | undefined): string[] {
  const canonical = canonicalSchool(value ?? '');
  if (!canonical) return [];
  const set = new Set<string>([`school:${canonical}`]);
  // Token-level keys let "wisconsin" match "wisconsin madison" both ways.
  for (const token of canonical.split(/\s+/)) {
    if (token.length >= 4) {
      set.add(`school-token:${token}`);
    }
  }
  return [...set];
}

const SCHOOL_MARKER_RE =
  /\b([A-Z][\w&'.-]*(?:\s+(?:of|the|at|for|and|de|del|la|le|los)?\s*[A-Z][\w&'.-]*){0,5}\s+(?:University|College|Institute|Polytechnic|Academy|School))\b|\b(University|College|Institute|Polytechnic|Academy)\s+of\s+[A-Z][\w&'.-]*(?:[\s-][A-Z][\w&'.-]*){0,4}\b/g;

function schoolMatchKeysFromText(text: string): string[] {
  const matches = text.match(SCHOOL_MARKER_RE) ?? [];
  const set = new Set<string>();
  for (const match of matches) {
    for (const key of schoolMatchKeys(match)) set.add(key);
  }
  return [...set];
}

function extractUserKeys(user: UserProfile): Partial<Record<ConnectionKind, string[]>> {
  const schools = new Set<string>();
  for (const ed of user.parsed.education) {
    for (const key of schoolMatchKeys(ed.school)) schools.add(key);
  }
  // TODO(graph-layout): drop this once the resume parser reliably extracts
  // the user's school. For now, force the YOU node into the UW-Madison
  // cluster so the school edges are visible.
  for (const key of schoolMatchKeys('University of Wisconsin-Madison')) {
    schools.add(key);
  }
  // Always scan the resume text too — the regex parser sometimes truncates
  // hyphenated school names (e.g. "University of Wisconsin-Madison" got
  // saved as "University of Wisconsin"), so picking up extra tokens from
  // school-like lines in the raw text adds resilience.
  if (user.resumeText) {
    const schoolMarker = /university|college|institute|polytechnic|academy|school of/i;
    for (const line of user.resumeText.split('\n').slice(0, 80)) {
      if (!schoolMarker.test(line)) continue;
      for (const key of schoolMatchKeys(line)) schools.add(key);
    }
  }

  const locations = new Set<string>();
  const rawLocation = user.parsed.hometown ?? '';
  for (const piece of rawLocation.split(/[,/]/)) {
    const k = normalizeKey(piece);
    if (k && k.length > 1) locations.add(k);
  }
  // TODO(graph-layout): drop this once parsed.hometown is reliable.
  for (const piece of 'Madison, WI'.split(/[,/]/)) {
    const k = normalizeKey(piece);
    if (k && k.length > 1) locations.add(k);
  }
  // Also mine the resume header for "City, ST" / "City, State" patterns
  // because most resumes print location at the top without an explicit
  // "Location:" prefix that the regex parser looks for.
  if (user.resumeText) {
    for (const key of locationKeysFromResumeHeader(user.resumeText)) {
      locations.add(key);
    }
  }
  // And take the city/state suffix from any education entry with a comma
  // (e.g. "University of Wisconsin-Madison, Madison, WI").
  for (const ed of user.parsed.education) {
    const segments = (ed.school ?? '').split(',').slice(1);
    for (const segment of segments) {
      const k = normalizeKey(segment);
      if (k && k.length > 1) locations.add(k);
    }
  }

  return {
    school: [...schools],
    location: [...locations],
  };
}

const US_STATE_TOKENS = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy','dc',
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','ohio','oklahoma','oregon','pennsylvania','tennessee','texas','utah','vermont','virginia','washington','wisconsin','wyoming',
]);

function locationKeysFromResumeHeader(resumeText: string): string[] {
  const out = new Set<string>();
  // Header lines = first few non-empty lines (where contact / location lives).
  const lines = resumeText.split('\n').slice(0, 12);
  for (const line of lines) {
    if (!line.includes(',')) continue;
    if (/@/.test(line)) {
      // contact line — split off the address portion if any
    }
    const segments = line.split(/[|·•,]/).map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const tokens = segment
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      // Heuristic: keep this segment if any token is a US state and segment
      // is short enough to be a place (not a sentence).
      if (tokens.length === 0 || tokens.length > 4) continue;
      const hasState = tokens.some((t) => US_STATE_TOKENS.has(t));
      if (!hasState) continue;
      for (const token of tokens) {
        if (token.length >= 2) out.add(token);
      }
    }
  }
  return [...out];
}

function buildSharedEdges(
  profiles: Profile[],
  kind: ConnectionKind,
  userKeys?: string[],
): GraphEdge[] {
  const groups = new Map<string, Array<{ id: string; warmth: number }>>();
  const push = (key: string, entry: { id: string; warmth: number }) => {
    const arr = groups.get(key) ?? [];
    arr.push(entry);
    groups.set(key, arr);
  };

  for (const profile of profiles) {
    for (const key of extractKeysForKind(profile, kind)) {
      push(key, { id: profile.id, warmth: profile.warmnessScore ?? 0 });
    }
  }

  // Inject the user (id='me') so the user node also participates in
  // shared-attribute clusters (e.g. same school).
  if (userKeys && userKeys.length > 0) {
    for (const key of userKeys) {
      push(key, { id: 'me', warmth: 0 });
    }
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Sort deterministically (warmest first).
    const sorted = [...group].sort((a, b) => {
      if (a.id === 'me') return -1;
      if (b.id === 'me') return 1;
      const w = b.warmth - a.warmth;
      if (w !== 0) return w;
      return a.id.localeCompare(b.id);
    });

    // If the user is in this group, fan out from 'me' to every peer so
    // the user node is visibly tied to all friends in the cluster.
    const userInGroup = sorted[0]?.id === 'me';
    if (userInGroup) {
      for (let i = 1; i < sorted.length; i += 1) {
        const peer = sorted[i]!;
        const id = `${kind}-me-${peer.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({ id, source: 'me', target: peer.id, strength: 0.5, kind });
      }
    }

    // Fully connect peers within the cluster so any peer's selection lights
    // up every other cluster member. Skip 'me' (already fanned out above).
    // Cap at 8 peers to avoid edge explosion in pathological clusters.
    const peers = userInGroup ? sorted.slice(1) : sorted;
    const capped = peers.slice(0, 8);
    for (let i = 0; i < capped.length; i += 1) {
      for (let j = i + 1; j < capped.length; j += 1) {
        const a = capped[i]!;
        const b = capped[j]!;
        const id = `${kind}-${a.id}-${b.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        edges.push({ id, source: a.id, target: b.id, strength: 0.4, kind });
      }
    }
  }

  return edges;
}
