import React from 'react'
import { useDraftStore } from '../store/draftStore'

// Compact countdown shown on the right of the app header (mobile) so the bidding
// / nomination timer stays visible from any draft panel. Renders nothing unless
// a timer is actually being driven (live bidding or the human's manual pick).
function HeaderTimer() {
  const draftState = useDraftStore(state => state.draftState)
  const currentNominator = useDraftStore(state => state.currentNominator)
  const currentPlayer = useDraftStore(state => state.currentPlayer)
  const teams = useDraftStore(state => state.teams)
  const timeRemaining = useDraftStore(state => state.timeRemaining)

  const humanTeam = teams.find(t => t.isHuman)
  const humanMustNominate =
    draftState === 'NOMINATING' &&
    !!humanTeam &&
    humanTeam.id === currentNominator &&
    !humanTeam.isAutoPilot
  const biddingActive = draftState === 'BIDDING' && !!currentPlayer

  if ((!biddingActive && !humanMustNominate) || !Number.isFinite(timeRemaining)) {
    return null
  }

  const label = biddingActive ? 'Bid' : 'Pick'
  return (
    <div
      className={`header-timer ${timeRemaining <= 5 ? 'urgent' : ''}`}
      role="timer"
      aria-label={`${label}: ${timeRemaining} seconds remaining`}
    >
      <span className="header-timer-label">{label}</span>
      <span className="header-timer-value">{timeRemaining}</span>
    </div>
  )
}

export default HeaderTimer
