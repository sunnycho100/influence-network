# Influence Network

Influence Network is a personal-use Chrome extension plus localhost React app for building a local graph of LinkedIn connections.

The extension is the system of record. It scrapes profile data while the user browses LinkedIn, stores that data in IndexedDB through Dexie, and exposes a small external message API to the web app. The web app reads from the extension and renders a larger mind-map style network view. There is no backend, no auth, and no cloud persistence in the current implementation.

This README is written for engineering review and describes the code that exists today, not the long-term MVP plan.

## Implementation Status

- Phase 1 is complete.
- Phase 2 is implemented in code.
- Phase 3 is now implemented in code.
- A first-pass graph visualization now exists in both the extension side panel and the localhost web app.
- Phase 2 still needs manual browser validation on real LinkedIn profiles before it should be considered accepted.
- Phase 3 still needs manual browser validation for resume parsing quality and warmness outcomes.
- Message generation, active scanning, and deployment are not implemented yet.

## High-Level Architecture

There are three packages:

- `shared/`
  Shared TypeScript models, message contracts, warmness logic, and a generic mind-map data builder
- `extension/`
  Manifest V3 Chrome extension containing the service worker, LinkedIn content script, IndexedDB layer, and interactive side panel
- `webapp/`
  React app running on `http://localhost:5173` that reads graph data from the extension and renders a larger network surface

### Current Runtime Topology

1. The user browses LinkedIn.
2. The extension content script detects LinkedIn SPA navigation and tries to scrape profile pages.
3. The content script sends internal runtime messages to the extension service worker.
4. The service worker writes profile and session records into IndexedDB.
5. The extension side panel reads the same IndexedDB state directly and renders a compact graph/stats UI.
6. The localhost web app calls `chrome.runtime.sendMessage(extensionId, ...)` and asks the extension for `PING`, `GET_GRAPH`, or `GET_PROFILE`.
7. The extension service worker responds with data from IndexedDB.
8. The web app computes a visual layout client-side and renders the graph.

## What Exists Today

### Extension

- Manifest V3 extension built with Vite and `@crxjs/vite-plugin`
- Chrome side panel opened from the toolbar icon
- Service worker for internal and external message handling
- Passive profile scraping for LinkedIn profile pages
- Dexie database with `profiles`, `userProfile`, `messages`, and `sessions`
- Side panel UI showing summary stats plus a compact interactive graph

### Web App

- React + Vite app on `http://localhost:5173`
- Extension bridge client for `PING` and `GET_GRAPH`
- Interactive network view with selectable nodes and details panel

### Shared Package

- Data models for `Profile`, `UserProfile`, `GeneratedMessage`, and `GraphSnapshot`
- Typed message contracts for extension communication
- Warmness scoring function
- Generic mind-map graph builder

## Key Files

### Shared

- `shared/src/models.ts`
  Core domain types
- `shared/src/messages.ts`
  External message contracts and origin validation helpers
- `shared/src/warmness.ts`
  Shared warmness scoring algorithm
- `shared/src/graph.ts`
  Generic graph-shaping helper for mind-map style node/edge output

### Extension

- `extension/manifest.config.ts`
  MV3 manifest definition
- `extension/src/background/service-worker.ts`
  Internal and external message entrypoints plus side panel behavior
- `extension/src/lib/db.ts`
  Dexie schema and read/write helpers
- `extension/src/lib/messaging.ts`
  External message handling for the web app
- `extension/src/lib/internal-messaging.ts`
  Internal runtime message handling from the content script
- `extension/src/content/index.ts`
  LinkedIn SPA route detection and scrape scheduling
- `extension/src/content/scrapers/profile-page.ts`
  Actual DOM scraping logic for profile pages
- `extension/src/sidepanel/index.tsx`
  Side panel entrypoint
- `extension/src/popup/Popup.tsx`
  Main side panel UI component

### Web App

