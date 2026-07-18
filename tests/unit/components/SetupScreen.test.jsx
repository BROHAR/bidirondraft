import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SetupScreen from '../../../src/components/SetupScreen.jsx'
import playersData from '../../../src/data/players.json'

// Mock the Zustand store so we can assert which launch action the wizard fires
// without booting the draft engine.
const initializeDraft = vi.fn()
const simulateDraft = vi.fn()
const runMetaSimulation = vi.fn()
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: () => ({ initializeDraft, simulateDraft, runMetaSimulation }),
}))

beforeEach(() => {
  window.localStorage.clear()
  initializeDraft.mockClear()
  simulateDraft.mockClear()
  runMetaSimulation.mockClear()
})

const nextButton = () => screen.getByRole('button', { name: /next →/i })
const backButton = () => screen.getByRole('button', { name: /back/i })

// Roster slots are compact +/- steppers; reach a slot's buttons via its card.
const rosterSlot = (pos) => screen.getByText(pos).closest('.roster-slot')
const rosterDec = (pos) => within(rosterSlot(pos)).getByRole('button', { name: new RegExp(`decrease ${pos}`, 'i') })
const rosterInc = (pos) => within(rosterSlot(pos)).getByRole('button', { name: new RegExp(`increase ${pos}`, 'i') })

// Advance the wizard from step 1 to step 3 with the given launch mode selected.
function gotoStep3(modeName) {
  fireEvent.click(nextButton()) // step 1 -> 2
  fireEvent.click(screen.getByRole('button', { name: new RegExp(modeName, 'i') }))
  fireEvent.click(nextButton()) // step 2 -> 3
}

