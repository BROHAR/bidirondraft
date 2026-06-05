// The bundled player values, AI strategy thresholds, and bid increments were
// all tuned against a $200-per-team budget. When a league uses a different
// budget, those absolute-dollar numbers need to scale proportionally so a
// $10-at-$200 player reads as $30 at a $600 budget. This module is the single
// source of truth for that scale factor.
export const REFERENCE_BUDGET = 200

// Multiplier to convert a $200-baseline dollar amount into the equivalent
// amount for `budget`. Falls back to 1.0 for missing/invalid budgets so callers
// (and existing $200 tests) are unaffected.
export function budgetScaleFor(budget) {
  return (budget && budget > 0 ? budget : REFERENCE_BUDGET) / REFERENCE_BUDGET
}

// Scale a $200-baseline value to `budget`, rounded to a whole dollar.
export function scaleValueToBudget(value, budget) {
  return Math.round(value * budgetScaleFor(budget))
}