- `webapp/src/lib/extension-client.ts`
  Typed browser bridge to the extension
- `webapp/src/lib/graph-layout.ts`
  Localhost-specific graph layout algorithm
- `webapp/src/App.tsx`
  Main graph page and node-details UI

## Manifest and Extension Surface

The extension currently uses a side panel, not a popup.

Important manifest behavior:

- `side_panel.default_path` points at `src/sidepanel/index.html`
- the toolbar action does not open a popup
- the service worker calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
- `externally_connectable` allows the localhost web app and the planned production origin
- `host_permissions` include LinkedIn plus dev-only Vite extension-host permissions on port `5175`

In practice, clicking the toolbar icon opens the right-side docked panel that reuses the UI implemented in `extension/src/popup/Popup.tsx`.

## Data Model

### `Profile`

Represents one scraped LinkedIn connection.

Current fields include:

- `id`
  LinkedIn profile slug
- `name`
- `headline`
- `currentCompany`
- `currentTitle`
- `location`
- `education[]`
- `experience[]`
- `skills?`
- `mutualConnections`
- `connectionDegree`
- `profilePictureUrl?`
- `linkedinUrl`
- `lastScraped`
- `scrapedFrom`
- `warmnessScore?`
- `sharedSignals?`

### `UserProfile`

Represents the local user's structured resume-derived state from the side panel resume flow.

### `GeneratedMessage`

Represents a locally stored generated outreach draft. The type and table exist, but generation is not implemented yet.

### `GraphSnapshot`

The extension returns graph data to the web app as:

- `profiles`
- `user`
- `messages`

## Persistence Logic

IndexedDB is wrapped with Dexie in `extension/src/lib/db.ts`.

Current tables:

- `profiles`
  Main scraped profile records
- `userProfile`
  Current local user profile parsed from uploaded/pasted resume text
- `messages`
  Reserved for future generated messages
- `sessions`
  Audit-like records for scrape attempts and failures

### Current Write Paths

Successful scrape writes:

- `recordProfileScrape(...)`
  Upserts the profile into `profiles`, recomputing warmness/signals if a local user profile exists
- records a matching `success` session in `sessions`

Resume save writes:

- `saveUserProfile(...)`
  Upserts `userProfile` and recomputes warmness/signals for all existing profiles

Failed scrape writes:

- `recordScrapeError(...)`
  Records a `status: "error"` session

### Current Read Paths

- `getGraphSnapshot()`
  Returns all profiles, the local user profile if present, and any stored messages
- `getProfileById(profileId)`
  Fetches one profile
- `getExtensionStats()`
  Returns profile count, last scrape time, and a shallow last-profile summary

## Message Flows

There are two distinct message layers.

### 1. Internal Extension Messages

Used by the content script to talk to the service worker.

Defined in:

- `extension/src/lib/runtime-messages.ts`
- `extension/src/lib/internal-messaging.ts`

Current internal messages:

- `UPSERT_SCRAPED_PROFILE`
- `SCRAPE_ERROR`

Flow:

1. content script scrapes a profile page
2. content script sends `UPSERT_SCRAPED_PROFILE`
3. service worker handles it through `handleInternalMessage(...)`
4. DB is updated

### 2. External Web App Messages

Used by the localhost web app to talk to the extension.

Defined in `shared/src/messages.ts`.

Current external messages:

- `PING`
- `GET_GRAPH`
- `GET_PROFILE`

Handled in `extension/src/lib/messaging.ts`.

Important current behavior:

- external messages are rejected unless the sender origin matches `localhost:5173`, `127.0.0.1:5173`, or the planned production origin
- `PING` returns `{ version: "0.1.0" }`
- `GET_GRAPH` returns the current `GraphSnapshot`
- `GET_PROFILE` returns a single profile by id

`GENERATE_MESSAGE` and `MARK_SENT` exist in shared types but are not implemented yet in the service worker.

