// Parses a user-supplied CSV of custom player values / projected points into
// override entries for the Customize Players modal (playerOverrides.js).
//
// Unlike the draft-history import there is no canonical export format for a
// "cheat sheet" CSV, so headers are matched against common synonyms (Value /
// AAV / Salary, Points / FPTS, …) — but structure stays strict: a named
// header row is required, and rows that don't parse are skipped with a
// per-line warning instead of being guessed at.
//
//   Player,Position,Value,Points
//   Bijan Robinson,RB,55,290.5
//
// The file is untrusted input. Safety posture, mirroring draftImport.js:
// never throws; hard row/field-length caps so a huge or hostile file can't
// wedge the tab; numeric fields must be finite and inside known bounds;
// entries are keyed by pool player ids (never by strings from the file), so
// the result can't smuggle arbitrary keys into the overrides object.

import { splitCsvFields } from './draftImport'
import { nameKey } from './keepers'

export const EXAMPLE_HEADER = 'Player,Position,Value,Points'

export const MAX_ROWS = 5000
const MAX_FIELD_LENGTH = 128
// Mirrors playerOverrides.js sanitize bounds for estimatedValue; points get a
// bound comfortably above any real season projection.
const MAX_VALUE = 100000
const MAX_POINTS = 10000

// Header synonyms, compared case/whitespace-insensitively.
const COLUMN_ALIASES = {
  player: ['player', 'name', 'player name'],
  position: ['position', 'pos'],
  value: ['value', 'auction value', 'aav', 'salary', 'price', 'dollar value', 'est value', 'estimated value', 'proj $'],
  points: ['points', 'pts', 'proj points', 'proj pts', 'projected points', 'fpts', 'fantasy points', 'projection'],
}

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

function normalizePosition(raw) {
  const p = (raw || '').toUpperCase().replace(/\s+/g, '')
  if (p === 'DEF' || p === 'D/ST' || p === 'DST') return 'DST'
  return VALID_POSITIONS.includes(p) ? p : null
}

// "$45", "45.0", "1,250" → number; anything else → NaN.
function parseNumeric(raw) {
  const cleaned = (raw || '').replace(/^\$/, '').replace(/,/g, '').trim()
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN
  return parseFloat(cleaned)
}

