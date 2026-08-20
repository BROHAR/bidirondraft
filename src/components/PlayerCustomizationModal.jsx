import React, { useState, useMemo, useRef } from 'react'
import {
  setEstimatedValueOverride,
  setProjectedPointsOverride,
  clearPlayerOverride,
  countOverrides,
} from '../utils/playerOverrides'
import {
  parsePlayerValuesCsv,
  mergeImportedOverrides,
  EXAMPLE_HEADER,
} from '../utils/playerValuesImport'
import { scaleValueToBudget } from '../utils/budgetScaling'

const SCORING_LABELS = {
  standard: 'Standard',
  halfPPR: 'Half PPR',
  ppr: 'PPR',
}

// Values CSVs are a few KB; anything past 5 MB is the wrong file, and reading
// it into state/parsing it would only lock up the tab (same cap as the
// league draft-history import).
const MAX_FILE_BYTES = 5 * 1024 * 1024
// Cap the rendered warning list — a garbled 5000-row file yields thousands of
// row warnings and rendering them all would swamp the panel.
const MAX_SHOWN_WARNINGS = 6

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
  budgetPerTeam,
  formatDeltas,
  onChange,
  onClearAll,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [sortBy, setSortBy] = useState('estimatedValue')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState(null)
  const [importPreview, setImportPreview] = useState(null) // parsePlayerValuesCsv result
  const fileInputRef = useRef(null)

  const filteredPlayers = useMemo(() => {
    // Book values are half-PPR 1-QB; formatDeltas carries every pre-anchor
    // adjustment (scoring format, superflex QB rescale, league profile,
    // position tweaks) so users type overrides against the book the draft
    // will actually use.
    const formatValueOf = (player) =>
      Math.max(1, player.estimatedValue + (formatDeltas?.get(player.id) ?? 0))
    return basePlayers
      .filter(player => {
        if (positionFilter !== 'ALL' && player.position !== positionFilter) return false
        if (searchTerm && !player.name.toLowerCase().includes(searchTerm.toLowerCase())) return false
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'estimatedValue') return formatValueOf(b) - formatValueOf(a)
        if (sortBy === 'name') return a.name.localeCompare(b.name)
        if (sortBy === 'position') return a.position.localeCompare(b.position)
        if (sortBy === 'points') {
          return (b.projectedPoints?.[scoringFormat] || 0) - (a.projectedPoints?.[scoringFormat] || 0)
        }
        return 0
      })
  }, [basePlayers, searchTerm, positionFilter, sortBy, scoringFormat, formatDeltas])

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

  const resetImport = () => {
    setImportText('')
    setImportError(null)
    setImportPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const toggleImport = () => {
    if (importOpen) resetImport()
    setImportOpen(!importOpen)
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setImportError('That file is over 5 MB — a player values CSV is far smaller. Check that this is the right file.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setImportText(String(reader.result || ''))
      setImportError(null)
      setImportPreview(null)
    }
    reader.readAsText(file)
  }

  const handleImportPreview = () => {
    const result = parsePlayerValuesCsv(importText, basePlayers)
    if (result.errors.length > 0) {
      setImportError(result.errors.join(' '))
      setImportPreview(null)
      return
    }
    setImportError(null)
    setImportPreview(result)
  }

  const handleImportApply = () => {
    if (!importPreview || importPreview.entries.length === 0) return
    onChange(mergeImportedOverrides(overrides, importPreview.entries, scoringFormat))
    resetImport()
    setImportOpen(false)
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
              <button
                className={`btn ${importOpen ? 'btn-secondary' : 'btn-outline'}`}
                onClick={toggleImport}
              >
                {importOpen ? 'Close Import' : 'Import CSV'}
              </button>
            </div>
          </div>

          <div className="customization-help">
            <p>
              <strong>Customize Players:</strong> Override est value and projected points to match your projections. Edits persist in this browser until cleared.
            </p>
          </div>

          {importOpen && (
            <div className="values-import-panel">
              <p className="section-hint">
                Upload or paste a CSV of your own values and/or projected points. Needs a header row with a player-name
                column plus a Value and/or Points column (Position recommended), e.g.:
              </p>
              <code className="values-import-header-example">{EXAMPLE_HEADER}</code>
              <div className="values-import-inputs">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  aria-label="Upload values CSV"
                  onChange={handleImportFile}
                />
                <textarea
                  className="values-import-textarea"
                  rows={4}
                  placeholder={`${EXAMPLE_HEADER}\nBijan Robinson,RB,55,290.5\n…`}
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value)
                    setImportPreview(null)
                  }}
                />
              </div>
              {importError && <div className="simulate-error">{importError}</div>}
              {importPreview && (
                <div className="values-import-preview">
                  <div className="values-import-summary">
                    {importPreview.entries.length} player{importPreview.entries.length === 1 ? '' : 's'} matched
                    {importPreview.warnings.length > 0 && ` · ${importPreview.warnings.length} row${importPreview.warnings.length === 1 ? '' : 's'} skipped or flagged`}
                    {' '}· values in your league&apos;s dollars, points as {formatLabel}
                  </div>
                  {importPreview.warnings.length > 0 && (
                    <ul className="values-import-warnings">
                      {importPreview.warnings.slice(0, MAX_SHOWN_WARNINGS).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                      {importPreview.warnings.length > MAX_SHOWN_WARNINGS && (
                        <li>…and {importPreview.warnings.length - MAX_SHOWN_WARNINGS} more.</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
              <div className="values-import-actions">
                <button
                  className="btn btn-outline"
                  onClick={handleImportPreview}
                  disabled={!importText.trim()}
                >
                  Preview
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleImportApply}
                  disabled={!importPreview || importPreview.entries.length === 0}
                >
                  {importPreview ? `Apply ${importPreview.entries.length} Player${importPreview.entries.length === 1 ? '' : 's'}` : 'Apply'}
                </button>
              </div>
            </div>
          )}

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
                // Base values are half-PPR book tuned for a $200 budget; apply
                // the combined book deltas, then scale to the league's budget
                // so users set custom values in context.
                const formatValue = Math.max(1, player.estimatedValue + (formatDeltas?.get(player.id) ?? 0))
                const scaledBaseValue = scaleValueToBudget(formatValue, budgetPerTeam)

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

                    <div className="base-value">${scaledBaseValue}</div>

                    <div className="override-control">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={valueOverride !== null ? valueOverride : ''}
                        placeholder={String(scaledBaseValue)}
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