## Scraping Logic

The current scraper is intentionally narrow and only targets LinkedIn profile pages.

### Route Detection

Implemented in `extension/src/content/index.ts`.

Main behavior:

- patches `history.pushState` and `history.replaceState`
- listens for custom navigation events and `popstate`
- uses a `MutationObserver` to detect SPA page changes
- only attempts scraping on URLs matching `/in/...`

### Timing Strategy

The content script does not scrape immediately once.
It schedules multiple attempts at:

- `250ms`
- `1200ms`
- `3200ms`

This is meant to tolerate LinkedIn's delayed hydration and content swaps.

There is also a retry path:

- if the URL is still a profile page
- and the page has not been successfully scraped yet
- a retry is scheduled at `700ms`

### Current Profile Scraper

Implemented in `extension/src/content/scrapers/profile-page.ts`.

Current extraction behavior:

- profile id from the URL
- name from top-level heading selectors
- headline from top-card selectors or fallback text lines
- location from top-card selectors or fallback text lines
- connection degree from top-card text
- mutual connection count from top-card text
- experience from the `Experience` section
- education from the `Education` section
- current title/company from the first extracted experience row
- profile image from top-card image selectors

Important implementation notes:

- selectors are intentionally redundant because LinkedIn markup changes frequently
- section extraction is label-based, looking for headings like `experience` and `education`
- list items are deduplicated by the first few text lines
- date detection is heuristic and string-based

This is the main area that still needs real-world validation against actual LinkedIn profiles.

## Service Worker Logic

Implemented in `extension/src/background/service-worker.ts`.

Current responsibilities:

- open the side panel when the action icon is clicked
- receive external messages from the web app
- receive internal messages from the content script
- route each message to the appropriate handler
- normalize async errors into `{ ok: false, error }` responses

This keeps the service worker as the control plane for both extension-internal and webapp-external traffic.

## Side Panel Logic

The extension side panel reuses `Popup.tsx` as its main UI component.

Current side panel behavior:

- loads extension stats directly from Dexie
- loads the full graph snapshot directly from Dexie
- supports resume text paste and PDF upload
- parses a local `UserProfile` from resume data
- saves the user profile and refreshes profile warmness/signals
- shows loading, empty, error, and ready states
- supports two compact visual modes:
  - `Orbit`
  - `Cards`
- keeps a selected node in state
- renders detail content for the selected profile
- opens LinkedIn in a new tab from the selected profile panel

This is a local extension surface and does not use the external message bridge.

## Localhost Web App Logic

The web app uses the external extension bridge and does not read IndexedDB directly.

### Extension Client

Implemented in `webapp/src/lib/extension-client.ts`.

Current behavior:

- reads `VITE_EXTENSION_ID` from the environment
- calls `chrome.runtime.sendMessage(extensionId, message, callback)`
- normalizes `chrome.runtime.lastError`
- throws if no response or if the response is `{ ok: false }`

### Page Flow

Implemented in `webapp/src/App.tsx`.

On initial load:

1. call `PING`
2. call `GET_GRAPH`
3. store snapshot in React state
4. compute a graph layout from the snapshot
5. render the graph and a details sidebar

The page also supports manual refresh by calling the same flow again.

### Web Graph Layout

Implemented in `webapp/src/lib/graph-layout.ts`.

Current algorithm:

- sort profiles by warmness, then by mutual connections
- group profiles by company
- create one center user node if a local `UserProfile` exists
- allocate each company a radial sector around the center
- distribute each company's profiles around its hub position
- size profile nodes by a mix of warmness and mutual connections
- draw two edge types:
  - `spoke`
    user to profile
  - `cluster`
    profile to adjacent profile within the same company bucket

This is a custom SVG-and-absolute-position layout, not Cytoscape yet.

## Shared Graph Builder vs Web Graph Layout

There are currently two graph-shaping approaches in the codebase:

