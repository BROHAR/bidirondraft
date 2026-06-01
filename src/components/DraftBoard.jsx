import React from 'react'
import { useDraftStore } from '../store/draftStore'
import PlayerPool from './PlayerPool'
import AuctionBlock from './AuctionBlock'
import TabbedSection from './TabbedSection'
import ControlPanel from './ControlPanel'
import AutoPilotControl from './AutoPilotControl'
import DraftProgress from './DraftProgress'

function DraftBoard() {
  const draftState = useDraftStore(state => state.draftState)
  
  return (
    <div className="draft-board">
      <div className="draft-main">
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
    </div>
  )
}

export default DraftBoard