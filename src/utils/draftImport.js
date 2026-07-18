// Parses a real league's auction draft results CSV into pick records for
// league-profile fitting (leagueProfile.js). The format is strict by design —
// a documented header + six named columns (sample: data/2025_draft_results.csv)
// — so parsing failures are actionable ("missing column X") instead of the
// silent misreads a tolerant free-text parser risks.
//
//   Pick,Player,NFL Team,Position,Salary,Fantasy Team
//   1,Patrick Mahomes,KC,QB,8,PrestigeWorldWide
//
// Columns are resolved by (case/whitespace-insensitive) header name, so column
// order doesn't matter. No player-pool name matching happens here or anywhere
// downstream: fitting is book-free (see leagueProfile.js), so records carry
// only what the CSV states.

export const REQUIRED_COLUMNS = ['pick', 'player', 'nfl team', 'position', 'salary', 'fantasy team']

export const EXAMPLE_HEADER = 'Pick,Player,NFL Team,Position,Salary,Fantasy Team'

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// Minimal quote-aware CSV field splitter. Team/player names carry apostrophes
// but commas-in-quotes are cheap insurance for hand-edited files.
export function splitCsvFields(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields.map(f => f.trim())
}

function normalizePosition(raw) {
  const p = (raw || '').toUpperCase().replace(/\s+/g, '')
  if (p === 'DEF' || p === 'D/ST' || p === 'DST') return 'DST'
  return VALID_POSITIONS.includes(p) ? p : null
}

// Parse CSV text into { records, teams, hasPickOrder, suggestedBudget,
// errors, warnings }. `errors` (non-empty ⇒ unusable input: bad header / no
// rows) is distinct from `warnings` (skipped or suspicious rows; parse
// continues). Never throws.
export function parseDraftCsv(text) {
  const errors = []
  const warnings = []
  const records = []

  const lines = (text || '').split(/\r\n|\r|\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) {
    return { records, teams: [], hasPickOrder: false, suggestedBudget: 200, errors: ['The file is empty.'], warnings }
  }

  // Header: every required column must be present by name.
  const headerFields = splitCsvFields(lines[0]).map(f => f.toLowerCase().replace(/\s+/g, ' ').trim())
  const colIndex = {}
  for (const col of REQUIRED_COLUMNS) colIndex[col] = headerFields.indexOf(col)
  const missing = REQUIRED_COLUMNS.filter(c => colIndex[c] === -1)
  if (missing.length > 0) {
    errors.push(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected header: ${EXAMPLE_HEADER}`)
    return { records, teams: [], hasPickOrder: false, suggestedBudget: 200, errors, warnings }
  }

  const seen = new Set()
  let blankPicks = 0

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1
    const fields = splitCsvFields(lines[i])
    const get = col => fields[colIndex[col]] ?? ''

    const name = get('player')
    const fantasyTeam = get('fantasy team')
    const position = normalizePosition(get('position'))
    const salaryRaw = get('salary').replace(/^\$/, '')
    const price = /^\d+$/.test(salaryRaw) ? parseInt(salaryRaw, 10) : NaN
    const pickRaw = get('pick')
    const pick = /^\d+$/.test(pickRaw) ? parseInt(pickRaw, 10) : null

    if (!name || !fantasyTeam) {
      warnings.push(`Line ${lineNo}: missing player or fantasy team — row skipped.`)
      continue
    }
    if (!Number.isFinite(price) || price < 1) {
      warnings.push(`Line ${lineNo}: salary "${get('salary')}" is not a positive whole number — row skipped.`)
      continue
    }
    if (!position) {
      warnings.push(`Line ${lineNo}: position "${get('position')}" not recognized (expected QB/RB/WR/TE/K/DEF) — row skipped.`)
      continue
    }
    if (pick === null) blankPicks++

    const dupKey = `${name}|${position}|${price}|${fantasyTeam}|${pick ?? ''}`
    if (seen.has(dupKey)) {
      warnings.push(`Line ${lineNo}: duplicate of an earlier row — skipped.`)
      continue
    }
    seen.add(dupKey)

    records.push({
      pick,
      name,
      nflTeam: get('nfl team').toUpperCase() || null,
      position,
      price,
      fantasyTeam,
      line: lineNo,
    })
  }

  if (records.length === 0 && errors.length === 0) {
    errors.push('No valid draft rows found. Expected header: ' + EXAMPLE_HEADER)
  }

  // Teams in first-appearance order with totals.
  const teamOrder = []
  const teamStats = new Map()
  for (const r of records) {
    if (!teamStats.has(r.fantasyTeam)) {
      teamStats.set(r.fantasyTeam, { name: r.fantasyTeam, picks: 0, spend: 0 })
      teamOrder.push(r.fantasyTeam)
    }
    const t = teamStats.get(r.fantasyTeam)
    t.picks++
    t.spend += r.price
  }
  const teams = teamOrder.map(n => teamStats.get(n))

  // Pick order is trustworthy when at most a third of rows lack a number.
  const hasPickOrder = records.length > 0 && blankPicks <= records.length / 3

  // A team can't spend more than its budget, so the max team total is the
  // best available floor for what the league's budget was.
  const suggestedBudget = teams.length > 0 ? Math.max(...teams.map(t => t.spend), 1) : 200

  return { records, teams, hasPickOrder, suggestedBudget, errors, warnings }
}
