// Browser-history integration for the SPA.
//
// The app is screen-driven by the store's `draftState`; before this service
// existed there was zero History API usage, so pressing Back exited the site.
// This module owns ALL History API interaction: it subscribes to the draft
// store, pushes an entry per forward screen transition, and turns Back/Forward
// (popstate) into store transitions — guarded by a confirm when the navigation
// would destroy memory-only draft/results state.
//
// Behavior map (screen × Back/Forward):
// - SETUP        Back → TITLE (setDraftState('TITLE'), the mirror of how
//                TitleScreen enters SETUP).
// - live draft   (NOMINATING/BIDDING/PAUSED — ONE screen, ONE history entry;
//                intra-draft churn never grows the stack) Back → navigation is
//                cancelled by re-pushing the current entry, then a ConfirmDialog
//                asks to leave; confirm runs restartDraft() → SETUP (the same
//                exit path as ControlPanel's "Restart Draft").
// - COMPLETE     Back → same guard, with PostDraftAnalysis's "Start a New
//                Draft?" wording; confirm runs restartDraft() → SETUP.
// - META_RESULTS Back → closeMetaResults() → SETUP, matching the report's
//                un-confirmed "Back to Setup" button.
// - Forward      TITLE → SETUP is allowed (data-free). Any other Forward
//                target (draft/complete/meta) is unreachable — that state is
//                memory-only — so the entry is rewritten to the current screen
//                (a no-op re-sync; Forward never crashes or desyncs).
//
// The screen is mirrored into the URL hash (#setup, #draft, …) purely for
// clarity. Deep-linking is intentionally NOT supported: state is memory-only,
// so a fresh load of any URL starts at TITLE and start() replaces the entry
// (clearing any stale hash). Path never changes, so the Express SPA fallback
// and the Vite dev server are unaffected.
//
// Known minor artifact: in-app backward jumps (e.g. Restart Draft) rewrite the
// current entry rather than unwinding the stack, so stale deeper entries can
// survive; popstate treats those as unreachable targets and re-syncs, which
// can cost an extra (harmless, no-op) Back press. Never data loss.

import { useDraftStore } from '../store/draftStore'
import { track } from './analyticsService'

// The three live-draft states collapse into one 'draft' screen so
// NOMINATING↔BIDDING↔PAUSED churn produces no history traffic.
const SCREEN_OF_STATE = {
  TITLE: 'title',
  SETUP: 'setup',
  NOMINATING: 'draft',
  BIDDING: 'draft',
  PAUSED: 'draft',
  COMPLETE: 'complete',
  META_RESULTS: 'meta',
}

// Depth of each screen in the navigation flow: a transition to a deeper
// screen pushes a new entry, anything else rewrites the current one.
// META_RESULTS branches off SETUP, at the same depth as the live draft.
const SCREEN_DEPTH = { title: 0, setup: 1, draft: 2, meta: 2, complete: 3 }

export function screenForDraftState(draftState) {
  return SCREEN_OF_STATE[draftState] || 'title'
}

export function createHistoryService({ store, win = window }) {
  // True while this service itself is driving a store transition (from a
  // popstate or a confirm), so the store subscription doesn't double-write.
  let syncing = false
  // 'leave-draft' | 'discard-results' | null — pending Back confirmation.
  let confirmRequest = null
  const confirmListeners = new Set()

  const urlFor = (screen) =>
    screen === 'title'
      ? win.location.pathname + win.location.search
      : `#${screen}`

  const push = (screen) => win.history.pushState({ screen }, '', urlFor(screen))
  const replace = (screen) => win.history.replaceState({ screen }, '', urlFor(screen))

  const currentScreen = () => screenForDraftState(store.getState().draftState)

  const setConfirmRequest = (kind) => {
    if (confirmRequest === kind) return
    confirmRequest = kind
    confirmListeners.forEach((listener) => listener(confirmRequest))
    if (kind) track('leave_prompt_shown', { prompt: kind })
  }

  // App-initiated screen changes → keep the history stack in step.
  const onStoreChange = (state, prevState) => {
    if (syncing) return
    const next = screenForDraftState(state.draftState)
    const prev = screenForDraftState(prevState.draftState)
    if (next === prev) return // intra-draft churn, timer ticks, bids, …
    // A screen change from inside the app supersedes any pending Back confirm
    // (e.g. the user clicked the in-app Restart while our dialog was open).
    setConfirmRequest(null)
    if (SCREEN_DEPTH[next] > SCREEN_DEPTH[prev]) push(next)
    else replace(next)
  }

  // Browser Back/Forward. `target` is the screen of the entry the browser
  // just landed on; the app hasn't moved yet.
  const onPopState = (event) => {
    const target = (event.state && event.state.screen) || 'title'
    const current = currentScreen()
    if (target === current) return

    // Guarded screens: draft/results live only in memory, so Back must not
    // destroy them silently. Cancel the navigation by re-pushing the current
    // screen (we stay put), then ask; resolveConfirm() finishes the exit.
    if (current === 'draft') {
      push(current)
      setConfirmRequest('leave-draft')
      return
    }
    if (current === 'complete') {
      push(current)
      setConfirmRequest('discard-results')
      return
    }

    syncing = true
    try {
      const state = store.getState()
      if (current === 'meta') {
        state.closeMetaResults() // → SETUP, same as "Back to Setup"
      } else if (current === 'setup' && target === 'title') {
        state.setDraftState('TITLE')
      } else if (current === 'title' && target === 'setup') {
        state.setDraftState('SETUP') // Forward into SETUP is data-free
      }
      // Anything else (Forward into draft/complete/meta) is unreachable
      // without in-memory data; fall through and rewrite the entry to
      // wherever the app actually is now.
      replace(currentScreen())
    } finally {
      syncing = false
    }
  }

  // Called by the UI when the user answers the Back-navigation dialog.
  const resolveConfirm = (confirmed) => {
    const request = confirmRequest
    setConfirmRequest(null)
    if (request) track('leave_prompt_answered', { prompt: request, confirmed: !!confirmed })
    if (!request || !confirmed) return // cancel: we already re-pushed, stay put
    syncing = true
    try {
      // Both guarded screens exit through the app's existing reset path.
      store.getState().restartDraft() // → SETUP
      replace(currentScreen())
    } finally {
      syncing = false
    }
  }

  const start = () => {
    // Anchor the current entry (normally TITLE on a fresh load — this also
    // clears any stale #hash from a pasted deep link).
    replace(currentScreen())
    const unsubscribe = store.subscribe(onStoreChange)
    win.addEventListener('popstate', onPopState)
    return () => {
      unsubscribe()
      win.removeEventListener('popstate', onPopState)
    }
  }

  const onConfirmChange = (listener) => {
    confirmListeners.add(listener)
    return () => confirmListeners.delete(listener)
  }

  return {
    start,
    onConfirmChange,
    getConfirmRequest: () => confirmRequest,
    resolveConfirm,
  }
}

// App-wide singleton bound to the real store and window (components use this;
// tests build their own instances via createHistoryService).
let singleton = null
export function getHistoryService() {
  if (!singleton) singleton = createHistoryService({ store: useDraftStore })
  return singleton
}
