import React, { useState, useEffect, useRef } from 'react'
import { useDraftStore } from '../store/draftStore'

// Flashes a retro "SOLD!" banner whenever a purchase lands in draftHistory.
// Audio already announces sales; this is the visual (and screen-reader)
// counterpart, so sales register even with the sound toggled off.
const SHOW_MS = 3500

function SoldBanner() {
  const draftHistory = useDraftStore(state => state.draftHistory)
  const [visible, setVisible] = useState(false)
  const seenCount = useRef(draftHistory.length)

  const lastPick = draftHistory.length > 0 ? draftHistory[draftHistory.length - 1] : null

  useEffect(() => {
    if (draftHistory.length > seenCount.current) {
      seenCount.current = draftHistory.length
      setVisible(true)
      const t = setTimeout(() => setVisible(false), SHOW_MS)
      return () => clearTimeout(t)
    }
    seenCount.current = draftHistory.length
  }, [draftHistory.length])

  return (
    <div className="sold-banner-region" role="status" aria-live="polite">
      {visible && lastPick && (
        <div className="sold-banner">
          <span className="sold-banner-tag">Sold!</span>
          <span className="sold-banner-player">
            {lastPick.player.name} ({lastPick.player.position})
          </span>
          <span className="sold-banner-arrow" aria-hidden="true">→</span>
          <span className="sold-banner-team">{lastPick.team}</span>
          <span className="sold-banner-price">${lastPick.price}</span>
        </div>
      )}
    </div>
  )
}

export default SoldBanner
