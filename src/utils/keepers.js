import { Team } from '../models/Team.js'
import { isPositionStartable } from './positionEligibility.js'

// Keeper leagues (not dynasty): each team may retain a small number of players
// from last season at a fixed price. Keepers are modeled as pre-completed
// auction purchases — the player goes on the roster with purchasePrice set,
// the price comes out of remainingBudget, and the player leaves the auction
// pool before the draft starts. Everything downstream (maxBid, roster
// reservation, endgame spend floor, pacing) reads live team state, so no
// strategy/engine special-casing is needed beyond the value anchor netting
// in DraftEngine.initializeDraft.
//
// Keeper entry shape (plain JSON so it survives the meta-sim worker's
// JSON round-trip): { teamPosition, playerId, name, position, price }
// - teamPosition is the 1-based draft seat (matches humanDraftPosition).
// - name/position are denormalized from the player pool so validation and
//   display work without loading players.json.

export const KEEPER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
export const DEFAULT_MAX_KEEPERS = 3
export const MAX_KEEPERS_LIMIT = 5

function totalRosterSize(rosterPositions) {
  return Object.values(rosterPositions || {}).reduce((s, c) => s + c, 0)
}

// Required-slot reservation for a hypothetical roster of keeper positions,
// using the real Team need/flex/superflex semantics (Team methods only read
// player.position, so plain {position} stubs suffice).
function reservedSlotsFor(keeperPositions, rosterPositions) {
  const team = new Team('keeper_check', 'keeper_check', false, { rosterPositions })
  team.roster = keeperPositions.map(position => ({ position }))
  let reserved = 0
  for (const pos of KEEPER_POSITIONS) reserved += team.getPositionNeed(pos)
  reserved += team.getFlexNeed()
  reserved += team.getSuperflexNeed()
  return reserved
}

// Structural + economic validation. Called from DraftConfig.validate(), so it
// must not throw on malformed input — everything becomes an error string.
export function validateKeepers(config) {
  const errors = []
  const keepers = config.keepers
  if (keepers == null) return errors
  if (!Array.isArray(keepers)) {
    errors.push('Keepers must be a list')
    return errors
  }
  if (keepers.length === 0) return errors

  const maxKeepers = Number.isInteger(config.maxKeepersPerTeam)
    ? config.maxKeepersPerTeam
    : DEFAULT_MAX_KEEPERS
  if (maxKeepers < 0 || maxKeepers > MAX_KEEPERS_LIMIT) {
    errors.push(`Max keepers per team must be between 0 and ${MAX_KEEPERS_LIMIT}`)
  }

  const rosterSize = totalRosterSize(config.rosterPositions)
  const seenIds = new Set()
  const byTeam = new Map() // teamPosition -> { spend, positions: [] }

  for (const k of keepers) {
    const label = k?.name || k?.playerId || 'unknown player'
    if (!k || typeof k !== 'object') {
      errors.push('Keeper entries must be objects')
      continue
    }
    if (!Number.isInteger(k.teamPosition) || k.teamPosition < 1 || k.teamPosition > config.numberOfTeams) {
      errors.push(`Keeper ${label}: team position must be between 1 and ${config.numberOfTeams}`)
      continue
    }
    if (typeof k.playerId !== 'string' || k.playerId.length === 0) {
      errors.push(`Keeper ${label}: missing player id`)
      continue
    }
    if (!KEEPER_POSITIONS.includes(k.position)) {
      errors.push(`Keeper ${label}: invalid position`)
      continue
    }
    // A keeper at a position the league can never start (e.g. a kicker in a
    // no-K league) would be silently dropped by the engine's pool exclusion —
    // flag it loudly here instead so the user fixes the config.
    if (!isPositionStartable(k.position, config.rosterPositions)) {
      errors.push(`Keeper ${label}: ${k.position} has no starting slot in this league`)
      continue
    }
    if (!Number.isInteger(k.price) || k.price < 1 || k.price > config.budgetPerTeam) {
      errors.push(`Keeper ${label}: price must be between $1 and $${config.budgetPerTeam}`)
      continue
    }
    if (seenIds.has(k.playerId)) {
      errors.push(`Keeper ${label}: kept by more than one team`)
      continue
    }
    seenIds.add(k.playerId)

    if (!byTeam.has(k.teamPosition)) byTeam.set(k.teamPosition, { spend: 0, positions: [] })
    const t = byTeam.get(k.teamPosition)
    t.spend += k.price
    t.positions.push(k.position)
  }

  for (const [teamPosition, { spend, positions }] of byTeam) {
    const teamLabel = `Team ${teamPosition}`
    if (positions.length > maxKeepers) {
      errors.push(`${teamLabel}: at most ${maxKeepers} keepers allowed`)
    }
    const openSlots = rosterSize - positions.length
    // $1 per still-open slot must survive the keeper spend, or the team's
    // opening maxBid is already negative.
    if (spend + openSlots > config.budgetPerTeam) {
      errors.push(`${teamLabel}: keeper prices ($${spend}) leave less than $1 per open roster slot`)
    }
    // Open slots must still cover every unfilled required starter (incl.
    // FLEX/SUPERFLEX), or the draft's completeness invariant is unmeetable.
    if (reservedSlotsFor(positions, config.rosterPositions) > openSlots) {
      errors.push(`${teamLabel}: keepers leave too few open slots to fill required starters`)
    }
  }

  return errors
}

