// Ad-hoc diff between the ESPN projections CSV and the Yahoo salary-cap CSV,
// using the same name+position normalization that process.mjs uses to join.
// Run: node scripts/refresh-projections/diff-sources.mjs <espn.csv> <yahoo.csv>

import fs from 'fs'
import { splitCsvLine, normalizeName } from './process.mjs'
import { normalizePosition } from './positions.mjs'

function readCsv(path) {
  const lines = fs.readFileSync(path, 'utf8').split('\n').filter(l => l.trim())
  const headers = splitCsvLine(lines[0])
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = cells[i] })
    return row
  })
}

const [, , espnPath, yahooPath] = process.argv
if (!espnPath || !yahooPath) {
  console.error('usage: node diff-sources.mjs <espn.csv> <yahoo.csv>')
  process.exit(1)
}

const espn = readCsv(espnPath)
const yahoo = readCsv(yahooPath)
const key = r => normalizeName(r.name) + '|' + normalizePosition(r.position)

const espnByKey = new Map(espn.map(r => [key(r), r]))
const yahooByKey = new Map(yahoo.map(r => [key(r), r]))

const espnOnly = espn.filter(r => !yahooByKey.has(key(r)))
const yahooOnly = yahoo.filter(r => !espnByKey.has(key(r)))

console.log(`ESPN total: ${espn.length}  Yahoo total: ${yahoo.length}`)
console.log()
console.log(`=== In ESPN but NOT in Yahoo (${espnOnly.length}) ===`)
for (const r of espnOnly) {
  const pos = normalizePosition(r.position) || '?'
  console.log(`  ${r.name.padEnd(28)} ${pos.padEnd(4)} ${r.team}`)
}
console.log()
console.log(`=== In Yahoo but NOT in ESPN (${yahooOnly.length}) ===`)
for (const r of yahooOnly) {
  const pos = normalizePosition(r.position) || '?'
  console.log(`  ${r.name.padEnd(28)} ${pos.padEnd(4)} ${r.team}  $${r.proj_dollars}`)
}
