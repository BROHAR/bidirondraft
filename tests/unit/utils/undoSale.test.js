import { describe, it, expect } from 'vitest'
import { revertSale, revertPsychology } from '../../../src/utils/undoSale.js'
import { Team } from '../../../src/models/Team.js'

const CONFIG = {
  numberOfTeams: 4,
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
}

function mkPlayer(id, estimatedValue = 40) {
  return { id, name: id, position: 'RB', team: 'KC', estimatedValue, projectedPoints: 200 }
}

// Apply the same mutations completeBidding + updateTeamPsychology perform for
// a sale, so revertSale is tested against the real forward operation's shape.
function applySale(teams, winner, player, price) {
  player.purchasePrice = price
  winner.roster.push(player)
  winner.remainingBudget -= price
  const value = player.estimatedValue - price
  winner.recentBidOutcomes.push({ won: true, value, price, player })
  if (winner.recentBidOutcomes.length > 5) winner.recentBidOutcomes.shift()
  winner.momentum = value >= 5 ? 'winning' : value <= -8 ? 'losing' : 'neutral'
  for (const team of teams) {
    if (team !== winner && !team.isHuman) {
      team.recentBidOutcomes.push({ won: false, value, price, player })
      if (team.recentBidOutcomes.length > 5) team.recentBidOutcomes.shift()
      const losses = team.recentBidOutcomes.filter(o => !o.won).length
      team.momentum = losses >= 3 ? 'losing' : losses <= 1 ? 'winning' : 'neutral'
    }
  }
  return { player, team: winner.name, nominator: winner.name, price, timestamp: Date.now() }
}

function mkTeams() {
  return [
    new Team('team_1', 'My Team', true, CONFIG),
    new Team('team_2', 'Team 2', false, CONFIG),
    new Team('team_3', 'Team 3', false, CONFIG),
  ]
}

describe('revertSale', () => {
  it('restores roster, budget, and purchasePrice after a sale', () => {
    const teams = mkTeams()
    const winner = teams[1]
    const player = mkPlayer('p1')
    const entry = applySale(teams, winner, player, 33)

    expect(winner.roster).toHaveLength(1)
    expect(winner.remainingBudget).toBe(167)

    const revertedTeam = revertSale(teams, entry)

    expect(revertedTeam).toBe(winner)
    expect(winner.roster).toHaveLength(0)
    expect(winner.remainingBudget).toBe(200)
    expect(player.purchasePrice).toBeNull()
  })

  it('pops the sale outcome from the winner and every losing AI team', () => {
    const teams = mkTeams()
    const player = mkPlayer('p1')
    const entry = applySale(teams, teams[1], player, 33)

    expect(teams[1].recentBidOutcomes).toHaveLength(1)
    expect(teams[2].recentBidOutcomes).toHaveLength(1)

    revertSale(teams, entry)

    expect(teams[1].recentBidOutcomes).toHaveLength(0)
    expect(teams[2].recentBidOutcomes).toHaveLength(0)
    expect(teams[1].momentum).toBe('neutral')
    expect(teams[2].momentum).toBe('neutral') // no outcomes left → neutral
    // The human loser never received an outcome and must stay untouched.
    expect(teams[0].recentBidOutcomes).toHaveLength(0)
  })

  it('recomputes momentum from the remaining outcomes', () => {
    const teams = mkTeams()
    const winner = teams[1]
    // First sale: a bargain ($10 for a $40 player) -> 'winning' momentum.
    const bargain = applySale(teams, winner, mkPlayer('p1'), 10)
    expect(winner.momentum).toBe('winning')
    // Second sale: a big overpay -> 'losing' momentum.
    const overpay = applySale(teams, winner, mkPlayer('p2'), 60)
    expect(winner.momentum).toBe('losing')

    revertSale(teams, overpay)
    // Undoing the overpay restores the bargain-derived momentum.
    expect(winner.momentum).toBe('winning')

    revertSale(teams, bargain)
    expect(winner.momentum).toBe('neutral')
    expect(winner.remainingBudget).toBe(200)
    expect(winner.roster).toHaveLength(0)
  })

  it('is a safe no-op for a "No Bids" fallback entry', () => {
    const teams = mkTeams()
    const player = mkPlayer('p1')
    const entry = { player, team: 'No Bids', nominator: 'Team 2', price: 0, timestamp: 1 }

    expect(revertSale(teams, entry)).toBeNull()
    for (const team of teams) {
      expect(team.remainingBudget).toBe(200)
      expect(team.roster).toHaveLength(0)
      expect(team.recentBidOutcomes).toHaveLength(0)
    }
  })

  it('never pops outcomes that belong to a different sale', () => {
    const teams = mkTeams()
    const p1 = mkPlayer('p1')
    const p2 = mkPlayer('p2')
    applySale(teams, teams[1], p1, 20)
    // Craft an entry for p2 that was never actually sold to team_3.
    const bogus = { player: p2, team: 'Team 3', nominator: 'Team 3', price: 5, timestamp: 2 }

    revertPsychology(teams, teams[2], p2)

    // team_2's p1 win and team_3's p1 loss both survive.
    expect(teams[1].recentBidOutcomes).toHaveLength(1)
    expect(teams[2].recentBidOutcomes).toHaveLength(1)

    // Full revertSale of the bogus entry still refunds only what it names.
    revertSale(teams, bogus)
    expect(teams[2].remainingBudget).toBe(205) // refund applies (entry says $5)
    expect(teams[2].recentBidOutcomes).toHaveLength(1)
  })
})
