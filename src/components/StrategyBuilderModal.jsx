import React, { useState } from 'react'
import { BUILTIN_STRATEGIES, BUILTIN_BY_KEY } from '../strategies/registry'
import { upsertCustomStrategy, removeCustomStrategy } from '../utils/customStrategiesStore'
import { NFL_TEAMS } from '../strategies/TacoStrategy'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
const MULT_MIN = 0.5
const MULT_MAX = 2.0
const SKIP_MIN = 0.02
const SKIP_MAX = 0.45

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Read the position multipliers / skip probability a built-in ships with, so a
// new clone starts from its base's actual tuning rather than flat 1.0s.
function baseDefaults(baseKey) {
  const entry = BUILTIN_BY_KEY[baseKey] || BUILTIN_STRATEGIES[0]
  const instance = new entry.Class()
  const pm = instance.preferences?.positionMultipliers || {}
  const positionMultipliers = {}
  for (const pos of POSITIONS) positionMultipliers[pos] = pm[pos] ?? 1.0
  return {
    positionMultipliers,
    skipProbability: instance.getSkipProbability(),
    homeTeam: instance.preferences?.homeTeam || '',
  }
}

function emptyForm(baseKey = BUILTIN_STRATEGIES[0].key) {
  return { id: null, name: '', baseKey, ...baseDefaults(baseKey) }
}

function StrategyBuilderModal({ isOpen, onClose, customStrategies, onChange }) {
  const [form, setForm] = useState(() => emptyForm())
  const [error, setError] = useState(null)

  if (!isOpen) return null

  const resetForm = () => { setForm(emptyForm()); setError(null) }

  // Switching the base preset reseeds the tunable knobs from that preset.
  const handleBaseChange = (baseKey) => {
    setForm(prev => ({ ...prev, baseKey, ...baseDefaults(baseKey) }))
  }

  const handleMultiplierChange = (pos, value) => {
    const n = parseFloat(value)
    setForm(prev => ({
      ...prev,
      positionMultipliers: { ...prev.positionMultipliers, [pos]: isNaN(n) ? prev.positionMultipliers[pos] : n },
    }))
  }

  const editStrategy = (def) => {
    setForm({
      id: def.id,
      name: def.name,
      baseKey: def.baseKey,
      positionMultipliers: { ...baseDefaults(def.baseKey).positionMultipliers, ...def.positionMultipliers },
      skipProbability: def.skipProbability ?? baseDefaults(def.baseKey).skipProbability,
      homeTeam: def.homeTeam || '',
    })
    setError(null)
  }

  const deleteStrategy = (id) => {
    if (!confirm('Delete this custom strategy?')) return
    onChange(removeCustomStrategy(customStrategies, id))
    if (form.id === id) resetForm()
  }

  const save = () => {
    const name = form.name.trim()
    if (!name) { setError('Give the strategy a name.'); return }

    const positionMultipliers = {}
    for (const pos of POSITIONS) {
      positionMultipliers[pos] = clamp(Number(form.positionMultipliers[pos]) || 1.0, MULT_MIN, MULT_MAX)
    }

    const def = {
      id: form.id || newId(),
      name,
      baseKey: form.baseKey,
      positionMultipliers,
      skipProbability: clamp(Number(form.skipProbability), SKIP_MIN, SKIP_MAX),
    }
    // Home-team affinity only means anything on a Taco clone.
    if (form.baseKey === 'Taco' && form.homeTeam) def.homeTeam = form.homeTeam

    onChange(upsertCustomStrategy(customStrategies, def))
    resetForm()
  }

  const baseLabel = (key) => BUILTIN_BY_KEY[key]?.label || key

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content strategy-builder-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Custom Strategies</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {customStrategies.length > 0 && (
            <div className="custom-strategy-list">
              {customStrategies.map(def => (
                <div key={def.id} className="custom-strategy-row">
                  <span className="custom-strategy-name">{def.name}</span>
                  <span className="custom-strategy-base">based on {baseLabel(def.baseKey)}</span>
                  <span className="custom-strategy-actions">
                    <button type="button" className="btn btn-outline" onClick={() => editStrategy(def)}>Edit</button>
                    <button type="button" className="btn btn-outline" onClick={() => deleteStrategy(def.id)}>Delete</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="custom-strategy-form">
            <h4>{form.id ? 'Edit strategy' : 'New strategy'}</h4>

            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={form.name}
                placeholder="e.g. Aggressive Zero RB"
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="cs-base">Clone from</label>
              <select id="cs-base" value={form.baseKey} onChange={(e) => handleBaseChange(e.target.value)}>
                {BUILTIN_STRATEGIES.map(s => (
                  <option key={s.key} value={s.key}>{s.label} - {s.description}</option>
                ))}
              </select>
              <small>Inherits the preset's bidding/nomination behavior; the knobs below override its values.</small>
            </div>

            <div className="form-group">
              <label>Position value multipliers ({MULT_MIN}–{MULT_MAX})</label>
              <div className="grid grid-2">
                {POSITIONS.map(pos => (
                  <div key={pos} className="multiplier-field">
                    <label htmlFor={`mult-${pos}`}>{pos}</label>
                    <input
                      id={`mult-${pos}`}
                      type="number"
                      min={MULT_MIN}
                      max={MULT_MAX}
                      step="0.05"
                      value={form.positionMultipliers[pos]}
                      onChange={(e) => handleMultiplierChange(pos, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <small>1.0 = neutral, &gt;1.0 favors the position, &lt;1.0 avoids it. K/DST stay capped a few dollars regardless.</small>
            </div>

            <div className="form-group">
              <label>Aggression (skip probability {form.skipProbability.toFixed(2)})</label>
              <input
                type="range"
                min={SKIP_MIN}
                max={SKIP_MAX}
                step="0.01"
                value={form.skipProbability}
                onChange={(e) => setForm(prev => ({ ...prev, skipProbability: parseFloat(e.target.value) }))}
              />
              <small>Left = more aggressive (skips fewer auctions); right = more passive.</small>
            </div>

            {form.baseKey === 'Taco' && (
              <div className="form-group">
                <label htmlFor="cs-hometeam">Home team (overpays for)</label>
                <select id="cs-hometeam" value={form.homeTeam} onChange={(e) => setForm(prev => ({ ...prev, homeTeam: e.target.value }))}>
                  <option value="">♥ Random</option>
                  {NFL_TEAMS.map(team => (
                    <option key={team} value={team}>♥ {team}</option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className="form-error">{error}</p>}
          </div>
        </div>

        <div className="modal-footer">
          {form.id && (
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancel edit
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={save}>
            {form.id ? 'Save changes' : 'Add strategy'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default StrategyBuilderModal
