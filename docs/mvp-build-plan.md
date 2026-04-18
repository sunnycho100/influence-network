# AlumniGraph — MVP Build Plan

*Copy this file from a Markdown or “raw” view (not rich-text preview) so fenced code blocks, tables, and numbered lists stay valid when pasted elsewhere.*

**Architecture:** Chrome extension (scraper) + web app (visualizer), communicating via `externally_connectable`
**Scope:** Personal-use
**Target build time:** 3–4 weeks with a coding agent

---

## What we're building

A two-part system for building and visualizing a personal mind-map of LinkedIn connections:

1. **Chrome extension** — scrapes LinkedIn profile data as the user browses, stores it locally in IndexedDB, and acts as the source of truth.
2. **Web app** — full-screen React app (localhost in dev, optionally deployed) that queries the extension for graph data and renders an interactive Cytoscape mind-map with node click → AI-powered "Generate Message" for personalized LinkedIn outreach.

The two components communicate directly via `chrome.runtime.sendMessage` using the extension's `externally_connectable` manifest key. **No backend, no cloud, no auth.** Data stays on the user's machine.

---

## User flow

1. Install extension → upload resume (PDF or text) in extension popup.
2. Resume parser (LLM call) extracts education, experience, skills, clubs, hometown. Stored locally in extension's IndexedDB.
3. User browses LinkedIn normally → content script detects profile pages and search results, extracts visible data, stores in IndexedDB.
4. Optional active scan: on a LinkedIn school/alumni page, click "Scan" to paginated-scrape with throttling.
5. User opens the web app (`localhost:5173` in dev).
6. Web app sends `GET_GRAPH` message to extension → extension returns full graph from IndexedDB.
7. Web app renders full-screen Cytoscape force-directed graph, clustered by company, sized by warmness score.
8. Click a node → detail panel with person's headline, experience, shared signals, warmness score.
9. Click `+ Generate Message` → web app sends `GENERATE_MESSAGE` to extension → extension calls LLM API → returns draft.
10. User reviews/edits, copies to clipboard, sends manually via LinkedIn's own UI.

---

## Monorepo structure

