import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  track,
  strategyParam,
  draftStartParams,
  analyticsScreenFor,
  initAnalyticsTracker,
} from '../../../src/services/analyticsService.js'
import { useDraftStore } from '../../../src/store/draftStore.js'

const BASE_STORE_STATE = {
  draftState: 'TITLE',
  currentPlayer: null,
  draftHistory: [],
  teams: [],
  autoPilotEnabled: false,
  metaSim: { running: false, done: 0, total: 0, result: null, error: null },
}

describe('track', () => {
  afterEach(() => {
    delete window.gtag
  })

  it('no-ops without throwing when window.gtag is undefined', () => {
    expect(window.gtag).toBeUndefined()
    expect(() => track('screen_view', { screen_name: 'title' })).not.toThrow()
  })

  it('calls gtag with the GA4 event shape', () => {
    window.gtag = vi.fn()
    track('bid_placed', { amount: 12, bid_type: 'plus_1' })
    expect(window.gtag).toHaveBeenCalledTimes(1)
    expect(window.gtag).toHaveBeenCalledWith('event', 'bid_placed', {
      amount: 12,
      bid_type: 'plus_1',
    })
  })

  it('strips undefined and null params', () => {
    window.gtag = vi.fn()
    track('draft_completed', { duration_seconds: undefined, total_picks: 0, autopilot: false, x: null })
    expect(window.gtag).toHaveBeenCalledWith('event', 'draft_completed', {
      total_picks: 0,
      autopilot: false,
    })
  })

  it('defaults params to an empty object', () => {
    window.gtag = vi.fn()
    track('draft_paused')
    expect(window.gtag).toHaveBeenCalledWith('event', 'draft_paused', {})
  })

  it('never throws even when gtag itself throws', () => {
    window.gtag = vi.fn(() => { throw new Error('blocked') })
    expect(() => track('screen_view', { screen_name: 'setup' })).not.toThrow()
  })
})

describe('strategyParam', () => {
  it('passes built-in strategy keys through', () => {
    expect(strategyParam('Balanced')).toBe('Balanced')
    expect(strategyParam('StarsAndScrubs')).toBe('StarsAndScrubs')
  })

  it('masks user-authored custom strategies', () => {
    expect(strategyParam('custom:abc-123')).toBe('custom')
  })

  it('returns undefined for missing keys', () => {
    expect(strategyParam(undefined)).toBeUndefined()
    expect(strategyParam('')).toBeUndefined()
  })
})

describe('draftStartParams', () => {
  const config = {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    scoringFormat: 'halfPPR',
    humanDraftPosition: 3,
    humanTeamName: 'My Secret Team', // must never appear in params
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
    nominationTimer: 20,
    biddingTimer: 20,
    keepers: [{ playerId: 'p1', price: 35 }, { playerId: 'p2', price: 10 }],
    leagueProfile: { parsedCount: 150 },
    autoPilotEnabled: true,
    autoPilotStrategy: 'custom:mine',
    aiTeamStrategies: ['Mixed', 'Taco', '', 'ZeroRB'],
    customStrategies: [{ id: 'mine', name: 'Mine' }],
    playerOverrides: { p9: { estimatedValue: 12 } },
    playerValueAdjustments: new Map([['p1', 1.2]]),
    positionalSpendLimits: { QB: 20 },
  }

  it('flattens the launch config into scalar snake_case params', () => {
    const params = draftStartParams(config, 'live')
    expect(params).toEqual({
      mode: 'live',
      league_size: 12,
      budget: 200,
      scoring_format: 'halfPPR',
      draft_position: 3,
      roster_size: 15,
      roster_shape: 'QB1_RB2_WR2_TE1_FLEX1_K1_DST1_BENCH6',
      bench_slots: 6,
      superflex: false,
      nomination_timer: 20,
      bidding_timer: 20,
      keeper_count: 2,
      keeper_spend: 45,
      league_import: true,
      autopilot: true,
      autopilot_strategy: 'custom',
      ai_profiles_pinned: 2,
      custom_strategy_count: 1,
      player_override_count: 1,
      value_adjustment_count: 1,
      spend_limit_count: 1,
    })
    // Privacy: user-entered team name never leaves the app.
    expect(JSON.stringify(params)).not.toContain('My Secret Team')
  })

  it('omits the strategy when autopilot is off and tolerates a minimal config', () => {
    const params = draftStartParams({ numberOfTeams: 10, budgetPerTeam: 100 }, 'meta')
    expect(params.autopilot).toBe(false)
    expect(params.autopilot_strategy).toBeUndefined()
    expect(params.keeper_count).toBe(0)
    expect(params.league_import).toBe(false)
  })
})

