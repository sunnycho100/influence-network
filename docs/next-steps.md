# Next Steps

This file is a handoff guide for future agentic coding work on AlumniGraph.

Project root:
`/Users/sunghwan_cho/Documents/projects/alumni-graph`

Source spec:
`/Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md`

## Current State

- Phase 1 is complete.
- Phase 2 is implemented in code.
- Phase 3 is implemented in code.
- Phase 2 and Phase 3 still need manual browser validation on real LinkedIn pages and real resumes.
- Phase 4 and beyond are not implemented yet.

## Recommended Order

1. Manually validate Phase 2 in Chrome.
2. Manually validate Phase 3 resume parsing and warmness behavior.
3. If selector or parsing issues appear, fix Phase 2/3 before building more features.
4. Build Phase 4: graph visualization in the web app.
5. Build Phase 5: AI message generation.
6. Build Phase 6: active alumni scanning and polish.
7. Build Phase 7 only if deployment is needed.

## Human Step Before More Coding

Do this in the browser before asking an agent to move too far ahead:

1. Load `extension/dist` as an unpacked extension.
2. Visit around 10 real LinkedIn profile pages.
3. Confirm the popup updates profile count and last-scraped timestamp.
4. Inspect IndexedDB and confirm `profiles` and `sessions` are being written.
5. Note any selector failures or malformed scraped fields.
6. Upload a PDF resume and confirm text is extracted.
7. Save resume text and confirm `userProfile` persists in IndexedDB.
8. Verify existing profiles get `warmnessScore` and `sharedSignals` after save.

If this manual validation exposes issues, give the agent a fix-focused prompt before moving to Phase 4.

## Agent Prompt 1: Phase 2 Fix Pass

Use this if real LinkedIn testing finds scraping problems.

```text
I'm building AlumniGraph in /Users/sunghwan_cho/Documents/projects/alumni-graph. Read /Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md and /Users/sunghwan_cho/Documents/projects/alumni-graph/README.md first.

Phase 2 is already implemented, but manual testing on real LinkedIn pages exposed scraping issues. Focus only on fixing Phase 2. Do not proceed to Phase 3.

Your goals:
- improve passive profile scraping reliability on LinkedIn profile pages
- fix broken or missing selectors for name, headline, experience, education, and location
- preserve the Dexie schema and popup dashboard unless changes are needed to support the fixes
- keep the current service worker and popup flow working

Requirements:
- work only inside /Users/sunghwan_cho/Documents/projects/alumni-graph
- run typecheck and build after changes
- update README only if setup or validation steps changed
- stop after Phase 2 is stable

Acceptance:
- manual testing on real LinkedIn profiles shows correct IndexedDB profile records
- popup stats still update correctly
- pnpm typecheck and pnpm build pass
```

## Agent Prompt 2: Phase 3 Fix Pass

Use this if manual testing finds resume parser or warmness issues.

```text
I'm building AlumniGraph in /Users/sunghwan_cho/Documents/projects/alumni-graph. Read /Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md and /Users/sunghwan_cho/Documents/projects/alumni-graph/README.md first.

Phase 3 is already implemented. Execute a fix pass for Phase 3 only. Do not proceed to Phase 4.

Current status:
- Phase 1 is complete
- Phase 2 is implemented
- Phase 3 is implemented
- the extension already has Dexie storage, passive scraping, popup stats, resume upload/paste, and external messaging

Phase 3 fix-pass goals:
- improve PDF parsing and resume text parsing quality
- fix malformed UserProfile.parsed output
- ensure warmness and shared signals recompute correctly on profile scrape and user profile save
- preserve current side panel resume UI and status feedback
- keep GET_GRAPH behavior unchanged

Requirements:
- keep all data local
- no backend, no auth
- store any API key only in chrome.storage.local if needed
- use the shared package for reusable types and warmness logic
- preserve existing Phase 1 and Phase 2 behavior
- add only the minimum UI needed in the popup for resume upload/paste and status feedback
- run pnpm typecheck and pnpm build after changes
- update README to reflect the new status and setup

Acceptance:
- user can upload a PDF or paste resume text without parser crashes
- structured UserProfile data is saved locally and updates predictably
- scraped profiles show a 0-100 warmness score and shared signals
- GET_GRAPH returns scored profiles
- pnpm typecheck and pnpm build pass
```

## Agent Prompt 3: Phase 4

Use this after Phase 3 is complete and validated.