// Parse CSV text against the current player pool. Returns
// { entries, errors, warnings } — `errors` non-empty means unusable input
// (bad header / no usable rows); `warnings` are skipped rows, parse continues.
// Never throws.
//
// entries: [{ playerId, name, position, value?, points? }] — name/position
// echo the POOL player (not the file) for preview display; value is rounded
// to whole dollars in the league's budget scale, points to one decimal.
export function parsePlayerValuesCsv(text, players) {
  const errors = []
  const warnings = []
  const entries = []

  const lines = (text || '').split(/\r\n|\r|\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) {
    return { entries, errors: ['The file is empty.'], warnings }
  }
  if (lines.length - 1 > MAX_ROWS) {
    errors.push(`Too many rows (${lines.length - 1}) — a player values file should have at most ${MAX_ROWS}. Check that this is the right file.`)
    return { entries, errors, warnings }
  }

  // Resolve columns by header name, accepting common synonyms.
  const headerFields = splitCsvFields(lines[0]).map(f => f.toLowerCase().replace(/\s+/g, ' ').trim())
  const colIndex = {}
  for (const [col, aliases] of Object.entries(COLUMN_ALIASES)) {
    colIndex[col] = headerFields.findIndex(h => aliases.includes(h))
  }
  if (colIndex.player === -1) {
    errors.push(`No player-name column found (looked for: ${COLUMN_ALIASES.player.join(', ')}). Expected header like: ${EXAMPLE_HEADER}`)
    return { entries, errors, warnings }
  }
  if (colIndex.value === -1 && colIndex.points === -1) {
    errors.push(`No value or points column found (looked for: ${COLUMN_ALIASES.value.join(', ')} / ${COLUMN_ALIASES.points.join(', ')}). Expected header like: ${EXAMPLE_HEADER}`)
    return { entries, errors, warnings }
  }

  // Pool lookups: exact name+position, and name-only for files without a
  // position column (only trusted when the name is unique in the pool).
  const byNamePos = new Map()
  const byName = new Map()
  for (const p of players || []) {
    const key = nameKey(p.name)
    byNamePos.set(`${key}|${p.position}`, p)
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(p)
  }

  const entryByPlayerId = new Map()

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1
    const fields = splitCsvFields(lines[i])
    const get = col => (colIndex[col] === -1 ? '' : (fields[colIndex[col]] ?? '')).slice(0, MAX_FIELD_LENGTH)

    const name = get('player')
    if (!name) {
      warnings.push(`Line ${lineNo}: missing player name — row skipped.`)
      continue
    }

    const valueRaw = get('value')
    const pointsRaw = get('points')
    let value
    if (colIndex.value !== -1 && valueRaw !== '') {
      const v = parseNumeric(valueRaw)
      if (!Number.isFinite(v) || v < 0 || v > MAX_VALUE) {
        warnings.push(`Line ${lineNo}: value "${valueRaw}" is not a number between 0 and ${MAX_VALUE} — row skipped.`)
        continue
      }
      value = Math.round(v)
    }
    let points
    if (colIndex.points !== -1 && pointsRaw !== '') {
      const v = parseNumeric(pointsRaw)
      if (!Number.isFinite(v) || v < 0 || v > MAX_POINTS) {
        warnings.push(`Line ${lineNo}: points "${pointsRaw}" is not a number between 0 and ${MAX_POINTS} — row skipped.`)
        continue
      }
      points = Math.round(v * 10) / 10
    }
    if (value === undefined && points === undefined) {
      warnings.push(`Line ${lineNo}: no value or points given — row skipped.`)
      continue
    }

    // Match against the pool. Position narrows the match when present;
    // without one, a name shared by multiple pool players is ambiguous.
    const key = nameKey(name)
    const position = normalizePosition(get('position'))
    let player = null
    if (position) {
      player = byNamePos.get(`${key}|${position}`) || null
    } else {
      const candidates = byName.get(key) || []
      if (candidates.length > 1) {
        warnings.push(`Line ${lineNo}: "${name}" matches multiple players — add a Position column to disambiguate. Row skipped.`)
        continue
      }
      player = candidates[0] || null
    }
    if (!player) {
      warnings.push(`Line ${lineNo}: "${name}"${position ? ` (${position})` : ''} not found in the player pool — row skipped.`)
      continue
    }

    if (entryByPlayerId.has(player.id)) {
      warnings.push(`Line ${lineNo}: duplicate entry for ${player.name} — later row wins.`)
    }
    const entry = { playerId: player.id, name: player.name, position: player.position }
    if (value !== undefined) entry.value = value
    if (points !== undefined) entry.points = points
    entryByPlayerId.set(player.id, entry)
  }

  entries.push(...entryByPlayerId.values())

  if (entries.length === 0 && errors.length === 0) {
    errors.push('No rows matched players in the pool. Expected header like: ' + EXAMPLE_HEADER)
  }

  return { entries, errors, warnings }
}

// Merge parsed entries into an overrides object (playerOverrides.js shape).
// Imported values land in the same slots the modal inputs write: value →
// estimatedValue (league-budget dollars), points → projectedPoints under the
// league's scoring format. Existing overrides for untouched players/fields
// are preserved.
export function mergeImportedOverrides(overrides, entries, scoringFormat) {
  const next = { ...overrides }
  for (const e of entries || []) {
    const existing = next[e.playerId] ? { ...next[e.playerId] } : {}
    if (typeof e.value === 'number') existing.estimatedValue = e.value
    if (typeof e.points === 'number') {
      existing.projectedPoints = { ...existing.projectedPoints, [scoringFormat]: e.points }
    }
    next[e.playerId] = existing
  }
  return next
}