describe('analyticsScreenFor', () => {
  it('collapses the three live-draft states into one screen', () => {
    expect(analyticsScreenFor('NOMINATING')).toBe('draft')
    expect(analyticsScreenFor('BIDDING')).toBe('draft')
    expect(analyticsScreenFor('PAUSED')).toBe('draft')
    expect(analyticsScreenFor('COMPLETE')).toBe('post_draft')
    expect(analyticsScreenFor('META_RESULTS')).toBe('meta_results')
    expect(analyticsScreenFor('WHO_KNOWS')).toBe('title')
  })
})

describe('initAnalyticsTracker (store-driven events)', () => {
  let gtag, unsubscribe

  const eventsNamed = (name) => gtag.mock.calls.filter(c => c[1] === name)

  beforeEach(() => {
    useDraftStore.setState({ ...BASE_STORE_STATE })
    gtag = vi.fn()
    window.gtag = gtag
    unsubscribe = initAnalyticsTracker(useDraftStore)
  })

  afterEach(() => {
    unsubscribe?.()
    delete window.gtag
    useDraftStore.setState({ ...BASE_STORE_STATE })
  })

  it('fires the initial screen_view on init', () => {
    expect(gtag).toHaveBeenCalledWith('event', 'screen_view', { screen_name: 'title' })
  })

  it('fires screen_view on each screen transition, once per screen', () => {
    gtag.mockClear()
    useDraftStore.getState().setDraftState('SETUP')
    useDraftStore.getState().setDraftState('NOMINATING')
    useDraftStore.getState().setDraftState('BIDDING') // same 'draft' screen
    const views = eventsNamed('screen_view').map(c => c[2].screen_name)
    expect(views).toEqual(['setup', 'draft'])
  })

  it('fires draft_paused and draft_resumed on PAUSED transitions', () => {
    useDraftStore.getState().setDraftState('NOMINATING')
    gtag.mockClear()
    useDraftStore.getState().setDraftState('PAUSED')
    expect(eventsNamed('draft_paused')).toHaveLength(1)
    expect(eventsNamed('screen_view')).toHaveLength(0) // still the draft screen
    useDraftStore.getState().setDraftState('BIDDING')
    expect(eventsNamed('draft_resumed')).toHaveLength(1)
  })

  it('fires player_won only for picks won by the human team', () => {
    const human = { isHuman: true, name: 'Me', budget: 200, remainingBudget: 160, roster: [{}, {}] }
    useDraftStore.setState({
      draftState: 'BIDDING',
      teams: [human, { isHuman: false, name: 'Rival', roster: [] }],
    })
    gtag.mockClear()
    useDraftStore.setState({
      draftHistory: [
        { player: { name: 'Bijan Robinson', position: 'RB' }, team: 'Me', price: 40 },
        { player: { name: 'Ja\'Marr Chase', position: 'WR' }, team: 'Rival', price: 45 },
      ],
    })
    const won = eventsNamed('player_won')
    expect(won).toHaveLength(1)
    expect(won[0][2]).toEqual({
      player_name: 'Bijan Robinson',
      player_position: 'RB',
      price: 40,
      autopilot: false,
    })
  })

  it('fires draft_completed with user totals when the draft ends', () => {
    useDraftStore.setState({
      draftState: 'BIDDING',
      teams: [{ isHuman: true, name: 'Me', budget: 200, remainingBudget: 12, roster: new Array(15).fill({}) }],
      draftHistory: new Array(30).fill({ player: {}, team: 'Rival', price: 1 }),
    })
    gtag.mockClear()
    useDraftStore.getState().setDraftState('COMPLETE')
    const done = eventsNamed('draft_completed')
    expect(done).toHaveLength(1)
    expect(done[0][2]).toMatchObject({
      total_picks: 30,
      autopilot: false,
      user_spent: 188,
      user_budget_left: 12,
      user_roster_size: 15,
    })
    expect(done[0][2].duration_seconds).toBeGreaterThanOrEqual(0)
    expect(eventsNamed('screen_view').map(c => c[2].screen_name)).toEqual(['post_draft'])
  })

  it('store actions emit their instrumentation (draft_restarted)', () => {
    useDraftStore.getState().setDraftState('COMPLETE')
    gtag.mockClear()
    useDraftStore.getState().restartDraft()
    const restarts = eventsNamed('draft_restarted')
    expect(restarts).toHaveLength(1)
    expect(restarts[0][2]).toEqual({ from_state: 'COMPLETE' })
  })
})
