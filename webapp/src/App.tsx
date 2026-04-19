import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphSnapshot, Profile } from '@alumni-graph/shared';
import { extensionClient } from './lib/extension-client';
import {
  ALL_CONNECTION_KINDS,
  buildGraphLayout,
  getCanvasSize,
  getInitialsForNode,
  getNodeSummary,
  isSelfProfile,
  type ConnectionKind,
  type GraphNode,
} from './lib/graph-layout';
import { useDraggableNodePositions, type NodePos } from './lib/use-draggable-positions';
import { ChatWidget } from './ChatWidget';

/* ── Types ───────────────────────────────────── */

type LoadState = 'idle' | 'loading' | 'success' | 'error';
type MessageGenState = 'idle' | 'generating' | 'done' | 'error';

interface PingResult {
  version: string;
}

/* ── Constants ───────────────────────────────── */

const EMPTY_SNAPSHOT: GraphSnapshot = {
  profiles: [],
  user: null,
  messages: [],
};

const CANVAS = getCanvasSize();
const ACCENT = '#38BDF8';
const INK_4 = '#2A2A28';

const CONNECTION_LABELS: Record<ConnectionKind, string> = {
  company: 'Job',
  school: 'School',
  location: 'Location',
};

const CONNECTION_COLORS: Record<ConnectionKind, string> = {
  company: '#FAFAF7',  // ink-0 / white
  school: '#F5B14C',   // amber
  location: '#5EE6B5', // mint
};

/* ── Helpers ─────────────────────────────────── */

function warmthOpacity(warmth: number, isUser = false): number {
  if (isUser) return 1;
  if (warmth >= 80) return 0.95;
  if (warmth >= 60) return 0.75;
  if (warmth >= 40) return 0.55;
  if (warmth >= 20) return 0.35;
  return 0.18;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function formatTime(timestamp?: number | null) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function companyFromProfile(profile: Profile) {
  return (
    profile.currentCompany?.trim() ||
    profile.experience[0]?.company?.trim() ||
    profile.scrapedFrom ||
    'Unknown'
  );
}

function getSelectedNode(snapshot: GraphSnapshot | null, selectedId: string): GraphNode | null {
  if (!snapshot) return null;

  if (selectedId === 'me') {
    if (!snapshot.user) return null;
    const selfProfile = snapshot.profiles.find((p) => isSelfProfile(p, snapshot.user));
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
      hue: 0,
      warmth: 100,
      user: snapshot.user,
      ...(selfProfile ? { profile: selfProfile } : {}),
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

/* ── Node Button ─────────────────────────────── */

function NodeButton({
  node,
  pos,
  active,
  related = false,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  node: GraphNode;
  pos: NodePos;
  active: boolean;
  related?: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, evt: React.PointerEvent) => void;
  onDragMove: (id: string, evt: React.PointerEvent) => void;
  onDragEnd: (id: string, didDrag: boolean) => void;
}) {
  const isUser = node.kind === 'user';
  const photo = node.profile?.profilePictureUrl;
  const size = isUser ? 48 : 40;
  const ringColor = active ? ACCENT : related ? 'rgba(56,189,248,0.45)' : INK_4;
  const staticShadow = active
    ? `0 0 0 1px ${ACCENT}, 0 0 18px rgba(56,189,248,0.55)`
    : 'none';
  const draggedRef = useRef(false);

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        draggedRef.current = false;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        onDragStart(node.id, e);
      }}
      onPointerMove={(e) => {
        if (!(e.buttons & 1)) return;
        draggedRef.current = true;
        onDragMove(node.id, e);
      }}
      onPointerUp={(e) => {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        const didDrag = draggedRef.current;
        onDragEnd(node.id, didDrag);
        if (!didDrag) onSelect(node.id);
      }}
      onPointerCancel={() => onDragEnd(node.id, draggedRef.current)}
      aria-pressed={active}
      className={[
        'absolute -translate-x-1/2 -translate-y-1/2 group flex flex-col items-center gap-2',
        'outline-none transition-colors duration-150 touch-none select-none cursor-grab active:cursor-grabbing',
        active ? 'z-20' : 'z-10 hover:z-20',
      ].join(' ')}
      style={{
        left: `${(pos.x / CANVAS.width) * 100}%`,
        top: `${(pos.y / CANVAS.height) * 100}%`,
      }}
    >
      <div
        className={['overflow-hidden shrink-0', related && !active ? 'animate-shimmer' : ''].join(' ')}
        style={{
          width: size,
          height: size,
          borderRadius: '999px',
          border: `1px solid ${ringColor}`,
          boxShadow: staticShadow,
        }}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            className="w-full h-full object-cover pointer-events-none select-none"
            referrerPolicy="no-referrer"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{ opacity: active ? 1 : 0.85, WebkitUserDrag: 'none' } as React.CSSProperties}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center font-display text-[11px] font-medium tracking-tight"
            style={{
              background: '#111110',
              color: active ? '#FAFAF7' : '#9A9A93',
            }}
          >
            {getInitialsForNode(node)}
          </div>
        )}
      </div>
      <span
        className={[
          'font-mono text-[10px] uppercase tracking-[0.12em] max-w-[88px] truncate text-center leading-tight',
          active ? 'text-ink-0' : related ? 'text-ink-1' : 'text-ink-3 group-hover:text-ink-1',
        ].join(' ')}
      >
        {isUser ? 'You' : node.label.split(' ')[0]}
      </span>
    </button>
  );
}

