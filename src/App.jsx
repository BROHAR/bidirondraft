import React, { useState } from 'react'
import { useDraftStore } from './store/draftStore'
import DraftBoard from './components/DraftBoard'
import SetupScreen from './components/SetupScreen'
import TitleScreen from './components/TitleScreen'
import PostDraftAnalysis from './components/PostDraftAnalysis'
import MetaSimulationReport from './components/MetaSimulationReport'
import MetaSimulationProgress from './components/MetaSimulationProgress'

function App() {
  const draftState = useDraftStore(state => state.draftState)
  const metaRunning = useDraftStore(state => state.metaSim.running)
  const metaError = useDraftStore(state => state.metaSim.error)
  const [showDraftBoard, setShowDraftBoard] = useState(false)

  if (draftState === 'TITLE') {
    return <TitleScreen />
  }

  if (draftState === 'META_RESULTS') {
    return <MetaSimulationReport />
  }

  if (draftState === 'COMPLETE' && !showDraftBoard) {
    return <PostDraftAnalysis onViewDraft={() => setShowDraftBoard(true)} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>BIDIRON</h1>
      </header>
      <main className="app-main">
        {draftState === 'SETUP' ? <SetupScreen /> : <DraftBoard />}
      </main>
      {(metaRunning || metaError) && <MetaSimulationProgress />}
    </div>
  )
}

export default App
