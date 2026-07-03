import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

let storeState
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: (selector) => selector(storeState),
}))

import MetaSimulationReport from '../../../src/components/MetaSimulationReport.jsx'

const zeroPos = () => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 })

// A minimal but shape-complete meta result, matching what finalizeResult emits.
function makeResult(overrides = {}) {
  return {
    totalDrafts: 6,
    draftsPerStrategy: 3,
    numberOfTeams: 12,
    summaries: [
      {
        strategyName: 'Balanced', rank: 1, samples: 3,
        starterPoints: { mean: 1100, median: 1100, stdev: 20 },
        valueCapture: { mean: 10 }, teamVorp: { mean: 200 }, finishRank: { mean: 3 },
        winRate: 0.33,
        positionSpend: { ...zeroPos(), RB: 60, WR: 40 },
        positionSpendPct: { ...zeroPos(), RB: 0.6, WR: 0.4 },
      },
    ],
    fieldAverages: { starterPoints: 1100, valueCapture: 10, finishRank: 3, positionSpendPct: { ...zeroPos(), RB: 0.6, WR: 0.4 } },
    winningComposition: {
      samples: 6,
      positionSpend: { ...zeroPos(), RB: 90, WR: 70, QB: 20 },
      positionSpendPct: { ...zeroPos(), RB: 0.5, WR: 0.39, QB: 0.11 },
      positionCounts: { ...zeroPos(), RB: 4, WR: 5, QB: 1 },
      positionStarterPoints: { ...zeroPos(), RB: 250, WR: 240, QB: 300 },
      winRateByStrategy: [
        { strategyName: 'HeroRB', games: 6, wins: 3, winRate: 0.5 },
        { strategyName: 'Balanced', games: 6, wins: 2, winRate: 0.333 },
        { strategyName: 'ZeroRB', games: 6, wins: 1, winRate: 0.167 },
      ],
    },
    blueprints: {
      strategyName: 'HeroRB',
      winRate: 0.5,
      teams: [
        {
          strategyName: 'HeroRB', seed: 1, starterPoints: 1180, totalSpent: 198, benchCount: 6,
          starters: [
            { slot: 'QB', name: 'Josh Allen', position: 'QB', team: 'BUF', price: 12, points: 320 },
            { slot: 'RB', name: 'Bijan Robinson', position: 'RB', team: 'ATL', price: 62, points: 317 },
          ],
        },
        {
          strategyName: 'HeroRB', seed: 2, starterPoints: 1120, totalSpent: 200, benchCount: 6,
          starters: [
            { slot: 'QB', name: 'Jalen Hurts', position: 'QB', team: 'PHI', price: 10, points: 300 },
            { slot: 'RB', name: 'Saquon Barkley', position: 'RB', team: 'PHI', price: 55, points: 310 },
          ],
        },
      ],
    },
    dreamTeams: [
      {
        strategyName: 'HeroRB', winRate: 0.5, totalPoints: 1600, totalCost: 190,
        rows: [
          { slotLabel: 'QB', name: 'Josh Allen', position: 'QB', team: 'BUF', price: 12, points: 320 },
          { slotLabel: 'RB', name: 'Bijan Robinson', position: 'RB', team: 'ATL', price: 62, points: 317 },
          { slotLabel: 'DST', name: null, position: null, team: null, price: 0, points: 0 },
        ],
      },
      {
        strategyName: 'Balanced', winRate: 0.333, totalPoints: 1550, totalCost: 195,
        rows: [
          { slotLabel: 'QB', name: 'Jalen Hurts', position: 'QB', team: 'PHI', price: 10, points: 300 },
        ],
      },
    ],
    ranking: ['Balanced'],
    ...overrides,
  }
}

describe('MetaSimulationReport — Winners & Points tabs', () => {
  beforeEach(() => {
    storeState = { metaSim: { result: makeResult() }, closeMetaResults: vi.fn() }
  })

  it('renders all six tabs', () => {
    render(<MetaSimulationReport />)
    for (const tab of ['Scorecard', 'Strengths', 'Why', 'Winners', 'Blueprints', 'Dream Teams']) {
      expect(screen.getByRole('button', { name: tab })).toBeTruthy()
    }
  })

  it('Winners tab shows the win-rate table and the Avg Points column', () => {
    render(<MetaSimulationReport />)
    fireEvent.click(screen.getByRole('button', { name: 'Winners' }))
    expect(screen.getByText('Which strategies win most (field-wide)')).toBeTruthy()
    expect(screen.getByText('HeroRB')).toBeTruthy()
    // The roster-counts table gained an Avg Points column.
    expect(screen.getByText('Avg Points')).toBeTruthy()
    // 6 winning rosters mentioned in the foot-note.
    expect(screen.getByText(/Aggregated from 6 winning rosters/)).toBeTruthy()
  })

  it('Blueprints tab renders example builds for the winning strategy', () => {
    render(<MetaSimulationReport />)
    fireEvent.click(screen.getByRole('button', { name: 'Blueprints' }))
    expect(screen.getByText('Winning blueprints — HeroRB')).toBeTruthy()
    expect(screen.getByText('Build 1')).toBeTruthy()
    expect(screen.getByText('Build 2')).toBeTruthy()
    expect(screen.getByText('Bijan Robinson')).toBeTruthy()
  })

  it('Dream Teams tab renders an ideal team per top strategy', () => {
    render(<MetaSimulationReport />)
    fireEvent.click(screen.getByRole('button', { name: 'Dream Teams' }))
    expect(screen.getByText('Ideal budget teams by strategy')).toBeTruthy()
    // Strategy names head each card; an empty slot renders an em dash.
    expect(screen.getByText('Jalen Hurts')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('renders empty states when there are no winning rosters', () => {
    storeState = {
      metaSim: { result: makeResult({
        winningComposition: { samples: 0, positionSpend: zeroPos(), positionSpendPct: zeroPos(), positionCounts: zeroPos(), positionStarterPoints: zeroPos(), winRateByStrategy: [] },
        blueprints: { strategyName: null, winRate: 0, teams: [] },
        dreamTeams: [],
      }) },
      closeMetaResults: vi.fn(),
    }
    render(<MetaSimulationReport />)
    fireEvent.click(screen.getByRole('button', { name: 'Blueprints' }))
    expect(screen.getAllByText('No winning rosters recorded.').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Dream Teams' }))
    expect(screen.getByText('No dream teams available.')).toBeTruthy()
  })
})
