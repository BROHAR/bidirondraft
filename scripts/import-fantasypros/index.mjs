// Merge FantasyPros projections into src/data/players.json as a second
// projection block (projectedPointsFP) alongside the ESPN-derived
// projectedPoints. The app's "Point Projections" setup option picks which
// block feeds the draft.
//
// Input: the per-position CSVs exported from fantasypros.com/nfl/projections
// and dropped into data/projections/ as
// FantasyPros_Fantasy_Football_Projections_<POS>.csv (QB/RB/WR/TE/K/DST).
// Run with: npm run import-fantasypros
//
// Points are computed from raw stats with the same scoring rules as
// scripts/refresh-projections/process.mjs (no fumble penalty — parity with
// the ESPN-derived numbers) so the two sources differ only in projections,
// not in scoring math. K/DST use FantasyPros' FPTS directly, mirroring how
// process.mjs uses ESPN's projected total for those positions.

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { normalizeName, splitCsvLine, splitCsvRecords } from '../refresh-projections/process.mjs'

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const PLAYERS_JSON = path.join(PROJECT_ROOT, 'src/data/players.json')
const CSV_DIR = path.join(PROJECT_ROOT, 'data/projections')

// FantasyPros repeats header names across stat groups ("YDS" appears for both
// passing and rushing), so columns are mapped positionally per file. Indices
// are relative to the row start; 0=Player, 1=Team.
const FILE_LAYOUTS = {
  QB:  { pass_yds: 4, pass_td: 5, int: 6, rush_yds: 8, rush_td: 9 },
  RB:  { rush_yds: 3, rush_td: 4, rec: 5, rec_yds: 6, rec_td: 7 },
  WR:  { rec: 2, rec_yds: 3, rec_td: 4, rush_yds: 6, rush_td: 7 },
  TE:  { rec: 2, rec_yds: 3, rec_td: 4 },
  K:   {},
  DST: {},
}

// FantasyPros formats large numbers with thousands separators ("1,381.4").
const num = (v) => parseFloat(String(v ?? '').replace(/[",]/g, '')) || 0

function round1(x) { return Math.round(x * 10) / 10 }

// Same offensive scoring as refresh-projections/process.mjs.
function computePoints(stats, position, fpts) {
  if (position === 'K' || position === 'DST') {
    const pts = round1(fpts)
    return { standard: pts, halfPPR: pts, ppr: pts }
  }
  const standard = 0.04 * stats.pass_yds + 4 * stats.pass_td - 2 * stats.int
    + 0.1 * stats.rush_yds + 6 * stats.rush_td
    + 0.1 * stats.rec_yds + 6 * stats.rec_td
  return {
    standard: round1(standard),
    halfPPR: round1(standard + 0.5 * stats.rec),
    ppr: round1(standard + 1.0 * stats.rec),
  }
}

// The pool keys defenses as "Texans D/ST"; FantasyPros uses "Houston Texans".
// Every NFL nickname is a single word, so the last word is the join key.
function dstKeyFromTeamName(name) {
  return normalizeName(name.trim().split(/\s+/).pop())
}

// Parse one per-position CSV into { key -> projectedPoints } entries.
export function parseFantasyProsCsv(text, position) {
  const layout = FILE_LAYOUTS[position]
  const records = splitCsvRecords(text.replace(/^﻿/, ''))
  const entries = []
  // Skip the header; FantasyPros also emits a junk near-empty second row.
  for (const line of records.slice(1)) {
    const cells = splitCsvLine(line).map(c => c.replace(/^"|"$/g, ''))
    const name = (cells[0] || '').trim()
    if (!name) continue
    const fpts = num(cells[cells.length - 1])
    const stats = { pass_yds: 0, pass_td: 0, int: 0, rush_yds: 0, rush_td: 0, rec: 0, rec_yds: 0, rec_td: 0 }
    for (const [stat, idx] of Object.entries(layout)) stats[stat] = num(cells[idx])
    const key = (position === 'DST' ? dstKeyFromTeamName(name) : normalizeName(name)) + position
    entries.push({ key, name, projectedPoints: computePoints(stats, position, fpts) })
  }
  return entries
}

// Abort rather than write if the merge looks broken (wrong CSVs, layout drift).
const MIN_MATCHED = 200

export function importFantasyPros() {
  const byKey = new Map()
  for (const position of Object.keys(FILE_LAYOUTS)) {
    const file = path.join(CSV_DIR, `FantasyPros_Fantasy_Football_Projections_${position}.csv`)
    if (!fs.existsSync(file)) {
      console.warn(`  ! Missing ${path.basename(file)} — ${position} skipped`)
      continue
    }
    for (const e of parseFantasyProsCsv(fs.readFileSync(file, 'utf-8'), position)) {
      byKey.set(e.key, e.projectedPoints)
    }
  }
  if (!byKey.size) throw new Error(`No FantasyPros CSVs found in ${CSV_DIR}`)

  const data = JSON.parse(fs.readFileSync(PLAYERS_JSON, 'utf-8'))
  let matched = 0
  const players = data.players.map(p => {
    const fp = byKey.get(normalizeName(p.name) + p.position)
    if (!fp) {
      // Drop any stale FP block from a previous import that no longer matches.
      const { projectedPointsFP: _stale, ...rest } = p
      return rest
    }
    matched++
    // Rebuild the object so projectedPointsFP sits next to projectedPoints.
    return {
      id: p.id, name: p.name, position: p.position, team: p.team,
      estimatedValue: p.estimatedValue,
      projectedPoints: p.projectedPoints,
      projectedPointsFP: fp,
      byeWeek: p.byeWeek,
      injuryStatus: p.injuryStatus || '',
    }
  })
  if (matched < MIN_MATCHED) {
    throw new Error(`Only ${matched} of ${byKey.size} FantasyPros players matched the pool (need ${MIN_MATCHED}) — players.json was NOT modified`)
  }

  fs.writeFileSync(PLAYERS_JSON, JSON.stringify({ players }, null, 2) + '\n')
  console.log(`✓ FantasyPros projections: ${matched} of ${data.players.length} pool players matched (${byKey.size} FP entries)`)
  console.log(`✓ Wrote ${PLAYERS_JSON}`)
  return { matched, total: data.players.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  importFantasyPros()
}
