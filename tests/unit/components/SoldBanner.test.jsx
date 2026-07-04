import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// SoldBanner reads draftHistory via a selector; feed a controllable snapshot.
let storeState
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: (selector) => selector(storeState),
}))

import SoldBanner from '../../../src/components/SoldBanner.jsx'

const pick = (name, price) => ({
  player: { id: name, name, position: 'RB' },
  team: 'Team 2',
  price,
  timestamp: 1,
})

beforeEach(() => {
  vi.useFakeTimers()
  storeState = { draftHistory: [] }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SoldBanner', () => {
  it('renders nothing until a sale lands', () => {
    render(<SoldBanner />)
    expect(screen.queryByText(/sold!/i)).toBeNull()
  })

  it('does not announce sales that predate mounting (e.g. after a rerender)', () => {
    storeState = { draftHistory: [pick('Bijan Robinson', 60)] }
    render(<SoldBanner />)
    expect(screen.queryByText(/sold!/i)).toBeNull()
  })

  it('shows player, winner, and price when a new sale lands, then hides', () => {
    const { rerender } = render(<SoldBanner />)

    storeState = { draftHistory: [pick('Bijan Robinson', 60)] }
    rerender(<SoldBanner />)

    expect(screen.getByText(/sold!/i)).toBeTruthy()
    expect(screen.getByText(/Bijan Robinson/)).toBeTruthy()
    expect(screen.getByText('Team 2')).toBeTruthy()
    expect(screen.getByText('$60')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.queryByText(/sold!/i)).toBeNull()
  })

  it('exposes a polite live region for screen readers', () => {
    render(<SoldBanner />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
  })
})
