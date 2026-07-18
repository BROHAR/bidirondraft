import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LeagueImportModal from '../../../src/components/LeagueImportModal.jsx'

const HEADER = 'Pick,Player,NFL Team,Position,Salary,Fantasy Team'

// Two 12-pick teams (24 rows, above the 20-record floor). Alpha is a
// LateRoundQB-shaped roster, Beta a ZeroRB-shaped one.
function sampleCsv() {
  const rows = [HEADER]
  let pick = 1
  const add = (pos, price, team, nfl = 'KC') =>
    rows.push(`${pick},P${pick++},${nfl},${pos},${price},${team}`)
  // Alpha: cheap QBs, spend spread across RB/WR.
  add('QB', 2, 'Alpha'); add('QB', 1, 'Alpha')
  add('RB', 40, 'Alpha'); add('RB', 36, 'Alpha'); add('WR', 30, 'Alpha')
  add('WR', 26, 'Alpha'); add('TE', 14, 'Alpha'); add('WR', 12, 'Alpha')
  add('RB', 9, 'Alpha'); add('WR', 1, 'Alpha'); add('K', 1, 'Alpha'); add('DEF', 1, 'Alpha')
  // Beta: no RB above $10, WR/TE heavy.
  add('WR', 45, 'Beta'); add('WR', 40, 'Beta'); add('WR', 35, 'Beta')
  add('TE', 25, 'Beta'); add('RB', 10, 'Beta'); add('RB', 8, 'Beta')
  add('RB', 5, 'Beta'); add('QB', 12, 'Beta'); add('WR', 6, 'Beta')
  add('TE', 4, 'Beta'); add('K', 1, 'Beta'); add('DEF', 1, 'Beta')
  return rows.join('\n')
}

function openAndParse(onApply = vi.fn()) {
  render(<LeagueImportModal isOpen={true} onClose={vi.fn()} existingProfile={null} onApply={onApply} />)
  fireEvent.change(screen.getByPlaceholderText(new RegExp('Patrick Mahomes')), {
    target: { value: sampleCsv() },
  })
  fireEvent.click(screen.getByRole('button', { name: /parse draft/i }))
  return onApply
}

describe('LeagueImportModal', () => {
  it('renders nothing when closed', () => {
    render(<LeagueImportModal isOpen={false} onClose={vi.fn()} existingProfile={null} onApply={vi.fn()} />)
    expect(screen.queryByText(/import last year/i)).not.toBeInTheDocument()
  })

  it('shows the required header and rejects malformed CSV inline', () => {
    render(<LeagueImportModal isOpen={true} onClose={vi.fn()} existingProfile={null} onApply={vi.fn()} />)
    expect(screen.getByText(HEADER)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(new RegExp('Patrick Mahomes')), {
      target: { value: 'not,a,valid\n1,2,3' },
    })
    fireEvent.click(screen.getByRole('button', { name: /parse draft/i }))
    expect(document.querySelector('.simulate-error')).toHaveTextContent(/missing column/i)
  })

  it('rejects a too-small valid CSV with a row-count error', () => {
    render(<LeagueImportModal isOpen={true} onClose={vi.fn()} existingProfile={null} onApply={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(new RegExp('Patrick Mahomes')), {
      target: { value: `${HEADER}\n1,A,KC,QB,5,T` },
    })
    fireEvent.click(screen.getByRole('button', { name: /parse draft/i }))
    expect(document.querySelector('.simulate-error')).toHaveTextContent(/1 valid rows/i)
  })

  it('parses to a preview with classified personas and requires the "this is me" pick', () => {
    const onApply = openAndParse()

    expect(screen.getByText(/24 picks · 2 teams/)).toBeInTheDocument()
    expect(screen.getByText(/pick order detected/)).toBeInTheDocument()

    // Classifier pre-fills the persona selects.
    expect(screen.getByRole('combobox', { name: 'Persona for Alpha' })).toHaveValue('LateRoundQB')
    expect(screen.getByRole('combobox', { name: 'Persona for Beta' })).toHaveValue('ZeroRB')

    // Apply is gated on marking the user's team.
    const apply = screen.getByRole('button', { name: /apply league profile/i })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'This is me: Alpha' }))
    expect(apply).not.toBeDisabled()

    fireEvent.click(apply)
    expect(onApply).toHaveBeenCalledTimes(1)
    const profile = onApply.mock.calls[0][0]
    expect(profile.version).toBe(2)
    expect(profile.parsedCount).toBe(24)
    expect(profile.positionFactors).toBeDefined()
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      expect(profile.tierFactors[pos].length).toBe(6)
    }
    expect(profile.teams.map(t => t.name)).toEqual(['Alpha', 'Beta'])
    expect(profile.teams[0].isUser).toBe(true)
    expect(profile.teams[1]).toMatchObject({ isUser: false, persona: 'ZeroRB' })
  })

  it('lets the user override an inferred persona before applying', () => {
    const onApply = openAndParse()
    fireEvent.change(screen.getByRole('combobox', { name: 'Persona for Beta' }), {
      target: { value: 'Taco' },
    })
    // Switching to Taco reveals the home-team select.
    expect(screen.getByRole('combobox', { name: 'Home team for Beta' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Home team for Beta' }), {
      target: { value: 'DAL' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'This is me: Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: /apply league profile/i }))
    expect(onApply.mock.calls[0][0].teams[1]).toMatchObject({ persona: 'Taco', homeTeam: 'DAL' })
  })

  it('warns when the entered budget is below the biggest pick', () => {
    openAndParse()
    const budget = screen.getByRole('spinbutton')
    fireEvent.change(budget, { target: { value: '30' } })
    expect(document.querySelector('.simulate-error')).toHaveTextContent(/exceeds a \$30 budget/i)
  })
})
