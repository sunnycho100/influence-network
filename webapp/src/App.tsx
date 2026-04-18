import { useEffect, useMemo, useState } from 'react';
import type { GraphSnapshot, Profile } from '@alumni-graph/shared';
import { extensionClient } from './lib/extension-client';
import {
  buildGraphLayout,
  getCanvasSize,
  getInitialsForNode,
  getNodeAccent,
  getNodeSummary,
  type GraphNode,
} from './lib/graph-layout';

type LoadState = 'idle' | 'loading' | 'success' | 'error';

interface PingResult {
  version: string;
}

const EMPTY_SNAPSHOT: GraphSnapshot = {
  profiles: [],
  user: null,
  messages: [],
};

const CANVAS = getCanvasSize();

function formatTime(timestamp?: number | null) {
  if (!timestamp) return 'Unknown';

  return new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function companyFromProfile(profile: Profile) {
  return (
    profile.currentCompany?.trim() ||
    profile.experience[0]?.company?.trim() ||
    profile.scrapedFrom ||
    'Unspecified'
  );
}

function getSelectedNode(snapshot: GraphSnapshot | null, selectedId: string): GraphNode | null {
  if (!snapshot) return null;

  if (selectedId === 'me') {
    if (!snapshot.user) return null;

    return {
      id: 'me',
      kind: 'user',
      label: snapshot.user.name,
      subtitle: 'Local user profile',
      detail: '',
      company: 'You',
      x: 0,
      y: 0,
      radius: 0,
      hue: 193,
      warmth: 100,
      user: snapshot.user,
    };
  }

  const profile = snapshot.profiles.find((entry) => entry.id === selectedId);
  if (!profile) return null;

  return {
    id: profile.id,
    kind: 'profile',
    label: profile.name,
    subtitle: profile.currentCompany?.trim() || companyFromProfile(profile),
    detail: '',
    company: companyFromProfile(profile),
    x: 0,
    y: 0,
    radius: 0,
    hue: 0,
    warmth: profile.warmnessScore ?? 42,
    profile,
  };
}

function NodeButton({
  node,
  active,
  onSelect,
}: {
  node: GraphNode;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const accent = getNodeAccent(node);

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={active}
      className={[
        'group absolute -translate-x-1/2 -translate-y-1/2 rounded-full text-left outline-none transition duration-200',
        active ? 'z-20 scale-[1.02]' : 'z-10 hover:z-20 hover:scale-[1.02]',
      ].join(' ')}
      style={{
        left: `${(node.x / CANVAS.width) * 100}%`,
        top: `${(node.y / CANVAS.height) * 100}%`,
        width: `${Math.max(118, node.radius * 3.2)}px`,
      }}
    >
      <div
        className={[
          'flex items-center gap-3 rounded-[999px] border px-4 py-3 shadow-[0_18px_50px_rgba(2,6,23,0.32)] backdrop-blur-xl transition',
          active
            ? 'border-white/28 bg-slate-950/88'
            : 'border-white/14 bg-slate-950/72 group-hover:border-white/24 group-hover:bg-slate-950/84',
        ].join(' ')}
        style={{
          boxShadow: active
            ? `0 0 0 1px ${accent}, 0 20px 70px rgba(2, 6, 23, 0.5)`
            : '0 18px 50px rgba(2, 6, 23, 0.32)',
        }}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-slate-950"
          style={{
            background: `linear-gradient(135deg, ${accent}, rgba(255,255,255,0.85))`,
          }}
        >
          {getInitialsForNode(node) || 'A'}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{node.label}</span>
          <span className="block truncate text-[11px] uppercase tracking-[0.22em] text-slate-300/80">
            {node.kind === 'user' ? 'You' : node.subtitle}
          </span>
        </span>
      </div>
    </button>
  );
}

export default function App() {
  const extensionId = import.meta.env.VITE_EXTENSION_ID?.trim() ?? '';
  const [bridgeState, setBridgeState] = useState<LoadState>('idle');
  const [graphState, setGraphState] = useState<LoadState>('idle');
  const [ping, setPing] = useState<PingResult | null>(null);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('me');
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const layout = useMemo(() => buildGraphLayout(snapshot ?? EMPTY_SNAPSHOT), [snapshot]);

  const selectedNode = useMemo(
    () => getSelectedNode(snapshot, selectedId),
    [snapshot, selectedId]
  );

  const summary = useMemo(() => {
    const profiles = snapshot?.profiles ?? [];
    const companies = new Set(profiles.map(companyFromProfile));
    const warmest = [...profiles].sort((a, b) => (b.warmnessScore ?? 0) - (a.warmnessScore ?? 0))[0];
    const latestScrape = profiles.reduce<number | null>((max, profile) => {
      return max === null ? profile.lastScraped : Math.max(max, profile.lastScraped);
    }, null);

    return {
      profileCount: profiles.length,
      companyCount: companies.size,
      messageCount: snapshot?.messages?.length ?? 0,
      warmest,
      latestScrape,
    };
  }, [snapshot]);

  async function loadGraph() {
    setBridgeState('loading');
    setGraphState('loading');
    setError('');

    const [pingResult, graphResult] = await Promise.allSettled([
      extensionClient.ping(),
      extensionClient.getGraph(),
    ]);

    if (pingResult.status === 'fulfilled') {
      setPing({ version: pingResult.value.version });
      setBridgeState('success');
    } else {
      setPing(null);
      setBridgeState('error');
    }

    if (graphResult.status === 'fulfilled') {
      setSnapshot(graphResult.value);
      setGraphState('success');
      setLastLoadedAt(Date.now());
      const nextSelected = graphResult.value.user ? 'me' : graphResult.value.profiles[0]?.id ?? '';
      if (nextSelected) {
        setSelectedId((current) => (current === 'me' && graphResult.value.user ? 'me' : nextSelected));
      }
    } else {
      setSnapshot(null);
      setGraphState('error');
      setError(graphResult.reason instanceof Error ? graphResult.reason.message : 'Graph load failed');
    }

    if (graphResult.status === 'rejected' && pingResult.status === 'rejected') {
      setError(
        pingResult.reason instanceof Error
          ? pingResult.reason.message
          : 'Unable to reach the extension bridge'
      );
    }
  }

  useEffect(() => {
    void loadGraph();
  }, []);

  useEffect(() => {
    if (!snapshot) return;

    if (selectedId === 'me' && snapshot.user) return;
    if (selectedId !== 'me' && snapshot.profiles.some((profile) => profile.id === selectedId)) return;

    setSelectedId(snapshot.user ? 'me' : snapshot.profiles[0]?.id ?? '');
  }, [snapshot, selectedId]);

  const connectionStatus =
    bridgeState === 'success' ? 'Linked' : bridgeState === 'error' ? 'Offline' : 'Checking';
  const graphStatus = graphState === 'success' ? 'Graph loaded' : graphState === 'error' ? 'No data' : 'Syncing';

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05101d] text-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(99,102,241,0.16),_transparent_28%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.14),_transparent_28%),linear-gradient(180deg,_#08111f_0%,_#06101a_50%,_#040811_100%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:56px_56px]" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="rounded-[2rem] border border-white/12 bg-white/6 p-4 shadow-[0_30px_100px_rgba(2,6,23,0.35)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-cyan-100">
                <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
                AlumniGraph localhost graph
              </div>
              <div className="space-y-2">
                <h1 className="max-w-3xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  A mind-map view for the local alumni graph.
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                  This workspace pulls the latest snapshot from the extension, lays out profiles by
                  company, and lets you inspect each node without leaving the page.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadGraph}
                className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-400 to-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_50px_rgba(56,189,248,0.3)] transition hover:-translate-y-0.5"
              >
                Refresh graph
              </button>
              <div className="rounded-2xl border border-white/12 bg-slate-950/55 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Extension ID
                </div>
                <div className="mt-1 font-mono text-sm text-slate-100">
                  {extensionId || 'VITE_EXTENSION_ID missing'}
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_360px]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Profiles', summary.profileCount],
                ['Companies', summary.companyCount],
                ['Messages', summary.messageCount],
                ['Last sync', formatTime(lastLoadedAt ?? summary.latestScrape)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-3xl border border-white/12 bg-white/6 p-4 backdrop-blur-xl"
                >
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{label}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{String(value)}</div>
                </div>
              ))}
            </div>

            <div className="rounded-[2rem] border border-white/12 bg-slate-950/74 p-3 shadow-[0_30px_100px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Graph</div>
                  <div className="mt-1 text-lg font-semibold text-white">Company clusters and spokes</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-emerald-300/15 bg-emerald-400/12 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-100">
                    {connectionStatus}
                  </span>
                  <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                    {graphStatus}
                  </span>
                  {ping ? (
                    <span className="rounded-full border border-cyan-300/15 bg-cyan-400/12 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-100">
                      v{ping.version}
                    </span>
                  ) : null}
                </div>
              </div>

              {error ? (
                <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                  {error}
                </div>
              ) : null}

              <div className="relative min-h-[34rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_38%),linear-gradient(180deg,_rgba(2,6,23,0.92),_rgba(2,6,23,0.78))]">
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 1200 900"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="spokeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="rgba(125, 211, 252, 0.18)" />
                      <stop offset="100%" stopColor="rgba(167, 243, 208, 0.3)" />
                    </linearGradient>
                    <linearGradient id="clusterGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="rgba(255, 255, 255, 0.1)" />
                      <stop offset="100%" stopColor="rgba(125, 211, 252, 0.28)" />
                    </linearGradient>
                  </defs>

                  {layout.edges.map((edge) => {
                    const source = layout.nodes.find((node) => node.id === edge.source);
                    const target = layout.nodes.find((node) => node.id === edge.target);

                    if (!source || !target) return null;

                    const dx = target.x - source.x;
                    const dy = target.y - source.y;
                    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                    const bend = edge.kind === 'spoke' ? 0.14 : 0.06;
                    const controlX = (source.x + target.x) / 2 - (dy / distance) * distance * bend;
                    const controlY = (source.y + target.y) / 2 + (dx / distance) * distance * bend;
                    const selected =
                      selectedNode && (selectedNode.id === source.id || selectedNode.id === target.id);

                    return (
                      <path
                        key={edge.id}
                        d={`M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`}
                        fill="none"
                        stroke={edge.kind === 'spoke' ? 'url(#spokeGradient)' : 'url(#clusterGradient)'}
                        strokeWidth={selected ? 2.6 : edge.kind === 'spoke' ? 1.8 : 1.1}
                        strokeOpacity={selected ? 0.92 : edge.kind === 'spoke' ? 0.42 : 0.22}
                      />
                    );
                  })}
                </svg>

                <div className="absolute inset-0">
                  {layout.nodes.map((node) => (
                    <NodeButton
                      key={node.id}
                      node={node}
                      active={selectedNode?.id === node.id}
                      onSelect={setSelectedId}
                    />
                  ))}
                </div>

                <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  <span>Click a node to inspect details</span>
                  <span>{layout.companies.length} company clusters</span>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-5 rounded-[2rem] border border-white/12 bg-white/6 p-4 shadow-[0_30px_100px_rgba(2,6,23,0.35)] backdrop-blur-xl sm:p-5">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Selected node</div>
              <h2 className="font-display text-2xl font-semibold text-white">
                {selectedNode?.label || 'Pick a node'}
              </h2>
              <p className="text-sm leading-6 text-slate-300">
                {selectedNode
                  ? getNodeSummary(selectedNode)
                  : 'The right-hand panel updates when you click a node in the graph.'}
              </p>
            </div>

            {selectedNode ? (
              <div className="space-y-4">
                <div className="rounded-[1.6rem] border border-white/12 bg-slate-950/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                        {selectedNode.kind === 'user' ? 'Local profile' : 'Connection'}
                      </div>
                      <div className="mt-1 text-lg font-semibold text-white">{selectedNode.subtitle}</div>
                    </div>
                    <span className="rounded-full border border-white/12 bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-200">
                      {selectedNode.kind}
                    </span>
                  </div>

                  {selectedNode.kind === 'profile' && selectedNode.profile ? (
                    <div className="mt-4 grid gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-white/5 p-3">
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Warmth</div>
                          <div className="mt-2 text-2xl font-semibold text-white">
                            {formatNumber(selectedNode.profile.warmnessScore ?? 42)}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-white/5 p-3">
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                            Mutuals
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-white">
                            {formatNumber(selectedNode.profile.mutualConnections)}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white/5 p-3 text-sm text-slate-300">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                          Headline
                        </div>
                        <div className="mt-2 text-slate-100">{selectedNode.profile.headline}</div>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-300">
                        <div>
                          <span className="text-slate-500">Company: </span>
                          <span className="text-slate-100">
                            {selectedNode.profile.currentCompany || selectedNode.company}
                          </span>
                        </div>
                        {selectedNode.profile.currentTitle ? (
                          <div>
                            <span className="text-slate-500">Title: </span>
                            <span className="text-slate-100">{selectedNode.profile.currentTitle}</span>
                          </div>
                        ) : null}
                        {selectedNode.profile.location ? (
                          <div>
                            <span className="text-slate-500">Location: </span>
                            <span className="text-slate-100">{selectedNode.profile.location}</span>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {[`Degree ${selectedNode.profile.connectionDegree ?? 'n/a'}`, `${selectedNode.profile.scrapedFrom}`].map(
                          (value) => (
                            <span
                              key={value}
                              className="rounded-full border border-white/12 bg-white/6 px-3 py-1 text-xs text-slate-200"
                            >
                              {value}
                            </span>
                          )
                        )}
                      </div>

                      {selectedNode.profile.sharedSignals?.length ? (
                        <div className="space-y-2">
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                            Shared signals
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedNode.profile.sharedSignals.map((signal) => (
                              <span
                                key={signal}
                                className="rounded-full border border-cyan-300/16 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100"
                              >
                                {signal}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <a
                        href={selectedNode.profile.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 to-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5"
                      >
                        Open LinkedIn profile
                      </a>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-white/5 p-3">
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                            Target companies
                          </div>
                          <div className="mt-2 text-sm text-slate-100">
                            {selectedNode.user?.targetCompanies.slice(0, 4).join(', ') || 'None yet'}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-white/5 p-3">
                          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                            Target roles
                          </div>
                          <div className="mt-2 text-sm text-slate-100">
                            {selectedNode.user?.targetRoles.slice(0, 4).join(', ') || 'None yet'}
                          </div>
                        </div>
                      </div>

                      {selectedNode.user ? (
                        <>
                          <div className="space-y-2">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                              Skills
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {selectedNode.user.parsed.skills.slice(0, 8).map((skill) => (
                                <span
                                  key={skill}
                                  className="rounded-full border border-white/12 bg-white/6 px-3 py-1 text-xs text-slate-200"
                                >
                                  {skill}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                              Experience
                            </div>
                            <div className="space-y-2">
                              {selectedNode.user.parsed.experience.slice(0, 3).map((entry) => (
                                <div key={`${entry.company}-${entry.title}`} className="rounded-2xl bg-white/5 p-3">
                                  <div className="font-medium text-white">{entry.title}</div>
                                  <div className="text-sm text-slate-300">{entry.company}</div>
                                  <div className="text-xs text-slate-500">{entry.dates}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
                              Education
                            </div>
                            <div className="space-y-2">
                              {selectedNode.user.parsed.education.slice(0, 3).map((entry) => (
                                <div key={`${entry.school}-${entry.degree}-${entry.major}`} className="rounded-2xl bg-white/5 p-3">
                                  <div className="font-medium text-white">{entry.school}</div>
                                  <div className="text-sm text-slate-300">
                                    {[entry.degree, entry.major].filter(Boolean).join(' - ') || 'Education record'}
                                  </div>
                                  <div className="text-xs text-slate-500">{entry.gradYear}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>

                {selectedNode.kind === 'profile' && selectedNode.profile ? (
                  <div className="rounded-[1.6rem] border border-white/12 bg-slate-950/55 p-4 text-sm leading-6 text-slate-300">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Signals</div>
                    <p className="mt-2">
                      {selectedNode.profile.mutualConnections > 0
                        ? `This connection is carrying ${selectedNode.profile.mutualConnections} mutual signal${selectedNode.profile.mutualConnections === 1 ? '' : 's'}.`
                        : 'This connection is lightly mapped, so it is a good candidate for a first outreach pass.'}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-[1.6rem] border border-dashed border-white/14 bg-slate-950/55 p-4 text-sm text-slate-300">
                The graph will populate here as soon as the extension returns a snapshot.
              </div>
            )}

            <div className="rounded-[1.6rem] border border-white/12 bg-slate-950/55 p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Legend</div>
              <div className="mt-3 space-y-3 text-sm text-slate-300">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)]" />
                  User profile anchor
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.85)]" />
                  Connection nodes
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-px w-6 bg-white/30" />
                  Spokes to the center
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
