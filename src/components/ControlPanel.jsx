import React, { useState } from 'react'
import { useDraftStore } from '../store/draftStore'
import { audioService } from '../services/audioService'
import ConfirmDialog from './ConfirmDialog'

function ControlPanel() {
  const {
    draftState,
    currentNominator,
    currentPlayer,
    draftHistory,
    teams,
    pauseDraft,
    resumeDraft,
    restartDraft,
    cancelNomination,
    undoLastSale
  } = useDraftStore()

  const [audioEnabled, setAudioEnabled] = useState(audioService.enabled)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [confirmCancelNomination, setConfirmCancelNomination] = useState(false)
  const [confirmUndoPick, setConfirmUndoPick] = useState(false)

  const isPaused = draftState === 'PAUSED'
  const currentNominatorTeam = teams.find(t => t.id === currentNominator)

  // Cancel Nomination applies to the auction on the block (live or paused
  // mid-auction). Undo Last Pick rewinds the most recent completed sale and is
  // available whenever the draft room is active — including during the next
  // auction, which it cancels as part of the rewind.
  const canCancelNomination = !!currentPlayer && (draftState === 'BIDDING' || isPaused)
  const lastPick = draftHistory.length > 0 ? draftHistory[draftHistory.length - 1] : null
  const canUndoPick = !!lastPick && ['NOMINATING', 'BIDDING', 'PAUSED'].includes(draftState)

  const undoMessage = lastPick
    ? [
        lastPick.team === 'No Bids' || lastPick.price === 0
          ? `${lastPick.player.name} will return to the player pool.`
          : `${lastPick.player.name} will return to the player pool and ${lastPick.team} will get its $${lastPick.price} back.`,
        currentPlayer ? `The auction in progress for ${currentPlayer.name} will also be cancelled.` : null,
        'The same team will nominate again.',
      ].filter(Boolean).join(' ')
    : ''

  const togglePause = () => {
    if (isPaused) {
      resumeDraft()
    } else {
      pauseDraft()
    }
  }

  const handleRestartDraft = () => {
    restartDraft()
    setConfirmRestart(false)
  }

  const handleCancelNomination = () => {
    cancelNomination()
    setConfirmCancelNomination(false)
  }

  const handleUndoPick = () => {
    undoLastSale()
    setConfirmUndoPick(false)
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
          className="btn btn-secondary"
          onClick={() => setConfirmCancelNomination(true)}
          disabled={!canCancelNomination}
          title={canCancelNomination
            ? 'Return the nominated player to the pool without a sale'
            : 'Available while a player is on the auction block'}
        >
          Cancel Nomination
        </button>

        <button
          className="btn btn-secondary"
          onClick={() => setConfirmUndoPick(true)}
          disabled={!canUndoPick}
          title={canUndoPick
            ? `Undo ${lastPick.player.name} to ${lastPick.team} for $${lastPick.price}`
            : 'Available once a pick has been made'}
        >
          Undo Last Pick
        </button>

        <button
          className="btn btn-danger"
          onClick={() => setConfirmRestart(true)}
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

      <ConfirmDialog
        open={confirmRestart}
        title="Restart Draft?"
        message="All progress will be lost. This cannot be undone."
        confirmLabel="Restart"
        danger
        onConfirm={handleRestartDraft}
        onCancel={() => setConfirmRestart(false)}
      />

      <ConfirmDialog
        open={confirmCancelNomination}
        title="Cancel Nomination?"
        message={currentPlayer
          ? `${currentPlayer.name} will return to the player pool without a sale, and the same team will nominate again.`
          : ''}
        confirmLabel="Cancel Nomination"
        cancelLabel="Keep Bidding"
        onConfirm={handleCancelNomination}
        onCancel={() => setConfirmCancelNomination(false)}
      />

      <ConfirmDialog
        open={confirmUndoPick}
        title="Undo Last Pick?"
        message={undoMessage}
        confirmLabel="Undo Pick"
        onConfirm={handleUndoPick}
        onCancel={() => setConfirmUndoPick(false)}
      />
    </div>
  )
}

export default ControlPanel