- `shared/src/graph.ts`
  generic `MindMapData` builder
- `webapp/src/lib/graph-layout.ts`
  localhost-specific layout builder used by the current web app

There is also `extension/src/lib/mindmap.ts`, which wraps the shared graph builder.

Important review note:

- the shared graph builder is present, but the current main rendering surfaces are not fully unified on top of it yet
- the extension side panel currently renders from `GraphSnapshot` directly
- the web app uses its own dedicated layout helper

This is likely a good future refactor target if the team wants one canonical graph layout pipeline.

## Warmness Logic

The scoring function exists in `shared/src/warmness.ts` and is now wired into save paths.

Current score components:

- same school
- same major
- same company
- currently at a target company
- shared skills
- mutual connection count

Important review note:

- `warmnessScore` exists on the `Profile` type
- graph UIs already know how to display warmness if the field is present
- profile scrapes recompute warmness when a user profile exists
- saving the user profile rescales warmness/signals for all stored profiles

## Dev Setup

### Scripts

- `pnpm install`
  install workspace dependencies
- `pnpm dev:extension`
  run the extension Vite dev server on port `5175`
- `pnpm dev:webapp`
  run the localhost web app on port `5173`
- `pnpm typecheck`
  type-check the entire workspace
- `pnpm build`
  build `shared`, `extension`, and `webapp`

### Why Two Ports

- `5173`
  localhost web app, and also the allowed external origin for the extension bridge
- `5175`
  extension dev server only

The extension uses host permissions for `5175` so the MV3 service worker can load Vite dev assets during development.

## Local Setup

1. Run `pnpm install` at the repo root.
2. Start the extension build with `pnpm dev:extension`.
3. Load `extension/dist` as an unpacked extension in `chrome://extensions`.
4. Copy `webapp/.env.example` to `webapp/.env`.
5. Set `VITE_EXTENSION_ID` in `webapp/.env` to the unpacked extension ID from Chrome.
6. Click the Influence Network toolbar icon to open the extension side panel.
7. Start the web app with `pnpm dev:webapp`.
8. Open `http://localhost:5173` to inspect the localhost graph view.

## Manual Validation Needed

Before treating Phase 2 as stable, real LinkedIn browsing still needs to validate:

1. profile page scraping against current LinkedIn markup
2. correctness of `experience` extraction
3. correctness of `education` extraction
4. correctness of mutual-connection parsing
5. robustness of the retry timing against SPA hydration

Recommended validation pass:

1. open roughly 10 real LinkedIn profile pages
2. wait a few seconds on each page
3. verify `profiles` and `sessions` in IndexedDB
4. inspect the side panel graph and localhost graph
5. note selector misses and malformed rows

Phase 3 resume validation still needed:

1. upload at least one PDF resume and confirm text extraction populates the resume textarea
2. paste resume text manually and save again to confirm text fallback works
3. verify `userProfile` is written in IndexedDB and updates after each save
4. verify existing `profiles` gain or update `warmnessScore` and `sharedSignals` after saving the user profile
5. refresh the localhost web app and confirm warmness-sensitive ordering and details update

## Known Gaps

- no AI message generation
- no active alumni scanning
- no export/import
- no production deployment setup

## Review Hotspots

If another engineer is reviewing this codebase, the highest-value review areas are:

- scraping robustness and selector strategy
- whether the route detection and retry timing are appropriate for LinkedIn's SPA behavior
- whether the internal vs external message boundaries are clean enough
- whether IndexedDB is the right source-of-truth boundary for upcoming features
- whether graph layout logic should be unified instead of split between `shared/` and `webapp/`
- whether future message types should be implemented now or removed from shared contracts until needed

## Notes

- This project is intended for personal use only.
- LinkedIn selectors are fragile and will likely need maintenance over time.
- The current graph views are first-pass layouts and will still benefit from better scoring, filtering, and deeper interactions.
# influence-network
