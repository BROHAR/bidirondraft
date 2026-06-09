import React, { useState, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { generateMetaTakeaways } from '../utils/metaSimulation.js'
import RadarChart from './RadarChart.jsx'
import '../styles/components/postDraftAnalysis.css'
import '../styles/components/metaSimulation.css'

const TABS = ['Scorecard', 'Strengths', 'Why']
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
const POS_COLOR = {
  QB: 'var(--pos-qb, #d65a5a)', RB: 'var(--pos-rb, #4a9d6f)', WR: 'var(--pos-wr, #4a7fd6)',
  TE: 'var(--pos-te, #c98a3a)', K: 'var(--pos-k, #8a6fc9)', DST: 'var(--pos-dst, #6f8a9d)',
}

// Columns for the scorecard. accessor pulls the sortable number from a summary.
const COLUMNS = [
  { key: 'strategyName', label: 'Strategy', accessor: s => s.strategyName, numeric: false },
  { key: 'starterPoints', label: 'Avg Starter Pts', accessor: s => s.starterPoints.mean, numeric: true, fmt: v => v.toFixed(0) },
  { key: 'median', label: 'Median', accessor: s => s.starterPoints.median, numeric: true, fmt: v => v.toFixed(0) },
  { key: 'stdev', label: 'Std Dev', accessor: s => s.starterPoints.stdev, numeric: true, fmt: v => v.toFixed(0) },
  { key: 'valueCapture', label: 'Avg Value $', accessor: s => s.valueCapture.mean, numeric: true, fmt: v => `${v >= 0 ? '' : '-'}$${Math.abs(v).toFixed(0)}` },
  { key: 'teamVorp', label: 'Avg VORP', accessor: s => s.teamVorp.mean, numeric: true, fmt: v => v.toFixed(0) },
  { key: 'finishRank', label: 'Avg Finish', accessor: s => s.finishRank.mean, numeric: true, fmt: v => v.toFixed(1) },
  { key: 'winRate', label: 'Win Rate', accessor: s => s.winRate, numeric: true, fmt: v => `${(v * 100).toFixed(0)}%` },
  { key: 'samples', label: 'Samples', accessor: s => s.samples, numeric: true, fmt: v => String(v) },
]

function ScorecardTab({ summaries }) {
  // Default: avg starter points descending (the headline metric).
  const [sortKey, setSortKey] = useState('starterPoints')
  const [sortDir, setSortDir] = useState('desc')

  const col = COLUMNS.find(c => c.key === sortKey) || COLUMNS[1]
  const sorted = useMemo(() => {
    const rows = [...summaries]
    rows.sort((a, b) => {
      const av = col.accessor(a), bv = col.accessor(b)
      if (col.numeric) return sortDir === 'desc' ? bv - av : av - bv
      return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv))
    })
    return rows
  }, [summaries, col, sortDir])

  const toggleSort = (key) => {
    if (key === sortKey) { setSortDir(d => (d === 'desc' ? 'asc' : 'desc')) }
    else { setSortKey(key); setSortDir(key === 'strategyName' ? 'asc' : 'desc') }
  }
  const indicator = (key) => (key === sortKey ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '')

  return (
    <div className="analysis-section">
      <table className="meta-scorecard">
        <thead>
          <tr>
            {COLUMNS.map(c => (
              <th
                key={c.key}
                className="sortable-th"
                onClick={() => toggleSort(c.key)}
                style={{ textAlign: c.numeric ? 'right' : 'left' }}
              >
                {c.label}{indicator(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.strategyName} className={s.rank === 1 ? 'meta-row-leader' : ''}>
              {COLUMNS.map(c => (
                <td key={c.key} style={{ textAlign: c.numeric ? 'right' : 'left', fontFamily: c.numeric ? 'var(--font-numeric)' : undefined }}>
                  {c.key === 'strategyName' && s.rank === 1 ? '★ ' : ''}{c.fmt ? c.fmt(c.accessor(s)) : c.accessor(s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meta-foot-note">
        Your team's average results drafting with each strategy against your configured league, ranked by
        average starting-lineup points. Click any header to re-sort.
      </p>
    </div>
  )
}

function StrengthsTab({ summaries, fieldAverages }) {
  const [selectedName, setSelectedName] = useState(summaries[0]?.strategyName)
  const selected = summaries.find(s => s.strategyName === selectedName) || summaries[0]

  // Radar: per-axis field max of spend share so 1 = the strategy that leans
  // hardest into that position.
  const fieldMax = {}
  for (const pos of POSITIONS) fieldMax[pos] = Math.max(0, ...summaries.map(s => s.positionSpendPct[pos] || 0))
  const teamRadii = POSITIONS.map(pos => (fieldMax[pos] > 0 ? (selected.positionSpendPct[pos] || 0) / fieldMax[pos] : 0))
  const avgRadii = POSITIONS.map(pos => (fieldMax[pos] > 0 ? (fieldAverages.positionSpendPct[pos] || 0) / fieldMax[pos] : 0))

  return (
    <div className="analysis-section meta-strengths">
      <div className="meta-strengths-bars">
        <h3>Your budget allocation by position</h3>
        <p className="meta-foot-note">Average share of your team's spend by position under each strategy — the clearest read on its style.</p>
        {summaries.map(s => (
          <div key={s.strategyName} className="meta-spend-row">
            <span className="meta-spend-name">{s.strategyName}</span>
            <span className="meta-spend-bar">
              {POSITIONS.map(pos => {
                const pct = (s.positionSpendPct[pos] || 0) * 100
                if (pct < 0.5) return null
                return (
                  <span
                    key={pos}
                    className="meta-spend-seg"
                    style={{ width: `${pct}%`, background: POS_COLOR[pos] }}
                    title={`${pos}: ${pct.toFixed(0)}%`}
                  >
                    {pct >= 10 ? pos : ''}
                  </span>
                )
              })}
            </span>
          </div>
        ))}
        <div className="meta-spend-legend">
          {POSITIONS.map(pos => (
            <span key={pos} className="meta-legend-item">
              <span className="meta-legend-swatch" style={{ background: POS_COLOR[pos] }} />{pos}
            </span>
          ))}
        </div>
      </div>

      <div className="meta-strengths-radar">
        <div className="radar-control">
          <label className="radar-control-label">Strategy</label>
          <select className="va-team-select" value={selectedName} onChange={e => setSelectedName(e.target.value)}>
            {summaries.map(s => <option key={s.strategyName} value={s.strategyName}>{s.strategyName}</option>)}
          </select>
        </div>
        <RadarChart axes={POSITIONS} team={teamRadii} avg={avgRadii} />
        <p className="meta-foot-note">Spend share by position, normalized to the strategy that leans hardest into each. Dashed = field average.</p>
      </div>
    </div>
  )
}

function WhyTab({ summaries, fieldAverages }) {
  return (
    <div className="analysis-section meta-why">
      {summaries.map(s => (
        <div key={s.strategyName} className={`meta-why-card${s.rank === 1 ? ' leader' : ''}`}>
          <div className="meta-why-head">
            <span className="meta-why-rank">#{s.rank}</span>
            <span className="meta-why-name">{s.strategyName}</span>
            <span className="meta-why-pts">{s.starterPoints.mean.toFixed(0)} pts</span>
          </div>
          <ul className="meta-why-list">
            {generateMetaTakeaways(s, fieldAverages).map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function MetaSimulationReport() {
  const result = useDraftStore(state => state.metaSim.result)
  const closeMetaResults = useDraftStore(state => state.closeMetaResults)
  const [activeTab, setActiveTab] = useState(0)

  if (!result) {
    return (
      <div className="analysis-page meta-report">
        <p style={{ color: 'var(--fg3)' }}>No meta-simulation results.</p>
        <button className="btn btn-primary" onClick={closeMetaResults}>Back to Setup</button>
      </div>
    )
  }

  const { summaries, fieldAverages, totalDrafts, draftsPerStrategy, numberOfTeams } = result
  const leader = summaries[0]

  return (
    <div className="analysis-page meta-report">
      <div className="meta-report-header">
        <div>
          <h1>Meta Simulation</h1>
          <p className="meta-report-sub">
            {totalDrafts} drafts ({draftsPerStrategy}/strategy) · {numberOfTeams}-team league · best for your team:{' '}
            <strong>{leader?.strategyName}</strong> ({leader?.starterPoints.mean.toFixed(0)} avg starter pts)
          </p>
        </div>
        <button className="btn btn-secondary" onClick={closeMetaResults}>Back to Setup</button>
      </div>

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

      <div className="analysis-body">
        {activeTab === 0 && <ScorecardTab summaries={summaries} />}
        {activeTab === 1 && <StrengthsTab summaries={summaries} fieldAverages={fieldAverages} />}
        {activeTab === 2 && <WhyTab summaries={summaries} fieldAverages={fieldAverages} />}
      </div>
    </div>
  )
}
