// Dedicated Vitest config for the on-demand bidding-audit harness.
// Kept separate so the default `test:run` suite never picks up the audit
// (it isn't a `*.test.*` file and isn't in the default include).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/bidding-audit.mjs'],
    // The audit runs hundreds of full drafts in one test; give it room.
    testTimeout: 600000,
    hookTimeout: 600000
  }
})
