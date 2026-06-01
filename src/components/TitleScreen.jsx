import React, { useEffect } from 'react'
import { useDraftStore } from '../store/draftStore'

function TitleScreen() {
  const setDraftState = useDraftStore(state => state.setDraftState)

  const handleStart = () => setDraftState('SETUP')

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleStart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="title-screen" onClick={handleStart}>
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

        <div className="title-screen-tagline">FANTASY FOOTBALL · AUCTION DRAFT</div>

        <button
          type="button"
          className="title-screen-start blink"
          onClick={(e) => { e.stopPropagation(); handleStart() }}
        >
          PRESS START
        </button>

        <div className="title-screen-footer">
          ©1989 BIDIRON · 1-PLAYER · AUCTION MODE
        </div>
      </div>
    </div>
  )
}

export default TitleScreen
