# Bid Iron Draft — Claude reference

Fantasy football auction draft simulator (React 19 + Vite + Zustand 5). Tests via Vitest.

## Development

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run test:run` — full Vitest suite (375 tests, ~10s); `npm run test` for watch mode
- `npm run lint` — ESLint

### ESLint

Flat config in `eslint.config.js` (ESLint 9). **Pinned to 9, not 10**: `eslint-plugin-react`'s latest release peer-caps at eslint `^9.7`, so 10 would need `--legacy-peer-deps` and run the React plugin against an unsupported major — revisit once the plugin supports 10. Lint scope is `.js`/`.jsx` only; `scripts/**/*.mjs` is intentionally excluded (it has never been linted). The bar is **0 errors**; warnings are non-blocking by design (the codebase predates linting). The react-hooks 7 React-Compiler rules (`set-state-in-effect`, `preserve-manual-memoization`) are set to `warn` rather than error for the same reason.

### Flaky test

`tests/integration/DraftCompleteness.test.js` is stochastic — the AI draft simulation uses unseeded `Math.random()` (in `aiManager.js`), so it fails at a low rate even on correct code. A single failure on a full-suite run is almost certainly flakiness, not a regression: re-run it in isolation to confirm —

```
npx vitest --run tests/integration/DraftCompleteness.test.js
```

Making the simulation RNG seedable would fix this for good (see the K/DST and roster-completeness invariants it guards).

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