/* ── App ─────────────────────────────────────── */

export default function App() {
  const [bridgeState, setBridgeState] = useState<LoadState>('idle');
  const [graphState, setGraphState] = useState<LoadState>('idle');
  const [ping, setPing] = useState<PingResult | null>(null);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('me');
  const [error, setError] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [minWarmness, setMinWarmness] = useState(0);
  const [activeConnectionKinds, setActiveConnectionKinds] = useState<Set<ConnectionKind>>(
    () => new Set(ALL_CONNECTION_KINDS),
  );

  const [msgByProfile, setMsgByProfile] = useState<
    Record<string, { state: MessageGenState; draft: string; error: string }>
  >({});
  const [copiedMsg, setCopiedMsg] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Derived state ── */

  const filteredSnapshot = useMemo<GraphSnapshot>(() => {
    if (!snapshot) return EMPTY_SNAPSHOT;
    const q = searchQuery.toLowerCase();
    const cf = companyFilter.toLowerCase();
    const filtered = snapshot.profiles.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.headline.toLowerCase().includes(q)) return false;
      if (cf && companyFromProfile(p).toLowerCase() !== cf) return false;
      if ((p.warmnessScore ?? 0) < minWarmness) return false;
      return true;
    });
    return { ...snapshot, profiles: filtered };
  }, [snapshot, searchQuery, companyFilter, minWarmness]);

  const layout = useMemo(
    () => buildGraphLayout(filteredSnapshot, { connectionKinds: [...activeConnectionKinds] }),
    [filteredSnapshot, activeConnectionKinds],
  );

  const { positions: nodePositions, moveNode, beginDrag, endDrag } =
    useDraggableNodePositions(layout.nodes);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const pointerToCanvas = useCallback((evt: React.PointerEvent): NodePos | null => {
    const el = canvasRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((evt.clientX - rect.left) / rect.width) * CANVAS.width,
      y: ((evt.clientY - rect.top) / rect.height) * CANVAS.height,
    };
  }, []);

  const handleNodeDragStart = useCallback(
    (id: string, _evt: React.PointerEvent) => {
      if (id === 'me') return;
      beginDrag(id);
    },
    [beginDrag],
  );

  const handleNodeDragMove = useCallback(
    (id: string, evt: React.PointerEvent) => {
      if (id === 'me') return;
      const p = pointerToCanvas(evt);
      if (!p) return;
      moveNode(id, p.x, p.y);
    },
    [moveNode, pointerToCanvas],
  );

  const handleNodeDragEnd = useCallback(
    (_id: string, _didDrag: boolean) => {
      endDrag();
    },
    [endDrag],
  );

  const selectedNode = useMemo(
    () => getSelectedNode(snapshot, selectedId),
    [snapshot, selectedId],
  );

  // Set of node ids visually "related" to the selected node — anyone joined
  // by a school/location/company edge in the current layout. Used to drive
  // the orange ring + edge highlight.
  const relatedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    for (const edge of layout.edges) {
      if (edge.kind === 'spoke') continue;
      if (edge.source === selectedId) ids.add(edge.target);
      else if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [layout.edges, selectedId]);

  const summary = useMemo(() => {
    const profiles = snapshot?.profiles ?? [];
    const companies = new Set(profiles.map(companyFromProfile));
    const latestScrape = profiles.reduce<number | null>((max, profile) => {
      return max === null ? profile.lastScraped : Math.max(max, profile.lastScraped);
    }, null);
    return {
      profileCount: profiles.length,
      companyCount: companies.size,
      messageCount: snapshot?.messages?.length ?? 0,
      latestScrape,
    };
  }, [snapshot]);

  const allCompanies = useMemo(() => {
    const companies = new Set((snapshot?.profiles ?? []).map(companyFromProfile));
    return [...companies].sort();
  }, [snapshot]);

  /* ── Data loading ── */

  const loadGraph = useCallback(async () => {
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
    } else {
      setSnapshot(null);
      setGraphState('error');
      setError(graphResult.reason instanceof Error ? graphResult.reason.message : 'Graph load failed');
    }

    if (graphResult.status === 'rejected' && pingResult.status === 'rejected') {
      setError(
        pingResult.reason instanceof Error
          ? pingResult.reason.message
          : 'Unable to reach the extension bridge',
      );
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      void loadGraph();
    }, 5_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadGraph]);

  useEffect(() => {
    if (!snapshot) return;
    if (selectedId === 'me' && snapshot.user) return;
    if (selectedId !== 'me' && snapshot.profiles.some((p) => p.id === selectedId)) return;
    setSelectedId(snapshot.user ? 'me' : snapshot.profiles[0]?.id ?? '');
  }, [snapshot, selectedId]);

  /* ── Handlers ── */

  const connectionStatus =
    bridgeState === 'success' ? 'LINKED' : bridgeState === 'error' ? 'OFFLINE' : 'CHECKING';

  const handleGenerateMessage = useCallback(async (profileId: string) => {
    setMsgByProfile((prev) => ({
      ...prev,
      [profileId]: { state: 'generating', draft: '', error: '' },
    }));
    setCopiedMsg(false);
    try {
      const result = await extensionClient.generateMessage(profileId);
      setMsgByProfile((prev) => ({
        ...prev,
        [profileId]: { state: 'done', draft: result.draft, error: '' },
      }));
    } catch (err) {
      setMsgByProfile((prev) => ({
        ...prev,
        [profileId]: {
          state: 'error',
          draft: '',
          error: err instanceof Error ? err.message : 'Message generation failed',
        },
      }));
    }
  }, []);

  const handleDraftChange = useCallback((profileId: string, draft: string) => {
    setMsgByProfile((prev) => ({
      ...prev,
      [profileId]: { ...(prev[profileId] ?? { state: 'done', error: '' }), draft, state: 'done', error: '' },
    }));
  }, []);

  const handleDismissDraft = useCallback((profileId: string) => {
    setMsgByProfile((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
  }, []);

  const handleCopyDraft = useCallback((draft: string) => {
    void navigator.clipboard.writeText(draft).then(() => {
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2000);
    });
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const { profiles } = await extensionClient.exportData();
      const blob = new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `influence-network-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }, []);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const profiles = JSON.parse(text);
        if (!Array.isArray(profiles)) throw new Error('Expected an array of profiles');
        const { imported } = await extensionClient.importData(profiles);
        setError('');
        void loadGraph();
        alert(`Imported ${imported} profiles`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Import failed');
      }
      e.target.value = '';
    },
    [loadGraph],
  );

  const hasFilters = searchQuery || companyFilter || minWarmness > 0;

  /* ── Render ── */

  return (
    <main className="flex flex-col h-screen bg-surface text-ink-1 overflow-hidden dot-grid">
      {/* ── Top bar ── */}
      <header className="relative z-30 flex items-center justify-between h-12 pl-5 pr-4 border-b border-hairline shrink-0">
        <div className="flex items-stretch gap-5 h-full">
          <div className="flex items-center gap-3">
            <span
              aria-label={connectionStatus}
              className="block w-[6px] h-[6px]"
              style={{
                background:
                  connectionStatus === 'LINKED'
                    ? ACCENT
                    : connectionStatus === 'OFFLINE'
                      ? '#5C5C57'
                      : '#9A9A93',
              }}
            />
            <h1 className="text-[13px] font-display font-medium tracking-tight text-ink-0">
              Influence Network
            </h1>
            {ping && (
              <span className="text-[10px] font-mono text-ink-3 tracking-[0.1em]">
                v{ping.version}
              </span>
            )}
          </div>

          <div className="hidden md:flex items-center pl-5 border-l border-hairline">
            <span className="font-mono text-[10px] tracking-[0.18em] text-ink-2 uppercase">
              {pad2(summary.profileCount)} profiles
              <span className="text-ink-4 mx-2">—</span>
              {pad2(summary.companyCount)} companies
              <span className="text-ink-4 mx-2">—</span>
              {pad2(summary.messageCount)} messages
            </span>
          </div>
        </div>

        <nav className="flex items-stretch h-full">
          <button
            type="button"
            onClick={loadGraph}
            className="px-4 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-2 hover:text-ink-0 transition-colors border-l border-hairline"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-4 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-2 hover:text-ink-0 transition-colors border-l border-hairline"
          >
            Export
          </button>
          <label className="px-4 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-2 hover:text-ink-0 transition-colors border-l border-hairline cursor-pointer inline-flex items-center">
            Import
            <input type="file" accept=".json" className="hidden" onChange={handleImport} />
          </label>
        </nav>
      </header>

      {/* ── Sub-header filter bar ── */}
      <div className="relative z-20 flex items-center gap-6 h-10 px-5 border-b border-hairline shrink-0">
        <div className="flex items-center gap-2">
          <span className="label">Search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="name or headline…"
            className="w-44 h-7 px-0 text-[12px] text-ink-1 placeholder:text-ink-3 border-0 border-b border-hairline focus:border-accent focus:outline-none transition-colors bg-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="label">Company</span>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="h-7 px-0 pr-4 text-[12px] text-ink-1 border-0 border-b border-hairline focus:border-accent focus:outline-none transition-colors appearance-none bg-transparent"
          >
            <option value="" className="bg-surface">All</option>
            {allCompanies.map((c) => (
              <option key={c} value={c} className="bg-surface">{c}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="label">Warmth ≥</span>
          <input
            type="range"
            min={0}
            max={100}
            value={minWarmness}
            onChange={(e) => setMinWarmness(Number(e.target.value))}
            className="slim w-24"
          />
          <span className="font-mono text-[11px] text-ink-1 tabular-nums w-6 text-right">
            {pad2(minWarmness)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="label">Connect</span>
          <div className="flex items-center gap-1">
            {ALL_CONNECTION_KINDS.map((kind) => {
              const active = activeConnectionKinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setActiveConnectionKinds((prev) => {
                      const next = new Set(prev);
                      if (next.has(kind)) next.delete(kind);
                      else next.add(kind);
                      return next;
                    });
                  }}
                  aria-pressed={active}
                  className="flex items-center gap-1.5 px-2 h-6 font-mono text-[10px] uppercase tracking-[0.14em] border transition-colors"
                  style={{
                    color: active ? '#FAFAF7' : '#5C5C57',
                    borderColor: active ? CONNECTION_COLORS[kind] : '#2A2A28',
                  }}
                >
                  <span
                    className="block w-[6px] h-[6px]"
                    style={{ background: active ? CONNECTION_COLORS[kind] : '#2A2A28' }}
                  />
                  {CONNECTION_LABELS[kind]}
                </button>
              );
            })}
          </div>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => { setSearchQuery(''); setCompanyFilter(''); setMinWarmness(0); }}
            className="ml-auto font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 hover:text-accent transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="relative flex-1 grid grid-cols-[1fr_380px] overflow-hidden">
        {/* ── Graph canvas ── */}
        <div className="relative overflow-hidden border-r border-hairline">
          {/* Error banner */}
          {error && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md px-4 py-2 border border-accent text-[11px] font-mono uppercase tracking-[0.1em] text-accent bg-surface">
              {error}
            </div>
          )}

          {/* Graph SVG + Nodes */}
          <div className="absolute inset-0" ref={canvasRef}>
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 1200 900"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {layout.edges.map((edge) => {
                const source = layout.nodes.find((n) => n.id === edge.source);
                const target = layout.nodes.find((n) => n.id === edge.target);
                if (!source || !target) return null;
                const sPos = nodePositions[source.id] ?? { x: source.x, y: source.y };
                const tPos = nodePositions[target.id] ?? { x: target.x, y: target.y };

                const isActive =
                  selectedNode && (selectedNode.id === source.id || selectedNode.id === target.id);
                const sameCompany =
                  selectedNode?.kind === 'profile' &&
                  ((source.kind === 'profile' && source.company === selectedNode.company) ||
                    (target.kind === 'profile' && target.company === selectedNode.company));
                // Edge counts as related if it joins the selected node to one
                // of its cluster peers (school/location/company), or shares the
                // selected node's company.
                const joinsCluster =
                  !!selectedId &&
                  edge.kind !== 'spoke' &&
                  (source.id === selectedId || target.id === selectedId) &&
                  (relatedIds.has(source.id) || relatedIds.has(target.id));
                const isRelated = !isActive && (!!sameCompany || joinsCluster);
                const targetNode = target.kind === 'profile' ? target : source;
                const opacity =
                  edge.kind === 'spoke'
                    ? warmthOpacity(targetNode.warmth, targetNode.kind === 'user')
                    : 0.18;

                const baseStroke =
                  edge.kind === 'spoke'
                    ? '#FAFAF7'
                    : CONNECTION_COLORS[edge.kind];

                return (
                  <line
                    key={edge.id}
                    x1={sPos.x}
                    y1={sPos.y}
                    x2={tPos.x}
                    y2={tPos.y}
                    stroke={isActive || isRelated ? ACCENT : baseStroke}
                    strokeWidth={isActive ? 1 : isRelated ? 0.7 : 0.5}
                    strokeOpacity={isActive ? 0.9 : isRelated ? 0.45 : opacity * 0.5}
                  />
                );
              })}
            </svg>

            <div className="absolute inset-0">
              {layout.nodes.map((node) => {
                const isActive = selectedNode?.id === node.id;
                const isRelated =
                  !isActive &&
                  (relatedIds.has(node.id) ||
                    (!!selectedNode &&
                      node.kind === 'profile' &&
                      selectedNode.kind === 'profile' &&
                      node.company === selectedNode.company));
                const pos = nodePositions[node.id] ?? { x: node.x, y: node.y };
                return (
                  <NodeButton
                    key={node.id}
                    node={node}
                    pos={pos}
                    active={isActive}
                    related={isRelated}
                    onSelect={setSelectedId}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              })}
            </div>
          </div>

          {/* Empty state */}
          {!layout.nodes.length && graphState !== 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="label">No data</div>
                <p className="text-[13px] text-ink-2 max-w-[260px]">
                  Start scraping profiles from LinkedIn to populate the network.
                </p>
              </div>
            </div>
          )}

          {/* Loading state */}
          {graphState === 'loading' && !layout.nodes.length && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-3">
                Connecting…
              </div>
            </div>
          )}

          {/* Bottom status */}
          <div className="absolute bottom-3 left-5 z-10 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-3">
            {pad2(layout.companies.length)} clusters
            <span className="text-ink-4 mx-2">—</span>
            {pad2(layout.nodes.length)} nodes
            <span className="text-ink-4 mx-2">—</span>
            synced {formatTime(lastLoadedAt)}
          </div>
        </div>

        {/* ── Detail rail ── */}
        <aside className="relative z-20 bg-surface overflow-y-auto panel-scroll">
          {selectedNode ? (
            <div className="px-6 py-7 space-y-7">
              {/* Eyebrow */}
              <div className="label">
                {selectedNode.kind === 'user' ? 'Your profile' : `Connection · ${selectedNode.company}`}
              </div>

              {/* Header */}
              <div className="flex items-start gap-4">
                <div
                  className="w-14 h-14 rounded-full overflow-hidden shrink-0"
                  style={{ border: `1px solid ${selectedNode.kind === 'user' ? ACCENT : INK_4}` }}
                >
                  {selectedNode.profile?.profilePictureUrl ? (
                    <img
                      src={selectedNode.profile.profilePictureUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-display text-base text-ink-0 bg-[#111110]">
                      {getInitialsForNode(selectedNode)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 pt-0.5 flex-1">
                  <h2 className="text-[24px] font-display font-medium text-ink-0 leading-[1.15] tracking-tight truncate">
                    {selectedNode.label}
                  </h2>
                  <p className="text-[13px] text-ink-2 mt-1.5 leading-[1.55] line-clamp-2">
                    {selectedNode.kind === 'user'
                      ? getNodeSummary(selectedNode)
                      : selectedNode.subtitle}
                  </p>
                </div>
              </div>

              {/* ── Profile node ── */}
              {selectedNode.kind === 'profile' && selectedNode.profile && (
                <>
                  {selectedNode.profile.headline && (
                    <p className="text-[13px] text-ink-1 leading-[1.6]">
                      {selectedNode.profile.headline}
                    </p>
                  )}

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNode.profile.connectionDegree != null && (
                      <span className="px-2 py-0.5 border border-hairline rounded-chip font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
                        {selectedNode.profile.connectionDegree === 1 ? '1st degree' : selectedNode.profile.connectionDegree === 2 ? '2nd degree' : '3rd degree'}
                      </span>
                    )}
                    {selectedNode.profile.location && (
                      <span className="px-2 py-0.5 border border-hairline rounded-chip font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
                        {selectedNode.profile.location}
                      </span>
                    )}
                  </div>

                  {/* Data list */}
                  <dl className="border-t border-hairline">
                    <div className="flex items-center justify-between py-3 border-b border-hairline">
                      <dt className="label">Warmth</dt>
                      <dd className="flex items-center gap-3">
                        <div className="w-[120px] h-[2px] bg-ink-4">
                          <div
                            className="h-full bg-accent transition-[width] duration-500"
                            style={{ width: `${selectedNode.profile.warmnessScore ?? 0}%` }}
                          />
                        </div>
                        <span className="font-mono text-[13px] text-ink-0 tabular-nums w-7 text-right">
                          {pad2(selectedNode.profile.warmnessScore ?? 0)}
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-hairline">
                      <dt className="label">Mutuals</dt>
                      <dd className="font-mono text-[13px] text-ink-0 tabular-nums">
                        {pad2(selectedNode.profile.mutualConnections)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-hairline">
                      <dt className="label">Source</dt>
                      <dd className="font-mono text-[11px] text-ink-1 truncate max-w-[180px]">
                        {selectedNode.profile.scrapedFrom}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-hairline">
                      <dt className="label">Scraped</dt>
                      <dd className="font-mono text-[11px] text-ink-1">
                        {formatTime(selectedNode.profile.lastScraped)}
                      </dd>
                    </div>
                  </dl>

                  {/* Shared signals */}
                  {(selectedNode.profile.sharedSignals?.length ?? 0) > 0 && (
                    <div className="space-y-2.5">
                      <div className="label">Shared signals</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNode.profile.sharedSignals!.map((signal) => (
                          <span
                            key={signal}
                            className="px-2 py-0.5 border border-accent/60 rounded-chip font-mono text-[10px] uppercase tracking-[0.1em] text-ink-1"
                          >
                            {signal}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <a
                      href={selectedNode.profile.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center h-9 border border-hairline rounded-chip font-mono text-[10px] tracking-[0.18em] uppercase text-ink-1 hover:border-ink-1 hover:text-ink-0 transition-colors"
                    >
                      LinkedIn ↗
                    </a>
                    {(() => {
                      const pid = selectedNode.profile.id;
                      const entry = msgByProfile[pid];
                      const isGen = entry?.state === 'generating';
                      const isDone = entry?.state === 'done';
                      return (
                        <button
                          type="button"
                          onClick={() => handleGenerateMessage(pid)}
                          disabled={isGen}
                          className="inline-flex items-center justify-center h-9 border border-accent rounded-chip font-mono text-[10px] tracking-[0.18em] uppercase text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          {isGen ? 'Drafting…' : isDone ? 'Regenerate' : 'Compose'}
                        </button>
                      );
                    })()}
                  </div>

                  {/* Message draft */}
                  {(() => {
                    const pid = selectedNode.profile.id;
                    const entry = msgByProfile[pid];
                    if (!entry) return null;
                    return (
                      <div className="border border-hairline p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="label" style={{ color: ACCENT }}>Draft</span>
                          <span className="font-mono text-[10px] text-ink-3 tabular-nums">
                            {entry.draft.length}/280
                            {entry.draft.length > 280 && (
                              <span className="text-accent ml-1">over</span>
                            )}
                          </span>
                        </div>
                        {entry.state === 'generating' && (
                          <p className="text-[13px] text-ink-2">Generating personalised message…</p>
                        )}
                        {entry.state === 'error' && (
                          <p className="text-[13px] text-accent">{entry.error}</p>
                        )}
                        {entry.state === 'done' && (
                          <>
                            <textarea
                              value={entry.draft}
                              onChange={(e) => handleDraftChange(pid, e.target.value)}
                              rows={5}
                              className="w-full resize-y border border-hairline p-3 text-[13px] text-ink-1 leading-[1.55] focus:outline-none focus:border-ink-2 transition-colors"
                            />
                            <div className="flex items-center justify-end gap-4">
                              <button
                                type="button"
                                onClick={() => handleDismissDraft(pid)}
                                className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-3 hover:text-ink-1 transition-colors"
                              >
                                Dismiss
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyDraft(entry.draft)}
                                className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent hover:text-ink-0 transition-colors"
                              >
                                {copiedMsg ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* ── User node ── */}
              {selectedNode.kind === 'user' && selectedNode.user && (
                <>
                  <dl className="border-t border-hairline">
                    <div className="flex items-start justify-between gap-4 py-3 border-b border-hairline">
                      <dt className="label pt-0.5">Target companies</dt>
                      <dd className="text-[12px] text-ink-1 text-right max-w-[220px] leading-[1.5]">
                        {selectedNode.user.targetCompanies.slice(0, 4).join(', ') || '—'}
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-4 py-3 border-b border-hairline">
                      <dt className="label pt-0.5">Target roles</dt>
                      <dd className="text-[12px] text-ink-1 text-right max-w-[220px] leading-[1.5]">
                        {selectedNode.user.targetRoles.slice(0, 4).join(', ') || '—'}
                      </dd>
                    </div>
                  </dl>

                  {selectedNode.user.parsed.skills.length > 0 && (
                    <div className="space-y-2.5">
                      <div className="label">Skills</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedNode.user.parsed.skills.slice(0, 12).map((skill) => (
                          <span
                            key={skill}
                            className="px-2 py-0.5 border border-hairline rounded-chip font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedNode.user.parsed.experience.length > 0 && (
                    <div className="space-y-3">
                      <div className="label">Experience</div>
                      <div className="space-y-0">
                        {selectedNode.user.parsed.experience.slice(0, 4).map((entry, i) => (
                          <div
                            key={`${entry.company}-${entry.title}-${i}`}
                            className="py-3 border-t border-hairline"
                          >
                            <div className="text-[13px] font-display font-medium text-ink-0 leading-tight">
                              {entry.title}
                            </div>
                            <div className="text-[12px] text-ink-2 mt-1">{entry.company}</div>
                            <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-3 mt-1">
                              {entry.dates}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedNode.user.parsed.education.length > 0 && (
                    <div className="space-y-3">
                      <div className="label">Education</div>
                      <div className="space-y-0">
                        {selectedNode.user.parsed.education.slice(0, 3).map((entry, i) => (
                          <div
                            key={`${entry.school}-${entry.degree}-${entry.major}-${i}`}
                            className="py-3 border-t border-hairline"
                          >
                            <div className="text-[13px] font-display font-medium text-ink-0 leading-tight">
                              {entry.school}
                            </div>
                            <div className="text-[12px] text-ink-2 mt-1">
                              {[entry.degree, entry.major].filter(Boolean).join(' · ') || 'Education'}
                            </div>
                            <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-3 mt-1">
                              {entry.gradYear}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full px-6">
              <div className="text-center space-y-2">
                <div className="label">No selection</div>
                <p className="text-[12px] text-ink-3">
                  {graphState === 'loading' ? 'Syncing with extension…' : `${pad2(summary.profileCount)} profiles loaded`}
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
      <ChatWidget onSelectProfile={(profileId) => setSelectedId(profileId)} />
    </main>
  );
}