describe('SetupScreen wizard', () => {
  it('starts on step 1 with Back disabled and the three step pills', () => {
    render(<SetupScreen />)
    expect(document.querySelector('.setup-step-title')).toHaveTextContent('League Settings')
    expect(backButton()).toBeDisabled()
    const stepper = document.querySelector('.setup-stepper')
    expect(within(stepper).getByText('League Settings')).toBeInTheDocument()
    expect(within(stepper).getByText('Draft or Sim Type')).toBeInTheDocument()
    expect(within(stepper).getByText('AI & Strategy')).toBeInTheDocument()
  })

  it('blocks advancing from step 1 when the roster is invalid, then allows it once fixed', () => {
    render(<SetupScreen />)
    // Default total is 15 (BENCH 6). Empty BENCH to drop below the minimum of 10.
    expect(rosterSlot('BENCH')).toHaveTextContent('6')
    for (let i = 0; i < 6; i++) fireEvent.click(rosterDec('BENCH'))
    expect(rosterSlot('BENCH')).toHaveTextContent('0')
    // Dec button clamps at 0 and disables.
    expect(rosterDec('BENCH')).toBeDisabled()

    fireEvent.click(nextButton())
    // Still on step 1, with an inline validation error.
    expect(document.querySelector('.setup-step-title')).toHaveTextContent('League Settings')
    expect(document.querySelector('.simulate-error')).toHaveTextContent(/roster/i)

    // Bump the roster back into range and advance.
    fireEvent.click(rosterInc('BENCH'))
    fireEvent.click(nextButton())
    expect(document.querySelector('.setup-step-title')).toHaveTextContent('Draft or Sim Type')
  })

  it('clamps a roster slot at the 0–7 range', () => {
    render(<SetupScreen />)
    // QB starts at 1; increment past the cap and confirm it stops at 7.
    for (let i = 0; i < 10; i++) fireEvent.click(rosterInc('QB'))
    expect(rosterSlot('QB')).toHaveTextContent('7')
    expect(rosterInc('QB')).toBeDisabled()
  })

  it('selects a single launch mode at a time on step 2', () => {
    render(<SetupScreen />)
    fireEvent.click(nextButton())
    const live = screen.getByRole('button', { name: /real time/i })
    const meta = screen.getByRole('button', { name: /meta sim/i })
    expect(live).toHaveAttribute('aria-pressed', 'true') // default
    fireEvent.click(meta)
    expect(meta).toHaveAttribute('aria-pressed', 'true')
    expect(live).toHaveAttribute('aria-pressed', 'false')
    // Meta reveals the drafts-per-strategy selector (10–50), inside the box.
    const draftCount = screen.getByRole('group', { name: /drafts per strategy/i })
    expect(draftCount).toBeInTheDocument()
    const options = within(draftCount).getAllByRole('button')
    expect(options.map(b => b.textContent)).toEqual(['10', '20', '30', '40', '50'])
    fireEvent.click(within(draftCount).getByRole('button', { name: '30' }))
    expect(within(draftCount).getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Live mode: step 3 CTA starts the live draft', () => {
    render(<SetupScreen />)
    gotoStep3('real time')
    const cta = screen.getByRole('button', { name: /start draft →/i })
    fireEvent.click(cta)
    expect(initializeDraft).toHaveBeenCalledTimes(1)
    expect(simulateDraft).not.toHaveBeenCalled()
  })

  it('Simulate mode: pre-enables Auto-Pilot (locked, required) and runs the simulation', () => {
    render(<SetupScreen />)
    gotoStep3('simulate')
    const autoPilot = screen.getByRole('switch', { name: /enable auto-pilot/i })
    expect(autoPilot).toBeChecked()
    expect(autoPilot).toBeDisabled()
    expect(screen.getByText(/required for simulate/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /run simulation →/i }))
    expect(simulateDraft).toHaveBeenCalledTimes(1)
    expect(initializeDraft).not.toHaveBeenCalled()
  })

  it('Meta mode: does not force the Auto-Pilot toggle and runs the meta simulation', () => {
    render(<SetupScreen />)
    gotoStep3('meta sim')
    const autoPilot = screen.getByRole('switch', { name: /enable auto-pilot/i })
    expect(autoPilot).not.toBeChecked()
    expect(autoPilot).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /run meta simulation →/i }))
    expect(runMetaSimulation).toHaveBeenCalledTimes(1)
  })

  it('persists the selected launch mode across remounts', () => {
    const { unmount } = render(<SetupScreen />)
    fireEvent.click(nextButton())
    fireEvent.click(screen.getByRole('button', { name: /meta sim/i }))
    unmount()

    render(<SetupScreen />)
    fireEvent.click(nextButton())
    expect(screen.getByRole('button', { name: /meta sim/i })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Back navigation preserves entered league values', () => {
    render(<SetupScreen />)
    const teamName = screen.getByPlaceholderText(/enter your team name/i)
    fireEvent.change(teamName, { target: { value: 'Gridiron Gang' } })
    fireEvent.click(nextButton()) // -> step 2
    fireEvent.click(backButton()) // -> step 1
    expect(screen.getByPlaceholderText(/enter your team name/i)).toHaveValue('Gridiron Gang')
  })

  it('value-adjustments modal shows format-adjusted book values but keeps user overrides verbatim', () => {
    // Derive fixtures from the live data so a projections refresh can't break
    // this: top two WRs by book value — any top WR gains value under PPR.
    const wrs = [...playersData.players]
      .filter(p => p.position === 'WR')
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
    const [topWr, secondWr] = wrs
    window.localStorage.setItem(
      'adraft.playerOverrides.v1',
      JSON.stringify({ [secondWr.id]: { estimatedValue: 25 } })
    )

    render(<SetupScreen />)
    const formatGroup = screen.getByText('Scoring Format').closest('.form-group')
    fireEvent.change(within(formatGroup).getByRole('combobox'), { target: { value: 'ppr' } })
    gotoStep3('real time')
    // The value-adjustments panel lives under Auto-Pilot.
    fireEvent.click(screen.getByRole('switch', { name: /enable auto-pilot/i }))
    fireEvent.click(screen.getByRole('button', { name: /adjust values/i }))

    const baseValueOf = (name) =>
      screen.getByText(name).closest('.adjustment-row').querySelector('.base-value').textContent
    // Non-overridden top WR: PPR book above the half-PPR data value.
    expect(parseInt(baseValueOf(topWr.name).slice(1), 10)).toBeGreaterThan(topWr.estimatedValue)
    // Overridden WR: exact user value, no format delta applied.
    expect(baseValueOf(secondWr.name)).toBe('$25')
  })

  describe('league profile import', () => {
    const CSV_HEADER = 'Pick,Player,NFL Team,Position,Salary,Fantasy Team'

    // Two 12-pick teams: Alpha (LateRoundQB-shaped), Beta (ZeroRB-shaped).
    function sampleCsv() {
      const rows = [CSV_HEADER]
      let pick = 1
      const add = (pos, price, team) => rows.push(`${pick},P${pick++},KC,${pos},${price},${team}`)
      add('QB', 2, 'Alpha'); add('QB', 1, 'Alpha')
      add('RB', 40, 'Alpha'); add('RB', 36, 'Alpha'); add('WR', 30, 'Alpha')
      add('WR', 26, 'Alpha'); add('TE', 14, 'Alpha'); add('WR', 12, 'Alpha')
      add('RB', 9, 'Alpha'); add('WR', 1, 'Alpha'); add('K', 1, 'Alpha'); add('DEF', 1, 'Alpha')
      add('WR', 45, 'Beta'); add('WR', 40, 'Beta'); add('WR', 35, 'Beta')
      add('TE', 25, 'Beta'); add('RB', 10, 'Beta'); add('RB', 8, 'Beta')
      add('RB', 5, 'Beta'); add('QB', 12, 'Beta'); add('WR', 6, 'Beta')
      add('TE', 4, 'Beta'); add('K', 1, 'Beta'); add('DEF', 1, 'Beta')
      return rows.join('\n')
    }

    function importProfile() {
      fireEvent.click(screen.getByRole('button', { name: /import last year/i }))
      fireEvent.change(screen.getByPlaceholderText(/Patrick Mahomes/), { target: { value: sampleCsv() } })
      fireEvent.click(screen.getByRole('button', { name: /parse draft/i }))
      fireEvent.click(screen.getByRole('radio', { name: 'This is me: Alpha' }))
      fireEvent.click(screen.getByRole('button', { name: /apply league profile/i }))
    }

    it('applying an import seat-maps personas, enables both toggles, and persists', () => {
      render(<SetupScreen />)
      gotoStep3('real time')
      importProfile()

      // Both toggles flip on; the profile summary chips render.
      expect(screen.getByRole('switch', { name: /use my league's draft history/i })).toBeChecked()
      expect(screen.getByRole('switch', { name: /match my league's bidders/i })).toBeChecked()
      expect(screen.getByText(/24 picks/)).toBeInTheDocument()

      // Seat mapping: human at seat 1, Beta (the one non-user imported team)
      // lands at seat 2; remaining seats stay Mixed.
      const saved = JSON.parse(window.localStorage.getItem('adraft.setupConfig.v1'))
      expect(saved.config.aiTeamStrategies[1]).toBe('ZeroRB')
      expect(saved.config.aiTeamStrategies[2]).toBe('Mixed')
      expect(saved.leagueProfileEnabled).toBe(true)

      // The profile itself persists in its own store.
      expect(JSON.parse(window.localStorage.getItem('adraft.leagueProfile.v1')).parsedCount).toBe(24)
    })

    it('launch config carries the profile only while the toggle is on', () => {
      render(<SetupScreen />)
      gotoStep3('real time')
      importProfile()

      fireEvent.click(screen.getByRole('button', { name: /start draft →/i }))
      expect(initializeDraft.mock.calls[0][0].leagueProfile).toMatchObject({ version: 2, parsedCount: 24 })

      // Toggle off → next launch sends null.
      fireEvent.click(screen.getByRole('switch', { name: /use my league's draft history/i }))
      fireEvent.click(screen.getByRole('button', { name: /start draft →/i }))
      expect(initializeDraft.mock.calls[1][0].leagueProfile).toBeNull()
    })

    it('the history toggle is disabled until a profile exists', () => {
      render(<SetupScreen />)
      gotoStep3('real time')
      expect(screen.getByRole('switch', { name: /use my league's draft history/i })).toBeDisabled()
    })
  })

  describe('positional limits', () => {
    const limitInput = (pos) => screen.getByRole('spinbutton', { name: `Max spend for ${pos}` })
    const persistedLimits = () =>
      JSON.parse(window.localStorage.getItem('adraft.setupConfig.v1')).config.positionalSpendLimits

    it('renders the six inputs only when Auto-Pilot is enabled', () => {
      render(<SetupScreen />)
      gotoStep3('real time')
      expect(screen.queryByText('Positional Limits')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('switch', { name: /enable auto-pilot/i }))
      expect(screen.getByText('Positional Limits')).toBeInTheDocument()
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
        expect(limitInput(pos)).toBeInTheDocument()
      }
    })

    it('persists a typed limit, clamps to the budget, and clearing removes the key', () => {
      render(<SetupScreen />)
      gotoStep3('real time')
      fireEvent.click(screen.getByRole('switch', { name: /enable auto-pilot/i }))

      fireEvent.change(limitInput('RB'), { target: { value: '70' } })
      expect(limitInput('RB')).toHaveValue(70)
      expect(persistedLimits()).toEqual({ RB: 70 })

      // Above the $200 default budget → clamps to it.
      fireEvent.change(limitInput('QB'), { target: { value: '999' } })
      expect(limitInput('QB')).toHaveValue(200)

      // Below $1 → clamps to $1.
      fireEvent.change(limitInput('K'), { target: { value: '0' } })
      expect(limitInput('K')).toHaveValue(1)

      // Clearing an input drops its key entirely.
      fireEvent.change(limitInput('RB'), { target: { value: '' } })
      expect(limitInput('RB')).toHaveValue(null)
      expect(persistedLimits()).toEqual({ QB: 200, K: 1 })
    })
  })
})
