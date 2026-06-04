import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { DraftEngine } from '../services/draftEngine.js'
import { AIManager } from '../services/aiManager.js'
import { autoPilotService } from '../services/autoPilotService.js'

let draftEngine = null
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

      // Create and initialize the draft engine
      draftEngine = new DraftEngine({ getState: get, setState: set })
      draftEngine.initializeDraft(config, playersData)
    },

    simulateDraft: (config, playersData) => {
      const strategy = config.autoPilotStrategy || 'Balanced'
      set((draft) => {
        draft.autoPilotEnabled = true
        draft.autoPilotStrategy = strategy
        draft.draftHistory = []
      })
      draftEngine = new DraftEngine({ getState: get, setState: set })
      draftEngine.initializeDraft(
        { ...config, autoPilotEnabled: true, autoPilotStrategy: strategy },
        playersData,
        { simulate: true }
      )
    },
    
    setCurrentNominator: (teamId) => set((draft) => {
      draft.currentNominator = teamId
    }),
    
    nominatePlayer: (player) => set((draft) => {
      draft.currentPlayer = player
      draft.currentBid = 1
      draft.currentBidder = null
      draft.draftState = 'BIDDING'
      draft.timeRemaining = draft.config.biddingTimer
    }),
    
    placeBid: (teamId, amount) => {
      if (draftEngine) {
        const success = draftEngine.placeBid(teamId, amount)
        // Note: State updates including timer reset are now handled in draftEngine.placeBid()
        return success
      }
      return false
    },
    
    completePurchase: () => set((draft) => {
      const winningTeam = draft.teams.find(t => t.id === draft.currentBidder)
      const nominatorTeam = draft.teams.find(t => t.id === draft.currentNominator)
      const player = draft.currentPlayer

      if (winningTeam && player) {
        winningTeam.roster.push(player)
        winningTeam.remainingBudget -= draft.currentBid

        draft.draftHistory.push({
          player: player,
          team: winningTeam.name,
          nominator: nominatorTeam ? nominatorTeam.name : null,
          price: draft.currentBid,
          timestamp: Date.now()
        })
        
        draft.availablePlayers = draft.availablePlayers.filter(p => p.id !== player.id)
        draft.currentPlayer = null
        draft.currentBid = 0
        draft.currentBidder = null
        draft.draftState = 'NOMINATING'
      }
    }),
    
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
        }
      }
    },

    skipPlayerAction: () => {
      if (draftEngine) {
        draftEngine.skipPlayer()
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

    simulateToEnd: () => {
      if (draftEngine) {
        draftEngine.simulateToEnd()
      }
    },
    
    restartDraft: () => {
      if (draftEngine) {
        draftEngine.clearTimers()
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
          autoPilotService.initializeStrategy(humanTeam, strategy)
        }
      }
    },
    
    updatePlayerValueAdjustment: (playerId, multiplier) => set((draft) => {
      const humanTeam = draft.teams.find(t => t.isHuman)
      if (humanTeam) {
        humanTeam.setPlayerValueAdjustment(playerId, multiplier)
      }
    })
  }))
)