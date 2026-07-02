import { StarsAndScrubs } from './StarsAndScrubs.js'
import { Balanced } from './Balanced.js'
import { ZeroRB } from './ZeroRB.js'
import { HeroRB } from './HeroRB.js'
import { ValueHunter } from './ValueHunter.js'
import { LateRoundQB } from './LateRoundQB.js'
import { Taco } from './TacoStrategy.js'
import { createCustomStrategy } from './customStrategy.js'

// Single source of truth for the built-in bidding strategies. aiManager,
// autoPilotService and SetupScreen all derive their lists from here so a
// strategy is declared exactly once. `key` is the class name — the value
// already persisted in saved setup configs (aiTeamStrategies pins,
// autoPilotStrategy) — so existing localStorage configs keep resolving.
export const BUILTIN_STRATEGIES = [
  { key: 'StarsAndScrubs', label: 'Stars & Scrubs', description: 'Elite players and cheap bench', Class: StarsAndScrubs },
  { key: 'Balanced', label: 'Balanced', description: 'Even focus across all positions', Class: Balanced },
  { key: 'ZeroRB', label: 'Zero RB', description: 'Avoid early running backs', Class: ZeroRB },
  { key: 'HeroRB', label: 'Hero RB', description: 'Target elite running back early', Class: HeroRB },
  { key: 'ValueHunter', label: 'Value Hunter', description: 'Target undervalued players', Class: ValueHunter },
  { key: 'LateRoundQB', label: 'Late Round QB', description: 'Wait on quarterbacks', Class: LateRoundQB },
  { key: 'Taco', label: 'Taco', description: 'Homer fan, overpays for top QBs, stacks K/DST', Class: Taco },
]

export const BUILTIN_BY_KEY = Object.fromEntries(
  BUILTIN_STRATEGIES.map(s => [s.key, s])
)

// The class pool aiManager draws from to fill unpinned ("Mixed") AI slots.
// Order matters: the assignment algorithm front-loads StarsAndScrubs and
// cycles the remainder, so keep StarsAndScrubs first to preserve the
// long-standing distribution (and seeded-test determinism).
export const MIXED_FILL_POOL = BUILTIN_STRATEGIES.map(s => s.Class)

const CUSTOM_PREFIX = 'custom:'

export function isCustomKey(key) {
  return typeof key === 'string' && key.startsWith(CUSTOM_PREFIX)
}

export function customKey(id) {
  return `${CUSTOM_PREFIX}${id}`
}

// Build the {value, label} option list for the setup dropdowns: every built-in
// followed by the user's custom strategies. Keeps the exact "Name - description"
// label text the UI shipped with so nothing visibly changes for built-ins.
export function getStrategyOptions(customDefs = []) {
  const builtins = BUILTIN_STRATEGIES.map(s => ({
    value: s.key,
    label: `${s.label} - ${s.description}`,
  }))
  const customs = (customDefs || []).map(def => ({
    value: customKey(def.id),
    label: `${def.name} (Custom)`,
  }))
  return [...builtins, ...customs]
}

// Resolve a strategy key to a fresh instance. Built-in keys map to their class;
// `custom:<id>` keys are cloned from their definition. Anything unresolvable
// (unknown key, or a custom pin whose definition was deleted) falls back to
// Balanced — mirroring autoPilotService's long-standing default — so a dangling
// pin can never crash strategy assignment.
export function instantiateStrategy(key, { customDefs = [], homeTeam } = {}) {
  if (isCustomKey(key)) {
    const id = key.slice(CUSTOM_PREFIX.length)
    const def = (customDefs || []).find(d => d.id === id)
    if (def) return createCustomStrategy(def)
    return new Balanced()
  }

  const Class = BUILTIN_BY_KEY[key]?.Class || Balanced
  const strategy = new Class()
  // Honor a user-pinned home team for Taco bidders; no-op otherwise.
  if (homeTeam && strategy.preferences && 'homeTeam' in strategy.preferences) {
    strategy.preferences.homeTeam = homeTeam
  }
  return strategy
}
