import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import KeeperModal from '../../../src/components/KeeperModal.jsx'

const PLAYERS = [
  { id: 'p1', name: 'Alpha Back', position: 'RB', team: 'KC', estimatedValue: 60 },
  { id: 'p2', name: 'Alpha Wideout', position: 'WR', team: 'DAL', estimatedValue: 45 },
  { id: 'p3', name: 'Beta Back', position: 'RB', team: 'SF', estimatedValue: 30 },
]

function config(overrides = {}) {
  return {
    numberOfTeams: 10,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 1,
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
    keepers: [],
    maxKeepersPerTeam: 3,
    ...overrides,
  }
}

function renderModal(props = {}) {
  const onApply = vi.fn()
  const onClose = vi.fn()
  render(
    <KeeperModal
      isOpen
      onClose={onClose}
      config={config(props.config)}
      players={PLAYERS}
      leagueProfile={props.leagueProfile ?? null}
      onApply={onApply}
    />
  )
  return { onApply, onClose }
}

describe('KeeperModal', () => {
  it('adds a keeper via search with book value as the default price', () => {
    const { onApply } = renderModal()
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), { target: { value: 'alpha' } })
    fireEvent.click(screen.getByText('Alpha Back'))

    // Row appears with the book-value price prefilled.
    expect(screen.getByLabelText(/keeper price for alpha back/i)).toHaveValue(60)

    fireEvent.click(screen.getByRole('button', { name: /save keepers/i }))
    expect(onApply).toHaveBeenCalledWith({
      keepers: [{ teamPosition: 1, playerId: 'p1', name: 'Alpha Back', position: 'RB', price: 60 }],
      maxKeepersPerTeam: 3,
    })
  })

  it('shows validation errors and blocks saving an invalid set', () => {
    renderModal({
      config: {
        keepers: [
          { teamPosition: 2, playerId: 'p1', name: 'Alpha Back', position: 'RB', price: 60 },
        ],
      },
    })
    // Price the keeper so high the team can't cover $1/slot for 14 open slots.
    fireEvent.change(screen.getByLabelText(/keeper price for alpha back/i), { target: { value: '190' } })
    expect(screen.getByText(/less than \$1 per open roster slot/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save keepers/i })).toBeDisabled()
  })

  it('removes a keeper from the staged list', () => {
    renderModal({
      config: {
        keepers: [
          { teamPosition: 2, playerId: 'p1', name: 'Alpha Back', position: 'RB', price: 40 },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /remove keeper alpha back/i }))
    expect(screen.queryByText('Alpha Back')).not.toBeInTheDocument()
  })

  it('offers last-year import with rule-adjusted prices when profile picks exist', () => {
    const leagueProfile = {
      teams: [
        { name: 'Imported One', isUser: false },
        { name: 'Imported Me', isUser: true },
      ],
      picks: [
        { name: 'Alpha Back', position: 'RB', price: 20, fantasyTeam: 'Imported One' },
        { name: 'Gone Guy', position: 'WR', price: 9, fantasyTeam: 'Imported One' },
        { name: 'Beta Back', position: 'RB', price: 10, fantasyTeam: 'Imported Me' },
      ],
    }
    const { onApply } = renderModal({ leagueProfile })

    fireEvent.click(screen.getByRole('button', { name: /from last year/i }))
    // +$5 rule.
    fireEvent.change(screen.getByLabelText(/keeper price rule/i), { target: { value: 'plus5' } })

    // Imported non-user team maps to the first non-human seat (2); the user's
    // team maps to the human seat (1).
    expect(screen.getByText('Imported One')).toBeInTheDocument()
    expect(screen.getByText(/My Team \(you\)/)).toBeInTheDocument()

    // Unmatched pick is disabled.
    const goneRow = screen.getByText(/Gone Guy/).closest('label')
    expect(goneRow.querySelector('input')).toBeDisabled()
    expect(screen.getByText(/not in player pool/i)).toBeInTheDocument()

    // Tick Alpha Back for Imported One → keeper at 20+5.
    const alphaRow = screen.getByText(/Alpha Back · RB · was \$20/).closest('label')
    fireEvent.click(alphaRow.querySelector('input'))

    fireEvent.click(screen.getByRole('button', { name: /save keepers/i }))
    expect(onApply).toHaveBeenCalledWith({
      keepers: [{ teamPosition: 2, playerId: 'p1', name: 'Alpha Back', position: 'RB', price: 25 }],
      maxKeepersPerTeam: 3,
    })
  })

  it('hides the import tab without profile picks', () => {
    renderModal({ leagueProfile: { teams: [] } })
    expect(screen.queryByRole('button', { name: /from last year/i })).not.toBeInTheDocument()
  })
})
