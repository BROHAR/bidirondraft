import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock the heavy column children so the test exercises only DraftBoard's mobile
// bottom-nav and auto-focus logic, not the full draft UI.
vi.mock('../../../src/components/PlayerPool', () => ({ default: () => <div>PlayerPool</div> }))
vi.mock('../../../src/components/AuctionBlock', () => ({ default: () => <div>AuctionBlock</div> }))
vi.mock('../../../src/components/TabbedSection', () => ({ default: () => <div>TabbedSection</div> }))
vi.mock('../../../src/components/ControlPanel', () => ({ default: () => <div>ControlPanel</div> }))
vi.mock('../../../src/components/AutoPilotControl', () => ({ default: () => <div>AutoPilotControl</div> }))
vi.mock('../../../src/components/DraftProgress', () => ({ default: () => <div>DraftProgress</div> }))

// DraftBoard reads store state via selectors; feed a controllable snapshot.
let storeState
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: (selector) => selector(storeState),
}))

import DraftBoard from '../../../src/components/DraftBoard.jsx'

const HUMAN = { id: 'h', isHuman: true, isAutoPilot: false }
const AI = { id: 'ai', isHuman: false }

beforeEach(() => {
  storeState = {
    draftState: 'NOMINATING',
    currentNominator: null,
    currentPlayer: null,
    teams: [HUMAN, AI],
  }
})

const panelOf = (container) => {
  const cls = container.querySelector('.draft-main').className
  return cls.match(/mobile-panel-(\w+)/)?.[1]
}

describe('DraftBoard mobile nav', () => {
  it('renders the four bottom-nav tabs', () => {
    render(<DraftBoard />)
    for (const label of ['Auction', 'Players', 'Teams', 'More']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('defaults to the auction panel when no one needs to act', () => {
    const { container } = render(<DraftBoard />)
    expect(panelOf(container)).toBe('auction')
  })

  it('switches the active panel when a nav tab is tapped', () => {
    const { container } = render(<DraftBoard />)
    fireEvent.click(screen.getByRole('button', { name: 'Teams' }))
    expect(panelOf(container)).toBe('board')
    expect(screen.getByRole('button', { name: 'Teams' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('auto-focuses Players when it is the human\'s turn to nominate', () => {
    storeState.currentNominator = 'h'
    const { container } = render(<DraftBoard />)
    expect(panelOf(container)).toBe('players')
    expect(screen.getByRole('button', { name: 'Players' })).toHaveClass('has-attention')
  })

  it('does not auto-focus Players when the human is on auto-pilot', () => {
    storeState.currentNominator = 'h'
    storeState.teams = [{ ...HUMAN, isAutoPilot: true }, AI]
    const { container } = render(<DraftBoard />)
    expect(panelOf(container)).toBe('auction')
  })

  it('auto-focuses Auction while bidding is active', () => {
    storeState.draftState = 'BIDDING'
    storeState.currentPlayer = { id: 'p1', name: 'Player One' }
    const { container } = render(<DraftBoard />)
    expect(panelOf(container)).toBe('auction')
    expect(screen.getByRole('button', { name: 'Auction' })).toHaveClass('has-attention')
  })
})
