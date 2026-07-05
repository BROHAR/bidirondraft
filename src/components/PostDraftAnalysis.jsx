import React, { useState, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import {
  getStartingLineup,
  calculateStarterPoints,
  getTotalValueCapture,
  rankTeamsByStarterPoints,
  calculateDraftGrade,
  gradeColor,
  getValueLabel,
  getMarketAveragesByPosition,
  getBestValues,
  getBiggestOverpays,
  getByeWeekMap,
  getPositionSpendingByGroup,
  getHumanPicksTimeline,
  generateTakeaways,
  getLeagueAvgPointsPerDollar,
  getPickAnalysis,
  getReplacementLevels,
  getPlayerVORP,
  getTeamVORP,
  generateValueCostTakeaways,
  getLineupSlots,
  getPositionalRankScores,
  buildPositionalRadar,
  getPowerRankings,
  buildDreamTeam,
} from '../utils/draftAnalysis.js'
import { budgetScaleFor } from '../utils/budgetScaling.js'
import RadarChart, { AXIS_FULL_LABEL } from './RadarChart.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import '../styles/components/postDraftAnalysis.css'

const TABS = ['Your Roster', 'Market Intel', 'Value vs Cost', 'Budget Flow', 'The Field', 'Strengths', 'Dream Team', 'Draft Board']
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
// Price-tier bounds are tuned for a $200 budget and scale with the league's
// actual budget (estimated values are rescaled at draft init).
function buildPriceTiers(budgetScale) {
  const s = v => Math.max(1, Math.round(v * budgetScale))
  const bounds = [[1, 10], [11, 25], [26, 40], [41, 60]]
  const tiers = bounds.map(([min, max]) => ({
    label: `$${s(min)}–${s(max)}`,
    min: s(min),
    max: s(max),
  }))
  tiers.push({ label: `$${s(60)}+`, min: s(60), max: Infinity })
  return tiers
}

// ---- InfoTip — small ⓘ glyph with a styled hover/focus tooltip ----------

// Strategy label for a team. AI teams show their strategy name; the human team
// shows "You", plus the auto-pilot strategy it drafted with when auto-pilot was
// used (in a draft or sim) — so it reads like the other bidders.
function teamStrategyLabel(team) {
  if (!team.isHuman) return team.draftStrategy?.name || 'AI'
  const autoStrat = team.isAutoPilot
    ? (team.draftStrategy?.name || team.autoPilotStrategy)
    : null
  return autoStrat ? `You (${autoStrat})` : 'You'
}

function InfoTip({ text, label }) {
  return (
    <span
      className="info-tip"
      tabIndex={0}
      role="note"
      aria-label={label ? `${label}: ${text}` : text}
    >
      ⓘ
      <span className="info-tip-bubble" role="tooltip">{text}</span>
    </span>
  )
}

// ---- Roster slot builder -----------------------------------------------

function buildRosterSlots(team, rosterPositions) {
  const rc = rosterPositions || {}
  const { slots: occupants, bench } = getLineupSlots(team, rosterPositions)
  const slots = []

  for (const slotType of ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST']) {
    const count = rc[slotType] || 0
    if (!count) continue
    const label = slotType === 'SUPERFLEX' ? 'SF' : slotType
    const filled = occupants[slotType] || []
    for (let i = 0; i < count; i++) {
      slots.push({ slotLabel: label, player: filled[i] || null, isStarter: true })
    }
  }

  bench.forEach(p => slots.push({ slotLabel: 'BENCH', player: p, isStarter: false }))
  return slots
}

// ---- Tab 1: Your Roster ------------------------------------------------

function RosterTab({ humanTeam, rosterPositions, draftHistory, config, replacementLevels }) {
  const starters = useMemo(() => getStartingLineup(humanTeam, rosterPositions), [humanTeam, rosterPositions])
  const starterIds = useMemo(() => new Set(starters.map(p => p.id)), [starters])
  const bench = humanTeam.roster.filter(p => !starterIds.has(p.id))
  const rosterSlots = useMemo(() => buildRosterSlots(humanTeam, rosterPositions), [humanTeam, rosterPositions])
  const mkt = useMemo(() => getMarketAveragesByPosition(draftHistory), [draftHistory])
  const posSpend = useMemo(() => getPositionSpendingByGroup(humanTeam), [humanTeam])
  const byeMap = useMemo(() => getByeWeekMap(humanTeam, rosterPositions), [humanTeam, rosterPositions])

  // "Room fair" price: the player's estimate corrected for how this draft
  // actually priced the position (league paid / league estimated). Answers
  // "what should this have cost in THIS room?" — omitted when it rounds to
  // the estimate itself.
  const roomFair = (pick) => {
    const m = mkt[pick.player.position]
    if (!m || !(m.avgEstimated > 0)) return null
    const fair = Math.round(pick.player.estimatedValue * (m.avgPaid / m.avgEstimated))
    return fair !== Math.round(pick.player.estimatedValue) ? fair : null
  }

  const myBestValues = useMemo(() => {
    const myPicks = draftHistory.filter(p => p.team === humanTeam.name)
    return [...myPicks]
      .map(p => ({ ...p, valueDiff: p.player.estimatedValue - p.price }))
      .sort((a, b) => b.valueDiff - a.valueDiff)
      .slice(0, 3)
  }, [draftHistory, humanTeam.name])

  const myOverpays = useMemo(() => {
    const myPicks = draftHistory.filter(p => p.team === humanTeam.name)
    return [...myPicks]
      .map(p => ({ ...p, valueDiff: p.player.estimatedValue - p.price }))
      .sort((a, b) => a.valueDiff - b.valueDiff)
      .slice(0, 3)
  }, [draftHistory, humanTeam.name])

  const bs = budgetScaleFor(config?.budgetPerTeam)
  const posRows = POSITION_ORDER.map(pos => {
    const mine = posSpend[pos]
    const market = mkt[pos]
    if (!mine) return null
    const marketAvg = market ? market.avgPaid : null
    const myAvg = mine.spend / mine.players.length
    const diff = marketAvg !== null ? myAvg - marketAvg : null

    // Verdict bands are per-player dollar deltas tuned for $200, scaled to
    // the league budget.
    let verdict = 'verdict-fair', verdictText = 'Fair'
    if (diff !== null) {
      if (diff <= -3 * bs)      { verdict = 'verdict-under';    verdictText = `$${Math.abs(diff).toFixed(0)} under mkt` }
      else if (diff <= 3 * bs)  { verdict = 'verdict-fair';     verdictText = 'At market' }
      else if (diff <= 8 * bs)  { verdict = 'verdict-over';     verdictText = `$${diff.toFixed(0)} over mkt` }
      else                      { verdict = 'verdict-big-over'; verdictText = `$${diff.toFixed(0)} over mkt` }
    }

    const posVorp = mine.players.reduce(
      (sum, p) => sum + getPlayerVORP(p, replacementLevels),
      0
    )

    return (
      <tr key={pos}>
        <td><span className={`pos-badge ${pos}`}>{pos}</span></td>
        <td>{mine.players.length}</td>
        <td>${mine.spend}</td>
        <td>${myAvg.toFixed(0)}</td>
        <td>{marketAvg !== null ? `$${marketAvg.toFixed(0)}` : '—'}</td>
        <td>{Math.round(posVorp)}</td>
        <td className={verdict}>{verdictText}</td>
      </tr>
    )
  }).filter(Boolean)

  const replacementSummary = replacementLevels
    ? POSITION_ORDER
        .filter(pos => replacementLevels[pos] !== undefined)
        .map(pos => `${pos} ${Math.round(replacementLevels[pos])}`)
        .join(' · ')
    : null

  // Bye week grid (weeks 1–18)
  const byeCells = Array.from({ length: 18 }, (_, i) => {
    const week = i + 1
    const players = byeMap[week] || []
    let cls = ''
    if (players.length >= 2) cls = 'conflict'
    else if (players.length === 1) cls = 'bye-1'
    return (
      <div
        key={week}
        className={`bye-cell ${cls}`}
        title={players.length ? players.map(p => p.name).join(', ') : ''}
      >
        {week}
      </div>
    )
  })

  return (
    <div>
      {/* Position breakdown */}
      <div className="analysis-section">
        <h3>Position Breakdown</h3>
        {posRows.length > 0 ? (
          <>
            <table className="pos-breakdown-table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Drafted</th>
                  <th>Spent</th>
                  <th>My $/Player</th>
                  <th>Mkt $/Player <InfoTip label="Mkt $/Player" text="League-wide average price paid per player at this position. The vs-Market verdict compares your per-player average against it." /></th>
                  <th>VORP</th>
                  <th>vs Market</th>
                </tr>
              </thead>
              <tbody>{posRows}</tbody>
            </table>
            {replacementSummary && (
              <div className="replacement-reference">
                Replacement levels: {replacementSummary}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--fg3)' }}>No roster data available.</p>
        )}
      </div>

      {/* Roster slot list */}
      <div className="analysis-section">
        <h3>Your Roster ({starters.length} starters · {bench.length} bench)</h3>
        <div className="roster-slot-list">
          {rosterSlots.map((slot, i) => {
            const label = slot.player ? getValueLabel(slot.player.estimatedValue, slot.player.purchasePrice || 0, bs) : null
            const isFirstBench = slot.slotLabel === 'BENCH' && (i === 0 || rosterSlots[i - 1].slotLabel !== 'BENCH')
            return (
              <React.Fragment key={i}>
                {isFirstBench && <div className="roster-divider">Bench</div>}
                <div className={`roster-slot-row${slot.isStarter ? '' : ' bench-row'}${!slot.player ? ' empty-row' : ''}`}>
                  <span className={`slot-label slot-${slot.slotLabel}`}>{slot.slotLabel}</span>
                  {slot.player ? (
                    <>
                      <span className="rs-name">{slot.player.name}</span>
                      <span className="rs-team">{slot.player.team}</span>
                      <span className="rs-bye">Bye {slot.player.byeWeek}</span>
                      <span className={`pos-badge ${slot.player.position}`}>{slot.player.position}</span>
                      <span className="rs-price">${slot.player.purchasePrice || 0}</span>
                      <span className={`value-badge ${label.cls}`}>{label.text}</span>
                      <span className="rs-pts">{(slot.player.projectedPoints || 0).toFixed(1)} pts</span>
                    </>
                  ) : (
                    <span className="rs-empty">— empty —</span>
                  )}
                </div>
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Steals & Overpays */}
      <div className="analysis-section">
        <h3>Your Best Deals &amp; Overpays</h3>
        <div className="steals-overpays">
          <div>
            <div className="so-list-title steals-title">Top Steals <InfoTip label="Top Steals" text="Room fair = the player's estimated value adjusted by how far above or below estimates this draft actually paid at the position." /></div>
            {myBestValues.map((pick, i) => (
              <div key={i} className="so-item">
                <div>
                  <div className="so-player">{pick.player.name}</div>
                  <div className="so-team">
                    {pick.player.position} · ${pick.price} paid (est. ${pick.player.estimatedValue}
                    {roomFair(pick) !== null ? ` · room fair $${roomFair(pick)}` : ''})
                  </div>
                </div>
                <span className="so-delta-positive">+${pick.valueDiff.toFixed(0)}</span>
              </div>
            ))}
            {myBestValues.length === 0 && <div className="so-team">No data</div>}
          </div>
          <div>
            <div className="so-list-title overpays-title">Biggest Overpays</div>
            {myOverpays.filter(p => p.valueDiff < 0).map((pick, i) => (
              <div key={i} className="so-item">
                <div>
                  <div className="so-player">{pick.player.name}</div>
                  <div className="so-team">
                    {pick.player.position} · ${pick.price} paid (est. ${pick.player.estimatedValue}
                    {roomFair(pick) !== null ? ` · room fair $${roomFair(pick)}` : ''})
                  </div>
                </div>
                <span className="so-delta-negative">-${Math.abs(pick.valueDiff).toFixed(0)}</span>
              </div>
            ))}
            {myOverpays.filter(p => p.valueDiff < 0).length === 0 && (
              <div className="so-team">No overpays — nice work!</div>
            )}
          </div>
        </div>
      </div>

      {/* Bye week heatmap */}
      <div className="analysis-section">
        <h3>Starter Bye Weeks (weeks 1–18)</h3>
        <div className="bye-week-grid">{byeCells}</div>
        <div className="bye-week-legend">
          <span>
            <span className="legend-dot" style={{ background: 'rgba(255,200,61,0.18)', borderColor: 'var(--gold-600)' }} />
            1 starter on bye
          </span>
          <span>
            <span className="legend-dot" style={{ background: 'rgba(200,16,46,0.25)', borderColor: 'var(--red-600)' }} />
            2+ starters on bye (conflict)
          </span>
        </div>
      </div>
    </div>
  )
}

// ---- Tab 2: Market Intel ------------------------------------------------

function MarketIntelTab({ draftHistory, humanTeam, allTeams, rosterPositions, replacementInfo, config }) {
  const bs = budgetScaleFor(config?.budgetPerTeam)
  const mkt = useMemo(() => getMarketAveragesByPosition(draftHistory), [draftHistory])
  const bestValues = useMemo(() => getBestValues(draftHistory, 5), [draftHistory])
  const overpays = useMemo(() => getBiggestOverpays(draftHistory, 5), [draftHistory])
  const takeaways = useMemo(
    () => generateTakeaways(humanTeam, allTeams, draftHistory, rosterPositions),
    [humanTeam, allTeams, draftHistory, rosterPositions]
  )

  // Position inflation bars — scale to max avg paid
  const posEntries = POSITION_ORDER.map(pos => [pos, mkt[pos]]).filter(([, v]) => v)
  const maxAvg = Math.max(...posEntries.map(([, v]) => Math.max(v.avgPaid, v.avgEstimated)), 1)

  // Tier analysis
  const tiers = buildPriceTiers(bs).map(tier => {
    const picks = draftHistory.filter(p => p.price >= tier.min && p.price <= tier.max)
    const totalOverpay = picks.reduce((sum, p) => sum + (p.price - p.player.estimatedValue), 0)
    const avgOverpay = picks.length > 0 ? totalOverpay / picks.length : 0
    return { ...tier, count: picks.length, avgOverpay }
  })

  return (
    <div>
      {/* Position inflation */}
      <div className="analysis-section">
        <h3>Position Pricing vs Projected Value</h3>
        <div className="market-bars">
          {posEntries.map(([pos, data]) => {
            const paidW = (data.avgPaid / maxAvg) * 100
            const estW  = (data.avgEstimated / maxAvg) * 100
            const cls   = data.inflation > 8 ? 'inflated' : data.inflation < -5 ? 'bargain' : 'neutral'
            const sign  = data.inflation >= 0 ? '+' : ''
            return (
              <div key={pos} className="market-bar-row">
                <div className="market-bar-pos">
                  <span className={`pos-badge ${pos}`}>{pos}</span>
                </div>
                <div className="market-bar-track">
                  <div className="market-bar-estimated" style={{ width: `${estW}%` }} />
                  <div className={`market-bar-paid ${cls}`} style={{ width: `${paidW}%` }} />
                </div>
                <div className={`market-bar-stat ${cls}`}>
                  {sign}{data.inflation.toFixed(0)}%
                </div>
              </div>
            )
          })}
        </div>
        <div className="market-legend">
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--gray-700)', marginRight: 4, border: '1px solid var(--gray-600)' }} />Projected value</span>
          <span><span style={{ display: 'inline-block', width: 12, height: 12, background: 'var(--sky-500)', marginRight: 4, border: '1px solid var(--sky-700)' }} />Avg paid</span>
        </div>
      </div>

      {/* Replacement-level reference */}
      {replacementInfo && (
        <div className="analysis-section">
          <h3>Replacement Levels</h3>
          <p className="replacement-blurb">
            VORP (Value Over Replacement Player) compares each pick to the best player at the position
            who <em>wouldn't</em> start in a typical lineup across this league. Below is who that is at each spot.
          </p>
          <div className="replacement-grid">
            {POSITION_ORDER.filter(pos => replacementInfo.players[pos]).map(pos => {
              const p = replacementInfo.players[pos]
              const rank = Math.round(replacementInfo.thresholds[pos]) + 1
              return (
                <div key={pos} className="replacement-card">
                  <div className="replacement-card-head">
                    <span className={`pos-badge ${pos}`}>{pos}</span>
                    <span className="replacement-rank">{pos}{rank}</span>
                  </div>
                  <div className="replacement-name">{p.name}</div>
                  <div className="replacement-pts">{Math.round(p.projectedPoints || 0)} pts</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Price tier analysis */}
      <div className="analysis-section">
        <h3>Competitiveness by Price Tier</h3>
        <div className="tier-grid">
          {tiers.map(tier => {
            const sign = tier.avgOverpay >= 0 ? '+' : ''
            const color = tier.avgOverpay > 3 * bs ? 'var(--accent-negative)'
              : tier.avgOverpay < -3 * bs ? 'var(--accent-positive)'
              : 'var(--fg2)'
            return (
              <div key={tier.label} className="tier-card">
                <div className="tier-range">{tier.label}</div>
                <div className="tier-count">{tier.count}</div>
                <div className="tier-label">players</div>
                {tier.count > 0 && (
                  <div className="tier-inflation" style={{ color }}>
                    {sign}{tier.avgOverpay.toFixed(1)} avg
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Draft-wide best values & overpays */}
      <div className="analysis-section">
        <h3>Draft-Wide Values &amp; Overpays</h3>
        <div className="global-so">
          <div>
            <div className="so-list-title steals-title">Best Values (entire draft)</div>
            {bestValues.map((pick, i) => (
              <div key={i} className="so-item">
                <div>
                  <div className="so-player">{pick.player.name}</div>
                  <div className="so-team">{pick.player.position} · {pick.team} · ${pick.price} (est. ${pick.player.estimatedValue})</div>
                </div>
                <span className="so-delta-positive">+${pick.valueDiff.toFixed(0)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="so-list-title overpays-title">Biggest Overpays (entire draft)</div>
            {overpays.filter(p => p.valueDiff < 0).map((pick, i) => (
              <div key={i} className="so-item">
                <div>
                  <div className="so-player">{pick.player.name}</div>
                  <div className="so-team">{pick.player.position} · {pick.team} · ${pick.price} (est. ${pick.player.estimatedValue})</div>
                </div>
                <span className="so-delta-negative">-${Math.abs(pick.valueDiff).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Takeaways */}
      {takeaways.length > 0 && (
        <div className="analysis-section">
          <h3>Key Takeaways for Your Real Draft</h3>
          <ul className="takeaways-list">
            {takeaways.map((t, i) => (
              <li key={i} className="takeaway-item">
                <span className="takeaway-bullet">▶</span>
                <span className="takeaway-text">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---- Tab 3: Value vs Cost ----------------------------------------------

function ValueAnalysisTab({ draftHistory, allTeams, humanTeam, replacementLevels }) {
  const [filter, setFilter] = useState('all')   // 'all' | 'human' | <teamId>
  const [sortBy, setSortBy] = useState('pick')  // 'pick' | 'dollar' | 'points' | 'vorp' | 'dollarPerVorp'
  const [sortDir, setSortDir] = useState('asc') // 'asc' | 'desc'

  const leagueAvg = useMemo(() => getLeagueAvgPointsPerDollar(draftHistory), [draftHistory])
  const bs = budgetScaleFor(humanTeam?.budget)
  const annotated = useMemo(() => getPickAnalysis(draftHistory, leagueAvg, bs), [draftHistory, leagueAvg, bs])

  // Whole-draft synthesis — neutral, never changes with the team filter.
  const valueTakeaways = useMemo(() => {
    const marketByPos = getMarketAveragesByPosition(draftHistory)
    return generateValueCostTakeaways(annotated, leagueAvg, replacementLevels, marketByPos)
  }, [annotated, leagueAvg, replacementLevels, draftHistory])

  // Filter
  const filtered = useMemo(() => {
    if (filter === 'all')   return annotated
    if (filter === 'human') return annotated.filter(p => p.team === humanTeam?.name)
    const team = allTeams.find(t => t.id === filter)
    return team ? annotated.filter(p => p.team === team.name) : annotated
  }, [annotated, filter, humanTeam, allTeams])

  // Sort
  const rows = useMemo(() => {
    const sorted = [...filtered]
    if (sortBy === 'pick')   sorted.sort((a, b) => a.pickIndex   - b.pickIndex)
    if (sortBy === 'dollar') sorted.sort((a, b) => b.dollarDelta - a.dollarDelta) // value-first
    if (sortBy === 'points') sorted.sort((a, b) => b.pointsDelta - a.pointsDelta) // value-first
    if (sortBy === 'vorp') {
      sorted.sort((a, b) => getPlayerVORP(b.player, replacementLevels) - getPlayerVORP(a.player, replacementLevels))
    }
    if (sortBy === 'dollarPerVorp') {
      // Lowest $/VORP first (most efficient); VORP=0 sorts to the bottom.
      const score = (p) => {
        const v = getPlayerVORP(p.player, replacementLevels)
        return v > 0 ? p.price / v : Infinity
      }
      sorted.sort((a, b) => score(a) - score(b))
    }
    return sortDir === 'asc' ? sorted : sorted.reverse()
  }, [filtered, sortBy, sortDir, replacementLevels])

  // Summary counts (always based on full draft, not filter)
  const dollarValues  = annotated.filter(p => p.dollarLabel.cls === 'value' || p.dollarLabel.cls === 'slight-value').length
  const dollarOverpay = annotated.filter(p => p.dollarLabel.cls === 'overpay' || p.dollarLabel.cls === 'slight-overpay').length
  const pointsValues  = annotated.filter(p => p.pointsLabel.cls === 'value' || p.pointsLabel.cls === 'slight-value').length
  const pointsOverpay = annotated.filter(p => p.pointsLabel.cls === 'overpay' || p.pointsLabel.cls === 'slight-overpay').length

  // Top callouts — always draft-wide so they don't disappear with team filter
  const bestDollar    = useMemo(() => [...annotated].sort((a, b) => b.dollarDelta - a.dollarDelta)[0], [annotated])
  const worstDollar   = useMemo(() => [...annotated].sort((a, b) => a.dollarDelta - b.dollarDelta)[0], [annotated])
  const bestPoints    = useMemo(() => [...annotated].sort((a, b) => b.pointsDelta - a.pointsDelta)[0], [annotated])
  const worstPoints   = useMemo(() => [...annotated].sort((a, b) => a.pointsDelta - b.pointsDelta)[0], [annotated])

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(key === 'pick' ? 'asc' : 'desc')
    }
  }

  const sortIndicator = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div>
      {/* Summary strip */}
      <div className="analysis-section">
        <h3>Value vs Cost — every pick, both lenses</h3>
        <div className="va-summary">
          <div className="va-stat">
            <label>League avg <InfoTip label="League avg" text="Total projected points ÷ total dollars spent across every pick. This is the benchmark each pick's points verdict is measured against." /></label>
            <span className="va-stat-value">{leagueAvg.toFixed(2)} pts/$</span>
          </div>
          <div className="va-stat">
            <label>Total picks</label>
            <span className="va-stat-value">{annotated.length}</span>
          </div>
          <div className="va-stat">
            <label>$ values / overpays <InfoTip label="Dollar values / overpays" text="Picks bought below estimated auction value (values) vs. above it (overpays), using the dollar lens." /></label>
            <span className="va-stat-value">
              <span style={{ color: 'var(--accent-positive)' }}>{dollarValues}</span>
              <span style={{ color: 'var(--fg3)' }}> / </span>
              <span style={{ color: 'var(--accent-negative)' }}>{dollarOverpay}</span>
            </span>
          </div>
          <div className="va-stat">
            <label>Pts values / overpays <InfoTip label="Points values / overpays" text="Picks that returned more projected points than their price should buy at league-average pts/$ (values) vs. fewer (overpays)." /></label>
            <span className="va-stat-value">
              <span style={{ color: 'var(--accent-positive)' }}>{pointsValues}</span>
              <span style={{ color: 'var(--fg3)' }}> / </span>
              <span style={{ color: 'var(--accent-negative)' }}>{pointsOverpay}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Top callouts */}
      <div className="analysis-section">
        <h3>Headliners <InfoTip label="Headliners" text="The most extreme picks of the entire draft on each lens. These stay draft-wide and don't change when you filter by team." /></h3>
        <div className="va-callouts">
          {bestDollar && (
            <div className="moment-card">
              <div className="moment-label">Biggest $ value</div>
              <div className="moment-player">{bestDollar.player.name}</div>
              <div className="moment-detail" style={{ color: 'var(--accent-positive)' }}>
                ${bestDollar.price} (est. ${bestDollar.player.estimatedValue})
              </div>
              <div className="moment-by">{bestDollar.team} · +${bestDollar.dollarDelta.toFixed(0)}</div>
            </div>
          )}
          {worstDollar && worstDollar.dollarDelta < 0 && (
            <div className="moment-card">
              <div className="moment-label">Biggest $ overpay</div>
              <div className="moment-player">{worstDollar.player.name}</div>
              <div className="moment-detail" style={{ color: 'var(--accent-negative)' }}>
                ${worstDollar.price} (est. ${worstDollar.player.estimatedValue})
              </div>
              <div className="moment-by">{worstDollar.team} · {worstDollar.dollarDelta.toFixed(0)}</div>
            </div>
          )}
          {bestPoints && (
            <div className="moment-card">
              <div className="moment-label">Biggest pts value</div>
              <div className="moment-player">{bestPoints.player.name}</div>
              <div className="moment-detail" style={{ color: 'var(--accent-positive)' }}>
                {(bestPoints.player.projectedPoints || 0).toFixed(1)} pts @ ${bestPoints.price}
              </div>
              <div className="moment-by">{bestPoints.team} · +{bestPoints.pointsDelta.toFixed(0)} surplus</div>
            </div>
          )}
          {worstPoints && worstPoints.pointsDelta < 0 && (
            <div className="moment-card">
              <div className="moment-label">Biggest pts overpay</div>
              <div className="moment-player">{worstPoints.player.name}</div>
              <div className="moment-detail" style={{ color: 'var(--accent-negative)' }}>
                {(worstPoints.player.projectedPoints || 0).toFixed(1)} pts @ ${worstPoints.price}
              </div>
              <div className="moment-by">{worstPoints.team} · {worstPoints.pointsDelta.toFixed(0)} surplus</div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="analysis-section">
        <div className="va-filter-bar">
          <div className="va-filter-group">
            <span className="va-filter-label">Show:</span>
            <button
              className={`sort-btn${filter === 'all' ? ' active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All teams
            </button>
            {humanTeam && (
              <button
                className={`sort-btn${filter === 'human' ? ' active' : ''}`}
                onClick={() => setFilter('human')}
              >
                Your team
              </button>
            )}
            <select
              className="va-team-select"
              value={['all', 'human'].includes(filter) ? '' : filter}
              onChange={(e) => setFilter(e.target.value || 'all')}
            >
              <option value="">Pick a team…</option>
              {allTeams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="va-filter-group">
            <span className="va-filter-label">Sort:</span>
            <button
              className={`sort-btn${sortBy === 'pick' ? ' active' : ''}`}
              onClick={() => toggleSort('pick')}
            >
              Pick order{sortIndicator('pick')}
            </button>
            <button
              className={`sort-btn${sortBy === 'dollar' ? ' active' : ''}`}
              onClick={() => toggleSort('dollar')}
            >
              $ delta{sortIndicator('dollar')}
            </button>
            <button
              className={`sort-btn${sortBy === 'points' ? ' active' : ''}`}
              onClick={() => toggleSort('points')}
            >
              Pts delta{sortIndicator('points')}
            </button>
            <button
              className={`sort-btn${sortBy === 'vorp' ? ' active' : ''}`}
              onClick={() => toggleSort('vorp')}
            >
              VORP{sortIndicator('vorp')}
            </button>
            <button
              className={`sort-btn${sortBy === 'dollarPerVorp' ? ' active' : ''}`}
              onClick={() => toggleSort('dollarPerVorp')}
            >
              $/VORP{sortIndicator('dollarPerVorp')}
            </button>
          </div>
        </div>
      </div>

      {/* Pick table */}
      <div className="analysis-section">
        {rows.length === 0 ? (
          <p style={{ color: 'var(--fg3)' }}>No picks match the current filter.</p>
        ) : (
          <table className="va-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Pos</th>
                <th>Drafter</th>
                <th>Paid <InfoTip label="Paid" text="The actual auction price the drafter paid for this player." /></th>
                <th>Est $ <InfoTip label="Est $" text="Pre-draft estimated auction value — what the player was projected to cost." /></th>
                <th>$ Verdict <InfoTip label="Dollar verdict" text="Paid vs. estimated value. ~15%+ under = VALUE, within ±5% = FAIR, ~15%+ over = OVER. Rows shaded green/red mark picks both lenses agree on." /></th>
                <th>Proj Pts <InfoTip label="Proj Pts" text="The player's projected fantasy points for the season." /></th>
                <th>$/pt <InfoTip label="Dollars per point" text="Price ÷ projected points. Lower means more projected points for each dollar spent." /></th>
                <th>VORP <InfoTip label="VORP" text="Value Over Replacement Player: projected points above the best player at this position who doesn't crack a starting lineup league-wide. Higher = harder to replace." /></th>
                <th>$/VORP <InfoTip label="Dollars per VORP" text="Price per point of VORP — the truest cost-efficiency number. Lower is better; shows “—” when VORP is 0." /></th>
                <th>Pts Verdict <InfoTip label="Points verdict" text="Did the pick return more or fewer projected points than its price should buy at league-average pts/$. Same VALUE / FAIR / OVER scale as the dollar lens." /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(pick => {
                const { dollarLabel, pointsLabel } = pick
                const isHumanPick = humanTeam && pick.team === humanTeam.name
                const consensusValue   = (dollarLabel.cls === 'value' || dollarLabel.cls === 'slight-value')
                                      && (pointsLabel.cls === 'value' || pointsLabel.cls === 'slight-value')
                const consensusOverpay = (dollarLabel.cls === 'overpay' || dollarLabel.cls === 'slight-overpay')
                                      && (pointsLabel.cls === 'overpay' || pointsLabel.cls === 'slight-overpay')
                const rowCls = consensusValue ? 'row-consensus-value'
                             : consensusOverpay ? 'row-consensus-overpay'
                             : ''
                const ptsPerDollar = pick.price > 0 ? (pick.player.projectedPoints || 0) / pick.price : 0
                const vorp = getPlayerVORP(pick.player, replacementLevels)
                const dollarPerVorp = vorp > 0 ? pick.price / vorp : null
                return (
                  <tr key={pick.pickIndex} className={rowCls}>
                    <td className="va-pick-idx">{pick.pickIndex}</td>
                    <td>
                      <span className="va-player">{pick.player.name}</span>
                      <span className="va-team-abbr"> {pick.player.team || ''}</span>
                    </td>
                    <td><span className={`pos-badge ${pick.player.position}`}>{pick.player.position}</span></td>
                    <td className={isHumanPick ? 'va-drafter-human' : ''}>
                      {isHumanPick ? `▶ ${pick.team}` : pick.team}
                    </td>
                    <td className="va-num">${pick.price}</td>
                    <td className="va-num va-est">${pick.player.estimatedValue}</td>
                    <td><span className={`value-badge ${dollarLabel.cls}`}>{dollarLabel.text}</span></td>
                    <td className="va-num">{(pick.player.projectedPoints || 0).toFixed(1)}</td>
                    <td className="va-num">{ptsPerDollar.toFixed(2)}</td>
                    <td className="va-num">{Math.round(vorp)}</td>
                    <td className="va-num">{dollarPerVorp !== null ? `$${dollarPerVorp.toFixed(2)}` : '—'}</td>
                    <td><span className={`value-badge ${pointsLabel.cls}`}>{pointsLabel.text}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Takeaways — whole-draft synthesis */}
      {valueTakeaways.length > 0 && (
        <div className="analysis-section">
          <h3>Takeaways <InfoTip label="Takeaways" text="What this report's numbers add up to — patterns to carry into your next draft." /></h3>
          <ul className="takeaways-list">
            {valueTakeaways.map((t, i) => (
              <li key={i} className="takeaway-item">
                <span className="takeaway-bullet">▶</span>
                <span className="takeaway-text">{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---- Tab 4: Budget Flow ------------------------------------------------

function BudgetFlowTab({ humanTeam, allTeams, draftHistory, config }) {
  const timeline = useMemo(
    () => getHumanPicksTimeline(draftHistory, humanTeam.name, config.budgetPerTeam),
    [draftHistory, humanTeam.name, config.budgetPerTeam]
  )
  const leaguePtsPerDollar = useMemo(() => getLeagueAvgPointsPerDollar(draftHistory), [draftHistory])

  const posSpend = useMemo(() => getPositionSpendingByGroup(humanTeam), [humanTeam])
  const totalSpend = config.budgetPerTeam - humanTeam.remainingBudget

  const starters = useMemo(
    () => getStartingLineup(humanTeam, config.rosterPositions),
    [humanTeam, config.rosterPositions]
  )
  const starterIds = new Set(starters.map(p => p.id))
  const benchSpend = humanTeam.roster
    .filter(p => !starterIds.has(p.id))
    .reduce((sum, p) => sum + (p.purchasePrice || 0), 0)
  const deadMoneyPct = totalSpend > 0 ? (benchSpend / totalSpend) * 100 : 0

  const sortedByRemaining = [...allTeams].sort((a, b) => b.remainingBudget - a.remainingBudget)
  const maxRemaining = Math.max(...allTeams.map(t => t.remainingBudget), 1)

  const posSorted = Object.entries(posSpend).sort((a, b) => b[1].spend - a[1].spend)
  const maxPosSpend = Math.max(...posSorted.map(([, v]) => v.spend), 1)

  return (
    <div>
      {/* Timeline */}
      <div className="analysis-section">
        <h3>Your Picks — Budget Over Time</h3>
        {timeline.length === 0 ? (
          <p style={{ color: 'var(--fg3)' }}>No picks recorded for your team.</p>
        ) : (
          <div className="budget-timeline">
            {timeline.map((pt, i) => (
              <div key={i} className="timeline-pick">
                <div className="timeline-player">
                  {pt.player.name}
                  <span style={{ color: 'var(--fg3)', marginLeft: 6 }}>({pt.player.position})</span>
                </div>
                <div className="timeline-price">${pt.price}</div>
                <div className="timeline-remaining-wrap">
                  <div className="timeline-bar-track">
                    <div
                      className="timeline-bar-fill"
                      style={{ width: `${(pt.remaining / config.budgetPerTeam) * 100}%` }}
                    />
                  </div>
                  <span className="timeline-budget-left">${pt.remaining} left</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-2">
        {/* Budget remaining */}
        <div className="analysis-section">
          <h3>Budget Remaining — All Teams</h3>
          <div className="bar-chart">
            {sortedByRemaining.map(team => (
              <div key={team.id} className={`bar-row ${team.isHuman ? 'is-human' : ''}`}>
                <div className="bar-label">{team.isHuman ? `▶ ${team.name}` : team.name}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(team.remainingBudget / maxRemaining) * 100}%` }}
                  />
                </div>
                <div className="bar-value">${team.remainingBudget}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Spend by position + efficiency */}
        <div>
          <div className="analysis-section">
            <h3>Your Spend by Position</h3>
            <div className="bar-chart">
              {posSorted.map(([pos, data]) => (
                <div key={pos} className="bar-row">
                  <div className="bar-label">
                    <span className={`pos-badge ${pos}`}>{pos}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(data.spend / maxPosSpend) * 100}%` }} />
                  </div>
                  <div className="bar-value">${data.spend}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="analysis-section">
            <h3>Budget Efficiency</h3>
            <div className="eff-stats">
              <div className="eff-stat">
                <label>Pts per $ <InfoTip label="Pts per dollar" text="Your roster's total projected points per dollar spent, vs the league-wide average across every pick. Above the league number = your dollars bought more production." /></label>
                <span className="eff-value">
                  {totalSpend > 0
                    ? (humanTeam.roster.reduce((sum, p) => sum + (p.projectedPoints || 0), 0) / totalSpend).toFixed(1)
                    : '—'}
                  {leaguePtsPerDollar > 0 ? ` (lg ${leaguePtsPerDollar.toFixed(1)})` : ''}
                </span>
              </div>
              <div className="eff-stat">
                <label>Total Spent</label>
                <span className="eff-value">${totalSpend}</span>
              </div>
              <div className="eff-stat">
                <label>Budget Used</label>
                <span className="eff-value">{config.budgetPerTeam > 0 ? ((totalSpend / config.budgetPerTeam) * 100).toFixed(0) : 0}%</span>
              </div>
              <div className="eff-stat">
                <label>Bench Spend</label>
                <span className="eff-value">${benchSpend} ({deadMoneyPct.toFixed(0)}%)</span>
              </div>
              <div className="eff-stat">
                <label>Players Drafted</label>
                <span className="eff-value">{humanTeam.roster.length}</span>
              </div>
            </div>
            {deadMoneyPct > 30 && (
              <div className="eff-warning" style={{ marginTop: 'var(--space-3)' }}>
                {deadMoneyPct.toFixed(0)}% of spend went to bench players — consider prioritizing starters in bidding wars.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Tab 5: The Field --------------------------------------------------

function FieldTab({ allTeams, rosterPositions, draftHistory, replacementLevels }) {
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [sortBy, setSortBy] = useState('starterPts')
  const [sortDir, setSortDir] = useState('desc')

  const teamRows = useMemo(() => {
    return allTeams.map(team => ({
      team,
      starterPts: calculateStarterPoints(team, rosterPositions),
      totalPts: team.roster.reduce((s, p) => s + (p.projectedPoints || 0), 0),
      teamVorp: getTeamVORP(team, replacementLevels),
      vc: getTotalValueCapture(team),
      budgetLeft: team.remainingBudget,
      stratName: teamStrategyLabel(team),
    }))
  }, [allTeams, rosterPositions, replacementLevels])

  const sortedRows = useMemo(() => {
    const arr = [...teamRows]
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'team') {
      arr.sort((a, b) => a.team.name.localeCompare(b.team.name) * dir)
    } else if (sortBy === 'strategy') {
      arr.sort((a, b) => a.stratName.localeCompare(b.stratName) * dir)
    } else {
      arr.sort((a, b) => (a[sortBy] - b[sortBy]) * dir)
    }
    return arr
  }, [teamRows, sortBy, sortDir])

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(['team', 'strategy'].includes(key) ? 'asc' : 'desc')
    }
  }
  const sortIndicator = (key) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  // Rank chip column: based on the starter-points ranking, regardless of current sort,
  // so it always reflects "best team this draft".
  const rankByTeamId = useMemo(() => {
    const ranked = rankTeamsByStarterPoints(allTeams, rosterPositions)
    return new Map(ranked.map((t, i) => [t.id, i + 1]))
  }, [allTeams, rosterPositions])

  const mostExpensive = useMemo(() => {
    if (!draftHistory.length) return null
    return draftHistory.reduce((best, p) => p.price > best.price ? p : best)
  }, [draftHistory])

  const biggestSteal = useMemo(() => {
    if (!draftHistory.length) return null
    return draftHistory.reduce((best, p) => {
      const diff = p.player.estimatedValue - p.price
      return diff > (best.player.estimatedValue - best.price) ? p : best
    })
  }, [draftHistory])

  const biggestOverpay = useMemo(() => {
    if (!draftHistory.length) return null
    return draftHistory.reduce((worst, p) => {
      const diff = p.player.estimatedValue - p.price
      return diff < (worst.player.estimatedValue - worst.price) ? p : worst
    })
  }, [draftHistory])

  return (
    <div>
      {/* Rankings table */}
      <div className="analysis-section">
        <h3>Team Rankings by Projected Starter Points</h3>
        <table className="rankings-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="sortable-th" onClick={() => toggleSort('team')}>
                Team{sortIndicator('team')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('starterPts')}>
                Starter Pts{sortIndicator('starterPts')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('totalPts')}>
                Total Pts{sortIndicator('totalPts')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('teamVorp')}>
                VORP{sortIndicator('teamVorp')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('vc')}>
                Value Cap.{sortIndicator('vc')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('budgetLeft')}>
                $ Left{sortIndicator('budgetLeft')}
              </th>
              <th className="sortable-th" onClick={() => toggleSort('strategy')}>
                Strategy{sortIndicator('strategy')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ team, starterPts, totalPts, teamVorp, vc, budgetLeft, stratName }) => {
              const rank = rankByTeamId.get(team.id) || 0
              return (
                <tr
                  key={team.id}
                  className={`clickable-row${team.isHuman ? ' human-row' : ''}`}
                  onClick={() => setSelectedTeam(team)}
                >
                  <td className={`rank-cell ${rank > 0 && rank <= 3 ? 'top-3' : ''}`}>{rank}</td>
                  <td className="team-name-cell">{team.name}</td>
                  <td className="pts-cell">{starterPts.toFixed(1)}</td>
                  <td className="pts-cell" style={{ color: 'var(--fg3)' }}>{totalPts.toFixed(1)}</td>
                  <td className="pts-cell">{Math.round(teamVorp)}</td>
                  <td className={vc >= 0 ? 'vc-positive' : 'vc-negative'}>
                    {vc >= 0 ? '+' : ''}{vc.toFixed(0)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-numeric)', color: 'var(--fg2)' }}>${budgetLeft}</td>
                  <td>
                    <span className={`strategy-tag ${team.isHuman ? 'you' : ''}`}>{stratName}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Notable moments */}
      {(mostExpensive || biggestSteal || biggestOverpay) && (
        <div className="analysis-section">
          <h3>Notable Draft Moments</h3>
          <div className="moments-grid">
            {mostExpensive && (
              <div className="moment-card">
                <div className="moment-label">Most Expensive Pick</div>
                <div className="moment-player">{mostExpensive.player.name}</div>
                <div className="moment-detail">${mostExpensive.price}</div>
                <div className="moment-by">{mostExpensive.team} · est. ${mostExpensive.player.estimatedValue}</div>
              </div>
            )}
            {biggestSteal && (
              <div className="moment-card">
                <div className="moment-label">Steal of the Draft</div>
                <div className="moment-player">{biggestSteal.player.name}</div>
                <div className="moment-detail" style={{ color: 'var(--accent-positive)' }}>
                  ${biggestSteal.price} (est. ${biggestSteal.player.estimatedValue})
                </div>
                <div className="moment-by">{biggestSteal.team}</div>
              </div>
            )}
            {biggestOverpay && biggestOverpay.player.estimatedValue - biggestOverpay.price < 0 && (
              <div className="moment-card">
                <div className="moment-label">Biggest Overpay</div>
                <div className="moment-player">{biggestOverpay.player.name}</div>
                <div className="moment-detail" style={{ color: 'var(--accent-negative)' }}>
                  ${biggestOverpay.price} (est. ${biggestOverpay.player.estimatedValue})
                </div>
                <div className="moment-by">{biggestOverpay.team}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTeam && (
        <TeamRosterModal
          team={selectedTeam}
          rosterPositions={rosterPositions}
          onClose={() => setSelectedTeam(null)}
        />
      )}
    </div>
  )
}

function TeamRosterModal({ team, rosterPositions, onClose }) {
  const rosterSlots = useMemo(() => buildRosterSlots(team, rosterPositions), [team, rosterPositions])
  const starterPts = calculateStarterPoints(team, rosterPositions)
  const totalPts = team.roster.reduce((s, p) => s + (p.projectedPoints || 0), 0)
  const stratName = teamStrategyLabel(team)
  const spent = team.budget - team.remainingBudget

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content team-roster-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{team.name} <span className="trm-strategy-tag">{stratName}</span></h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="trm-summary">
            <div><span className="trm-label">Spent</span> <span className="trm-value">${spent}</span></div>
            <div><span className="trm-label">Remaining</span> <span className="trm-value">${team.remainingBudget}</span></div>
            <div><span className="trm-label">Starter Pts</span> <span className="trm-value">{starterPts.toFixed(1)}</span></div>
            <div><span className="trm-label">Total Pts</span> <span className="trm-value">{totalPts.toFixed(1)}</span></div>
          </div>
          <div className="roster-slot-list">
            {rosterSlots.map((slot, i) => {
              const label = slot.player ? getValueLabel(slot.player.estimatedValue, slot.player.purchasePrice || 0, budgetScaleFor(team.budget)) : null
              const isFirstBench = slot.slotLabel === 'BENCH' && (i === 0 || rosterSlots[i - 1].slotLabel !== 'BENCH')
              return (
                <React.Fragment key={i}>
                  {isFirstBench && <div className="roster-divider">Bench</div>}
                  <div className={`roster-slot-row${slot.isStarter ? '' : ' bench-row'}${!slot.player ? ' empty-row' : ''}`}>
                    <span className={`slot-label slot-${slot.slotLabel}`}>{slot.slotLabel}</span>
                    {slot.player ? (
                      <>
                        <span className="rs-name">{slot.player.name}</span>
                        <span className="rs-team">{slot.player.team}</span>
                        <span className="rs-bye">Bye {slot.player.byeWeek}</span>
                        <span className={`pos-badge ${slot.player.position}`}>{slot.player.position}</span>
                        <span className="rs-price">${slot.player.purchasePrice || 0}</span>
                        <span className={`value-badge ${label.cls}`}>{label.text}</span>
                        <span className="rs-pts">{(slot.player.projectedPoints || 0).toFixed(1)} pts</span>
                      </>
                    ) : (
                      <span className="rs-empty">— empty —</span>
                    )}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Tab 6: Draft Board ------------------------------------------------

function DraftBoardTab({ draftHistory, allTeams, rosterPositions, replacementLevels }) {
  const [sortBy, setSortBy] = useState('cost')

  const orderedPicks = useMemo(() => {
    const starterIdsByTeam = new Map(
      allTeams.map(team => [
        team.name,
        new Set(getStartingLineup(team, rosterPositions).map(p => p.id)),
      ])
    )
    return draftHistory.map((pick, index) => ({
      ...pick,
      nominationIndex: index + 1,
      valueDiff: pick.player.estimatedValue - pick.price,
      isStarter: starterIdsByTeam.get(pick.team)?.has(pick.player.id) ?? false,
    }))
  }, [draftHistory, allTeams, rosterPositions])

  const teamColumns = useMemo(() => {
    return allTeams.map(team => {
      const starters = getStartingLineup(team, rosterPositions)
      const starterIds = new Set(starters.map(p => p.id))
      const starterPts = calculateStarterPoints(team, rosterPositions)
      const totalPts = team.roster.reduce((s, p) => s + (p.projectedPoints || 0), 0)
      const benchPts = totalPts - starterPts
      const stratName = teamStrategyLabel(team)

      const picks = draftHistory
        .filter(p => p.team === team.name)
        .map(p => ({ ...p, valueDiff: p.player.estimatedValue - p.price, isStarter: starterIds.has(p.player.id) }))

      let sorted
      if (sortBy === 'position') {
        const posCmp = (a, b) => {
          const ai = POSITION_ORDER.indexOf(a.player.position)
          const bi = POSITION_ORDER.indexOf(b.player.position)
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
        }
        sorted = [
          ...picks.filter(p => p.isStarter).sort(posCmp),
          ...picks.filter(p => !p.isStarter).sort(posCmp),
        ]
      } else if (sortBy === 'cost') {
        sorted = [...picks].sort((a, b) => b.price - a.price)
      } else {
        sorted = [...picks].sort((a, b) => b.valueDiff - a.valueDiff)
      }

      return { team, picks: sorted, starterPts, totalPts, benchPts, stratName }
    })
  }, [draftHistory, allTeams, sortBy, rosterPositions])

  const maxPicks = Math.max(...teamColumns.map(tc => tc.picks.length), 0)

  return (
    <div className="analysis-section">
      <div className="draft-board-header">
        <h3 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>Draft Board</h3>
        <div className="draft-board-sort">
          {['cost', 'position', 'value', 'nominations'].map(opt => (
            <button
              key={opt}
              className={`sort-btn${sortBy === opt ? ' active' : ''}`}
              onClick={() => setSortBy(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {sortBy === 'nominations' ? (
        <div className="draft-board-scroll">
          {orderedPicks.length === 0 ? (
            <p style={{ color: 'var(--fg3)' }}>No nominations recorded.</p>
          ) : (
            <table className="nominations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>NFL</th>
                  <th>Nominated By</th>
                  <th>Drafter</th>
                  <th>Paid</th>
                  <th>Est $</th>
                  <th>VORP</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {orderedPicks.map(pick => (
                  <tr key={pick.nominationIndex}>
                    <td className="va-pick-idx">{pick.nominationIndex}</td>
                    <td className="nom-player">{pick.player.name}</td>
                    <td><span className={`pos-badge ${pick.player.position}`}>{pick.player.position}</span></td>
                    <td className="nom-nfl">{pick.player.team || ''}</td>
                    <td className="nom-nominator">{pick.nominator || '—'}</td>
                    <td>{pick.team}</td>
                    <td className="va-num">${pick.price}</td>
                    <td className="va-num va-est">${pick.player.estimatedValue}</td>
                    <td className="va-num">{Math.round(getPlayerVORP(pick.player, replacementLevels))}</td>
                    <td>
                      <span className={`value-badge ${pick.isStarter ? 'value' : 'fair'}`}>
                        {pick.isStarter ? 'Starter' : 'Bench'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
      <div className="draft-board-scroll">
        <div
          className="draft-board-grid"
          style={{ gridTemplateColumns: `repeat(${allTeams.length}, minmax(160px, 1fr))` }}
        >
          {teamColumns.map(({ team, picks, starterPts, totalPts, benchPts, stratName }) => (
            <div key={team.id} className={`draft-board-col${team.isHuman ? ' is-human' : ''}`}>
              <div className="draft-board-col-header">
                <div className="dbh-name">{team.isHuman ? `▶ ${team.name}` : team.name}</div>
                <div className="dbh-strat">{stratName}</div>
                <div className="dbh-pts">
                  <span><span className="dbh-num">{starterPts.toFixed(0)}</span> <span className="dbh-pts-label">str</span></span>
                  <span><span className="dbh-num">{benchPts.toFixed(0)}</span> <span className="dbh-pts-label">bnch</span></span>
                  <span><span className="dbh-num">{totalPts.toFixed(0)}</span> <span className="dbh-pts-label">tot</span></span>
                </div>
              </div>
              {Array.from({ length: maxPicks }, (_, i) => {
                const pick = picks[i]
                if (!pick) return <div key={i} className="db-cell db-cell-empty" />
                const label = getValueLabel(pick.player.estimatedValue, pick.price, budgetScaleFor(allTeams[0]?.budget))
                const isBenchStart = sortBy === 'position' && !pick.isStarter && (i === 0 || picks[i - 1]?.isStarter)
                return (
                  <div
                    key={i}
                    className={`db-cell${pick.isStarter ? ' db-starter' : ' db-bench'}${isBenchStart ? ' db-bench-start' : ''}`}
                  >
                    <div className="db-name">{pick.player.name}</div>
                    <div className="db-meta">
                      <span className={`pos-badge ${pick.player.position}`}>{pick.player.position}</span>
                      <span className="db-price">${pick.price}</span>
                      <span className={`value-badge ${label.cls}`}>
                        {pick.valueDiff >= 0 ? '+' : ''}{pick.valueDiff.toFixed(0)}
                      </span>
                      <span className="db-pts">{(pick.player.projectedPoints || 0).toFixed(1)} pts</span>
                      <span className="db-vorp">{Math.round(getPlayerVORP(pick.player, replacementLevels))} VORP</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}

// ---- Tab: Positional Strengths (spider chart) --------------------------

const STAT_OPTIONS = [
  { key: 'points', label: 'Points' },
  { key: 'vorp', label: 'VORP' },
  { key: 'rank', label: 'Rank' },
]
const FILTER_OPTIONS = [
  { key: 'starters', label: 'Starters' },
  { key: 'all', label: 'All' },
  { key: 'bench', label: 'Bench' },
]
function rankTierClass(rank, of) {
  if (!of) return 'neutral'
  if (rank <= of / 3) return 'value'
  if (rank > (of * 2) / 3) return 'overpay'
  return 'neutral'
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function PositionalStrengthsTab({ allTeams, rosterPositions, replacementLevels, availablePlayers, humanTeam }) {
  const [selectedTeamId, setSelectedTeamId] = useState(humanTeam?.id || allTeams[0]?.id)
  const [filter, setFilter] = useState('starters')
  const [stat, setStat] = useState('points')

  const rankScores = useMemo(() => {
    const pool = [...(availablePlayers || []), ...allTeams.flatMap(t => t.roster)]
    return getPositionalRankScores(pool)
  }, [availablePlayers, allTeams])

  const radar = useMemo(
    () => buildPositionalRadar(allTeams, rosterPositions, { stat, filter, replacementLevels, rankScores }),
    [allTeams, rosterPositions, stat, filter, replacementLevels, rankScores]
  )

  const powerRankings = useMemo(() => getPowerRankings(radar), [radar])

  const team = allTeams.find(t => t.id === selectedTeamId) || allTeams[0]
  const teamData = team ? radar.byTeamId[team.id] : null

  if (!teamData || radar.axes.length === 0) {
    return <div className="analysis-section"><p style={{ color: 'var(--fg3)' }}>No positional data to chart.</p></div>
  }

  const teamRadii = radar.axes.map(ax => teamData.normalized[ax] || 0)
  const avgRadii = radar.axes.map(ax => radar.fieldAvgNormalized[ax] || 0)
  const statLabel = STAT_OPTIONS.find(s => s.key === stat).label

  const fmtValue = (v) => stat === 'points' ? v.toFixed(0) : stat === 'vorp' ? Math.round(v) : v.toFixed(0)

  return (
    <div className="radar-tab">
      <div className="radar-controls">
        <div className="radar-control">
          <label className="radar-control-label">Team</label>
          <select
            className="va-team-select"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            {allTeams.map(t => (
              <option key={t.id} value={t.id}>{teamStrategyLabel(t)} — {t.name}</option>
            ))}
          </select>
        </div>
        <div className="radar-control">
          <label className="radar-control-label">Players</label>
          <div className="radar-toggle">
            {FILTER_OPTIONS.map(o => (
              <button
                key={o.key}
                className={`sort-btn${filter === o.key ? ' active' : ''}`}
                onClick={() => setFilter(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="radar-control">
          <label className="radar-control-label">Stat</label>
          <div className="radar-toggle">
            {STAT_OPTIONS.map(o => (
              <button
                key={o.key}
                className={`sort-btn${stat === o.key ? ' active' : ''}`}
                onClick={() => setStat(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="radar-layout">
        <div className="radar-chart-wrap">
          <RadarChart axes={radar.axes} team={teamRadii} avg={avgRadii} />
          <div className="radar-legend">
            <span className="radar-legend-item"><i className="radar-swatch team" />{team.name}</span>
            <span className="radar-legend-item"><i className="radar-swatch avg" />League avg</span>
          </div>
        </div>

        <div className="radar-rank-panel">
          <div className="radar-rank-title">
            League rank by {statLabel}
            <span className="radar-rank-sub">{FILTER_OPTIONS.find(f => f.key === filter).label}</span>
          </div>
          {radar.axes.map(ax => {
            const r = teamData.ranks[ax] || { rank: 0, of: 0 }
            return (
              <div key={ax} className="radar-rank-row">
                <span className={`pos-badge ${ax === 'SUPERFLEX' ? 'QB' : ax}`}>{AXIS_FULL_LABEL[ax] || ax}</span>
                <span className={`radar-rank-value ${rankTierClass(r.rank, r.of)}`}>
                  {r.rank ? ordinal(r.rank) : '—'}<span className="radar-rank-of"> of {r.of}</span>
                </span>
                <span className="radar-rank-stat">{fmtValue(teamData.values[ax] || 0)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="radar-power">
        <div className="radar-power-title">
          Power Rankings
          <span className="radar-rank-sub">avg position rank · {statLabel} · {FILTER_OPTIONS.find(f => f.key === filter).label}</span>
        </div>
        <ol className="radar-power-list">
          {powerRankings.map(row => {
            const t = allTeams.find(x => x.id === row.teamId)
            if (!t) return null
            return (
              <li
                key={row.teamId}
                className={`radar-power-row${t.id === team.id ? ' selected' : ''}${t.isHuman ? ' human' : ''}`}
              >
                <span className="radar-power-rank">{row.rank}</span>
                <span className="radar-power-name">{t.name}<span className="radar-power-strat"> · {teamStrategyLabel(t)}</span></span>
                <span className="radar-power-avg">{row.avgRank.toFixed(1)}</span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

// ---- Tab: Dream Team ---------------------------------------------------

function DreamTeamTab({ allTeams, rosterPositions, availablePlayers, humanTeam }) {
  const [selectedTeamId, setSelectedTeamId] = useState(humanTeam?.id || allTeams[0]?.id)

  const team = allTeams.find(t => t.id === selectedTeamId) || allTeams[0]
  const budget = team?.budget ?? 200

  // Best starting lineup buyable for this team's budget at cost.
  const dream = useMemo(
    () => buildDreamTeam(allTeams, availablePlayers, rosterPositions, budget),
    [allTeams, availablePlayers, rosterPositions, budget]
  )

  const yourStarters = useMemo(
    () => buildRosterSlots(team, rosterPositions).filter(s => s.isStarter),
    [team, rosterPositions]
  )

  const yourPoints = yourStarters.reduce((s, r) => s + (r.player?.projectedPoints || 0), 0)
  const yourCost = yourStarters.reduce((s, r) => s + (r.player?.purchasePrice || 0), 0)
  const ptsGap = dream.totalPoints - yourPoints
  const ownedDreamSlots = dream.rows.reduce((n, r, i) => {
    const mine = yourStarters[i]?.player
    return n + (r.player && mine && r.player.id === mine.id ? 1 : 0)
  }, 0)

  return (
    <div className="dream-tab">
      <div className="radar-controls">
        <div className="radar-control">
          <label className="radar-control-label">Compare against</label>
          <select
            className="va-team-select"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            {allTeams.map(t => (
              <option key={t.id} value={t.id}>{teamStrategyLabel(t)} — {t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="dream-summary">
        <div className="dream-stat">
          <div className="dream-stat-label">Best lineup pts <InfoTip label="Best lineup pts" text="Best starting lineup buyable for this budget at the prices this draft actually produced: drafted players cost their sale price, free agents their estimated value." /></div>
          <div className="dream-stat-value">{dream.totalPoints.toFixed(0)}</div>
          <div className="dream-stat-sub">
            ${dream.totalCost} of ${dream.starterBudget}
            {dream.benchReserve > 0 ? ` (−$${dream.benchReserve} bench)` : ''}
          </div>
        </div>
        <div className="dream-stat">
          <div className="dream-stat-label">{team.name} pts</div>
          <div className="dream-stat-value">{yourPoints.toFixed(0)}</div>
          <div className="dream-stat-sub">starters cost ${yourCost}</div>
        </div>
        <div className="dream-stat">
          <div className="dream-stat-label">Points behind</div>
          <div className="dream-stat-value" style={{ color: ptsGap > 0 ? 'var(--accent-negative)' : 'var(--accent-positive)' }}>
            {ptsGap > 0 ? '-' : ''}{Math.abs(ptsGap).toFixed(0)}
          </div>
          <div className="dream-stat-sub">{ownedDreamSlots} of {dream.rows.length} dream slots owned</div>
        </div>
      </div>

      <div className="dream-table">
        <div className="dream-row dream-head">
          <span className="dream-slot">Slot</span>
          <span className="dream-cell-head">Dream Team</span>
          <span className="dream-cell-head">{team.name}</span>
          <span className="dream-delta-head">Δ pts</span>
        </div>
        {dream.rows.map((r, i) => {
          const dreamP = r.player
          const meta = dreamP ? dream.meta.get(dreamP.id) : null
          const mine = yourStarters[i]?.player || null
          const owned = dreamP && mine && dreamP.id === mine.id
          const delta = (dreamP?.projectedPoints || 0) - (mine?.projectedPoints || 0)
          return (
            <div key={`${r.slotLabel}-${i}`} className={`dream-row${owned ? ' owned' : ''}`}>
              <span className={`pos-badge ${r.slotLabel === 'SF' ? 'QB' : r.slotLabel}`}>{r.slotLabel}</span>
              <span className="dream-cell">
                {dreamP ? (
                  <>
                    <span className="dream-pname">{dreamP.name}</span>
                    <span className="dream-pmeta">
                      {(dreamP.projectedPoints || 0).toFixed(0)} pts · ${meta?.cost ?? 0}
                      <span className="dream-owner">{meta?.drafted ? meta.owner : 'FA'}</span>
                    </span>
                  </>
                ) : <span className="dream-empty">—</span>}
              </span>
              <span className="dream-cell">
                {mine ? (
                  <>
                    <span className="dream-pname">{mine.name}</span>
                    <span className="dream-pmeta">
                      {(mine.projectedPoints || 0).toFixed(0)} pts · ${mine.purchasePrice ?? 0}
                    </span>
                  </>
                ) : <span className="dream-empty">(unfilled)</span>}
              </span>
              <span className={`dream-delta${owned ? ' owned' : delta > 0 ? ' behind' : ''}`}>
                {owned ? '★' : delta > 0 ? `-${delta.toFixed(0)}` : '0'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Main component ----------------------------------------------------

export default function PostDraftAnalysis({ onViewDraft }) {
  const [activeTab, setActiveTab] = useState(0)
  const [confirmNewDraft, setConfirmNewDraft] = useState(false)
  const { teams, draftHistory, config, restartDraft, availablePlayers } = useDraftStore()

  const humanTeam = teams.find(t => t.isHuman)
  const rp = config.rosterPositions

  const replacementInfo = useMemo(() => {
    const allPlayers = [...availablePlayers, ...teams.flatMap(t => t.roster)]
    return getReplacementLevels(allPlayers, rp, config.numberOfTeams)
  }, [availablePlayers, teams, rp, config.numberOfTeams])
  const replacementLevels = replacementInfo.levels

  const grade = useMemo(
    () => humanTeam ? calculateDraftGrade(humanTeam, teams, rp) : 'N/A',
    [humanTeam, teams, rp]
  )
  const rankedTeams = useMemo(() => rankTeamsByStarterPoints(teams, rp), [teams, rp])
  const rank = humanTeam ? rankedTeams.findIndex(t => t.id === humanTeam.id) + 1 : null
  const valueCapture = humanTeam ? getTotalValueCapture(humanTeam) : 0
  const budgetLeft = humanTeam ? humanTeam.remainingBudget : 0
  // Dollar thresholds in the hero cards are $200-tuned; scale to the budget.
  const heroScale = budgetScaleFor(config?.budgetPerTeam)

  const starterPts = humanTeam ? calculateStarterPoints(humanTeam, rp) : 0

  if (!humanTeam) {
    return (
      <div className="analysis-page">
        <div className="analysis-header">
          <h1>BIDIRON</h1>
          <div className="analysis-header-actions">
            <button className="btn btn-secondary btn-sm" onClick={restartDraft}>New Draft</button>
          </div>
        </div>
        <div className="analysis-body" style={{ textAlign: 'center', paddingTop: 'var(--space-8)' }}>
          <p style={{ color: 'var(--fg3)' }}>No draft data found.</p>
        </div>
      </div>
    )
  }


  return (
    <div className="analysis-page">
      {/* Header */}
      <header className="analysis-header">
        <h1>BIDIRON</h1>
        <div className="analysis-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={onViewDraft}>View Draft</button>
          <button className="btn btn-primary btn-sm" onClick={() => setConfirmNewDraft(true)}>New Draft</button>
        </div>
      </header>

      <ConfirmDialog
        open={confirmNewDraft}
        title="Start a New Draft?"
        message="This report and the completed draft will be discarded. This cannot be undone."
        confirmLabel="New Draft"
        danger
        onConfirm={restartDraft}
        onCancel={() => setConfirmNewDraft(false)}
      />

      {/* Hero */}
      <div className="analysis-hero">
        <div className="analysis-hero-title">
          Post-Draft Analysis
        </div>
        <div className="hero-cards">
          <div className="hero-card">
            <div className="hero-card-label">Draft Grade</div>
            <div className="hero-card-value" style={{ color: gradeColor(grade) }}>{grade}</div>
            <div className="hero-card-sub">{starterPts.toFixed(0)} projected starter pts</div>
          </div>
          <div className="hero-card">
            <div className="hero-card-label">Rank</div>
            <div className="hero-card-value">#{rank}</div>
            <div className="hero-card-sub">of {teams.length} teams</div>
          </div>
          <div className="hero-card">
            <div className="hero-card-label">Value Captured</div>
            <div
              className="hero-card-value"
              style={{ color: valueCapture >= 0 ? 'var(--accent-positive)' : 'var(--accent-negative)' }}
            >
              {valueCapture >= 0 ? '+' : ''}{valueCapture.toFixed(0)}
            </div>
            <div className="hero-card-sub">est. value vs price, full roster</div>
          </div>
          <div className={`hero-card ${budgetLeft > 15 * heroScale ? 'warn' : ''}`}>
            <div className="hero-card-label">Budget Left</div>
            <div className="hero-card-value">${budgetLeft}</div>
            <div className="hero-card-sub">
              {budgetLeft > 15 * heroScale ? 'left on the table' : `of $${humanTeam.budget} used`}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav className="analysis-tabs">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === i ? 'active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="analysis-body">
        {activeTab === 0 && (
          <RosterTab
            humanTeam={humanTeam}
            rosterPositions={rp}
            draftHistory={draftHistory}
            config={config}
            replacementLevels={replacementLevels}
          />
        )}
        {activeTab === 1 && (
          <MarketIntelTab
            config={config}
            draftHistory={draftHistory}
            humanTeam={humanTeam}
            allTeams={teams}
            rosterPositions={rp}
            replacementInfo={replacementInfo}
          />
        )}
        {activeTab === 2 && (
          <ValueAnalysisTab
            draftHistory={draftHistory}
            allTeams={teams}
            humanTeam={humanTeam}
            replacementLevels={replacementLevels}
          />
        )}
        {activeTab === 3 && (
          <BudgetFlowTab
            humanTeam={humanTeam}
            allTeams={teams}
            draftHistory={draftHistory}
            config={config}
          />
        )}
        {activeTab === 4 && (
          <FieldTab
            allTeams={teams}
            rosterPositions={rp}
            draftHistory={draftHistory}
            replacementLevels={replacementLevels}
          />
        )}
        {activeTab === 5 && (
          <PositionalStrengthsTab
            allTeams={teams}
            rosterPositions={rp}
            replacementLevels={replacementLevels}
            availablePlayers={availablePlayers}
            humanTeam={humanTeam}
          />
        )}
        {activeTab === 6 && (
          <DreamTeamTab
            allTeams={teams}
            rosterPositions={rp}
            availablePlayers={availablePlayers}
            humanTeam={humanTeam}
          />
        )}
        {activeTab === 7 && (
          <DraftBoardTab
            draftHistory={draftHistory}
            allTeams={teams}
            rosterPositions={rp}
            replacementLevels={replacementLevels}
          />
        )}
      </div>
    </div>
  )
}
