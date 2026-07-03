import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'

let storeState
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: (selector) => selector(storeState),
}))

import HeaderTimer from '../../../src/components/HeaderTimer.jsx'

const HUMAN = { id: 'h', isHuman: true, isAutoPilot: false }
const AI = { id: 'ai', isHuman: false }

beforeEach(() => {
  storeState = {
    draftState: 'NOMINATING',
    currentNominator: null,
    currentPlayer: null,
    teams: [HUMAN, AI],
    timeRemaining: 20,
  }
})

describe('HeaderTimer', () => {
  it('renders nothing when no timer is active', () => {
    const { container } = render(<HeaderTimer />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the bidding countdown while bidding', () => {
    storeState.draftState = 'BIDDING'
    storeState.currentPlayer = { id: 'p1', name: 'Player One' }
    storeState.timeRemaining = 12
    const { container } = render(<HeaderTimer />)
    expect(container.querySelector('.header-timer-label')).toHaveTextContent('Bid')
    expect(container.querySelector('.header-timer-value')).toHaveTextContent('12')
    expect(container.querySelector('.header-timer')).not.toHaveClass('urgent')
  })

  it('shows the nomination countdown on the human pick turn', () => {
    storeState.currentNominator = 'h'
    storeState.timeRemaining = 8
    const { container } = render(<HeaderTimer />)
    expect(container.querySelector('.header-timer-label')).toHaveTextContent('Pick')
    expect(container.querySelector('.header-timer-value')).toHaveTextContent('8')
  })

  it('marks the countdown urgent at 5s or less', () => {
    storeState.draftState = 'BIDDING'
    storeState.currentPlayer = { id: 'p1', name: 'Player One' }
    storeState.timeRemaining = 5
    const { container } = render(<HeaderTimer />)
    expect(container.querySelector('.header-timer')).toHaveClass('urgent')
  })

  it('stays hidden during an AI nomination turn (timer not driven for the human)', () => {
    storeState.currentNominator = 'ai'
    const { container } = render(<HeaderTimer />)
    expect(container.firstChild).toBeNull()
  })

  it('stays hidden when the human is on auto-pilot', () => {
    storeState.currentNominator = 'h'
    storeState.teams = [{ ...HUMAN, isAutoPilot: true }, AI]
    const { container } = render(<HeaderTimer />)
    expect(container.firstChild).toBeNull()
  })
})
