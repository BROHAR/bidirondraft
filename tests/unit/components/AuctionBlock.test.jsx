import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// AuctionBlock destructures the whole store state (no selector).
let storeState
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: (selector) => (selector ? selector(storeState) : storeState),
}))

import AuctionBlock from '../../../src/components/AuctionBlock.jsx'
import { Team } from '../../../src/models/Team.js'

const CONFIG = {
  numberOfTeams: 12,
  budgetPerTeam: 200,
  biddingTimer: 20,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
}

const PLAYER = {
  id: 'p1',
  name: 'Jahmyr Gibbs',
  position: 'RB',
  team: 'DET',
  byeWeek: 8,
  projectedPoints: 280.5,
  estimatedValue: 62,
}

function biddingState(overrides = {}) {
  const human = new Team('team_1', 'My Team', true, CONFIG)
  const ai = new Team('team_2', 'Team 2', false, CONFIG)
  return {
    draftState: 'BIDDING',
    currentPlayer: PLAYER,
    currentBid: 15,
    currentBidder: 'team_2',
    currentNominator: 'team_2',
    timeRemaining: 12,
    teams: [human, ai],
    draftHistory: [],
    availablePlayers: [PLAYER],
    config: CONFIG,
    placeBid: vi.fn(),
    skipPlayerAction: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  storeState = biddingState()
})

describe('AuctionBlock paused behavior', () => {
  it('keeps the current auction visible when paused mid-bid', () => {
    storeState = biddingState({ draftState: 'PAUSED' })
    render(<AuctionBlock />)

    // Full auction view: player, current bid, and a PAUSED chip over the timer.
    expect(screen.getByText('Jahmyr Gibbs')).toBeInTheDocument()
    expect(screen.getByText('$15')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('PAUSED')
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.queryByText(/draft paused/i)).not.toBeInTheDocument()
  })

  it('disables all bid controls and skip while paused', () => {
    storeState = biddingState({ draftState: 'PAUSED' })
    render(<AuctionBlock />)

    for (const btn of screen.getAllByRole('button')) {
      // The advisor Show/Hide toggle stays usable; everything actionable is off.
      if (/show|hide/i.test(btn.textContent)) continue
      expect(btn, btn.textContent).toBeDisabled()
    }
    expect(screen.getByText(/resume the draft to continue bidding/i)).toBeInTheDocument()
  })

  it('shows the bare placeholder when paused with no player on the block', () => {
    storeState = biddingState({ draftState: 'PAUSED', currentPlayer: null })
    render(<AuctionBlock />)

    expect(screen.getByText(/draft paused/i)).toBeInTheDocument()
    expect(screen.queryByText('Jahmyr Gibbs')).not.toBeInTheDocument()
  })

  it('normal bidding still shows the countdown and enabled bid buttons', () => {
    render(<AuctionBlock />)

    expect(screen.getByRole('timer')).toHaveTextContent('12')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+\$1 \(/ })).toBeEnabled()
  })
})
