// Dedicated Vitest config for the on-demand Taco-audit harness.
// Separate from the default suite (taco-audit.mjs isn't a `*.test.*` file).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/taco-audit.mjs'],
    testTimeout: 600000,
    hookTimeout: 600000
  }
})
