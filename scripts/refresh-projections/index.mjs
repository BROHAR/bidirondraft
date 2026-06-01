// Orchestrator for the ESPN projections refresh.
// Runs: scrape → write CSV → process CSV → rewrite src/data/players.json
//
// Usage: npm run refresh-projections

import { scrapeAll } from './scrape.mjs'
import { processCsv } from './process.mjs'

async function main() {
  const { csvPath, yahooCsvPath } = await scrapeAll()
  await processCsv(csvPath, yahooCsvPath)
  console.log('✓ players.json refreshed')
}

main().catch(err => {
  console.error('Refresh failed:', err)
  process.exit(1)
})
