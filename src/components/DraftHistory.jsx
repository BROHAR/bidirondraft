import React from 'react'
import { useDraftStore } from '../store/draftStore'
import { getValueLabel, getVariancePosition } from '../utils/draftAnalysis'

function formatDelta(cls, deltaDollars) {
  if (cls === 'fair') return '~'
  const rounded = Math.round(deltaDollars)
  if (rounded === 0) return '~'
  return rounded > 0 ? `+$${rounded}` : `−$${Math.abs(rounded)}`
}

function DraftHistory() {
  const { draftHistory } = useDraftStore()

  return (
    <div className="card draft-history">
      <div className="history-header">
        <h3>Draft History ({draftHistory.length} picks)</h3>
      </div>

      <div className="draft-picks">
        {draftHistory.length === 0 ? (
          <div className="no-picks">
            <p>No players drafted yet</p>
          </div>
        ) : (
          <div className="picks-list">
            {draftHistory.slice().reverse().map((pick, index) => {
              const pickNumber = draftHistory.length - index
              const { text, cls, pct, deltaDollars } = getValueLabel(pick.player.estimatedValue, pick.price)
              const markerLeft = getVariancePosition(pct)

              return (
                <div key={`${pick.player.id}-${pick.timestamp}`} className={`draft-pick draft-pick--${cls}`}>
                  <div className="pick-top-row">
                    <span className="pick-chip">#{pickNumber}</span>
                    <span className="pick-team-chip">{pick.team}</span>
                  </div>

                  <div className="pick-body-row">
                    <div className="pick-player">
                      <div className="pick-name">{pick.player.name}</div>
                      <div className="pick-meta">
                        <span className="pick-pos-tag">{pick.player.position}</span>
                        <span>{pick.player.team}</span>
                      </div>
                    </div>
                    <div className="pick-price-block">
                      <div className="pick-price">${pick.price}</div>
                      <div className="pick-est-line">
                        est ${Math.round(pick.player.estimatedValue)}{' '}
                        <span className="pick-delta">({formatDelta(cls, deltaDollars)})</span>
                      </div>
                    </div>
                  </div>

                  <div className="pick-variance">
                    <div className="variance-track">
                      <div className="variance-zone" />
                      <div className="variance-marker" style={{ left: `${markerLeft}%` }} />
                    </div>
                    <div className="variance-label">{text}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {draftHistory.length > 0 && (
        <div className="draft-stats">
          <h5>Draft Statistics</h5>
          <div className="stats-grid">
            <div className="stat">
              <label>Total Spent</label>
              <span className="stat-value">${draftHistory.reduce((sum, pick) => sum + pick.price, 0)}</span>
            </div>
            <div className="stat">
              <label>Average Price</label>
              <span className="stat-value">${(draftHistory.reduce((sum, pick) => sum + pick.price, 0) / draftHistory.length).toFixed(1)}</span>
            </div>
            <div className="stat">
              <label>Highest Price</label>
              <span className="stat-value">${Math.max(...draftHistory.map(pick => pick.price))}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DraftHistory