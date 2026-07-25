import React, { useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { getValueLabel, getVariancePosition, getKeeperPicks } from '../utils/draftAnalysis'
import { budgetScaleFor } from '../utils/budgetScaling'

function formatDelta(cls, deltaDollars) {
  if (cls === 'fair') return '~'
  const rounded = Math.round(deltaDollars)
  if (rounded === 0) return '~'
  return rounded > 0 ? `+$${rounded}` : `−$${Math.abs(rounded)}`
}

function DraftHistory() {
  const { draftHistory, teams, config } = useDraftStore()
  const bs = budgetScaleFor(config?.budgetPerTeam)

  // Keepers render as pre-draft entries pinned below pick #1 (the list is
  // newest-first). They're kept out of draftHistory itself so the auction
  // stats below stay market-only.
  const keeperPicks = useMemo(() => getKeeperPicks(teams), [teams])
  const allPicks = useMemo(
    () => [...draftHistory.slice().reverse(), ...keeperPicks],
    [draftHistory, keeperPicks]
  )

  return (
    <div className="card draft-history">
      <div className="history-header">
        <h3>
          Draft History ({draftHistory.length} picks
          {keeperPicks.length > 0 ? ` · ${keeperPicks.length} keepers` : ''})
        </h3>
      </div>

      <div className="draft-picks">
        {allPicks.length === 0 ? (
          <div className="no-picks">
            <p>No players drafted yet</p>
          </div>
        ) : (
          <div className="picks-list">
            {allPicks.map((pick, index) => {
              const pickNumber = pick.isKeeper ? null : draftHistory.length - index
              const { text, cls, pct, deltaDollars } = getValueLabel(pick.player.estimatedValue, pick.price, bs)
              const markerLeft = getVariancePosition(pct)

              return (
                <div key={`${pick.player.id}-${pick.timestamp ?? 'keeper'}`} className={`draft-pick draft-pick--${cls}`}>
                  <div className="pick-top-row">
                    <span className={`pick-chip${pick.isKeeper ? ' pick-chip--keeper' : ''}`}>
                      {pick.isKeeper ? 'KEEPER' : `#${pickNumber}`}
                    </span>
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