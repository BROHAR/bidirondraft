// Whether a player position can ever fill a STARTING slot under the league's
// roster configuration. Positions that can't (e.g. K/DST in leagues that run
// no kicker/defense slot) are useless even on the bench — there is never a
// lineup spot for them — so the draft engine excludes them from the auction
// pool entirely and validation rejects keepers at those positions.
//
// FLEX covers RB/WR/TE; SUPERFLEX covers QB/RB/WR/TE; K and DST only start in
// their own dedicated slot. A missing/empty rosterPositions map means the
// caller has no league shape to judge by, so everything passes.
export function isPositionStartable(position, rosterPositions) {
  if (!rosterPositions || Object.keys(rosterPositions).length === 0) return true
  const rc = rosterPositions
  const direct = rc[position] || 0
  if (position === 'QB') return direct + (rc.SUPERFLEX || 0) > 0
  if (position === 'RB' || position === 'WR' || position === 'TE') {
    return direct + (rc.FLEX || 0) + (rc.SUPERFLEX || 0) > 0
  }
  return direct > 0
}
