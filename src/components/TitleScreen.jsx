import { useCallback, useEffect, useState } from 'react'
import { useDraftStore } from '../store/draftStore'
import SignupModal from './SignupModal'
import { isSubscribed } from '../utils/subscribeStore'

function TitleScreen() {
  const setDraftState = useDraftStore(state => state.setDraftState)
  const [showSignup, setShowSignup] = useState(false)

  const handleStart = useCallback(() => setDraftState('SETUP'), [setDraftState])

  useEffect(() => {
    // While the signup modal is open, keys belong to the email form —
    // Space/Enter must not start the game.
    if (showSignup) return
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleStart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSignup, handleStart])

  return (
    <div className="title-screen" onClick={() => { if (!showSignup) handleStart() }}>
      <div className="title-screen-scanlines" aria-hidden="true" />

      <div className="title-screen-content">
        <img
          src="/assets/trophy-lombardi.svg"
          alt=""
          className="title-screen-mark"
          width="200"
          height="200"
        />

        <h1 className="title-screen-wordmark">
          <span className="title-screen-bid">BID</span>
          <span className="title-screen-iron">IRON</span>
        </h1>

        <div className="title-screen-tagline">FANTASY FOOTBALL · AUCTION DRAFT SIMULATOR</div>

        <button
          type="button"
          className="title-screen-start blink"
          onClick={(e) => { e.stopPropagation(); handleStart() }}
        >
          PRESS START
        </button>

        <div className="title-screen-footer">
          ©2026 BIDIRON · 1-PLAYER · AUCTION MODE
          {!isSubscribed() && (
            <>
              {' · '}
              <button
                type="button"
                className="title-screen-updates"
                onClick={(e) => { e.stopPropagation(); setShowSignup(true) }}
              >
                GET UPDATES
              </button>
            </>
          )}
        </div>
      </div>

      <SignupModal open={showSignup} onClose={() => setShowSignup(false)} source="title" />
    </div>
  )
}

export default TitleScreen
