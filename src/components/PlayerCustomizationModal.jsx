import React, { useState, useMemo } from 'react'
import {
  setEstimatedValueOverride,
  setProjectedPointsOverride,
  clearPlayerOverride,
  countOverrides,
} from '../utils/playerOverrides'

const SCORING_LABELS = {
  standard: 'Standard',
  halfPPR: 'Half PPR',
  ppr: 'PPR',
}

function parseNumber(raw) {
  if (raw === '' || raw === null || raw === undefined) return null
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

function PlayerCustomizationModal({
  isOpen,
  onClose,
  basePlayers,
  overrides,
  scoringFormat,
  onChange,
  onClearAll,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [sortBy, setSortBy] = useState('estimatedValue')

  const filteredPlayers = useMemo(() => {
    return basePlayers
      .filter(player => {
        if (positionFilter !== 'ALL' && player.position !== positionFilter) return false
        if (searchTerm && !player.name.toLowerCase().includes(searchTerm.toLowerCase())) return false
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'estimatedValue') return b.estimatedValue - a.estimatedValue
        if (sortBy === 'name') return a.name.localeCompare(b.name)
        if (sortBy === 'position') return a.position.localeCompare(b.position)
        if (sortBy === 'points') {
          return (b.projectedPoints?.[scoringFormat] || 0) - (a.projectedPoints?.[scoringFormat] || 0)
        }
        return 0
      })
  }, [basePlayers, searchTerm, positionFilter, sortBy, scoringFormat])

  const handleValueChange = (playerId, raw) => {
    const value = parseNumber(raw)
    onChange(setEstimatedValueOverride(overrides, playerId, value))
  }

  const handlePointsChange = (playerId, raw) => {
    const value = parseNumber(raw)
    onChange(setProjectedPointsOverride(overrides, playerId, scoringFormat, value))
  }

  const handleResetPlayer = (playerId) => {
    onChange(clearPlayerOverride(overrides, playerId))
  }

  const handleClearAll = () => {
    if (confirm('Clear all player customizations?')) {
      onClearAll()
    }
  }

  if (!isOpen) return null

  const modifiedCount = countOverrides(overrides)
  const formatLabel = SCORING_LABELS[scoringFormat] || scoringFormat

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content player-customization-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Customize Players ({formatLabel})</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="customization-controls">
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
                <option value="points">Sort by Points</option>
                <option value="name">Sort by Name</option>
                <option value="position">Sort by Position</option>
              </select>
            </div>
            <div className="customization-actions">
              {modifiedCount > 0 && (
                <span className="customization-badge">{modifiedCount} customized</span>
              )}
            </div>
          </div>

          <div className="customization-help">
            <p>
              <strong>Customize Players:</strong> Override est value and projected points to match your projections. Edits persist in this browser until cleared.
            </p>
          </div>

          <div className="customization-list">
            <div className="customization-header">
              <div>Player</div>
              <div>Pos</div>
              <div>Base Value</div>
              <div>Your Value</div>
              <div>Base Points</div>
              <div>Your Points</div>
              <div></div>
            </div>

            <div className="customization-rows">
              {filteredPlayers.map(player => {
                const o = overrides[player.id]
                const valueOverride = o && typeof o.estimatedValue === 'number' ? o.estimatedValue : null
                const pointsOverride = o && o.projectedPoints && typeof o.projectedPoints[scoringFormat] === 'number'
                  ? o.projectedPoints[scoringFormat]
                  : null
                const isModified = valueOverride !== null || pointsOverride !== null
                const basePoints = player.projectedPoints?.[scoringFormat] ?? 0

                return (
                  <div
                    key={player.id}
                    className={`customization-row ${isModified ? 'modified' : ''}`}
                  >
                    <div className="player-info">
                      <div className="player-name">{player.name}</div>
                      <div className="player-team">{player.team}</div>
                    </div>

                    <div className="player-position">{player.position}</div>

                    <div className="base-value">${player.estimatedValue}</div>

                    <div className="override-control">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={valueOverride !== null ? valueOverride : ''}
                        placeholder={String(player.estimatedValue)}
                        onChange={(e) => handleValueChange(player.id, e.target.value)}
                        className={`override-input ${valueOverride !== null ? 'modified' : ''}`}
                      />
                    </div>

                    <div className="base-points">{basePoints.toFixed(1)}</div>

                    <div className="override-control">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={pointsOverride !== null ? pointsOverride : ''}
                        placeholder={basePoints.toFixed(1)}
                        onChange={(e) => handlePointsChange(player.id, e.target.value)}
                        className={`override-input ${pointsOverride !== null ? 'modified' : ''}`}
                      />
                    </div>

                    <div className="row-reset">
                      {isModified && (
                        <button
                          className="reset-btn"
                          onClick={() => handleResetPlayer(player.id)}
                          title="Reset this player"
                        >
                          ↻
                        </button>
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
            onClick={handleClearAll}
            disabled={modifiedCount === 0}
          >
            Clear All ({modifiedCount})
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlayerCustomizationModal
