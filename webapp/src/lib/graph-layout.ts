import type { GraphSnapshot, Profile, UserProfile } from '@alumni-graph/shared';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  strength: number;
  kind: 'spoke' | 'cluster';
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

function companyHue(name: string) {
  return 190 + (hashString(name) % 110);
}

export function buildGraphLayout(snapshot: GraphSnapshot): GraphLayout {
  const profiles = [...snapshot.profiles].sort((a, b) => {
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
      }
    : null;

  if (userNode) {
    nodes.push(userNode);
  }

  const totalProfiles = Math.max(1, profiles.length);
  let cursor = -Math.PI / 2;
  const sectorGap = 0.18;

  companies.forEach((company, index) => {
    const group = grouped.get(company.name) ?? [];
    const share = group.length / totalProfiles;
    const angleSpan = clamp(share * Math.PI * 2 * 1.15 + 0.36, 0.72, 1.7);
    const centerAngle = cursor + angleSpan / 2;
    const baseRadius = 228 + Math.min(120, group.length * 10) + (index % 2 === 0 ? 0 : 34);
    const hubX = CENTER_X + Math.cos(centerAngle) * baseRadius;
    const hubY = CENTER_Y + Math.sin(centerAngle) * baseRadius * 0.8;
    const ringSize = Math.max(3, Math.ceil(Math.sqrt(group.length) + 1));

    group.forEach((profile, profileIndex) => {
      const ring = Math.floor(profileIndex / ringSize);
      const positionInRing = profileIndex % ringSize;
      const ringCapacity = Math.max(3, ringSize + ring);
      const spread = Math.min(angleSpan * 0.85, 1.25);
      const offset = ringCapacity === 1 ? 0 : (positionInRing / (ringCapacity - 1) - 0.5) * spread;
      const angle = centerAngle + offset;
      const distance = 66 + ring * 58;
      const x = hubX + Math.cos(angle) * distance;
      const y = hubY + Math.sin(angle) * distance * 0.8;
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

      if (profileIndex > 0) {
        const previous = group[profileIndex - 1];
        if (!previous) return;
        edges.push({
          id: `${previous.id}-${profile.id}`,
          source: previous.id,
          target: profile.id,
          strength: 0.38,
          kind: 'cluster',
        });
      }
    });

    cursor += angleSpan + sectorGap;
  });

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

export function getNodeAccent(node: GraphNode) {
  return `hsl(${node.hue} 82% 62%)`;
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
