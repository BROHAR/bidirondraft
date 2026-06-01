// Process a scraped CSV into src/data/players.json with computed scoring
// for standard / halfPPR / ppr formats. Preserves estimatedValue and byeWeek
// from the existing players.json by name+position match.

import fs from 'fs'
import path from 'path'

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const PLAYERS_JSON = path.join(PROJECT_ROOT, 'src/data/players.json')

// Quote-aware single-line CSV split. ESPN/Yahoo emit comma-containing fields
// (e.g. "WR,CB" multi-position chips) which rowToCsv escapes via double
// quotes; a naive line.split(',') would shift columns and corrupt the row.
export function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCsv(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  const headers = splitCsvLine(lines[0])
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => {
      const v = cells[i]
      // Numeric fields all parse to numbers; name/position/team/injury_status stay as strings
      if (['name', 'position', 'team', 'injury_status'].includes(h)) {
        row[h] = v || ''
      } else {
        row[h] = v === undefined || v === '' ? 0 : parseFloat(v) || 0
      }
    })
    return row
  })
}

// Standard NFL fantasy scoring (offensive players)
function standardPoints(row) {
  const passing  = 0.04 * row.pass_yds + 4 * row.pass_td - 2 * row.int
  const rushing  = 0.1  * row.rush_yds + 6 * row.rush_td
  const receiving = 0.1 * row.rec_yds + 6 * row.rec_td
  return passing + rushing + receiving
}

// ESPN's Sortable Projections doesn't expose all the data we'd need to compute
// K and DST scoring from raw stats (no points-allowed tiers for DST, no
// kicking stats in the All-view column set for K). Use ESPN's projected total
// directly for both — fantasy formats don't vary for K or DST anyway.
function kickerPoints(row) { return row.espn_fpts }
function defensePoints(row) { return row.espn_fpts }

function computeProjectedPoints(row) {
  if (row.position === 'K') {
    const pts = Math.round(kickerPoints(row) * 10) / 10
    return { standard: pts, halfPPR: pts, ppr: pts }
  }
  if (row.position === 'DST') {
    const pts = Math.round(defensePoints(row) * 10) / 10
    return { standard: pts, halfPPR: pts, ppr: pts }
  }
  // Offensive: compute from raw stats. PPR adds reception bonus.
  const standard = standardPoints(row)
  const halfPPR = standard + 0.5 * row.rec
  const ppr = standard + 1.0 * row.rec
  return {
    standard: Math.round(standard * 10) / 10,
    halfPPR: Math.round(halfPPR * 10) / 10,
    ppr: Math.round(ppr * 10) / 10,
  }
}

// "Ja'Marr Chase Jr." -> "jamarrchase"
// Also strips a trailing " D/ST" / " DST" so ESPN's "Bengals D/ST" matches
// Yahoo's "Bengals" when keying defenses by name+position.
export function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[.'’,]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b/gi, '')
    .replace(/\s+d\/?st\b/i, '')
    .replace(/\s+/g, '')
}

// Crude rank-based default for genuinely new players (no existing match).
function defaultEstimatedValue(rank) {
  if (rank < 24) return Math.round(50 - rank * 1.0)
  if (rank < 84) return Math.round(20 - (rank - 24) * 0.25)
  return Math.max(1, 3 - Math.floor((rank - 84) / 50))
}

// Kickers and defenses are worth a couple dollars at most. Clamp them into a
// sane band regardless of Yahoo Proj $ or a stale players.json value, so the
// pipeline can never emit an inflated (or zero) K/DST value that would let the
// AI bid stack run a kicker auction into the double digits.
function clampKDST(position, value) {
  if (position === 'K' || position === 'DST') {
    return Math.max(1, Math.min(3, Math.round(value || 0)))
  }
  return value
}

// Generate next available player_NNN id given existing ids.
function nextIdGenerator(existingIds) {
  const used = new Set(existingIds)
  let n = 1
  return () => {
    while (used.has(`player_${String(n).padStart(3, '0')}`)) n++
    const id = `player_${String(n).padStart(3, '0')}`
    used.add(id)
    n++
    return id
  }
}

