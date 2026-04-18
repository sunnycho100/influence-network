import type { GraphSnapshot, Profile } from './models.js';

export interface MindMapNode {
  id: string;
  label: string;
  kind: 'root' | 'user' | 'company' | 'profile';
  size: number;
  x: number;
  y: number;
  company?: string;
  title?: string;
  subtitle?: string;
  profileId?: string;
  mutualConnections?: number;
  warmnessScore?: number;
}

export interface MindMapEdge {
  id: string;
  source: string;
  target: string;
  kind: 'root-company' | 'company-profile';
  strength: number;
}

export interface MindMapData {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  profileCount: number;
  companyCount: number;
}

interface CompanyCluster {
  name: string;
  profiles: Profile[];
}

const ROOT_RADIUS = 0;
const COMPANY_RING_RADIUS = 245;
const PROFILE_RING_BASE = 76;
const PROFILE_RING_STEP = 22;

export function buildMindMapData(snapshot: GraphSnapshot): MindMapData {
  const profiles = [...snapshot.profiles].sort((left, right) => {
    const warmnessDelta = (right.warmnessScore ?? 0) - (left.warmnessScore ?? 0);
    if (warmnessDelta !== 0) {
      return warmnessDelta;
    }

    const mutualDelta = right.mutualConnections - left.mutualConnections;
    if (mutualDelta !== 0) {
      return mutualDelta;
    }

    return right.lastScraped - left.lastScraped;
  });

  const companies = clusterProfilesByCompany(profiles);
  const rootNode: MindMapNode = snapshot.user
    ? {
        id: 'user-root',
        label: snapshot.user.name,
        kind: 'user',
        size: 72,
        x: ROOT_RADIUS,
        y: ROOT_RADIUS,
        title: snapshot.user.targetRoles.join(', ') || 'Your network',
        subtitle: snapshot.user.targetCompanies.join(', ') || 'Local graph source',
      }
    : {
        id: 'network-root',
        label: 'My Network',
        kind: 'root',
        size: 72,
        x: ROOT_RADIUS,
        y: ROOT_RADIUS,
        title: 'Scraped LinkedIn graph',
        subtitle: `${profiles.length} people captured locally`,
      };

  const nodes: MindMapNode[] = [rootNode];
  const edges: MindMapEdge[] = [];

  companies.forEach((cluster, companyIndex) => {
    const companyAngle = polarAngle(companyIndex, companies.length);
    const companyPosition = projectPoint(companyAngle, COMPANY_RING_RADIUS);
    const companyId = `company:${slugify(cluster.name)}:${companyIndex}`;

    nodes.push({
      id: companyId,
      label: cluster.name,
      kind: 'company',
      size: clamp(38 + cluster.profiles.length * 4, 42, 64),
      x: companyPosition.x,
      y: companyPosition.y,
      company: cluster.name,
      subtitle: `${cluster.profiles.length} profile${cluster.profiles.length === 1 ? '' : 's'}`,
    });

    edges.push({
      id: `${rootNode.id}->${companyId}`,
      source: rootNode.id,
      target: companyId,
      kind: 'root-company',
      strength: cluster.profiles.length,
    });

    cluster.profiles.forEach((profile, profileIndex) => {
      const offsetCount = Math.max(cluster.profiles.length, 1);
      const offsetSpread = Math.min(Math.PI / 1.25, 0.38 * offsetCount);
      const startAngle = companyAngle - offsetSpread / 2;
      const step = offsetCount === 1 ? 0 : offsetSpread / (offsetCount - 1);
      const profileAngle = startAngle + step * profileIndex;
      const profileRadius =
        COMPANY_RING_RADIUS + PROFILE_RING_BASE + Math.floor(profileIndex / 4) * PROFILE_RING_STEP;
      const profilePosition = projectPoint(profileAngle, profileRadius);

      nodes.push({
        id: `profile:${profile.id}`,
        profileId: profile.id,
        label: profile.name,
        kind: 'profile',
        size: clamp(22 + (profile.warmnessScore ?? 0) * 0.18 + profile.mutualConnections, 24, 42),
        x: profilePosition.x,
        y: profilePosition.y,
        company: profile.currentCompany ?? cluster.name,
        title: profile.currentTitle ?? profile.headline,
        subtitle: profile.location ?? profile.headline,
        mutualConnections: profile.mutualConnections,
        ...(profile.warmnessScore !== undefined ? { warmnessScore: profile.warmnessScore } : {}),
      });

      edges.push({
        id: `${companyId}->profile:${profile.id}`,
        source: companyId,
        target: `profile:${profile.id}`,
        kind: 'company-profile',
        strength: Math.max(1, profile.mutualConnections),
      });
    });
  });

  return {
    nodes,
    edges,
    profileCount: profiles.length,
    companyCount: companies.length,
  };
}

function clusterProfilesByCompany(profiles: Profile[]): CompanyCluster[] {
  const clusters = new Map<string, Profile[]>();

  for (const profile of profiles) {
    const company = normalizeCompanyName(profile.currentCompany) || normalizeCompanyName(profile.experience[0]?.company) || 'Independent';
    const bucket = clusters.get(company) ?? [];
    bucket.push(profile);
    clusters.set(company, bucket);
  }

  return Array.from(clusters.entries())
    .map(([name, groupedProfiles]) => ({
      name,
      profiles: groupedProfiles.slice(0, 14),
    }))
    .sort((left, right) => right.profiles.length - left.profiles.length)
    .slice(0, 10);
}

function normalizeCompanyName(value?: string): string {
  if (!value) {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

function polarAngle(index: number, total: number): number {
  return (-Math.PI / 2) + (Math.PI * 2 * index) / Math.max(total, 1);
}

function projectPoint(angle: number, radius: number): { x: number; y: number } {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