// Match config.keepers against the live teams/players built by the engine.
// Entries that no longer resolve (stale playerId after a projections refresh,
// team count shrank) are silently skipped — validation is the loud gate, this
// is the tolerant one. Duplicate playerIds keep the first entry.
export function resolveKeepers(config, teams, players) {
  const keepers = Array.isArray(config.keepers) ? config.keepers : []
  if (keepers.length === 0) return []
  const byId = new Map(players.map(p => [p.id, p]))
  const seen = new Set()
  const resolved = []
  for (const k of keepers) {
    const team = teams[(Number(k?.teamPosition) || 0) - 1]
    const player = byId.get(k?.playerId)
    if (!team || !player || seen.has(player.id)) continue
    seen.add(player.id)
    resolved.push({ team, player, price: Math.max(1, Math.round(Number(k.price) || 1)) })
  }
  return resolved
}

// The four-step purchase mutation from DraftEngine.completeBidding, replayed
// at init time for each keeper: price on the player, player on the roster,
// price off the budget, player out of the pool. Returns the remaining auction
// pool; returns `players` unchanged (same reference) when there are no
// keepers so the no-keeper path is byte-identical.
export function applyResolvedKeepers(resolved, players) {
  if (!resolved || resolved.length === 0) return players
  const keptIds = new Set()
  for (const { team, player, price } of resolved) {
    player.purchasePrice = price
    player.isKeeper = true
    team.roster.push(player)
    team.remainingBudget -= price
    keptIds.add(player.id)
  }
  return players.filter(p => !keptIds.has(p.id))
}

// --- Keepers from last year's imported draft --------------------------------

// Loose name key for matching imported picks to the current pool: lowercase,
// strip punctuation and generational suffixes. Position must also match, so
// collisions are effectively impossible in practice.
//
// Ordering matters for safety: whitespace is collapsed BEFORE the anchored
// suffix match. The previous `/\s+(jr|…)$/` ran against raw input and
// backtracked quadratically on long internal whitespace runs (ReDoS — this
// runs per imported pick during render). After collapse+trim, the suffix
// pattern needs no `\s+` and cannot backtrack. The length cap bounds work on
// adversarial single-token input; no real player name approaches 128 chars.
export function nameKey(name) {
  return String(name || '')
    .slice(0, 128)
    .toLowerCase()
    .replace(/[.'’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ (jr|sr|ii|iii|iv|v)$/, '')
}

// Match imported league-profile picks ({name, position, price, fantasyTeam})
// to the current player pool by normalized name + position. Returns
// [{ pick, player|null }] in input order; unmatched picks (retired, renamed,
// dropped from projections) come back with player=null so the UI can show
// them as unavailable rather than silently hiding them.
export function matchPicksToPlayers(picks, players) {
  const byKey = new Map()
  for (const p of players) byKey.set(`${nameKey(p.name)}|${p.position}`, p)
  return (picks || []).map(pick => ({
    pick,
    player: byKey.get(`${nameKey(pick.name)}|${pick.position}`) || null,
  }))
}

// Keeper price rules leagues commonly use, applied to last year's price.
// Clamped to [1, budgetPerTeam] by the caller's validation.
export const KEEPER_PRICE_RULES = [
  { key: 'same', label: 'Same price', apply: p => p },
  { key: 'plus5', label: '+$5', apply: p => p + 5 },
  { key: 'plus10pct', label: '+10% (rounded up)', apply: p => Math.ceil(p * 1.1) },
]

// Sanitizer for setupConfigStore: only structurally sound entries survive a
// load (same posture as sanitizeSpendLimits — drop, don't repair). Economic
// validation stays in validateKeepers; this only guards shape so corrupt
// storage can't wedge the setup screen.
export function sanitizeKeepers(value, maxTeamPosition = 20) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const k of value) {
    if (!k || typeof k !== 'object') continue
    if (!Number.isInteger(k.teamPosition) || k.teamPosition < 1 || k.teamPosition > maxTeamPosition) continue
    if (typeof k.playerId !== 'string' || !k.playerId) continue
    if (!KEEPER_POSITIONS.includes(k.position)) continue
    if (!Number.isInteger(k.price) || k.price < 1 || k.price > 100000) continue
    out.push({
      teamPosition: k.teamPosition,
      playerId: k.playerId,
      name: typeof k.name === 'string' ? k.name : '',
      position: k.position,
      price: k.price,
    })
  }
  return out
}
