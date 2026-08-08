import React, { useState, useMemo } from 'react'
import {
  buildChampEntries, computeChampProjection, clampBoost, rosterSizeFor,
  loadSavedRosters, saveRoster, deleteSavedRoster, resolveSavedRoster,
  MAX_SAVED_ROSTERS, BOOST_MIN, BOOST_MAX,
} from '../utils/champBuilder.js'
import { getLineupSlots } from '../utils/draftAnalysis.js'
import { track } from '../services/analyticsService'

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST']
const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST']
// Multi-position filters mirror slot eligibility in draftAnalysis.js.
const MULTI_POS_FILTERS = { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] }
// Keep the pool table snappy — filters/search reach everyone below the fold.
const POOL_ROW_LIMIT = 150

// Build-a-Champ: hand-pick a roster from the players the simulations actually
// drafted, priced at the average the configured league pays for each. A boost
// % per player bends their projection, and the roster is scored/ranked against
// every simulated team. Rosters persist to localStorage across meta sims.
export default function BuildAChampTab({ result }) {
  const { playerPool, leagueBenchmark, rosterPositions, numberOfTeams, budgetPerTeam } = result
  const [selection, setSelection] = useState([])
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('ALL')
  const [savedRosters, setSavedRosters] = useState(() => loadSavedRosters())
  const [saveName, setSaveName] = useState('')
  const [notice, setNotice] = useState(null)

  const poolById = useMemo(() => new Map((playerPool || []).map(p => [p.id, p])), [playerPool])
  const entries = useMemo(() => buildChampEntries(selection, poolById), [selection, poolById])
  const projection = useMemo(
    () => computeChampProjection(entries, {
      rosterPositions, numberOfTeams, budgetPerTeam,
      benchmark: leagueBenchmark?.teamStarterPoints || [],
    }),
    [entries, rosterPositions, numberOfTeams, budgetPerTeam, leagueBenchmark]
  )

  // Slot assignment for display uses the boosted projections, mirroring how
  // the projection itself picks starters.
  const lineup = useMemo(() => {
    const roster = entries.map(e => ({ ...e, projectedPoints: e.adjustedPoints }))
    return getLineupSlots({ roster }, rosterPositions)
  }, [entries, rosterPositions])

  const selectedIds = useMemo(() => new Set(selection.map(s => s.id)), [selection])
  const rosterFull = entries.length >= rosterSizeFor(rosterPositions)

  const filteredPool = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (playerPool || [])
      .filter(p => !selectedIds.has(p.id))
      .filter(p => posFilter === 'ALL'
        || (MULTI_POS_FILTERS[posFilter] ? MULTI_POS_FILTERS[posFilter].includes(p.position) : p.position === posFilter))
      .filter(p => !q || p.name.toLowerCase().includes(q))
  }, [playerPool, selectedIds, posFilter, search])

  if (!playerPool?.length) {
    return (
      <div className="analysis-section">
        <p className="meta-foot-note">
          No player market data in this report — run a new meta simulation to use Build-a-Champ.
        </p>
      </div>
    )
  }

  const addPlayer = (id) => {
    if (rosterFull || selectedIds.has(id)) return
    setNotice(null)
    setSelection(sel => [...sel, { id, boostPct: 0 }])
  }
  const removePlayer = (id) => setSelection(sel => sel.filter(s => s.id !== id))
  const setBoost = (id, value) => {
    // Allow free typing (including "-" / empty); clamp on projection side too.
    const n = value === '' || value === '-' ? 0 : clampBoost(value)
    setSelection(sel => sel.map(s => (s.id === id ? { ...s, boostPct: n } : s)))
  }

  const onSave = () => {
    const updated = saveRoster(saveName, entries)
    if (!updated) {
      setNotice(saveName.trim()
        ? `All ${MAX_SAVED_ROSTERS} save slots are used — delete one or reuse an existing name to overwrite.`
        : 'Give the roster a name before saving.')
      return
    }
    setSavedRosters(updated)
    setNotice(`Saved "${saveName.trim()}".`)
    track('champ_roster_saved', { players: entries.length })
  }

  const onLoad = (saved) => {
    const { selection: loaded, missing } = resolveSavedRoster(saved, poolById)
    setSelection(loaded)
    setSaveName(saved.name)
    setNotice(missing.length
      ? `Loaded "${saved.name}" — ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not drafted in these sims and ${missing.length === 1 ? 'was' : 'were'} left off.`
      : `Loaded "${saved.name}".`)
    track('champ_roster_loaded', { players: loaded.length })
  }

  const onDelete = (name) => {
    setSavedRosters(deleteSavedRoster(name))
    setNotice(null)
  }

  // One display row per configured slot (filled or open), then the bench.
  const slotRows = []
  for (const slot of SLOT_ORDER) {
    const count = rosterPositions?.[slot] || 0
    for (let i = 0; i < count; i++) slotRows.push({ slot, player: lineup.slots[slot]?.[i] || null })
  }
  const benchSpots = Math.max(rosterPositions?.BENCH || 0, lineup.bench.length)
  for (let i = 0; i < benchSpots; i++) slotRows.push({ slot: 'BN', player: lineup.bench[i] || null })

  const fmtRank = projection.spotsFilled ? projection.expectedRank.toFixed(1) : '—'

  return (
    <div className="analysis-section champ-builder">
      <h3>Build-a-Champ</h3>
      <p className="meta-foot-note">
        Build your dream roster from the players these simulations drafted, at the price your league
        actually pays for them on average. Set a +/- % on any player you expect to beat (or miss) their
        projection, and see where the roster would have finished across all {leagueBenchmark?.teamStarterPoints?.length || 0} simulated teams.
      </p>

      <div className="champ-summary">
        <div className="champ-stat">
          <span className="champ-stat-label">Spent</span>
          <span className={`champ-stat-value${projection.overBudget ? ' champ-over' : ''}`}>
            ${projection.totalCost} / ${budgetPerTeam}
          </span>
        </div>
        <div className="champ-stat">
          <span className="champ-stat-label">Roster</span>
          <span className="champ-stat-value">{projection.spotsFilled} / {projection.rosterSize}</span>
        </div>
        <div className="champ-stat">
          <span className="champ-stat-label">Starter Pts</span>
          <span className="champ-stat-value">{projection.starterPoints.toFixed(0)}</span>
        </div>
        <div className="champ-stat">
          <span className="champ-stat-label">Proj Finish</span>
          <span className="champ-stat-value">{fmtRank} of {numberOfTeams}</span>
        </div>
        <div className="champ-stat">
          <span className="champ-stat-label">Beats</span>
          <span className="champ-stat-value">{(projection.percentile * 100).toFixed(0)}% of teams</span>
        </div>
        <div className="champ-stat">
          <span className="champ-stat-label">Title Odds</span>
          <span className="champ-stat-value">{(projection.winOdds * 100).toFixed(0)}%</span>
        </div>
      </div>
      {projection.overBudget && (
        <p className="champ-warning">This roster costs more than your ${budgetPerTeam} budget — you couldn't build it in a real draft.</p>
      )}

      <div className="champ-save-bar">
        <input
          className="champ-save-input"
          type="text"
          placeholder="Roster name"
          maxLength={30}
          value={saveName}
          onChange={e => setSaveName(e.target.value)}
        />
        <button className="btn btn-secondary" onClick={onSave} disabled={!entries.length}>Save roster</button>
        {savedRosters.map(r => (
          <span key={r.name} className="champ-saved-chip">
            <button className="champ-saved-load" onClick={() => onLoad(r)} title={`Load ${r.name}`}>{r.name}</button>
            <button className="champ-saved-delete" onClick={() => onDelete(r.name)} title={`Delete ${r.name}`} aria-label={`Delete ${r.name}`}>×</button>
          </span>
        ))}
        <span className="meta-foot-note champ-save-note">{savedRosters.length}/{MAX_SAVED_ROSTERS} saved — rosters carry across meta sims and re-price to each new run.</span>
      </div>
      {notice && <p className="champ-notice">{notice}</p>}

      <div className="champ-layout">
        <div className="champ-roster">
          <h3>Your roster</h3>
          <table className="meta-scorecard">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Player</th>
                <th style={{ textAlign: 'right' }}>$</th>
                <th style={{ textAlign: 'right' }}>Boost %</th>
                <th style={{ textAlign: 'right' }}>Pts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {slotRows.map((row, i) => (
                <tr key={i} className={row.player ? '' : 'champ-empty-slot'}>
                  <td>{row.slot}</td>
                  {row.player ? (
                    <>
                      <td>{row.player.name} <span className="champ-pos-tag">{row.player.position}</span></td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-numeric)' }}>${row.player.avgPrice}</td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="champ-boost-input"
                          type="number"
                          min={BOOST_MIN}
                          max={BOOST_MAX}
                          step={5}
                          value={selection.find(s => s.id === row.player.id)?.boostPct ?? 0}
                          onChange={e => setBoost(row.player.id, e.target.value)}
                          aria-label={`Boost % for ${row.player.name}`}
                        />
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-numeric)' }}>
                        {row.player.adjustedPoints.toFixed(0)}
                        {row.player.boostPct !== 0 && (
                          <span className={`champ-boost-delta${row.player.boostPct > 0 ? ' up' : ' down'}`}>
                            {row.player.boostPct > 0 ? '▲' : '▼'}
                          </span>
                        )}
                      </td>
                      <td>
                        <button className="champ-remove" onClick={() => removePlayer(row.player.id)} aria-label={`Remove ${row.player.name}`}>×</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="champ-open">Open spot</td>
                      <td style={{ textAlign: 'right' }}>—</td>
                      <td style={{ textAlign: 'right' }}>—</td>
                      <td style={{ textAlign: 'right' }}>—</td>
                      <td />
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="champ-pool">
          <h3>Player market</h3>
          <div className="champ-pool-controls">
            <input
              className="champ-search"
              type="search"
              placeholder="Search players…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="champ-pos-filters">
              {POS_FILTERS.map(pos => (
                <button
                  key={pos}
                  className={`champ-pos-btn${posFilter === pos ? ' active' : ''}`}
                  onClick={() => setPosFilter(pos)}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
          <table className="meta-scorecard">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th style={{ textAlign: 'right' }}>Avg $</th>
                <th style={{ textAlign: 'right' }}>Proj Pts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredPool.slice(0, POOL_ROW_LIMIT).map(p => (
                <tr key={p.id}>
                  <td>{p.name} <span className="champ-pos-tag">{p.team}</span></td>
                  <td>{p.position}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-numeric)' }}>${p.avgPrice}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-numeric)' }}>{p.projectedPoints.toFixed(0)}</td>
                  <td>
                    <button
                      className="btn btn-secondary champ-add"
                      onClick={() => addPlayer(p.id)}
                      disabled={rosterFull}
                      aria-label={`Add ${p.name}`}
                      title={rosterFull ? 'Roster is full — remove a player first' : `Add ${p.name}`}
                    >
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredPool.length > POOL_ROW_LIMIT && (
            <p className="meta-foot-note">Showing the top {POOL_ROW_LIMIT} of {filteredPool.length} players by average price — search or filter to find the rest.</p>
          )}
          {!filteredPool.length && <p className="meta-foot-note">No players match.</p>}
          <p className="meta-foot-note">
            Prices are the average each player sold for across all {result.totalDrafts} simulated drafts of your league.
          </p>
        </div>
      </div>
    </div>
  )
}
