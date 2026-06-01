import React, { useState } from 'react'
import { useDraftStore } from '../store/draftStore'
import { audioService } from '../services/audioService'

function ControlPanel() {
  const { 
    draftState, 
    currentNominator,
    teams,
    setDraftState,
    availablePlayers,
    pauseDraft,
    resumeDraft,
    restartDraft
  } = useDraftStore()
  
  const [audioEnabled, setAudioEnabled] = useState(audioService.enabled)

  const isPaused = draftState === 'PAUSED'
  const currentNominatorTeam = teams.find(t => t.id === currentNominator)

  const togglePause = () => {
    if (isPaused) {
      resumeDraft()
    } else {
      pauseDraft()
    }
  }

  const handleRestartDraft = () => {
    if (confirm('Are you sure you want to restart the draft? All progress will be lost.')) {
      restartDraft()
    }
  }

  const toggleAudio = () => {
    const newState = audioService.toggleAudio()
    setAudioEnabled(newState)
  }

  return (
    <div className="card control-panel">
      <div className="panel-header">
        <h3>Draft Controls</h3>
        <div className={`draft-status ${draftState.toLowerCase()}`}>
          {draftState}
        </div>
      </div>

      <div className="current-info">
        {draftState === 'NOMINATING' && currentNominatorTeam && (
          <div className="nominator-info">
            <label>Current Nominator:</label>
            <span className={`team-name ${currentNominatorTeam.isHuman ? 'human-team' : ''}`}>
              {currentNominatorTeam.name}
            </span>
          </div>
        )}
        
        {draftState === 'BIDDING' && (
          <div className="bidding-info">
            <label>Status:</label>
            <span>Auction in progress</span>
          </div>
        )}
      </div>

      <div className="control-buttons">
        <button 
          className={`btn ${isPaused ? 'btn-success' : 'btn-secondary'}`}
          onClick={togglePause}
        >
          {isPaused ? 'Resume Draft' : 'Pause Draft'}
        </button>
        
        <button 
          className="btn btn-danger"
          onClick={handleRestartDraft}
        >
          Restart Draft
        </button>
        
        <button 
          className={`btn ${audioEnabled ? 'btn-success' : 'btn-secondary'}`}
          onClick={toggleAudio}
          title={`Audio is ${audioEnabled ? 'enabled' : 'disabled'}`}
        >
          AUDIO {audioEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

    </div>
  )
}

export default ControlPanel