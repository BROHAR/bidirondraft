# Bid Iron Draft — Claude reference

Fantasy football auction draft simulator (React 19 + Vite + Zustand 5). Tests via Vitest.

## Development

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run test:run` — full Vitest suite (745 tests, ~40s); `npm run test` for watch mode
- `npm run lint` — ESLint

### ESLint

Flat config in `eslint.config.js` (ESLint 9). **Pinned to 9, not 10**: `eslint-plugin-react`'s latest release peer-caps at eslint `^9.7`, so 10 would need `--legacy-peer-deps` and run the React plugin against an unsupported major — revisit once the plugin supports 10. Lint scope is `.js`/`.jsx` only; `scripts/**/*.mjs` is intentionally excluded (it has never been linted). The bar is **0 errors**; warnings are non-blocking by design (the codebase predates linting). The react-hooks 7 React-Compiler rules (`set-state-in-effect`, `preserve-manual-memoization`) are set to `warn` rather than error for the same reason.

### Simulation RNG (seedable)

All draft-simulation randomness (AI bidding, strategies, engine jitter) flows through `src/utils/rng.js` — unseeded it delegates to `Math.random()` (app behavior unchanged); tests call `setSeed(n)` to make full simulated drafts deterministic. `tests/integration/DraftCompleteness.test.js` and `tests/integration/BudgetSpendDown.test.js` are seeded this way, so failures there are real regressions, not flakiness. When adding new randomness to AI/engine code, import `random()` from `src/utils/rng.js` rather than calling `Math.random()` directly, or seeded tests lose determinism.

## Recent Updates log — `content/updates.json`

The blog's "Recent Updates" page renders from `content/updates.json`. **Whenever you prepare a commit or PR containing user-visible changes, also append an entry to this file.** One entry per feature (not per commit — group a feature and its fix-ups), newest first at the top of the array.

Schema (all fields required):

```json
{
  "date": "YYYY-MM-DD",
  "title": "Short headline",
  "summary": "1-3 sentences in lay-person terms.",
  "tags": ["short", "lowercase"]
}
```

Rules:

- **Write for fantasy-football players, not developers.** Say what changed for the user, never mention internals (component names, refactors, test counts). Example of a good entry:

  ```json
  {
    "date": "2026-07-25",
    "title": "Keeper league support",
    "summary": "You can now set up keepers before the draft: pick each team's kept players and prices, or pull them straight from last year's imported draft. Keepers show up on rosters and reports with a K badge.",
    "tags": ["new-feature", "keepers"]
  }
  ```

- **Skip very minor changes**: small UI tweaks, styling/CSS fixes, refactors, dependency bumps, test-only changes, and routine data refreshes (e.g. "Refresh player projections") get no entry.
- Common tags: `new-feature`, `ai`, `draft-room`, `reports`, `mobile`, `accessibility`, `setup`, `keepers`, `autopilot`. Reuse existing tags before inventing new ones.
- `tests/unit/updatesLog.test.js` validates the schema and newest-first ordering — run `npm run test:run` after editing.

## Auction Dispatch voice — `content/blog/*.md`

Every Dispatch post is written in the house voice below. It was modeled on the tone of fantasy analysts JJ Zachariason, Justin Boone, and Andy Holloway — conversational-analytical, numbers-grounded, leaguemate-to-leaguemate — then adapted to BIDIRON's angle: the author is **the person who built the simulator and watches thousands of AI drafts**.

**Voice parameters:**

- **Person**: first-person singular ("I built", "I watch", "my sims"), never corporate "we". Address the reader as "you", like a leaguemate, not an audience.
- **Authority source**: observed simulation behavior and specific numbers, not credentials. Real figures beat adjectives ("the room burned 93% of its money by the halfway point" > "teams overspend early"). Max ~2 stats per paragraph, rounded the way you'd say them aloud.
- **Takes**: state them flat, no throat-clearing. Hedge only genuine uncertainty. Admit mistakes and surprises ("I believed it too, so I coded it. It loses constantly.") — being wrong on the record is part of the voice.
- **Rhythm**: mostly short-to-medium sentences with deliberate variety; fragments are fine; starting with And/But/So is fine. Paragraphs 1–4 sentences. One-sentence paragraphs for emphasis, sparingly.
- **Humor**: dry and league-life-observational (group chats, the buddy who overpays for his defense). Self-deprecating over clever. Never forced; two laughs per article is plenty.
- **Structure**: headers are plain statements, not "Habit one: Title-Case Aphorism". Do NOT end every section with a mic-drop line — one per article, max.
- **Banned AI-isms**: perfectly parallel triads; "It's not X. It's Y." more than once per piece; em-dash chains (guideline: ≤1 em-dash per paragraph); "Here's the thing"; "Let's dive in"; "in today's landscape"; rhetorical question followed by its own tidy answer as a repeated device; every noun getting exactly two adjectives.
- **Jargon**: plain talk. League terms (book value, stars and scrubs, price enforcement) get a half-sentence gloss on first use, in passing, not a definition paragraph.

Reference implementation: `content/blog/auction-drafts-beat-snake-drafts.md`. New posts should read like the same person wrote them.

## "update players" — refresh the player pool

When the user asks to "update players", "refresh players", "refresh projections", or similar:

```
npm run refresh-projections
```

That single command does the full refresh and ends by overwriting `src/data/players.json` in place. No further action required.

> Prerequisite: the Yahoo step needs Playwright's Chromium binary. On a fresh clone or after a Playwright version bump, run `npx playwright install chromium` first — otherwise it fails with `Executable doesn't exist … chrome-headless-shell`. (ESPN no longer needs a browser — see below.)

After it finishes, optionally:

- `npm run test:run` to confirm the test suite still passes
- `git add src/data/players.json data/projections/projections-*.csv data/projections/yahoo-salcap-*.csv && git commit -m "Refresh player projections"` if the user wants the new data committed

Expected runtime: ~15-30 seconds. ESPN is a single JSON API request; the only browser work is the Yahoo page scrape.

### What the refresh does

Implemented in `scripts/refresh-projections/`:

- **`scrape.mjs`** — Two sources:
  1. **ESPN** — the public `kona_player_info` JSON API (`lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/<SEASON>/segments/0/leaguedefaults/3?view=kona_player_info`), the same endpoint the projections page itself calls. Driven by an `x-fantasy-filter` header (requires a sort clause, or it returns nothing) plus `x-fantasy-platform`/`x-fantasy-source` headers. No auth. Returns the full ~1000-player pool deterministically with projected stats. **We moved off DOM scraping because ESPN's projections table is _virtualized_** — only on-screen rows exist in the DOM — which made a Playwright/pagination scrape non-deterministic and silently dropped a fixed cohort of starters (Mahomes, Herbert, Stafford, …). ESPN stat IDs (e.g. pass_yds=3, rush_yds=24, rec=53), position IDs (1=QB…16=DST), and proTeam IDs are mapped into the same CSV shape the old scraper emitted. `appliedTotal` from the season projection (`statSourceId===1`) is the projected points — used directly for K/DST. Offensive players projected for 0 points are dropped. Season defaults to the current year; override with `ESPN_SEASON`.
  2. **Yahoo** — salary-cap draft analysis (`?count=500`) via Playwright (its page isn't virtualized), single request, used for the authoritative auction `estimatedValue`.

- **`process.mjs`** — Computes fantasy points (standard / halfPPR / ppr) from raw passing+rushing+receiving stats. K and DST use ESPN's projected points directly. Merges by normalized name + position: Yahoo's "Proj $" wins for `estimatedValue` when matched; otherwise the existing `players.json` value is preserved; new entries get a rank-based default. `byeWeek` is preserved from existing entries (the projection feed doesn't expose it). **Completeness guardrail:** throws (leaving `players.json` untouched) if more than 8 of Yahoo's top-150 players are absent from the ESPN data — the safety net that caught the virtualized-scrape bug.

- **`index.mjs`** — Orchestrator (the npm entry point).

### Audit trail

Each refresh writes timestamped CSVs to `data/projections/`:
- `projections-YYYY-MM-DD.csv` — ESPN scraped stats
- `yahoo-salcap-YYYY-MM-DD.csv` — Yahoo Proj $ values

Useful for diffing scrapes over time and troubleshooting if a future ESPN/Yahoo page change breaks parsing.

### Things that can break

- **ESPN API changes**: if the fetch returns an HTTP error or 0 players, the `x-fantasy-filter` shape, the `view`, the headers, or the season may have changed. Open the live projections page with DevTools → Network, find the `lm-api-reads` request, and copy its current URL/headers/filter. The completeness guardrail will catch silent gaps even if the request still succeeds.
- **ESPN stat-ID drift**: the numeric stat IDs (pass_yds=3, pass_td=4, int=20, rush_yds=24, rush_td=25, rec=53, rec_yds=42, rec_td=43, …) are ESPN constants mapped in `scrape.mjs`. If projections look wrong, re-verify an ID against a known player's projected line.
- **Yahoo selector changes**: keys on `[data-tst="player-name"]` and `[data-tst="player-position"]`. Open the page and update selectors.
- **Completeness guardrail fires**: `process.mjs` aborts the refresh if >8 of Yahoo's top-150 players are missing from the ESPN data — meaning the ESPN fetch came back incomplete. Fix the fetch; don't raise the threshold to force a write of bad data.
