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

> Prerequisite: the scrape needs Playwright's Chromium binary. On a fresh clone or after a Playwright version bump, run `npx playwright install chromium` first — otherwise it fails with `Executable doesn't exist … chrome-headless-shell`.

After it finishes, optionally:

- `npm run test:run` to confirm the test suite still passes
- `git add src/data/players.json data/projections/projections-*.csv data/projections/yahoo-salcap-*.csv && git commit -m "Refresh player projections"` if the user wants the new data committed

Expected runtime: ~2-3 minutes (ESPN's pagination is async with multi-second latency per page; the script handles this with a 10s warmup + first-row-change detection per Next click).

### What the refresh does

Implemented in `scripts/refresh-projections/`:

- **`scrape.mjs`** — Playwright (Chromium, headless). Three passes in one browser session:
  1. ESPN Sortable Projections "All" view, 10 pages × 50 rows = 500 offensive players. Captures top kickers naturally (ESPN's K position filter is broken — only changes column headers, not row filter).
  2. ESPN D/ST filter view, 1 page = 32 defenses. Re-navigates the page first because the position filter goes unresponsive after extensive pagination.
  3. Yahoo Fantasy salary-cap draft analysis (`?count=500`), single request, used for the authoritative auction `estimatedValue`.

- **`process.mjs`** — Computes fantasy points (standard / halfPPR / ppr) from raw passing+rushing+receiving stats. K and DST use ESPN's projected points directly. Merges by normalized name + position: Yahoo's "Proj $" wins for `estimatedValue` when matched; otherwise the existing `players.json` value is preserved; new entries get a rank-based default. `byeWeek` is preserved from existing entries (Sortable Projections doesn't expose it).

- **`index.mjs`** — Orchestrator (the npm entry point).

### Audit trail

Each refresh writes timestamped CSVs to `data/projections/`:
- `projections-YYYY-MM-DD.csv` — ESPN scraped stats
- `yahoo-salcap-YYYY-MM-DD.csv` — Yahoo Proj $ values

Useful for diffing scrapes over time and troubleshooting if a future ESPN/Yahoo page change breaks parsing.

### Things that can break

- **ESPN selector changes**: `scrape.mjs` keys on `.player-column__athlete a`, `.playerinfo__playerteam`, `.playerinfo__playerpos`, `button.Pagination__Button--next`, `.Pagination__list__item--active`, `label.picker-option`. If a refresh throws a clear "could not switch to Sortable Projections view" or "Position filter did not apply" error, ESPN changed their HTML — open the page in a browser, inspect the new structure, update selectors.
- **Yahoo selector changes**: keys on `[data-tst="player-name"]` and `[data-tst="player-position"]`. Same playbook.
- **Pagination timing**: ESPN's pagination is debounced/async. If pages stop advancing partway through (only N×50 rows scraped instead of 500), bump the `waitForFunction` timeout in `gotoNextPage` (currently 15s) or the post-Sortable-switch warmup wait (currently 10s).