```text
alumni-graph/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── extension/                # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── vite.config.ts
│   ├── package.json
│   ├── public/
│   │   └── icons/ (16/32/48/128)
│   └── src/
│       ├── background/
│       │   └── service-worker.ts      # LLM calls, message routing, external message handler
│       ├── content/
│       │   ├── index.ts               # Entry point; route detection via MutationObserver
│       │   ├── scrapers/
│       │   │   ├── profile-page.ts
│       │   │   ├── search-results.ts
│       │   │   └── alumni-page.ts
│       │   └── ui/
│       │       └── scan-button.tsx    # Floating "Scan" button injected on alumni pages
│       ├── popup/
│       │   ├── index.html
│       │   └── Popup.tsx              # Resume upload, profile count, API key settings
│       ├── lib/
│       │   ├── db.ts                  # Dexie schema + queries
│       │   ├── llm.ts                 # Anthropic/Gemini client
│       │   ├── prompts.ts             # Prompt templates
│       │   ├── warmness.ts            # Scoring algorithm
│       │   ├── resume-parser.ts       # pdf.js + LLM
│       │   ├── throttle.ts            # Rate limiter
│       │   └── messaging.ts           # External message handler
│       └── types/
│           └── models.ts              # Imports from shared/
├── webapp/                   # React + Vite web app (visualizer)
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── MindMap.tsx            # Cytoscape full-screen graph
│       │   ├── NodeDetails.tsx        # Side panel on node click
│       │   ├── MessageComposer.tsx    # AI draft + edit + copy
│       │   ├── FilterBar.tsx          # Company, school, warmness filters
│       │   ├── StatsPanel.tsx         # Graph stats
│       │   └── ExtensionBridge.tsx    # Connection status indicator
│       ├── hooks/
│       │   ├── useGraphData.ts        # Polls extension for graph updates
│       │   └── useExtensionBridge.ts  # Wraps chrome.runtime.sendMessage
│       ├── lib/
│       │   ├── extension-client.ts    # Typed API to the extension
│       │   └── graph-layout.ts        # Cytoscape layout config
│       └── types/                     # Imports from shared/
└── shared/                   # Shared TypeScript types + utils
    ├── package.json
    └── src/
        ├── models.ts                  # Profile, UserProfile, GeneratedMessage
        ├── messages.ts                # Message types between extension ↔ webapp
        └── warmness.ts                # Shared scoring logic (used by both)
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Extension framework | Manifest V3 |
| Extension build | Vite + `@crxjs/vite-plugin` |
| Web app build | Vite + React 18 |
| Language | TypeScript |
| UI | React 18 + Tailwind CSS |
| Graph viz | Cytoscape.js (use `cytoscape-cose-bilkent` layout) |
| Local DB | Dexie.js (IndexedDB wrapper) |
| PDF parsing | pdf.js |
| LLM API | Gemini 2.5 Flash fallback |
| State | Zustand |
| Auth | None |

---

## Extension ↔ Web app communication

### Extension `manifest.json` (key parts)

```json
{
  "manifest_version": 3,
  "name": "AlumniGraph",
  "version": "0.1.0",
  "permissions": ["storage", "scripting", "activeTab", "tabs"],
  "host_permissions": ["https://www.linkedin.com/*"],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/*"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "src/popup/index.html" },
  "externally_connectable": {
    "matches": [
      "http://localhost:5173/*",
      "https://alumni-graph.vercel.app/*"
    ]
  }
}
```

### Extension service worker (message handler)

```typescript
// extension/src/background/service-worker.ts

import { db } from '../lib/db';
import { generateMessage } from '../lib/llm';
import type { ExtensionMessage, ExtensionResponse } from '@shared/messages';

chrome.runtime.onMessageExternal.addListener(
  async (
    msg: ExtensionMessage,
    sender,
    sendResponse: (r: ExtensionResponse) => void
  ) => {
    // Optional: verify sender.url matches expected origins
    if (!isAllowedOrigin(sender.url)) {
      sendResponse({ ok: false, error: 'unauthorized_origin' });
      return;
    }

    try {
      switch (msg.type) {
        case 'GET_GRAPH': {
          const profiles = await db.profiles.toArray();
          const user = await db.userProfile.get('me');
          sendResponse({ ok: true, data: { profiles, user } });
          break;
        }
        case 'GET_PROFILE': {
          const profile = await db.profiles.get(msg.profileId);
          sendResponse({ ok: true, data: profile });
          break;
        }
        case 'GENERATE_MESSAGE': {
          const profile = await db.profiles.get(msg.profileId);
          const user = await db.userProfile.get('me');
          if (!profile || !user) {
            sendResponse({ ok: false, error: 'missing_data' });
            return;
          }
          const draft = await generateMessage(user, profile);
          await db.messages.add({
            id: crypto.randomUUID(),
            profileId: msg.profileId,
            draft,
            context: profile.sharedSignals?.join(', ') ?? '',
            createdAt: Date.now(),
            sent: false,
          });
          sendResponse({ ok: true, data: { draft } });
          break;
        }
        case 'MARK_SENT': {
          await db.messages.update(msg.messageId, { sent: true });
          sendResponse({ ok: true });
          break;
        }
        case 'PING': {
          sendResponse({ ok: true, data: { version: '0.1.0' } });
          break;
        }
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message });
    }
    return true; // async response
  }
);

function isAllowedOrigin(url?: string): boolean {
  if (!url) return false;
  return url.startsWith('http://localhost:5173') ||
         url.startsWith('https://alumni-graph.vercel.app');
}
```

### Web app bridge

```typescript
// webapp/src/lib/extension-client.ts

const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID;

function send<T>(msg: any): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      reject(new Error('Extension not installed or Chrome API unavailable'));
      return;
    }
    chrome.runtime.sendMessage(EXTENSION_ID, msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? 'unknown'));
        return;
      }
      resolve(response.data as T);
    });
  });
}

export const extensionClient = {
  ping: () => send<{ version: string }>({ type: 'PING' }),
  getGraph: () => send<{ profiles: Profile[]; user: UserProfile }>({ type: 'GET_GRAPH' }),
  getProfile: (profileId: string) => send<Profile>({ type: 'GET_PROFILE', profileId }),
  generateMessage: (profileId: string) =>
    send<{ draft: string }>({ type: 'GENERATE_MESSAGE', profileId }),
  markSent: (messageId: string) => send<void>({ type: 'MARK_SENT', messageId }),
};
```

### Shared message types

```typescript
// shared/src/messages.ts

export type ExtensionMessage =
  | { type: 'PING' }
  | { type: 'GET_GRAPH' }
  | { type: 'GET_PROFILE'; profileId: string }
  | { type: 'GENERATE_MESSAGE'; profileId: string }
  | { type: 'MARK_SENT'; messageId: string };

export type ExtensionResponse<T = any> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
```

---

## Data model

```typescript
// shared/src/models.ts

export interface UserProfile {
  id: 'me';
  name: string;
  email?: string;
  resumeText: string;
  parsed: {
    education: Array<{ school: string; degree: string; major: string; gradYear: number }>;
    experience: Array<{ company: string; title: string; dates: string; description: string }>;
    skills: string[];
    clubs: string[];
    hometown?: string;
    languages: string[];
  };
  targetCompanies: string[];
  targetRoles: string[];
}

export interface Profile {
  id: string;                         // LinkedIn public slug
  name: string;
  headline: string;
  currentCompany?: string;
  currentTitle?: string;
  location?: string;
  education: Array<{ school: string; degree?: string; major?: string; dates?: string }>;
  experience: Array<{ company: string; title: string; dates: string }>;
  skills?: string[];
  mutualConnections: number;
  mutualConnectionIds?: string[];
  connectionDegree: 1 | 2 | 3 | null;
  profilePictureUrl?: string;
  linkedinUrl: string;
  lastScraped: number;
  scrapedFrom: 'profile' | 'search' | 'alumni' | 'manual';
  warmnessScore?: number;
  sharedSignals?: string[];
}

export interface GeneratedMessage {
  id: string;
  profileId: string;
  draft: string;
  context: string;
  createdAt: number;
  sent: boolean;
}
```

---

## LinkedIn scraping — implementation notes

### SPA route detection

```typescript
// extension/src/content/index.ts

import { scrapeProfilePage } from './scrapers/profile-page';
import { scrapeSearchResults } from './scrapers/search-results';
import { scrapeAlumniPage } from './scrapers/alumni-page';
import { db } from '../lib/db';

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    handleRoute(location.href);
  }
});
observer.observe(document, { subtree: true, childList: true });

handleRoute(location.href);

async function handleRoute(url: string) {
  if (url.match(/\/in\/[^\/]+\/?(\?.*)?$/)) {
    const profile = await scrapeProfilePage();
    if (profile?.id) await db.profiles.put(profile);
  } else if (url.match(/\/search\/results\/people/)) {
    const profiles = await scrapeSearchResults();
    await db.profiles.bulkPut(profiles);
  } else if (url.match(/\/school\/.+\/people/)) {
    const profiles = await scrapeAlumniPage();
    await db.profiles.bulkPut(profiles);
  }
}
```

### Throttling rules (hard limits)

```typescript
// extension/src/lib/throttle.ts

export const SCRAPE_LIMITS = {
  profilesPerHour: 30,
  profilesPerDay: 100,
  delayBetweenProfilesMs: 3000,
  jitterMs: 2000,
};
```

**Rules:**
- Passive scraping (user-driven browsing): no limit — this is natural behavior
- Active scanning (pagination): enforce `delayBetweenProfilesMs + jitter` between fetches
- After 30 scrapes in an hour: prompt user to pause for 30 min
- If LinkedIn returns 429 or shows CAPTCHA: stop immediately, surface warning

---

## Warmness scoring

```typescript
// shared/src/warmness.ts

export interface WarmnessResult {
  score: number;          // 0-100
  signals: string[];
}

export function computeWarmness(user: UserProfile, target: Profile): WarmnessResult {
  let score = 0;
  const signals: string[] = [];

  const userSchools = user.parsed.education.map(e => normalize(e.school));
  const targetSchools = target.education.map(e => normalize(e.school));
  const sharedSchool = userSchools.find(s => targetSchools.includes(s));
  if (sharedSchool) { score += 30; signals.push(`Same school: ${sharedSchool}`); }

  const userMajors = user.parsed.education.map(e => normalize(e.major));
  const targetMajors = target.education.map(e => normalize(e.major ?? ''));
  if (userMajors.some(m => m && targetMajors.includes(m))) {
    score += 15; signals.push('Same major');
  }

  const userCompanies = user.parsed.experience.map(e => normalize(e.company));
  const targetCompanies = target.experience.map(e => normalize(e.company));
  const sharedCompany = userCompanies.find(c => targetCompanies.includes(c));
  if (sharedCompany) { score += 25; signals.push(`Same company: ${sharedCompany}`); }

  if (target.currentCompany && user.targetCompanies.map(normalize).includes(normalize(target.currentCompany))) {
    score += 20; signals.push(`Currently at ${target.currentCompany} (target)`);
  }

  const userSkills = new Set(user.parsed.skills.map(normalize));
  const targetSkills = (target.skills ?? []).map(normalize);
  const sharedSkills = targetSkills.filter(s => userSkills.has(s));
  if (sharedSkills.length > 0) {
    score += Math.min(sharedSkills.length * 5, 15);
    signals.push(`${sharedSkills.length} shared skills`);
  }

  if (target.mutualConnections > 0) {
    score += Math.min(target.mutualConnections * 2, 20);
    signals.push(`${target.mutualConnections} mutual connections`);
  }

  return { score: Math.min(score, 100), signals };
}

function normalize(s?: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}
```

---

## Message-generation prompt

```typescript
// extension/src/lib/prompts.ts

export const COLD_OUTREACH_PROMPT = `You are writing a LinkedIn message on behalf of the user below. The goal: land a 15-minute virtual coffee chat.

USER (sender):
Name: {{user.name}}
Role: {{user.currentRole}}
Education: {{user.education}}
Key experience: {{user.keyExperience}}
Target path: {{user.targetRoles}} at {{user.targetCompanies}}

TARGET (recipient):
Name: {{target.name}}
Role: {{target.currentTitle}} at {{target.currentCompany}}
Education: {{target.education}}
Prior experience: {{target.experience}}

SHARED SIGNALS (use at least ONE in the opening):
{{signals}}

Write a 3-sentence message that:
1. Opens with the single strongest shared signal — specific, not generic
2. Connects your background to their current role in ONE sentence
3. Makes a low-friction ask — "15 minutes to hear how you moved from X to Y"

HARD RULES:
- Under 280 characters total
- No em dashes, no "I hope this finds you well," no "I came across your profile"
- Write like a smart 20-year-old, not a LinkedIn recruiter
- Use first name only; no "Hi [name]!"
- Never mention that you are an AI

Output ONLY the message. No preamble.`;
```

Use Claude Haiku 4.5 (`claude-haiku-4-5-20251001`). Gemini 2.5 Flash is a fine alternative. Personal usage < $2/mo.

---

## Phase-by-phase build plan

### Phase 1 — Monorepo + extension scaffolding (Week 1, days 1–3)
- [ ] Initialize pnpm workspace with `extension/`, `webapp/`, `shared/`
- [ ] Set up TypeScript base config, Tailwind in both UIs
- [ ] Scaffold Manifest V3 extension via Vite + `@crxjs/vite-plugin`
- [ ] Scaffold `webapp/` with Vite + React + Tailwind
- [ ] Configure `externally_connectable` in `manifest.json` for `localhost:5173`
- [ ] Dummy `PING` handler in extension + `PING` button in web app to prove bidirectional communication
- [ ] Define all shared types in `shared/src/models.ts` and `shared/src/messages.ts`

**Acceptance:** web app on `localhost:5173` can ping the extension and receive `{ version: "0.1.0" }`.

### Phase 2 — Extension: passive scraping + local DB (Week 1, days 4–7)
- [ ] Dexie schema: `profiles`, `userProfile`, `messages`, `sessions`
- [ ] Content script + MutationObserver for SPA routing
- [ ] `scrapeProfilePage()` — extract name, headline, experience, education
- [ ] Popup UI with profile count + last-scraped timestamp
- [ ] Test on 10 real LinkedIn profiles; fix broken selectors

**Acceptance:** visiting 10 LinkedIn profiles populates IndexedDB with correct data.

### Phase 3 — Resume + warmness scoring (Week 2, days 1–4)
- [ ] Popup: resume upload (PDF via pdf.js, or paste text)
- [ ] LLM-powered resume parser → structured `UserProfile.parsed`
- [ ] Implement `computeWarmness()` (shared package)
- [ ] On every new profile save, recompute warmness + store signals
- [ ] Extend `GET_GRAPH` response to include scored profiles

**Acceptance:** uploaded resume → 20 visited profiles each show a 0–100 warmness score with 1–4 shared signals.

### Phase 4 — Web app visualization (Week 2, days 5–7)
- [ ] `useGraphData` hook polls extension every 5s for updates
- [ ] Cytoscape full-screen graph: nodes sized by warmness, colored by company cluster
- [ ] Edges: user ↔ each profile (weight = warmness); profile ↔ profile when sharing a company
- [ ] Click node → `NodeDetails` side panel
- [ ] `FilterBar`: search, company filter, school filter, warmness threshold slider
- [ ] Legend + `StatsPanel` (total profiles, avg warmness, top companies)

**Acceptance:** web app renders 50+ nodes smoothly, filters work live, node click shows full detail panel.

### Phase 5 — AI message generation (Week 3, days 1–4)
- [ ] Extension: `generateMessage(user, profile)` calls Claude Haiku with filled-in prompt
- [ ] API key stored in `chrome.storage.local`, managed in popup settings
- [ ] Web app: `+ Generate Message` button in `NodeDetails`
- [ ] `MessageComposer` component: streaming draft → editable textarea → copy button
- [ ] Track which profiles have been messaged (strike-through in graph)

**Acceptance:** click `+` on any node produces a usable LinkedIn message <280 chars referencing real shared signals.

### Phase 6 — Active scanning + polish (Week 3, days 5–7)
- [ ] Floating "Scan alumni" button injected on `/school/[x]/people` pages
- [ ] Paginated scrape with throttle (3s + jitter), max 50 profiles per session
- [ ] Progress bar + cancel button (in a small injected overlay on LinkedIn)
- [ ] 429 / CAPTCHA detection → stop + warn
- [ ] JSON export/import for graph backup
- [ ] Dark mode, keyboard shortcuts in web app

**Acceptance:** a 30-minute scan of a mid-size alumni network populates 40–50 profiles without triggering LinkedIn warnings.

### Phase 7 — Deploy web app (optional, 1 day)
- [ ] Deploy `webapp/` to Vercel or Cloudflare Pages
- [ ] Update extension `externally_connectable` to include deployed origin
- [ ] Update `VITE_EXTENSION_ID` environment variable for production build

**Acceptance:** graph viewable from deployed URL on any device that has the extension installed.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| LinkedIn account ban | Conservative throttle; passive scrape by default; user-consented pagination; never auto-click |
| Selectors break on LinkedIn update | Per-page adapter with fallback selectors; log misses to DevTools |
| API cost overrun | Haiku tier + cache per profile + rate-limit button clicks |
| Extension ID changes on rebuild | Pin the key in `manifest.json` via `"key"` field (generated once) |
| Web app can't reach extension | Clear connection-status indicator + docs on "install extension first" |
| Local DB growth | IndexedDB scales to millions; add archive-after-90-days later |
| User reinstalls extension and loses data | JSON export in Phase 6; document the backup workflow |

---

## Extension ID stability

Chrome assigns an extension ID based on the packed `.crx` key. For a stable ID across dev rebuilds (so `VITE_EXTENSION_ID` in the web app doesn't change), generate a key once and pin it:

```bash
# Generate once
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -outform DER | base64 -A
```

Paste the output into `manifest.json` as `"key": "..."`. The extension ID becomes deterministic.

---

## API key management

- User enters their Anthropic or Gemini API key in the extension popup (Settings tab)
- Stored in `chrome.storage.local` — never committed, never sent to web app
- All LLM calls happen from the extension's service worker
- Web app requests message generation → extension makes the API call → returns draft
- API key never leaves the extension

---

## Handoff prompt for coding agent

> I'm building AlumniGraph, a personal-use Chrome extension + React web app monorepo. The complete spec is in this repo as **`mvp-build-plan.md`** (project root). Read that file first, then execute Phase 1: ensure the pnpm workspace at the repo root has `extension/`, `webapp/`, and `shared/` packages, scaffold the Manifest V3 extension (Vite + @crxjs) and the React + Vite web app, wire up `externally_connectable` + a `PING` message round-trip between them, and commit all shared TypeScript types. Stop after Phase 1 is complete and the acceptance test passes (web app pings extension, receives version response). Do not proceed to Phase 2 without explicit approval.

---

## Known limitations (personal-use disclaimers)

- Violates LinkedIn's TOS — do not distribute publicly
- Selectors will break every 2–3 months; expect maintenance
- LLM writes in its own voice, not yours (v2: voice-matching from your past messages)
- Graph is only as complete as your browsing or active scans
- Mutual connection names often hidden by LinkedIn (only counts exposed unless both 1st-degree)
- Chromium browsers only (Chrome, Edge, Arc, Brave)