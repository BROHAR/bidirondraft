import React, { useMemo, useState } from 'react'
import { validateKeepers, matchPicksToPlayers, KEEPER_PRICE_RULES, MAX_KEEPERS_LIMIT } from '../utils/keepers'

// Keeper setup: assign each seat the players it retains from last season and
// the price they count against its budget. Two ways in — search the player
// pool manually, or (when a league import with raw picks exists) tick players
// straight off last year's results with a pricing rule applied. Edits are
// local until "Save Keepers"; onApply receives { keepers, maxKeepersPerTeam }.
function KeeperModal({ isOpen, onClose, config, players, leagueProfile, onApply }) {
  const [keepers, setKeepers] = useState(() => config.keepers || [])
  const [maxKeepers, setMaxKeepers] = useState(config.maxKeepersPerTeam ?? 3)
  const [tab, setTab] = useState('manual')             // 'manual' | 'import'
  const [seat, setSeat] = useState(1)
  const [search, setSearch] = useState('')
  const [priceRule, setPriceRule] = useState('same')

  // Last year's picks matched to the current pool, grouped per imported team
  // and mapped onto seats with the same convention as the league-profile
  // persona seating: the user's team takes the human seat, everyone else
  // fills the remaining seats in imported order.
  const importGroups = useMemo(() => {
    const picks = leagueProfile?.picks
    if (!Array.isArray(picks) || picks.length === 0) return null
    const matched = matchPicksToPlayers(picks, players)
    const profileTeams = leagueProfile.teams || []
    const seatByTeam = new Map()
    const others = profileTeams.filter(t => !t.isUser)
    let next = 0
    for (let s = 1; s <= config.numberOfTeams; s++) {
      if (s === config.humanDraftPosition) continue
      const t = others[next++]
      if (t) seatByTeam.set(t.name, s)
    }
    const user = profileTeams.find(t => t.isUser)
    if (user) seatByTeam.set(user.name, config.humanDraftPosition)

    const groups = []
    for (const t of profileTeams) {
      const s = seatByTeam.get(t.name)
      if (!s) continue
      const rows = matched
        .filter(m => m.pick.fantasyTeam === t.name)
        .sort((a, b) => b.pick.price - a.pick.price)
      groups.push({ teamName: t.name, seat: s, isUser: !!t.isUser, rows })
    }
    return groups.sort((a, b) => a.seat - b.seat)
  }, [leagueProfile, players, config.numberOfTeams, config.humanDraftPosition])

  if (!isOpen) return null

  const keptIds = new Set(keepers.map(k => k.playerId))
  const rule = KEEPER_PRICE_RULES.find(r => r.key === priceRule) || KEEPER_PRICE_RULES[0]
  const ruledPrice = p => Math.max(1, Math.min(config.budgetPerTeam, Math.round(rule.apply(p))))

  const errors = validateKeepers({ ...config, keepers, maxKeepersPerTeam: maxKeepers })

  const seatLabel = s => (s === config.humanDraftPosition
    ? `${config.humanTeamName || 'Your Team'} (you)`
    : (config.aiTeamNames?.[s - 1]?.trim() || `Position ${s}`))

  const searchMatches = search.trim().length >= 2
    ? players
        .filter(p => !keptIds.has(p.id) && p.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
        .slice(0, 8)
    : []

  const addKeeper = (player, price) => {
    setKeepers(list => [...list, {
      teamPosition: seat,
      playerId: player.id,
      name: player.name,
      position: player.position,
      price: Math.max(1, Math.min(config.budgetPerTeam, Math.round(price))),
    }])
    setSearch('')
  }

  const removeKeeper = (playerId) => {
    setKeepers(list => list.filter(k => k.playerId !== playerId))
  }

  const setKeeperPrice = (playerId, raw) => {
    const n = parseInt(raw, 10)
    setKeepers(list => list.map(k =>
      k.playerId === playerId && Number.isFinite(n)
        ? { ...k, price: Math.max(1, Math.min(config.budgetPerTeam, n)) }
        : k))
  }

  const toggleImportPick = (group, row) => {
    if (!row.player) return
    if (keptIds.has(row.player.id)) {
      removeKeeper(row.player.id)
    } else {
      setKeepers(list => [...list, {
        teamPosition: group.seat,
        playerId: row.player.id,
        name: row.player.name,
        position: row.player.position,
        price: ruledPrice(row.pick.price),
      }])
    }
  }

  const keptCountFor = s => keepers.filter(k => k.teamPosition === s).length
  const spendFor = s => keepers.filter(k => k.teamPosition === s).reduce((sum, k) => sum + k.price, 0)
  const sortedKeepers = [...keepers].sort((a, b) => a.teamPosition - b.teamPosition || b.price - a.price)

  const save = () => {
    onApply({ keepers, maxKeepersPerTeam: maxKeepers })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content keeper-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Keeper Setup</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="keeper-toolbar">
            <div className="form-group keeper-max">
              <label>Max keepers per team</label>
              <select
                aria-label="Max keepers per team"
                value={maxKeepers}
                onChange={(e) => setMaxKeepers(parseInt(e.target.value, 10))}
              >
                {Array.from({ length: MAX_KEEPERS_LIMIT + 1 }, (_, i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            {importGroups && (
              <div className="keeper-tabs" role="group" aria-label="Keeper source">
                <button
                  type="button"
                  className={`btn btn-sm ${tab === 'manual' ? 'btn-primary' : 'btn-outline'}`}
                  aria-pressed={tab === 'manual'}
                  onClick={() => setTab('manual')}
                >
                  Search Players
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${tab === 'import' ? 'btn-primary' : 'btn-outline'}`}
                  aria-pressed={tab === 'import'}
                  onClick={() => setTab('import')}
                >
                  From Last Year&apos;s Draft
                </button>
              </div>
            )}
          </div>

          {tab === 'manual' && (
            <div className="keeper-add">
              <div className="form-group">
                <label>Team</label>
                <select
                  aria-label="Keeper team"
                  value={seat}
                  onChange={(e) => setSeat(parseInt(e.target.value, 10))}
                >
                  {Array.from({ length: config.numberOfTeams }, (_, i) => i + 1).map(s => (
                    <option key={s} value={s}>{seatLabel(s)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group keeper-search">
                <label>Player</label>
                <input
                  type="text"
                  value={search}
                  placeholder="Search by name…"
                  onChange={(e) => setSearch(e.target.value)}
                />
                {searchMatches.length > 0 && (
                  <ul className="keeper-search-results">
                    {searchMatches.map(p => (
                      <li key={p.id}>
                        <button type="button" onClick={() => addKeeper(p, p.estimatedValue)}>
                          <span className="keeper-result-name">{p.name}</span>
                          <span className="keeper-result-meta">{p.position} · {p.team} · ${Math.round(p.estimatedValue)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {tab === 'import' && importGroups && (
            <div className="keeper-import">
              <div className="form-group keeper-price-rule">
                <label>Keeper price rule (applied to last year&apos;s price)</label>
                <select
                  aria-label="Keeper price rule"
                  value={priceRule}
                  onChange={(e) => setPriceRule(e.target.value)}
                >
                  {KEEPER_PRICE_RULES.map(r => (
                    <option key={r.key} value={r.key}>{r.label}</option>
                  ))}
                </select>
              </div>
              {importGroups.map(group => (
                <div key={group.teamName} className="keeper-import-team">
                  <div className="keeper-import-team-head">
                    <span className="keeper-import-team-name">{group.teamName}</span>
                    <span className="keeper-import-team-seat">→ {seatLabel(group.seat)}</span>
                  </div>
                  <div className="keeper-import-picks">
                    {group.rows.map(({ pick, player }) => {
                      const kept = player && keptIds.has(player.id)
                      const keptElsewhere = player && !kept &&
                        keepers.some(k => k.playerId === player.id && k.teamPosition !== group.seat)
                      const atLimit = !kept && keptCountFor(group.seat) >= maxKeepers
                      return (
                        <label
                          key={`${pick.name}|${pick.position}`}
                          className={`keeper-import-pick ${!player ? 'unavailable' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={!!kept}
                            disabled={!player || keptElsewhere || atLimit}
                            onChange={() => toggleImportPick(group, { pick, player })}
                          />
                          <span>{pick.name} · {pick.position} · was ${pick.price}</span>
                          {player
                            ? <span className="keeper-import-now">→ ${ruledPrice(pick.price)}</span>
                            : <span className="keeper-import-now">not in player pool</span>}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sortedKeepers.length > 0 && (
            <div className="keeper-list">
              <table>
                <thead>
                  <tr><th>Team</th><th>Player</th><th>Pos</th><th>Price</th><th /></tr>
                </thead>
                <tbody>
                  {sortedKeepers.map(k => (
                    <tr key={k.playerId}>
                      <td>{seatLabel(k.teamPosition)}</td>
                      <td>{k.name}</td>
                      <td>{k.position}</td>
                      <td>
                        <input
                          type="number"
                          className="keeper-price-input"
                          min={1}
                          max={config.budgetPerTeam}
                          value={k.price}
                          aria-label={`Keeper price for ${k.name}`}
                          onChange={(e) => setKeeperPrice(k.playerId, e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          aria-label={`Remove keeper ${k.name}`}
                          onClick={() => removeKeeper(k.playerId)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="keeper-summary">
                {[...new Set(keepers.map(k => k.teamPosition))].sort((a, b) => a - b).map(s => (
                  <span key={s} className="league-profile-chip">
                    {seatLabel(s)}: {keptCountFor(s)} · ${spendFor(s)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="simulate-error">{errors.join(' · ')}</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {keepers.length > 0 && (
            <button className="btn btn-outline" onClick={() => setKeepers([])}>Clear All</button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={errors.length > 0}>
            Save Keepers
          </button>
        </div>
      </div>
    </div>
  )
}

export default KeeperModal
