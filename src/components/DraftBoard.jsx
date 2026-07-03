import React, { useState, useEffect } from 'react'
import { useDraftStore } from '../store/draftStore'
import PlayerPool from './PlayerPool'
import AuctionBlock from './AuctionBlock'
import TabbedSection from './TabbedSection'
import ControlPanel from './ControlPanel'
import AutoPilotControl from './AutoPilotControl'
import DraftProgress from './DraftProgress'

function DraftBoard() {
  const draftState = useDraftStore(state => state.draftState)
  const currentNominator = useDraftStore(state => state.currentNominator)
  const currentPlayer = useDraftStore(state => state.currentPlayer)
  const teams = useDraftStore(state => state.teams)

  // Which panel the mobile bottom-nav is showing (desktop ignores this).
  const [mobilePanel, setMobilePanel] = useState('auction')

  // Derive the two moments that deserve the user's attention on a phone.
  const humanTeam = teams.find(t => t.isHuman)
  const humanMustNominate =
    draftState === 'NOMINATING' &&
    !!humanTeam &&
    humanTeam.id === currentNominator &&
    !humanTeam.isAutoPilot
  const biddingActive = draftState === 'BIDDING' && !!currentPlayer

  // Auto-focus: jump to the relevant panel when the actionable context changes.
  // Keyed on `focus` so it fires on transitions but leaves manual taps alone
  // within a given state (a null focus never forces a switch).
  const focus = humanMustNominate ? 'players' : biddingActive ? 'auction' : null
  useEffect(() => {
    if (focus) setMobilePanel(focus)
  }, [focus])

  const navTabs = [
    { id: 'auction', label: 'Auction', attention: biddingActive },
    { id: 'players', label: 'Players', attention: humanMustNominate },
    { id: 'board', label: 'Teams', attention: false },
    { id: 'controls', label: 'More', attention: false },
  ]

  return (
    <div className="draft-board">
      <div className={`draft-main mobile-panel-${mobilePanel}`}>
        <div className="draft-column left-column">
          <PlayerPool />
        </div>

        <div className="draft-column auction-column">
          <AuctionBlock />
        </div>

        <div className="draft-column tabbed-column">
          <TabbedSection />
        </div>

        <div className="draft-column right-column">
          <DraftProgress />
          <ControlPanel />
          <AutoPilotControl />
        </div>
      </div>

      <nav className="draft-mobile-nav">
        {navTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${mobilePanel === tab.id ? 'active' : ''} ${tab.attention ? 'has-attention' : ''}`}
            aria-pressed={mobilePanel === tab.id}
            onClick={() => setMobilePanel(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default DraftBoard
