# BIDIRON — Fantasy Football Auction Draft Simulator

A single-page web app for practicing **fantasy football auction drafts** against AI
opponents. Nominate players, bid in real time against eleven AI teams that each run a
distinct draft strategy (Balanced, Value Hunter, Stars & Scrubs, Zero-RB, Hero-RB,
Late-Round-QB, and the QB/K/DST-hoarding "Taco"), get an in-draft bid advisor, and
review a full post-draft analysis with VORP and optimal-lineup roles.

Everything runs **client-side** — there is no backend, no account, and no data leaves
your browser. Your custom player-value overrides are saved to `localStorage`.

## Tech stack

- **React 18** + **Vite** (dev/build)
- **Zustand** (state) + **Immer** (immutable updates)
- **Vitest** + Testing Library (unit/integration tests)
- **Playwright** (used only by the offline projection-refresh script)

## Getting started

Requires **Node ≥ 22.12** (see `.nvmrc`).

```bash
npm install
npm run dev          # start the dev server at http://localhost:3000
```

Other scripts:

```bash
npm run build        # production build to dist/
npm run preview      # preview the production build
npm run test         # run tests in watch mode
npm run test:run     # run the full test suite once
npm run lint         # eslint (errors fail; legacy dead-code issues are warnings)
```

> The dev server binds to all interfaces (`server.host: true`), so it is reachable
> from other devices on your LAN. Change `host` in `vite.config.js` if you don't want that.

## Player data

The app ships with a projection set in `src/data/players.json`. You can refresh it:

```bash
npm run refresh-projections
```

> ⚠️ **Third-party data disclaimer.** This script uses Playwright to scrape publicly
> visible projection pages from ESPN and Yahoo Fantasy (it sends a desktop Chrome
> `User-Agent`). The player names, projections, and auction values are the property of
> their respective owners; this project is **not affiliated with or endorsed by** the
> NFL, ESPN, or Yahoo. Scraping and redistributing this data may be contrary to those
> sites' Terms of Service — run the refresh and use the resulting data **at your own
> risk and for personal use only**. See `scripts/refresh-projections/` and `CLAUDE.md`
> for how the refresh works.

## Project layout

```
src/
  components/   React UI
  services/     draft engine, AI manager, auto-pilot, audio
  strategies/   one file per AI draft strategy (extend BaseStrategy)
  models/       Team, Player, DraftConfig
  store/        Zustand store
  utils/        bid advisor, draft analysis, player overrides
  data/         players.json (refreshable projection set)
scripts/
  refresh-projections/   Playwright scraper + processing pipeline
tests/          Vitest unit + integration suites
```

## Contributing

PRs and forks are welcome. Before opening a PR:

```bash
npm run test:run && npm run lint
```

New logic under `src/` should come with tests in `tests/unit/` (a repo hook reminds you
when a source file lacks a matching test). Keep changes consistent with the surrounding
code style.

## License

Licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE).

Copyright (C) 2026 BIDIRON contributors.
