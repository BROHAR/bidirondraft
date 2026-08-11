import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import BuildAChampTab from '../../../src/components/BuildAChampTab.jsx'

// Small league so the math is easy to eyeball: 3 roster spots, 4 teams,
// benchmark quartiles at 400/500/600/700 starter points.
function makeResult(overrides = {}) {
  return {
    totalDrafts: 8,
    numberOfTeams: 4,
    budgetPerTeam: 100,
    rosterPositions: { QB: 1, RB: 1, BENCH: 1 },
    playerPool: [
      { id: 'rb1', name: 'Bijan Robinson', position: 'RB', team: 'ATL', projectedPoints: 280, avgPrice: 55, timesDrafted: 8, draftRate: 1 },
      { id: 'qb1', name: 'Josh Allen', position: 'QB', team: 'BUF', projectedPoints: 320, avgPrice: 30, timesDrafted: 8, draftRate: 1 },
      { id: 'qb2', name: 'Jalen Hurts', position: 'QB', team: 'PHI', projectedPoints: 300, avgPrice: 25, timesDrafted: 8, draftRate: 1 },
      { id: 'wr1', name: 'Justin Jefferson', position: 'WR', team: 'MIN', projectedPoints: 270, avgPrice: 50, timesDrafted: 8, draftRate: 1 },
    ],
    leagueBenchmark: { teamStarterPoints: [400, 500, 600, 700] },
    ...overrides,
  }
}

const addButtonFor = (name) => screen.getByRole('button', { name: `Add ${name}` })
// The value text of the summary stat card with the given label.
const statValue = (label) => screen.getByText(label).parentElement.querySelector('.champ-stat-value').textContent

describe('BuildAChampTab', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('renders the market pool and an empty roster with open spots', () => {
    render(<BuildAChampTab result={makeResult()} />)
    expect(screen.getByText('Player market')).toBeTruthy()
    expect(screen.getByText('Josh Allen')).toBeTruthy()
    // 3 configured spots, all open.
    expect(screen.getAllByText('Open spot')).toHaveLength(3)
    expect(screen.getByText('0 / 3')).toBeTruthy()
    expect(screen.getByText('$0 / $100')).toBeTruthy()
  })

  it('adds players: cost, starter points, and projected finish update', () => {
    render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Josh Allen'))
    fireEvent.click(addButtonFor('Bijan Robinson'))

    expect(statValue('Spent')).toBe('$85 / $100')
    expect(statValue('Roster')).toBe('2 / 3')
    // 320 + 280 = 600 starter points: above 400/500, tied with 600, below 700
    // → beats 62.5% of the field, expected rank 1 + 3 × 0.375 = 2.1.
    expect(statValue('Starter Pts')).toBe('600')
    expect(statValue('Proj Finish')).toBe('2.1 of 4')
    expect(statValue('Beats')).toBe('63% of teams')
  })

  it('applies a per-player boost to the projection', () => {
    render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Josh Allen'))
    // -50% on a 320-pt QB → 160 starter points, below the whole field.
    fireEvent.change(screen.getByLabelText('Boost % for Josh Allen'), { target: { value: '-50' } })
    expect(statValue('Starter Pts')).toBe('160')
    expect(statValue('Proj Finish')).toBe('4.0 of 4')
  })

  it('flags an over-budget roster', () => {
    render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Bijan Robinson'))
    fireEvent.click(addButtonFor('Josh Allen'))
    fireEvent.click(addButtonFor('Justin Jefferson'))
    expect(screen.getByText(/costs more than your \$100 budget/)).toBeTruthy()
  })

  it('disables adding once every roster spot is filled', () => {
    render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Josh Allen'))
    fireEvent.click(addButtonFor('Bijan Robinson'))
    fireEvent.click(addButtonFor('Jalen Hurts'))
    expect(screen.getByRole('button', { name: 'Add Justin Jefferson' }).disabled).toBe(true)
  })

  it('removes a player from the roster', () => {
    render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Josh Allen'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Josh Allen' }))
    expect(screen.getByText('0 / 3')).toBeTruthy()
    expect(screen.getAllByText('Open spot')).toHaveLength(3)
  })

  it('saves and reloads a roster (boosts included) across remounts', () => {
    const { unmount } = render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Josh Allen'))
    fireEvent.change(screen.getByLabelText('Boost % for Josh Allen'), { target: { value: '25' } })
    fireEvent.change(screen.getByPlaceholderText('Roster name'), { target: { value: 'My Champs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save roster' }))
    expect(screen.getByText('Saved "My Champs".')).toBeTruthy()
    unmount()

    // Fresh mount (e.g. after a new meta sim): the saved chip loads the roster.
    render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(screen.getByRole('button', { name: 'My Champs' }))
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getByLabelText('Boost % for Josh Allen').value).toBe('25')
  })

  it('reports players a new sim never drafted when loading a saved roster', () => {
    const { unmount } = render(<BuildAChampTab result={makeResult()} />)
    fireEvent.click(addButtonFor('Josh Allen'))
    fireEvent.click(addButtonFor('Bijan Robinson'))
    fireEvent.change(screen.getByPlaceholderText('Roster name'), { target: { value: 'Champs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save roster' }))
    unmount()

    // Next meta sim's pool no longer contains Bijan.
    const result = makeResult()
    result.playerPool = result.playerPool.filter(p => p.id !== 'rb1')
    render(<BuildAChampTab result={result} />)
    fireEvent.click(screen.getByRole('button', { name: 'Champs' }))
    expect(screen.getByText(/Bijan Robinson.*left off/)).toBeTruthy()
  })

  it('filters the market pool by FLEX and SUPERFLEX eligibility', () => {
    render(<BuildAChampTab result={makeResult()} />)
    // FLEX: RB/WR/TE only — both QBs drop out.
    fireEvent.click(screen.getByRole('button', { name: 'FLEX' }))
    expect(screen.getByText('Bijan Robinson')).toBeTruthy()
    expect(screen.getByText('Justin Jefferson')).toBeTruthy()
    expect(screen.queryByText('Josh Allen')).toBeNull()
    expect(screen.queryByText('Jalen Hurts')).toBeNull()
    // SUPERFLEX adds QBs back in.
    fireEvent.click(screen.getByRole('button', { name: 'SUPERFLEX' }))
    expect(screen.getByText('Josh Allen')).toBeTruthy()
    expect(screen.getByText('Bijan Robinson')).toBeTruthy()
  })

  it('seeds the roster from a transferred build', () => {
    const transfer = { name: 'HeroRB build 1', players: [{ id: 'qb1', name: 'Josh Allen' }, { id: 'rb1', name: 'Bijan Robinson' }] }
    render(<BuildAChampTab result={makeResult()} transfer={transfer} />)
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(screen.getByText(/Loaded "HeroRB build 1"/)).toBeTruthy()
    expect(screen.getByPlaceholderText('Roster name').value).toBe('HeroRB build 1')
  })

  it('reports transferred players missing from the market', () => {
    const transfer = { name: 'Dream', players: [{ id: 'qb1', name: 'Josh Allen' }, { id: 'ghost', name: 'Casper Wentz' }] }
    render(<BuildAChampTab result={makeResult()} transfer={transfer} />)
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getByText(/Casper Wentz was not in the player market/)).toBeTruthy()
  })

  it('shows a fallback when the report has no market data', () => {
    render(<BuildAChampTab result={makeResult({ playerPool: [] })} />)
    expect(screen.getByText(/run a new meta simulation/i)).toBeTruthy()
  })
})
