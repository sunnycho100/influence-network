import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChangeEvent, CSSProperties } from 'react';

import { getGraphSnapshot, saveUserProfile } from '../lib/db';
import { hasLlmConfigured, parseResumeWithLlm } from '../lib/llm';
import { extractTextFromPdf, parseResumeTextToUserProfile } from '../lib/resume-parser';
import type { GraphSnapshot, Profile, UserProfile } from '@alumni-graph/shared';

import { getExtensionStats, type ExtensionStats } from './extensionStats';

type LayoutMode = 'orbit' | 'cards';
type FetchState = 'loading' | 'ready' | 'empty' | 'error';
type ResumeState = 'idle' | 'loading-file' | 'saving' | 'saved' | 'error';

function formatTimestamp(timestamp: number | null) {
  if (!timestamp || Number.isNaN(timestamp)) {
    return 'Not yet scraped';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getDegreeLabel(degree: 1 | 2 | 3 | null) {
  if (degree === 1) return '1st degree';
  if (degree === 2) return '2nd degree';
  if (degree === 3) return '3rd degree';
  return 'No connection degree';
}

function getHeadlineFallback(profile: Profile) {
  return (
    profile.currentTitle ||
    profile.currentCompany ||
    profile.location ||
    'Profile captured locally'
  );
}

export function Popup() {
  const [stats, setStats] = useState<ExtensionStats | null>(null);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [state, setState] = useState<FetchState>('loading');
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<LayoutMode>('orbit');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [resumeState, setResumeState] = useState<ResumeState>('idle');
  const [resumeFeedback, setResumeFeedback] = useState('');
  const [uploadedFileLabel, setUploadedFileLabel] = useState('');
  const resumeFileInputRef = useRef<HTMLInputElement | null>(null);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Load saved API key on mount
  useEffect(() => {
    chrome.storage.local.get('geminiApiKey').then((result) => {
      if (result.geminiApiKey) setApiKey(result.geminiApiKey as string);
    });
  }, []);

  const loadData = useCallback(async () => {
    setState('loading');
    setError('');

    const [statsResult, graphResult] = await Promise.allSettled([
      getExtensionStats(),
      getGraphSnapshot(),
    ]);

    const nextStats = statsResult.status === 'fulfilled' ? statsResult.value : null;
    const nextGraph = graphResult.status === 'fulfilled' ? graphResult.value : null;
    const nextError = [
      statsResult.status === 'rejected'
        ? statsResult.reason instanceof Error
          ? statsResult.reason.message
          : 'Unable to load extension stats'
        : '',
      graphResult.status === 'rejected'
        ? graphResult.reason instanceof Error
          ? graphResult.reason.message
          : 'Unable to load graph snapshot'
        : '',
    ]
      .filter(Boolean)
      .join(' • ');

    setStats(nextStats);
    setGraph(nextGraph);
    setError(nextError);

    if (nextGraph && nextGraph.profiles.length > 0) {
      setState('ready');
      return;
    }

    if (nextGraph) {
      setState('empty');
      return;
    }

    setState('error');
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Poll Dexie every 3 s — only trigger a full reload when stats actually change.
  useEffect(() => {
    let cancelled = false;
    let prevCount = stats?.profileCount ?? -1;
    let prevLastScraped = stats?.lastScrapedAt ?? -1;

    const id = setInterval(async () => {
      if (cancelled) return;
      try {
        const latest = await getExtensionStats();
        if (
          latest.profileCount !== prevCount ||
          (latest.lastScrapedAt ?? -1) !== prevLastScraped
        ) {
          prevCount = latest.profileCount;
          prevLastScraped = latest.lastScrapedAt ?? -1;
          void loadData();
        }
      } catch {
        /* swallow — next tick will retry */
      }
    }, 3_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loadData, stats?.profileCount, stats?.lastScrapedAt]);

  const profiles = graph?.profiles ?? [];
  const visibleProfiles = profiles.slice(0, 5);
  const userProfile = graph?.user ?? null;

  useEffect(() => {
    if (!profiles.length) {
      setSelectedProfileId(null);
      return;
    }

    const firstProfile = profiles[0];

    if (
      firstProfile &&
      (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId))
    ) {
      setSelectedProfileId(firstProfile.id);
    }
  }, [profiles, selectedProfileId]);

  const selectedProfile = useMemo(() => {
    if (!profiles.length) {
      return null;
    }

    return (
      profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null
    );
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!userProfile?.resumeText) {
      return;
    }

    if (!resumeText.trim()) {
      setResumeText(userProfile.resumeText);
    }
  }, [resumeText, userProfile]);

  const orbitNodes = useMemo<
    Array<{ profile: Profile; x: number; y: number; delay: number }>
  >(() => {
    const total = visibleProfiles.length;

    return visibleProfiles.map((profile, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
      const radius = total <= 2 ? 26 : total <= 4 ? 32 : 36;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;

      return {
        profile,
        x,
        y,
        delay: index * 70,
      };
    });
  }, [visibleProfiles]);

  const lastScrapedLabel = formatTimestamp(stats?.lastScrapedAt ?? null);
  const profileCount = stats?.profileCount ?? 0;
  const featuredCount = visibleProfiles.length;
  const remainingCount = Math.max(profiles.length - visibleProfiles.length, 0);
  const userLabel = graph?.user?.name ?? 'You';

  const openLinkedIn = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openResumeFilePicker = useCallback(() => {
    resumeFileInputRef.current?.click();
  }, []);

  const handleResumeFileSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setResumeState('loading-file');
    setResumeFeedback('');
    setUploadedFileLabel(file.name);

    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const nextText = isPdf ? await extractTextFromPdf(file) : await file.text();

      if (!nextText.trim()) {
        throw new Error('No readable text was found in the uploaded file.');
      }

      setResumeText(nextText.trim());
      setResumeState('idle');
      setResumeFeedback(`Loaded ${file.name}. Review the text, then save.`);
    } catch (uploadError) {
      setResumeState('error');
      setResumeFeedback(
        uploadError instanceof Error
          ? uploadError.message
          : 'Could not read the selected file.',
      );
    }
  }, []);

  const handleSaveResume = useCallback(async () => {
    const trimmedResume = resumeText.trim();
    if (!trimmedResume) {
      setResumeState('error');
      setResumeFeedback('Paste resume text or upload a PDF before saving.');
      return;
    }

    setResumeState('saving');
    setResumeFeedback('Parsing resume and recomputing warmness scores...');

    try {
      const parseOptions = userProfile?.name
        ? { fallbackName: userProfile.name }
        : undefined;

      let nextUserProfile: UserProfile;
      let parserUsed: 'gemini' | 'fallback' = 'fallback';

      if (await hasLlmConfigured()) {
        try {
          setResumeFeedback('Parsing resume with Gemini...');
          nextUserProfile = await parseResumeWithLlm(trimmedResume, parseOptions ?? {});
          parserUsed = 'gemini';
        } catch (llmError) {
          console.warn('Gemini resume parsing failed, falling back to regex parser', llmError);
          nextUserProfile = parseResumeTextToUserProfile(trimmedResume, parseOptions ?? {});
        }
      } else {
        nextUserProfile = parseResumeTextToUserProfile(trimmedResume, parseOptions ?? {});
      }

      await saveUserProfile(nextUserProfile);

      setResumeState('saved');
      setResumeFeedback(
        `Saved ${nextUserProfile.name} (parsed by ${parserUsed === 'gemini' ? 'Gemini' : 'local parser'}). ` +
          `${nextUserProfile.parsed.education.length} education entries, ` +
          `${nextUserProfile.parsed.experience.length} experience entries, ` +
          `${nextUserProfile.parsed.skills.length} skills.`,
      );

      await loadData();
    } catch (saveError) {
      setResumeState('error');
      setResumeFeedback(
        saveError instanceof Error ? saveError.message : 'Could not save your resume profile.',
      );
    }
  }, [loadData, resumeText, userProfile?.name]);

  const resumeStatusClass =
    resumeState === 'saved'
      ? 'resume-feedback-ok'
      : resumeState === 'error'
        ? 'resume-feedback-error'
        : 'resume-feedback-neutral';

  const topSkills = (profile: UserProfile | null): string => {
    if (!profile || profile.parsed.skills.length === 0) {
      return 'No skills parsed yet';
    }

    return profile.parsed.skills.slice(0, 4).join(' • ');
  };

  return (
    <main className="popup-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Influence Network</p>
          <h1>Local network</h1>
          <p className="lede">
            A compact local map of your alumni network. Node details and the latest scrape
            stats stay in view.
          </p>

          <div className="stat-strip" aria-label="Extension stats">
            <article className="stat-chip">
              <span className="stat-chip-label">Profiles</span>
              <strong>{formatCompactNumber(profileCount)}</strong>
            </article>
            <article className="stat-chip">
              <span className="stat-chip-label">Last scraped</span>
              <strong>{lastScrapedLabel}</strong>
            </article>
          </div>
        </div>

        <div className="hero-actions">
          <div className="mode-toggle" role="tablist" aria-label="Graph layout">
            <button
              type="button"
              className={`mode-toggle-option ${layout === 'orbit' ? 'is-active' : ''}`}
              onClick={() => setLayout('orbit')}
              aria-pressed={layout === 'orbit'}
            >
              Orbit
            </button>
            <button
              type="button"
              className={`mode-toggle-option ${layout === 'cards' ? 'is-active' : ''}`}
              onClick={() => setLayout('cards')}
              aria-pressed={layout === 'cards'}
            >
              Cards
            </button>
          </div>

          <div className="hero-pill">
            <span className="pill-dot" />
            Local only
          </div>
        </div>
      </section>

      <section className="panel resume-panel" aria-label="Resume profile setup">
        <div className="resume-panel-head">
          <div>
            <p className="panel-label">Phase 3 resume profile</p>
            <h2>Upload PDF or paste resume text</h2>
            <p className="panel-copy">
              This profile stays local and is used to compute warmness plus shared
              signals for scraped nodes.
            </p>
          </div>
          <div className="resume-panel-actions">
            <input
              ref={resumeFileInputRef}
              type="file"
              accept=".pdf,.txt,text/plain,application/pdf"
              className="resume-file-input"
              onChange={handleResumeFileSelected}
            />
            <button
              type="button"
              className="ghost-button"
              onClick={openResumeFilePicker}
              disabled={resumeState === 'loading-file' || resumeState === 'saving'}
            >
              Upload PDF/TXT
            </button>
            <button
              type="button"
              className="action-button"
              onClick={handleSaveResume}
              disabled={resumeState === 'loading-file' || resumeState === 'saving'}
            >
              {resumeState === 'saving' ? 'Saving...' : 'Save resume profile'}
            </button>
          </div>
        </div>

        <label className="resume-text-label" htmlFor="resume-input">
          Resume text
        </label>
        <textarea
          id="resume-input"
          className="resume-textarea"
          placeholder="Paste your resume text here if you do not upload a PDF."
          value={resumeText}
          onChange={(event) => setResumeText(event.target.value)}
          rows={7}
        />

        {(uploadedFileLabel || resumeFeedback) && (
          <p className={`resume-feedback ${resumeStatusClass}`}>
            {uploadedFileLabel ? `File: ${uploadedFileLabel}. ` : ''}
            {resumeFeedback}
          </p>
        )}

        {userProfile && (
          <div className="resume-summary" role="status">
            <div>
              <p className="panel-label">Saved user profile</p>
              <strong>{userProfile.name}</strong>
              {userProfile.email && <span>{userProfile.email}</span>}
            </div>
            <div>
              <p className="panel-label">Parsed data</p>
              <span>
                {userProfile.parsed.education.length} education • {userProfile.parsed.experience.length}{' '}
                roles • {userProfile.parsed.languages.length} languages
              </span>
              <span>{topSkills(userProfile)}</span>
            </div>
          </div>
        )}
      </section>

      {state === 'loading' && (
        <section className="panel panel-loading" aria-label="Loading graph data">
          <div className="skeleton skeleton-line" />
          <div className="stats-grid">
            <div className="skeleton-card">
              <div className="skeleton skeleton-kicker" />
              <div className="skeleton skeleton-value" />
              <div className="skeleton skeleton-subtitle" />
            </div>
            <div className="skeleton-card">
              <div className="skeleton skeleton-kicker" />
              <div className="skeleton skeleton-value" />
              <div className="skeleton skeleton-subtitle" />
            </div>
          </div>
          <div className="skeleton graph-stage" />
        </section>
      )}

      {state === 'error' && (
        <section className="panel panel-error" role="alert">
          <p className="panel-label">Could not load data</p>
          <h2>The popup could not read the current graph snapshot.</h2>
          <p className="panel-copy">
            {error || 'The extension store did not return the current network state.'}
          </p>
          <button type="button" className="action-button" onClick={loadData}>
            Retry
          </button>
        </section>
      )}

      {state === 'empty' && (
        <section className="panel panel-empty">
          <div className="empty-head">
            <div>
              <p className="panel-label">No profiles yet</p>
              <h2>Your graph is waiting for its first nodes.</h2>
              <p className="panel-copy">
                Start browsing LinkedIn profiles or alumni pages, then reopen this popup
                to see the map fill in.
              </p>
            </div>
            <button type="button" className="ghost-button" onClick={loadData}>
              Refresh
            </button>
          </div>

          <div className="graph-stage graph-stage-empty" aria-hidden="true">
            <div className="core-node core-node-empty">
              <span className="core-node-ring" />
              <strong>{userLabel}</strong>
              <span>Local graph hub</span>
            </div>
            <div className="empty-satellite empty-satellite-a" />
            <div className="empty-satellite empty-satellite-b" />
            <div className="empty-satellite empty-satellite-c" />
          </div>

          <div className="tip-list">
            <div className="tip-item">
              <span className="tip-index">1</span>
              Visit a profile or alumni page.
            </div>
            <div className="tip-item">
              <span className="tip-index">2</span>
              Let the scraper capture the visible profile details.
            </div>
            <div className="tip-item">
              <span className="tip-index">3</span>
              Reopen the popup to inspect the updated graph.
            </div>
          </div>
        </section>
      )}

      {state === 'ready' && stats && (
        <section className="panel panel-ready">
          <div className="panel-toolbar">
            <div>
              <p className="panel-label">Mind map</p>
              <h2>{layout === 'orbit' ? 'Compact orbital network' : 'Selected node cards'}</h2>
            </div>
            <button type="button" className="ghost-button" onClick={loadData}>
              Refresh
            </button>
          </div>

          <div className="graph-meta">
            <span>{featuredCount} featured nodes</span>
            <span>{remainingCount > 0 ? `${remainingCount} more hidden` : 'All nodes visible'}</span>
          </div>

          <div className={`graph-layout graph-layout-${layout}`}>
            {layout === 'orbit' ? (
              <section className="graph-stage" aria-label="Mind map view">
                <div className="graph-grid" />
                <div className="graph-ring graph-ring-a" />
                <div className="graph-ring graph-ring-b" />

                <button
                  type="button"
                  className="core-node"
                  onClick={() => setSelectedProfileId(profiles[0]?.id ?? null)}
                >
                  <span className="core-node-ring" />
                  <strong>{userLabel}</strong>
                  <span>{formatCompactNumber(profileCount)} profiles stored</span>
                </button>

                {orbitNodes.map(({ profile, x, y, delay }) => {
                  const isActive = selectedProfile?.id === profile.id;

                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`orbit-node ${isActive ? 'is-active' : ''}`}
                      style={
                        {
                          left: `${x}%`,
                          top: `${y}%`,
                          animationDelay: `${delay}ms`,
                        } as CSSProperties
                      }
                      onClick={() => setSelectedProfileId(profile.id)}
                      aria-pressed={isActive}
                      title={`${profile.name} — ${profile.currentCompany || profile.headline || ''}`}
                    >
                      <span className="orbit-node-name">{profile.name}</span>
                      <span className="orbit-node-meta">
                        {profile.currentCompany || profile.location || 'Captured locally'}
                      </span>
                    </button>
                  );
                })}
              </section>
            ) : (
              <section className="node-grid" aria-label="Node cards">
                {visibleProfiles.map((profile, index) => {
                  const isActive = selectedProfile?.id === profile.id;

                  return (
                    <button
                      key={profile.id}
                      type="button"
                      className={`profile-card ${isActive ? 'is-active' : ''}`}
                      onClick={() => setSelectedProfileId(profile.id)}
                      style={{ animationDelay: `${index * 60}ms` }}
                      aria-pressed={isActive}
                    >
                      <span className="profile-card-avatar">
                        {profile.profilePictureUrl ? (
                          <img src={profile.profilePictureUrl} alt="" loading="lazy" />
                        ) : (
                          getInitials(profile.name)
                        )}
                      </span>
                      <span className="profile-card-body">
                        <strong>{profile.name}</strong>
                        <span>{getHeadlineFallback(profile)}</span>
                        <small>{getDegreeLabel(profile.connectionDegree)}</small>
                      </span>
                    </button>
                  );
                })}
              </section>
            )}

            <aside className="detail-card" aria-label="Selected profile details">
              {selectedProfile ? (
                <>
                  <div className="detail-top">
                    <div>
                      <p className="panel-label">Selected node</p>
                      <h3>{selectedProfile.name}</h3>
                      <p className="detail-subtitle">{selectedProfile.headline}</p>
                    </div>

                    <div className="detail-avatar" aria-hidden="true">
                      {selectedProfile.profilePictureUrl ? (
                        <img
                          src={selectedProfile.profilePictureUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span>{getInitials(selectedProfile.name)}</span>
                      )}
                    </div>
                  </div>

                  <div className="detail-tags">
                    <span>{getDegreeLabel(selectedProfile.connectionDegree)}</span>
                    {selectedProfile.currentCompany && <span>{selectedProfile.currentCompany}</span>}
                    {selectedProfile.location && <span>{selectedProfile.location}</span>}
                  </div>

                  <div className="detail-stats">
                    <article>
                      <span className="detail-stat-label">Mutuals</span>
                      <strong>{formatCompactNumber(selectedProfile.mutualConnections)}</strong>
                    </article>
                    <article>
                      <span className="detail-stat-label">Scraped</span>
                      <strong>{formatTimestamp(selectedProfile.lastScraped)}</strong>
                    </article>
                  </div>

                  <div className="detail-section">
                    <p className="panel-label">Why it stands out</p>
                    <p className="panel-copy">
                      {selectedProfile.sharedSignals?.length
                        ? selectedProfile.sharedSignals.slice(0, 3).join(' · ')
                        : selectedProfile.experience[0]
                          ? `${selectedProfile.experience[0].title} at ${selectedProfile.experience[0].company}`
                          : 'This node has no additional signal tags yet.'}
                    </p>
                  </div>

                  <div className="detail-actions">
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => openLinkedIn(selectedProfile.linkedinUrl)}
                    >
                      Open LinkedIn
                    </button>
                    <button type="button" className="ghost-button" onClick={loadData}>
                      Sync again
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="panel-label">No node selected</p>
                  <h3>Click any node to inspect it.</h3>
                  <p className="panel-copy">
                    The details panel will show the profile headline, connection degree,
                    mutuals, and a quick profile link.
                  </p>
                </>
              )}
            </aside>
          </div>

          <div className="status-row">
            <div>
              <p className="panel-label">Storage status</p>
              <p className="panel-copy">
                {profileCount} {profileCount === 1 ? 'profile' : 'profiles'} stored locally.
                Ready for the web app bridge and graph rendering.
              </p>
            </div>
            <div className="status-actions">
              <button type="button" className="ghost-button" onClick={loadData}>
                Refresh data
              </button>
            </div>
          </div>
        </section>
      )}

      {state === 'ready' && stats && error && (
        <section className="panel panel-inline-warning" role="status">
          <p className="panel-label">Partial load</p>
          <p className="panel-copy">{error}</p>
        </section>
      )}

      {/* Settings toggle */}
      <section style={{ marginTop: 12, padding: '0 16px 16px' }}>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setShowSettings(!showSettings)}
          style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#94a3b8' }}
        >
          {showSettings ? '▾ Settings' : '▸ Settings'}
        </button>

        {showSettings && (
          <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#94a3b8', marginBottom: 6 }}>
              Gemini API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setApiKeySaved(false); }}
              placeholder="AIza..."
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(2,6,23,0.7)', color: '#e2e8f0', fontSize: 13, outline: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  chrome.storage.local.set({ geminiApiKey: apiKey }).then(() => {
                    setApiKeySaved(true);
                    setTimeout(() => setApiKeySaved(false), 2000);
                  });
                }}
                style={{ fontSize: 12, color: '#67e8f9' }}
              >
                Save key
              </button>
              {apiKeySaved && <span style={{ fontSize: 11, color: '#6ee7b7' }}>Saved!</span>}
            </div>
            <p style={{ marginTop: 6, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              Required for AI message generation. Get one at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: '#67e8f9', textDecoration: 'underline' }}>
                aistudio.google.com/apikey
              </a>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
