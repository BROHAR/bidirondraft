import React, { useState, useEffect } from 'react'
import { useDraftStore } from './store/draftStore'
import DraftBoard from './components/DraftBoard'
import SetupScreen from './components/SetupScreen'
import TitleScreen from './components/TitleScreen'
import PostDraftAnalysis from './components/PostDraftAnalysis'
import MetaSimulationReport from './components/MetaSimulationReport'
import MetaSimulationProgress from './components/MetaSimulationProgress'
import HeaderTimer from './components/HeaderTimer'

function App() {
  const draftState = useDraftStore(state => state.draftState)
  const metaRunning = useDraftStore(state => state.metaSim.running)
  const metaError = useDraftStore(state => state.metaSim.error)
  const [showDraftBoard, setShowDraftBoard] = useState(false)

  // Draft state lives only in memory — refresh or close mid-draft destroys
  // it. Warn before the browser lets that happen.
  const draftActive = ['NOMINATING', 'BIDDING', 'PAUSED'].includes(draftState)
  useEffect(() => {
    if (!draftActive) return
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draftActive])

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
        <HeaderTimer />
      </header>
      <main className="app-main">
        {draftState === 'SETUP' ? <SetupScreen /> : <DraftBoard />}
      </main>
      {(metaRunning || metaError) && <MetaSimulationProgress />}
    </div>
  )
}

export default App