```text
I'm building AlumniGraph in /Users/sunghwan_cho/Documents/projects/alumni-graph. Read /Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md and /Users/sunghwan_cho/Documents/projects/alumni-graph/README.md first.

Execute Phase 4 only. Do not proceed to Phase 5.

Current status:
- the extension stores scraped profiles locally
- GET_GRAPH returns the current graph snapshot
- warmness scoring is already implemented

Phase 4 goals:
- build the web app graph visualization
- poll the extension for graph updates
- render the graph with Cytoscape
- size nodes by warmness and cluster them by company
- add edges from the user to profiles and between profiles that share a company
- add node click details, filters, legend, and stats

Requirements:
- preserve the existing extension bridge behavior
- keep the web app at localhost:5173 in dev
- build a polished but practical MVP UI
- keep performance reasonable for 50+ nodes
- run pnpm typecheck and pnpm build after changes
- update README to match the new state

Acceptance:
- graph renders from extension data
- filters update live
- clicking a node shows full details
- pnpm typecheck and pnpm build pass
```

## Agent Prompt 4: Phase 5

Use this after the graph UI is working.

```text
I'm building AlumniGraph in /Users/sunghwan_cho/Documents/projects/alumni-graph. Read /Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md and /Users/sunghwan_cho/Documents/projects/alumni-graph/README.md first.

Execute Phase 5 only. Do not proceed to Phase 6.

Phase 5 goals:
- implement AI message generation in the extension service worker
- store the API key in chrome.storage.local
- add popup settings for the key
- add a Generate Message action in the web app node details view
- return a draft message based on real shared signals
- allow edit and copy in the web app
- track sent or messaged state locally

Requirements:
- all LLM calls must happen in the extension, not the web app
- never expose the API key to the web app
- follow the MVP prompt and message constraints from the build plan
- run pnpm typecheck and pnpm build after changes
- update README with any new setup instructions

Acceptance:
- clicking Generate Message produces a usable draft under 280 characters
- the message references real shared signals
- sent state is tracked locally
- pnpm typecheck and pnpm build pass
```

## Agent Prompt 5: Phase 6

Use this after message generation is stable.

```text
I'm building AlumniGraph in /Users/sunghwan_cho/Documents/projects/alumni-graph. Read /Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md and /Users/sunghwan_cho/Documents/projects/alumni-graph/README.md first.

Execute Phase 6 only. Do not proceed to Phase 7.

Phase 6 goals:
- add the floating Scan alumni button on LinkedIn alumni pages
- implement paginated active scanning with throttling and jitter
- add progress and cancel UI
- stop on 429 or CAPTCHA indicators
- add JSON export and import
- add final usability polish such as dark mode and keyboard shortcuts where appropriate

Requirements:
- be conservative with scanning behavior
- never auto-click through LinkedIn without explicit user action
- preserve passive scraping behavior
- run pnpm typecheck and pnpm build after changes
- update README for scan workflow and backup workflow

Acceptance:
- scan session can gather many alumni profiles with visible progress
- stop and warning behavior works for failure conditions
- JSON export and import work
- pnpm typecheck and pnpm build pass
```

## Optional Agent Prompt 6: Phase 7

Only use this if you actually want deployment.

```text
I'm building AlumniGraph in /Users/sunghwan_cho/Documents/projects/alumni-graph. Read /Users/sunghwan_cho/Documents/a-hackathon/cheat/MVP_BUILD_PLAN.md and /Users/sunghwan_cho/Documents/projects/alumni-graph/README.md first.

Execute Phase 7 only.

Phase 7 goals:
- deploy the web app
- wire the production origin into externally_connectable
- support a production extension ID or configuration flow
- document the production setup clearly

Requirements:
- preserve localhost development
- do not break the current dev bridge flow
- update README with deployment instructions
- run pnpm typecheck and pnpm build after changes

Acceptance:
- deployed web app can connect to the installed extension from the configured production origin
- pnpm typecheck and pnpm build pass
```

## Suggested Handoff Style

When giving work to the next agent, keep the scope bounded:

1. Ask for exactly one phase at a time.
2. Tell the agent to stop after that phase's acceptance criteria pass.
3. Ask the agent to update `README.md` when setup or status changes.
4. Ask the agent to run `pnpm typecheck` and `pnpm build` before finishing.
5. If manual browser validation is required, ask the agent to clearly call that out instead of guessing.
