import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { DraftEngine } from '../services/draftEngine.js'
import { AIManager } from '../services/aiManager.js'
import { autoPilotService } from '../services/autoPilotService.js'
import { runMetaSimulationAsync } from '../utils/metaSimulation.js'
import { revertSale } from '../utils/undoSale.js'
import { track, draftStartParams, strategyParam } from '../services/analyticsService.js'

let draftEngine = null
let metaSimWorker = null
let metaCancelRequested = false
const aiManager = new AIManager()

export const useDraftStore = create(
  immer((set, get) => ({
    // Draft State
    draftState: 'TITLE',
    currentNominator: null,
    currentPlayer: null,
    currentBid: 0,
    currentBidder: null,
    timeRemaining: 0,
    draftHistory: [],
    
    // Auto-pilot State
    autoPilotEnabled: false,
    autoPilotStrategy: 'Balanced',

    // Meta Simulation State (batch of headless drafts aggregated by strategy)
    metaSim: { running: false, done: 0, total: 0, result: null, error: null },
    
    // Teams and Players
    teams: [],
    availablePlayers: [],
    
    // Configuration
    config: {
      numberOfTeams: 12,
      budgetPerTeam: 200,
      humanTeamName: '',
      humanDraftPosition: 1,
      rosterPositions: {
        QB: 1,
        RB: 2,
        WR: 2,
        TE: 1,
        FLEX: 1,
        K: 1,
        DST: 1,
        BENCH: 6
      },
      nominationTimer: 20,
      biddingTimer: 20,
      minBidIncrement: 1
    },
    
    // Actions
    setDraftState: (state) => set((draft) => {
      draft.draftState = state
    }),
    
    initializeDraft: (config, playersData) => {
      // Set auto-pilot state from config
      set((draft) => {
        draft.autoPilotEnabled = config.autoPilotEnabled || false
        draft.autoPilotStrategy = config.autoPilotStrategy || 'Balanced'
      })

      // Create and initialize the draft engine. Retire any previous engine
      // first so its pending timer callbacks can't touch the new draft.
      if (draftEngine) draftEngine.dispose()
      draftEngine = new DraftEngine({ getState: get, setState: set })
      draftEngine.initializeDraft(config, playersData)
      track('draft_started', draftStartParams(config, 'live'))
    },

    simulateDraft: (config, playersData) => {
      const strategy = config.autoPilotStrategy || 'Balanced'
      set((draft) => {
        draft.autoPilotEnabled = true
        draft.autoPilotStrategy = strategy
        draft.draftHistory = []
      })
      if (draftEngine) draftEngine.dispose()
      draftEngine = new DraftEngine({ getState: get, setState: set })
      draftEngine.initializeDraft(
        { ...config, autoPilotEnabled: true, autoPilotStrategy: strategy },
        playersData,
        { simulate: true }
      )
      track('draft_started', draftStartParams(
        { ...config, autoPilotEnabled: true, autoPilotStrategy: strategy },
        'simulate'
      ))
    },

    // Run a batch of headless drafts on `config` and aggregate by strategy.
    // Heavy work runs in a Web Worker so the UI stays responsive; if Worker is
    // unavailable we fall back to running the same core on the main thread.
    runMetaSimulation: (config, playersData, { strategies, draftsPerStrategy = 50, baseSeed = 1 } = {}) => {
      // Strip non-cloneable / human-only fields before crossing the worker
      // boundary (playerValueAdjustments is a Map and not needed here).
      const safeConfig = JSON.parse(JSON.stringify({ ...config, playerValueAdjustments: undefined }))
      const total = (strategies?.length || 0) * draftsPerStrategy

      metaCancelRequested = false
      set((draft) => {
        draft.metaSim = { running: true, done: 0, total, result: null, error: null }
      })
      track('draft_started', {
        ...draftStartParams({ ...config, autoPilotEnabled: true }, 'meta'),
        drafts_per_strategy: draftsPerStrategy,
        strategy_count: strategies?.length || 0,
        total_drafts: total,
      })

      // Guard so the worker's error/done and the fallback can't both finish.
      let settled = false
      const finishWithResult = (result) => {
        if (settled) return
        settled = true
        set((draft) => {
          draft.metaSim.running = false
          draft.metaSim.result = result
          draft.metaSim.done = result.numDrafts
          draft.draftState = 'META_RESULTS'
        })
      }
      const finishWithError = (message) => {
        if (settled) return
        settled = true
        set((draft) => {
          draft.metaSim.running = false
          draft.metaSim.error = message
        })
      }

      // Cooperative, UI-friendly run on the main thread. Used directly when no
      // Worker exists, and as the recovery path when the worker errors (the Vite
      // dev server breaks module workers; production worker chunks are fine).
      const runOnMainThread = () => {
        if (settled) return
        runMetaSimulationAsync(safeConfig, playersData, {
          strategies,
          draftsPerStrategy,
          baseSeed,
          shouldCancel: () => metaCancelRequested,
          onProgress: (done, t) => set((draft) => { draft.metaSim.done = done; draft.metaSim.total = t }),
        })
          .then((result) => {
            if (metaCancelRequested) return
            finishWithResult(result)
          })
          .catch((err) => finishWithError(String(err?.message || err)))
      }

      if (typeof Worker === 'undefined') {
        runOnMainThread()
        return
      }

      try {
        if (metaSimWorker) metaSimWorker.terminate()
        metaSimWorker = new Worker(new URL('../workers/metaSimWorker.js', import.meta.url), { type: 'module' })
        const recover = () => {
          if (metaSimWorker) { metaSimWorker.terminate(); metaSimWorker = null }
          runOnMainThread()
        }
        metaSimWorker.onmessage = (e) => {
          const msg = e.data || {}
          if (msg.type === 'progress') {
            set((draft) => { draft.metaSim.done = msg.done; if (msg.total) draft.metaSim.total = msg.total })
          } else if (msg.type === 'done') {
            if (metaSimWorker) { metaSimWorker.terminate(); metaSimWorker = null }
            finishWithResult(msg.result)
          } else if (msg.type === 'error') {
            // Worker-side failure — fall back to the main thread rather than fail.
            recover()
          }
        }
        // Worker failed to load/run (Vite dev HMR-client injection, CSP, etc.).
        metaSimWorker.onerror = () => { recover() }
        metaSimWorker.postMessage({ type: 'run', config: safeConfig, playersData, strategies, draftsPerStrategy, baseSeed })
      } catch {
        // Worker construction itself failed — run inline instead.
        runOnMainThread()
      }
    },

    cancelMetaSimulation: () => {
      metaCancelRequested = true
      if (metaSimWorker) { metaSimWorker.terminate(); metaSimWorker = null }
      set((draft) => { draft.metaSim = { running: false, done: 0, total: 0, result: null, error: null } })
    },

    closeMetaResults: () => {
      metaCancelRequested = true
      if (metaSimWorker) { metaSimWorker.terminate(); metaSimWorker = null }
      set((draft) => {
        draft.draftState = 'SETUP'
        draft.metaSim = { running: false, done: 0, total: 0, result: null, error: null }
      })
    },

    setCurrentNominator: (teamId) => set((draft) => {
      draft.currentNominator = teamId
    }),
    
    placeBid: (teamId, amount) => {
      if (draftEngine) {
        const success = draftEngine.placeBid(teamId, amount)
        // Note: State updates including timer reset are now handled in draftEngine.placeBid()
        return success
      }
      return false
    },
    
    setTeams: (teams) => set((draft) => {
      draft.teams = teams
    }),
    
    updateTimer: (time) => set((draft) => {
      draft.timeRemaining = time
    }),
    
    // New actions for draft engine integration
    nominatePlayerAction: (player) => {
      if (draftEngine && player) {
        const humanTeam = get().teams.find(t => t.isHuman)
        if (humanTeam) {
          draftEngine.nominatePlayer(player, humanTeam.id)
          track('player_nominated', {
            player_name: player.name,
            player_position: player.position,
          })
        }
      }
    },

    skipPlayerAction: () => {
      if (draftEngine) {
        const skipped = get().currentPlayer
        draftEngine.skipPlayer()
        track('player_skipped', {
          player_name: skipped?.name,
          player_position: skipped?.position,
        })
      }
    },
    
    pauseDraft: () => {
      if (draftEngine) {
        draftEngine.pauseDraft()
      }
    },
    
    resumeDraft: () => {
      if (draftEngine) {
        draftEngine.resumeDraft()
      }
    },

    // --- Undo support -----------------------------------------------------
    // Both actions rewind via inverse operations on live state (no snapshot
    // stack), so undoLastSale can be applied repeatedly — multi-level undo,
    // newest pick first. Timer/AI coherence: draftEngine.clearTimers() cancels
    // the nomination/bidding intervals AND every pending one-shot callback
    // (AI nominations, the AI bid cascade, the post-sale advance), and
    // startNominationPhase() restarts the loop from the rewound state, so no
    // stale AI callback can land on undone state.

    // Cancel the auction currently on the block without a sale. The nominated
    // player is only removed from availablePlayers when a sale completes, so
    // clearing the block returns it to the pool; the same team then nominates
    // again (currentNominatorIndex only advances on a completed sale).
    cancelNomination: () => {
      const state = get()
      if (!draftEngine || !state.currentPlayer) return
      if (state.draftState !== 'BIDDING' && state.draftState !== 'PAUSED') return
      const wasPaused = state.draftState === 'PAUSED'
      const cancelled = state.currentPlayer
      draftEngine.clearTimers()
      set((draft) => {
        draft.currentPlayer = null
        draft.currentBid = 0
        draft.currentBidder = null
        draft.timeRemaining = 0
        draft.draftState = wasPaused ? 'PAUSED' : 'NOMINATING'
      })
      // A paused draft stays paused; resumeDraft() with no player on the
      // block re-enters the nomination phase.
      if (!wasPaused) draftEngine.startNominationPhase()
      track('nomination_cancelled', {
        player_name: cancelled.name,
        player_position: cancelled.position,
      })
    },

    // Undo the most recent completed sale: return the player to the pool,
    // refund the buying team and free its roster slot, revert AI bid-outcome
    // psychology, and rewind the nomination turn to that pick. If a new
    // auction is already on the block it is cancelled too (its player was
    // never removed from the pool).
    undoLastSale: () => {
      const state = get()
      if (!draftEngine || state.draftHistory.length === 0) return
      if (!['NOMINATING', 'BIDDING', 'PAUSED'].includes(state.draftState)) return
      const wasPaused = state.draftState === 'PAUSED'
      const entry = state.draftHistory[state.draftHistory.length - 1]

      draftEngine.clearTimers()

      // Revert the Team/Player instance mutations in place — the same
      // mutate-then-set pattern completeBidding itself uses.
      revertSale(state.teams, entry)

      // completeBidding advanced the nominator index after this sale; step it
      // back so the team whose pick was undone nominates again.
      draftEngine.currentNominatorIndex = Math.max(0, draftEngine.currentNominatorIndex - 1)

      set((draft) => {
        draft.draftHistory.pop()
        if (!draft.availablePlayers.some(p => p.id === entry.player.id)) {
          draft.availablePlayers.push(entry.player)
        }
        draft.currentPlayer = null
        draft.currentBid = 0
        draft.currentBidder = null
        // startNominationPhase re-derives the nominator from the rewound index.
        draft.currentNominator = null
        draft.timeRemaining = 0
        draft.draftState = wasPaused ? 'PAUSED' : 'NOMINATING'
      })
      if (!wasPaused) draftEngine.startNominationPhase()
      track('pick_undone', {
        player_name: entry.player.name,
        player_position: entry.player.position,
        price: entry.price,
      })
    },

    simulateToEnd: () => {
      if (draftEngine) {
        track('simulate_to_end', { picks_so_far: get().draftHistory.length })
        draftEngine.simulateToEnd()
      }
    },

    restartDraft: () => {
      track('draft_restarted', { from_state: get().draftState })
      if (draftEngine) {
        draftEngine.dispose()
        draftEngine = null
      }
      set((draft) => {
        draft.draftState = 'SETUP'
        draft.currentNominator = null
        draft.currentPlayer = null
        draft.currentBid = 0
        draft.currentBidder = null
        draft.timeRemaining = 0
        draft.draftHistory = []
        draft.teams = []
        draft.availablePlayers = []
        draft.autoPilotEnabled = false
        draft.autoPilotStrategy = 'Balanced'
      })
    },
    
    // Auto-pilot actions
    toggleAutoPilot: () => {
      set((draft) => {
        draft.autoPilotEnabled = !draft.autoPilotEnabled
        const humanTeam = draft.teams.find(t => t.isHuman)
        if (humanTeam) {
          if (draft.autoPilotEnabled) {
            humanTeam.enableAutoPilot(draft.autoPilotStrategy)
          } else {
            humanTeam.disableAutoPilot()
          }
        }
      })
      const state = get()
      if (state.autoPilotEnabled) {
        const humanTeam = state.teams.find(t => t.isHuman)
        if (humanTeam) {
          autoPilotService.initializeStrategy(humanTeam, state.autoPilotStrategy)
        }
      }
      track('autopilot_toggled', {
        enabled: state.autoPilotEnabled,
        strategy: strategyParam(state.autoPilotStrategy),
      })
    },

    setAutoPilotStrategy: (strategy) => {
      set((draft) => {
        draft.autoPilotStrategy = strategy
        const humanTeam = draft.teams.find(t => t.isHuman)
        if (humanTeam && humanTeam.isAutoPilot) {
          humanTeam.autoPilotStrategy = strategy
        }
      })
      const state = get()
      if (state.autoPilotEnabled) {
        const humanTeam = state.teams.find(t => t.isHuman)
        if (humanTeam) {
          autoPilotService.initializeStrategy(humanTeam, strategy, state.config?.customStrategies)
        }
      }
      track('autopilot_strategy_set', { strategy: strategyParam(strategy) })
    },
    
    updatePlayerValueAdjustment: (playerId, multiplier) => set((draft) => {
      const humanTeam = draft.teams.find(t => t.isHuman)
      if (humanTeam) {
        humanTeam.setPlayerValueAdjustment(playerId, multiplier)
      }
    })
  }))
)