import { Balanced } from './Balanced.js'
import { BUILTIN_BY_KEY } from './registry.js'

// Instantiate a user-authored "custom" strategy. Custom strategies are data,
// not code: each one clones a built-in preset (keeping that preset's signature
// method overrides — evaluateBid / selectNomination / getBidIncrement) and then
// patches the few knobs the builder exposes. This mirrors exactly what the
// concrete strategies do by hand (set positionMultipliers, return a fixed skip
// probability), so no new engine behavior is introduced. No RNG is used here,
// keeping seeded simulations deterministic.
export function createCustomStrategy(def) {
  const Base = BUILTIN_BY_KEY[def?.baseKey]?.Class || Balanced
  const strategy = new Base()

  strategy.name = def?.name || strategy.name
  strategy.isCustom = true
  strategy.customId = def?.id

  if (def?.positionMultipliers) {
    strategy.preferences.positionMultipliers = {
      ...strategy.preferences.positionMultipliers,
      ...def.positionMultipliers,
    }
  }

  // Optional aggression override: a fixed skip probability replaces the base's
  // getSkipProbability (which is itself just a constant on every concrete
  // strategy). Left untouched when unset so the clone inherits its base.
  if (def?.skipProbability != null) {
    const fixed = def.skipProbability
    strategy.getSkipProbability = () => fixed
  }

  // Home-team affinity only means anything on a Taco clone (which carries the
  // homeTeam/homeTeamMultiplier preferences the base value math reads).
  if (def?.homeTeam && strategy.preferences && 'homeTeam' in strategy.preferences) {
    strategy.preferences.homeTeam = def.homeTeam
  }

  return strategy
}
