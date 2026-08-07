import React, { useState, useMemo } from 'react'
import { budgetScaleFor } from '../utils/budgetScaling'

// Multiplier floor, and the fallback ceiling when no budget context is
// provided. The real ceiling is per-player: whatever multiplier takes the
// player to the league max bid (budget minus $1 for every other roster spot)
// — a $3 QB legitimately becomes $40 in a superflex league, so a fixed low
// cap like the old 3x is wrong, but no adjustment should exceed what any
// team could actually pay.
const MIN_MULTIPLIER = 0.1
const FALLBACK_MAX_MULTIPLIER = 100

function PlayerValueModal({
  isOpen,
  onClose,
  players,
  valueAdjustments,
  onUpdateAdjustment,
  budgetPerTeam,
  totalRosterSize,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [sortBy, setSortBy] = useState('estimatedValue')

  // League max bid expressed in the $200-reference space the displayed base
  // values live in, so base × multiplier compares against it directly.
  const referenceMaxBid = useMemo(() => {
    if (!budgetPerTeam || !totalRosterSize) return null
    const maxBid = budgetPerTeam - (totalRosterSize - 1)
    return maxBid > 0 ? maxBid / budgetScaleFor(budgetPerTeam) : null
  }, [budgetPerTeam, totalRosterSize])

  const maxMultiplierFor = (player) => {
    if (referenceMaxBid === null) return FALLBACK_MAX_MULTIPLIER
    const base = Math.max(1, player.estimatedValue)
    // Always allow at least 1x so an already-max-priced player keeps a
    // resettable control; round down to one decimal to match the input step.
    return Math.max(1, Math.floor((referenceMaxBid / base) * 10) / 10)
  }

  const filteredPlayers = useMemo(() => {
    return players
      .filter(player => {
        if (positionFilter !== 'ALL' && player.position !== positionFilter) {
          return false
        }
        if (searchTerm && !player.name.toLowerCase().includes(searchTerm.toLowerCase())) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'estimatedValue') {
          return b.estimatedValue - a.estimatedValue
        } else if (sortBy === 'name') {
          return a.name.localeCompare(b.name)
        } else if (sortBy === 'position') {
          return a.position.localeCompare(b.position)
        }
        return 0
      })
  }, [players, searchTerm, positionFilter, sortBy])

  const handleAdjustmentChange = (player, multiplier) => {
    const numericMultiplier = parseFloat(multiplier)
    if (isNaN(numericMultiplier)) return

    const clamped = Math.min(maxMultiplierFor(player),
      Math.max(MIN_MULTIPLIER, numericMultiplier))
    onUpdateAdjustment(player.id, clamped)
  }

  const getAdjustmentValue = (playerId) => {
    return valueAdjustments.get(playerId) || 1.0
  }

  const getAdjustedValue = (player) => {
    const adjustment = getAdjustmentValue(player.id)
    return Math.round(player.estimatedValue * adjustment)
  }

  const clearAllAdjustments = () => {
    if (confirm('Clear all player value adjustments?')) {
      for (const [playerId] of valueAdjustments) {
        onUpdateAdjustment(playerId, 1.0)
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content player-value-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Player Value Adjustments</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="adjustment-controls">
            <div className="filters">
              <input
                type="text"
                placeholder="Search players..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              
              <select 
                value={positionFilter}
                onChange={(e) => setPositionFilter(e.target.value)}
                className="position-filter"
              >
                <option value="ALL">All Positions</option>
                <option value="QB">QB</option>
                <option value="RB">RB</option>
                <option value="WR">WR</option>
                <option value="TE">TE</option>
                <option value="K">K</option>
                <option value="DST">DST</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                <option value="estimatedValue">Sort by Value</option>
                <option value="name">Sort by Name</option>
                <option value="position">Sort by Position</option>
              </select>
            </div>

            <div className="adjustment-actions">
              <div className="adjustment-count">
                {valueAdjustments.size > 0 && (
                  <span className="adjustment-badge">
                    {valueAdjustments.size} modified
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="adjustment-help">
            <p>
              <strong>Adjustment Guide:</strong> 0.5x = Half value, 1.0x = Default value, 2.0x = Double value. Each player caps at your league&apos;s max bid.
            </p>
          </div>

          <div className="player-adjustments-list">
            <div className="adjustment-header">
              <div>Player</div>
              <div>Position</div>
              <div>Base Value</div>
              <div>Multiplier</div>
              <div>Adjusted Value</div>
            </div>

            <div className="adjustment-rows">
              {filteredPlayers.map(player => {
                const currentAdjustment = getAdjustmentValue(player.id)
                const adjustedValue = getAdjustedValue(player)
                const isModified = currentAdjustment !== 1.0

                return (
                  <div key={player.id} className={`adjustment-row ${isModified ? 'modified' : ''}`}>
                    <div className="player-info">
                      <div className="player-name">{player.name}</div>
                      <div className="player-team">{player.team}</div>
                    </div>
                    
                    <div className="player-position">{player.position}</div>
                    
                    <div className="base-value">${player.estimatedValue}</div>
                    
                    <div className="multiplier-control">
                      <input
                        type="number"
                        min={MIN_MULTIPLIER}
                        max={maxMultiplierFor(player)}
                        step="0.1"
                        value={currentAdjustment}
                        onChange={(e) => handleAdjustmentChange(player, e.target.value)}
                        className="multiplier-input"
                      />
                      {isModified && (
                        <button
                          className="reset-btn"
                          onClick={() => handleAdjustmentChange(player, 1.0)}
                          title="Reset to default"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                    
                    <div className={`adjusted-value ${isModified ? 'modified' : ''}`}>
                      ${adjustedValue}
                      {isModified && (
                        <span className="change-indicator">
                          {adjustedValue > player.estimatedValue ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button 
            className="btn btn-secondary"
            onClick={clearAllAdjustments}
            disabled={valueAdjustments.size === 0}
          >
            Clear All ({valueAdjustments.size})
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlayerValueModal