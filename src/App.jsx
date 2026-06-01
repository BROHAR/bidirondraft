import React, { useState } from 'react'
import { useDraftStore } from './store/draftStore'
import DraftBoard from './components/DraftBoard'
import SetupScreen from './components/SetupScreen'
import TitleScreen from './components/TitleScreen'
import PostDraftAnalysis from './components/PostDraftAnalysis'

function App() {
  const draftState = useDraftStore(state => state.draftState)
  const [showDraftBoard, setShowDraftBoard] = useState(false)

  if (draftState === 'TITLE') {
    return <TitleScreen />
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
    </div>
  )
}

export default App
