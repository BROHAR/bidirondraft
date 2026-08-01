// Google Analytics 4 instrumentation.
//
// Two pieces live here:
//
// 1. `track(name, params)` — the only place the app talks to `window.gtag`.
//    It silently no-ops when gtag is missing (dev server, tests/jsdom,
//    ad-blocked browsers) and never throws, so instrumented code paths —
//    including the draft engine's hot loop — cannot be affected by analytics.
//
// 2. `initAnalyticsTracker(store)` — a single store subscription (wired up in
//    main.jsx) that turns draftState transitions into screen/lifecycle events:
//    screen_view, draft_paused/resumed, player_won, draft_completed. One hook
//    here covers every UI path that mutates the store, so components don't
//    need per-screen instrumentation.
//
// Conventions (GA4): snake_case event names and params, ≤40-char names, flat
// scalar params. Privacy: never send user-entered free text (team names,
// imported league identifiers) or emails. Public NFL player names, config
// values, counts, dollar amounts and durations are fine.

// Fire-and-forget GA4 event. Undefined/null params are stripped so optional
// fields can be passed unconditionally.
export function track(eventName, params = {}) {
  try {
    const gtag = typeof window !== 'undefined' ? window.gtag : undefined
    if (typeof gtag !== 'function') return
    const clean = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) clean[key] = value
    }
    gtag('event', eventName, clean)
  } catch {
    // Analytics must never break the app.
  }
}

// Custom strategies carry user-authored names; report them only as 'custom'.
export function strategyParam(key) {
  if (typeof key !== 'string' || !key) return undefined
  return key.startsWith('custom:') ? 'custom' : key
}

// Flatten a launch config into draft_started params. `mode` is
// 'live' | 'simulate' | 'meta'.
export function draftStartParams(config, mode) {
  const rp = config.rosterPositions || {}
  const keepers = config.keepers || []
  const pinnedProfiles = (config.aiTeamStrategies || [])
    .filter(s => s && s !== 'Mixed').length
  return {
    mode,
    league_size: config.numberOfTeams,
    budget: config.budgetPerTeam,
    scoring_format: config.scoringFormat,
    draft_position: config.humanDraftPosition,
    roster_size: Object.values(rp).reduce((sum, n) => sum + (n || 0), 0),
    roster_shape: Object.entries(rp)
      .filter(([, n]) => n > 0)
      .map(([pos, n]) => `${pos}${n}`)
      .join('_'),
    bench_slots: rp.BENCH || 0,
    superflex: (rp.SUPERFLEX || 0) > 0,
    nomination_timer: config.nominationTimer,
    bidding_timer: config.biddingTimer,
    keeper_count: keepers.length,
    keeper_spend: keepers.reduce((sum, k) => sum + (k.price || 0), 0),
    league_import: !!config.leagueProfile,
    autopilot: !!config.autoPilotEnabled,
    autopilot_strategy: config.autoPilotEnabled
      ? strategyParam(config.autoPilotStrategy)
      : undefined,
    ai_profiles_pinned: pinnedProfiles,
    custom_strategy_count: (config.customStrategies || []).length,
    player_override_count: Object.keys(config.playerOverrides || {}).length,
    value_adjustment_count: config.playerValueAdjustments?.size ?? 0,
    spend_limit_count: Object.keys(config.positionalSpendLimits || {}).length,
  }
}

// Mirrors historyService's screen collapse: the three live-draft states are
// one 'draft' screen, so intra-draft churn produces no screen_view traffic.
const SCREEN_OF_STATE = {
  TITLE: 'title',
  SETUP: 'setup',
  NOMINATING: 'draft',
  BIDDING: 'draft',
  PAUSED: 'draft',
  COMPLETE: 'post_draft',
  META_RESULTS: 'meta_results',
}

export function analyticsScreenFor(draftState) {
  return SCREEN_OF_STATE[draftState] || 'title'
}

// Central store-driven tracker. Subscribes to the draft store and derives
// lifecycle events from state transitions. Returns an unsubscribe function.
// Only main.jsx (and tests) call this — the store itself never does, so
// headless/simulated drafts in tests run without a subscription attached.
export function initAnalyticsTracker(store) {
  let draftStartedAt = null

  // Initial screen (normally 'title' on a fresh load).
  track('screen_view', { screen_name: analyticsScreenFor(store.getState().draftState) })

  const onChange = (state, prevState) => {
    if (state.draftState !== prevState.draftState) {
      const next = analyticsScreenFor(state.draftState)
      const prev = analyticsScreenFor(prevState.draftState)
      if (next !== prev) {
        track('screen_view', { screen_name: next })
        if (next === 'draft') draftStartedAt = Date.now()
      }

      if (state.draftState === 'PAUSED') {
        track('draft_paused')
      } else if (prevState.draftState === 'PAUSED' && (state.draftState === 'NOMINATING' || state.draftState === 'BIDDING')) {
        track('draft_resumed')
      }

      if (state.draftState === 'COMPLETE' && prevState.draftState !== 'COMPLETE') {
        const human = state.teams.find(t => t.isHuman)
        track('draft_completed', {
          duration_seconds: draftStartedAt
            ? Math.round((Date.now() - draftStartedAt) / 1000)
            : undefined,
          total_picks: state.draftHistory.length,
          autopilot: !!state.autoPilotEnabled,
          user_spent: human ? human.budget - human.remainingBudget : undefined,
          user_budget_left: human ? human.remainingBudget : undefined,
          user_roster_size: human ? human.roster.length : undefined,
        })
        draftStartedAt = null
      }
    }

    // Players won by the user's team: diff draftHistory growth. Keepers never
    // appear in draftHistory (they're pre-completed at init), so this only
    // sees real auction wins. Team names are compared, never sent.
    if (state.draftHistory.length > prevState.draftHistory.length) {
      const humanName = state.teams.find(t => t.isHuman)?.name
      if (humanName) {
        for (let i = prevState.draftHistory.length; i < state.draftHistory.length; i++) {
          const pick = state.draftHistory[i]
          if (pick?.team === humanName) {
            track('player_won', {
              player_name: pick.player?.name,
              player_position: pick.player?.position,
              price: pick.price,
              autopilot: !!state.autoPilotEnabled,
            })
          }
        }
      }
    }
  }

  return store.subscribe(onChange)
}
