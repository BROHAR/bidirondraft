---
name: verify
description: Build/launch/drive recipe for verifying Bid Iron Draft UI changes end-to-end with Playwright
---

# Verifying Bid Iron Draft changes

## Launch

```bash
npm run dev   # Vite, serves http://localhost:3000
```

## Drive to a live auction (Playwright)

Playwright is a project dependency; import it by absolute path from scripts
outside the repo (e.g. a scratchpad script):

```js
import { chromium } from '/home/brohar/dev/projects/adraft/node_modules/playwright/index.mjs'
```

Flow from cold load to the BIDDING state:

1. `page.click('button.title-screen-start')` — title screen
2. `page.click('button:has-text("Next →")')` twice — setup wizard steps 1→3
3. `page.click('.setup-wizard-nav .btn-primary.btn-large')` — launch CTA
4. `await page.waitForSelector('.bid-buttons', { timeout: 60000 })` — the human
   nominates first but the nomination timer auto-nominates on timeout, so
   BIDDING is always reached without interacting with the player pool.

Add `page.on('dialog', d => d.accept())` — an active draft registers a
beforeunload guard.

## Gotchas

- AI teams bid in real time: after clicking a bid button, the amount can jump
  well past your increment within ~500ms. Assert the click registered (amount
  changed), not an exact value. For deterministic checks, seed via
  `src/utils/rng.js` (test-only).
- Layout regimes to check for auction-panel changes: 375×667 (mobile panel +
  bottom nav), 900×700 and 900×500 (single column ≤1200px), 1300×700 (2-col
  ≤1560px), 1600×900 (4-col). The 769–1560px band uses content-sized grid rows
  with `.draft-main` as the scrollport; ≥1561px and ≤768px scroll inside
  `.auction-block` itself. The sticky `.bid-controls` bar depends on which
  element is the scrollport — verify at both regimes.