// Parse the simpler Yahoo CSV: name,position,team,proj_dollars
function parseYahooCsv(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  // skip header
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    return {
      name: cells[0] || '',
      position: cells[1] || '',
      team: cells[2] || '',
      proj_dollars: parseFloat(cells[3]) || 0,
    }
  })
}

export async function processCsv(csvPath, yahooCsvPath = null) {
  const csv = fs.readFileSync(csvPath, 'utf-8')
  const rows = parseCsv(csv)

  // Build Yahoo Proj $ lookup keyed by normalized name + position.
  const yahooByKey = new Map()
  if (yahooCsvPath && fs.existsSync(yahooCsvPath)) {
    const yahooRows = parseYahooCsv(fs.readFileSync(yahooCsvPath, 'utf-8'))
    for (const y of yahooRows) {
      yahooByKey.set(normalizeName(y.name) + y.position, y.proj_dollars)
    }
  }

  // Compute projections for each row
  const scraped = rows.map(row => ({
    name: row.name,
    position: row.position,
    team: row.team,
    injuryStatus: row.injury_status || '',
    projectedPoints: computeProjectedPoints(row),
    _normalized: normalizeName(row.name),
    _standard: standardPoints(row), // for ranking new players
  }))

  // Sort offensive players by standard points for rank-based defaults
  const offensiveByRank = scraped
    .filter(p => !['K', 'DST'].includes(p.position))
    .sort((a, b) => b._standard - a._standard)
  const rankByName = new Map(offensiveByRank.map((p, i) => [p._normalized + p.position, i]))

  // Load existing players.json
  let existing = { players: [] }
  if (fs.existsSync(PLAYERS_JSON)) {
    existing = JSON.parse(fs.readFileSync(PLAYERS_JSON, 'utf-8'))
  }
  const existingByKey = new Map()
  for (const p of existing.players || []) {
    existingByKey.set(normalizeName(p.name) + p.position, p)
  }

  const nextId = nextIdGenerator((existing.players || []).map(p => p.id))

  let matched = 0
  let added = 0
  let yahooValuesApplied = 0
  const newPlayers = scraped.map(p => {
    const key = p._normalized + p.position
    const old = existingByKey.get(key)
    // Yahoo's Proj $ is authoritative for estimatedValue when available.
    // Fall back to the existing players.json value, then to a rank-based
    // default for genuinely new players with no other signal.
    const yahooDollars = yahooByKey.get(key)
    if (old) {
      matched++
      const estimatedValue = clampKDST(p.position, yahooDollars !== undefined ? yahooDollars : old.estimatedValue)
      if (yahooDollars !== undefined) yahooValuesApplied++
      return {
        id: old.id,
        name: p.name,
        position: p.position,
        team: p.team,
        estimatedValue,
        projectedPoints: p.projectedPoints,
        byeWeek: old.byeWeek,
        injuryStatus: p.injuryStatus || '',
      }
    }
    added++
    const rank = rankByName.get(key) ?? 999
    let estimatedValue
    if (yahooDollars !== undefined) {
      estimatedValue = yahooDollars
      yahooValuesApplied++
    } else if (['K', 'DST'].includes(p.position)) {
      estimatedValue = 1
    } else {
      estimatedValue = defaultEstimatedValue(rank)
    }
    estimatedValue = clampKDST(p.position, estimatedValue)
    return {
      id: nextId(),
      name: p.name,
      position: p.position,
      team: p.team,
      estimatedValue,
      projectedPoints: p.projectedPoints,
      byeWeek: 0,
      injuryStatus: p.injuryStatus || '',
    }
  })

  const dropped = (existing.players || []).length - matched

  // Sort by estimatedValue desc (matches existing convention)
  newPlayers.sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0))

  fs.writeFileSync(PLAYERS_JSON, JSON.stringify({ players: newPlayers }, null, 2) + '\n')

  console.log(`✓ Scraped ${scraped.length} players`)
  console.log(`  Matched ${matched} existing entries`)
  console.log(`  Added ${added} new entries`)
  console.log(`  Dropped ${dropped} entries not present in scrape`)
  if (yahooByKey.size > 0) {
    console.log(`  Applied Yahoo Proj $ to ${yahooValuesApplied} players (of ${yahooByKey.size} Yahoo entries)`)
  }
  console.log(`✓ Wrote ${PLAYERS_JSON}`)
}
