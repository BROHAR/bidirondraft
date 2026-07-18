import React, { useState, useRef } from 'react'
import { parseDraftCsv, EXAMPLE_HEADER } from '../utils/draftImport'
import { fitLeagueProfile, classifyTeams } from '../utils/leagueProfile'
import { BUILTIN_STRATEGIES } from '../strategies/registry'
import { NFL_TEAMS } from '../strategies/TacoStrategy'
import playersData from '../data/players.json'

const MIN_RECORDS = 20

// Two-phase import: paste/upload the league's draft-results CSV, then review
// the detected teams (with inferred AI personas, editable) and mark which one
// is the user before applying. onApply receives the complete LeagueProfile.
function LeagueImportModal({ isOpen, onClose, existingProfile, onApply }) {
  const [phase, setPhase] = useState('input')          // 'input' | 'preview'
  const [csvText, setCsvText] = useState('')
  const [inputError, setInputError] = useState(null)
  const [parsed, setParsed] = useState(null)           // parseDraftCsv result
  const [budget, setBudget] = useState(200)
  const [teamRows, setTeamRows] = useState([])         // { name, picks, spend, persona, confidence, homeTeam }
  const [userTeamName, setUserTeamName] = useState(null)
  const fileInputRef = useRef(null)

  if (!isOpen) return null

  const reset = () => {
    setPhase('input'); setCsvText(''); setInputError(null)
    setParsed(null); setTeamRows([]); setUserTeamName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const close = () => { reset(); onClose() }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCsvText(String(reader.result || ''))
    reader.readAsText(file)
  }

  const handleParse = () => {
    const result = parseDraftCsv(csvText)
    if (result.errors.length > 0) {
      setInputError(result.errors.join(' '))
      return
    }
    if (result.records.length < MIN_RECORDS) {
      setInputError(`Only ${result.records.length} valid rows found — a full draft should have far more. Check the format.`)
      return
    }
    const personas = classifyTeams(result.records, { leagueBudget: result.suggestedBudget })
    setTeamRows(result.teams.map(t => {
      const p = personas.find(x => x.name === t.name)
      return { ...t, persona: p?.persona || 'Balanced', confidence: p?.confidence || 'low', homeTeam: p?.homeTeam || null }
    }))
    setBudget(result.suggestedBudget)
    setParsed(result)
    setInputError(null)
    setPhase('preview')
  }

  const setRowPersona = (name, persona) => {
    setTeamRows(rows => rows.map(r =>
      r.name === name ? { ...r, persona, homeTeam: persona === 'Taco' ? r.homeTeam : null } : r))
  }

  const setRowHomeTeam = (name, homeTeam) => {
    setTeamRows(rows => rows.map(r => (r.name === name ? { ...r, homeTeam: homeTeam || null } : r)))
  }

  const handleApply = () => {
    const profile = fitLeagueProfile(parsed.records, playersData.players, {
      leagueBudget: budget,
      teams: teamRows,
      userTeamName,
    })
    reset()
    onApply(profile)
  }

  const maxPrice = parsed ? Math.max(...parsed.records.map(r => r.price)) : 0

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-content league-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Import Last Year&apos;s Draft</h3>
          <button className="modal-close" onClick={close}>×</button>
        </div>

        {phase === 'input' && (
          <div className="modal-body">
            <p className="section-hint">
              Paste or upload your league&apos;s auction results as a CSV with this exact header:
            </p>
            <code className="league-import-header-example">{EXAMPLE_HEADER}</code>
            <div className="form-group">
              <label>Upload CSV</label>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} />
            </div>
            <div className="form-group">
              <label>Or paste CSV text</label>
              <textarea
                className="league-import-textarea"
                rows={10}
                placeholder={`${EXAMPLE_HEADER}\n1,Patrick Mahomes,KC,QB,8,PrestigeWorldWide\n…`}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
            </div>
            {existingProfile && (
              <p className="league-import-note">
                An import from {existingProfile.importedAt?.slice(0, 10) || 'earlier'} exists — applying a new one replaces it.
              </p>
            )}
            {inputError && <div className="simulate-error">{inputError}</div>}
          </div>
        )}

        {phase === 'preview' && (
          <div className="modal-body">
            <div className="league-import-summary">
              {parsed.records.length} picks · {teamRows.length} teams · $
              {parsed.records.reduce((s, r) => s + r.price, 0)} total ·{' '}
              {parsed.hasPickOrder ? 'pick order detected' : 'no pick order — late-inflation fitting skipped'}
              {parsed.warnings.length > 0 && ` · ${parsed.warnings.length} rows skipped`}
            </div>
            <div className="form-group">
              <label>League budget per team</label>
              <input
                type="number"
                min={10}
                value={budget}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (Number.isFinite(n) && n > 0) setBudget(n)
                }}
              />
              <small>The budget your real league used — prices are normalized from it.</small>
              {budget < maxPrice && (
                <div className="simulate-error">A ${maxPrice} pick exceeds a ${budget} budget — check the budget.</div>
              )}
            </div>

            <p className="section-hint">
              Review each team&apos;s inferred bidder persona (editable) and mark which team is yours.
            </p>
            <div className="league-import-teams">
              <table>
                <thead>
                  <tr><th>Me</th><th>Team</th><th>Picks</th><th>Spent</th><th>Persona</th></tr>
                </thead>
                <tbody>
                  {teamRows.map(row => (
                    <tr key={row.name}>
                      <td>
                        <input
                          type="radio"
                          name="league-import-me"
                          aria-label={`This is me: ${row.name}`}
                          checked={userTeamName === row.name}
                          onChange={() => setUserTeamName(row.name)}
                        />
                      </td>
                      <td className="league-import-team-name">{row.name}</td>
                      <td>{row.picks}</td>
                      <td>${row.spend}</td>
                      <td>
                        <div className="league-import-persona">
                          <select
                            aria-label={`Persona for ${row.name}`}
                            value={row.persona}
                            onChange={(e) => setRowPersona(row.name, e.target.value)}
                          >
                            {BUILTIN_STRATEGIES.map(s => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                          <span className={`confidence-badge confidence-${row.confidence}`}>{row.confidence}</span>
                          {row.persona === 'Taco' && (
                            <select
                              aria-label={`Home team for ${row.name}`}
                              value={row.homeTeam || ''}
                              onChange={(e) => setRowHomeTeam(row.name, e.target.value)}
                            >
                              <option value="">Random home team</option>
                              {NFL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!userTeamName && <p className="league-import-note">Select which team is yours to continue.</p>}
          </div>
        )}

        <div className="modal-footer">
          {phase === 'input' ? (
            <>
              <button className="btn btn-outline" onClick={close}>Cancel</button>
              <button className="btn btn-primary" onClick={handleParse} disabled={!csvText.trim()}>
                Parse Draft
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => setPhase('input')}>Back</button>
              <button className="btn btn-primary" onClick={handleApply} disabled={!userTeamName}>
                Apply League Profile
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default LeagueImportModal
