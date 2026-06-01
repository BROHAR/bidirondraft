import React, { useState, useEffect } from 'react'
import { useDraftStore } from '../store/draftStore'

function TeamRosters() {
  const { teams, config } = useDraftStore()
  const [selectedTeam, setSelectedTeam] = useState(0)

  // Ensure selectedTeam is valid when teams change
  useEffect(() => {
    if (teams.length > 0 && (selectedTeam >= teams.length || selectedTeam < 0)) {
      setSelectedTeam(0)
    }
  }, [teams.length, selectedTeam])

  const getRosterSlots = () => {
    const slots = []
    Object.entries(config.rosterPositions || {}).forEach(([position, count]) => {
      for (let i = 0; i < count; i++) {
        slots.push(`${position}${count > 1 ? ` ${i + 1}` : ''}`)
      }
    })
    return slots
  }

  const getPlayerForSlot = (team, slot) => {
    if (!team || !team.roster) return null
    
    const slotPosition = slot.split(' ')[0] // Get base position (e.g., "RB" from "RB 1")
    
    // Handle FLEX, SUPERFLEX, and BENCH positions
    if (slotPosition === 'FLEX') {
      return getFlexPlayer(team, slot)
    }
    if (slotPosition === 'SUPERFLEX') {
      return getSuperflexPlayer(team, slot)
    }
    if (slotPosition === 'BENCH') {
      return getBenchPlayer(team, slot)
    }
    
    // Find players matching this exact position who aren't already assigned
    const availablePlayers = team.roster.filter(player => {
      if (player.assignedSlot === slot) return true // Already assigned to this slot
      if (player.assignedSlot) return false // Already assigned elsewhere
      return player.position === slotPosition
    })
    
    if (availablePlayers.length === 0) return null
    
    // Assign this player to this slot to prevent double-assignment
    const player = availablePlayers[0]
    player.assignedSlot = slot
    
    return player
  }

  const getFlexPlayer = (team, slot) => {
    // FLEX can be RB, WR, or TE - prioritize players not already in their position slots
    const flexEligible = team.roster.filter(player => {
      if (player.assignedSlot === slot) return true // Already assigned to this slot
      if (player.assignedSlot) return false // Already assigned elsewhere
      return ['RB', 'WR', 'TE'].includes(player.position)
    })
    
    if (flexEligible.length === 0) return null
    
    // Prioritize players who have excess at their position (e.g., 3rd RB when only 2 RB slots)
    const excessPlayers = flexEligible.filter(player => {
      const positionCount = team.roster.filter(p => p.position === player.position).length
      const positionSlots = config.rosterPositions[player.position] || 0
      return positionCount > positionSlots
    })
    
    const player = excessPlayers.length > 0 ? excessPlayers[0] : flexEligible[0]
    player.assignedSlot = slot
    return player
  }

  const getSuperflexPlayer = (team, slot) => {
    // SUPERFLEX can be QB, RB, WR, or TE - often used for QB2
    const superflexEligible = team.roster.filter(player => {
      if (player.assignedSlot === slot) return true // Already assigned to this slot
      if (player.assignedSlot) return false // Already assigned elsewhere
      return ['QB', 'RB', 'WR', 'TE'].includes(player.position)
    })
    
    if (superflexEligible.length === 0) return null
    
    // Prioritize QBs for superflex, then excess position players
    const qbs = superflexEligible.filter(p => p.position === 'QB')
    const excessPlayers = superflexEligible.filter(player => {
      const positionCount = team.roster.filter(p => p.position === player.position).length
      const positionSlots = config.rosterPositions[player.position] || 0
      return positionCount > positionSlots
    })
    
    let player
    if (qbs.length > 1) { // If we have multiple QBs, use the second one
      player = qbs[1]
    } else if (excessPlayers.length > 0) {
      player = excessPlayers[0]
    } else {
      player = superflexEligible[0]
    }
    
    player.assignedSlot = slot
    return player
  }

  const getBenchPlayer = (team, slot) => {
    // BENCH can hold any position player - prioritize players not needed for starting positions
    const benchEligible = team.roster.filter(player => {
      if (player.assignedSlot === slot) return true // Already assigned to this slot
      if (player.assignedSlot) return false // Already assigned elsewhere
      return true // Any position can go to bench
    })
    
    if (benchEligible.length === 0) return null
    
    // Prioritize players who are excess at their position (beyond starting requirements)
    const excessPlayers = benchEligible.filter(player => {
      const positionCount = team.roster.filter(p => p.position === player.position).length
      const positionSlots = config.rosterPositions[player.position] || 0
      return positionCount > positionSlots
    })
    
    // If we have excess players, use them for bench first
    const player = excessPlayers.length > 0 ? excessPlayers[0] : benchEligible[0]
    player.assignedSlot = slot
    return player
  }

  // Clear slot assignments before rendering to allow reassignment
  const clearSlotAssignments = (team) => {
    if (team && team.roster) {
      team.roster.forEach(player => {
        delete player.assignedSlot
      })
    }
  }

  const getPositionNeed = (team, position) => {
    const positionCount = team.roster.filter(p => p.position === position).length
    const required = config.rosterPositions[position] || 0
    return Math.max(0, required - positionCount)
  }


  return (
    <div className="card team-rosters">
      <div className="rosters-header">
        <h3>Team Rosters</h3>
        
        <select 
          value={selectedTeam}
          onChange={(e) => setSelectedTeam(Number(e.target.value))}
          className="team-select"
        >
          {teams.map((team, index) => (
            <option key={team.id} value={index}>
              {team.name} {team.isHuman ? '(You)' : ''}
            </option>
          ))}
        </select>
      </div>

      {teams.length > 0 && teams[selectedTeam] && (
        <div className="roster-view">
          <div className="team-info">
            <div className="team-header">
              <div className="team-budget">
                <div className="budget-primary">
                  <span className="budget-remaining">${teams[selectedTeam].remainingBudget}</span>
                  <span className="budget-total"> / ${teams[selectedTeam].budget}</span>
                </div>
                <div className="budget-secondary">
                  <span className="budget-label">Max Bid</span>
                  <span className="budget-maxbid">${teams[selectedTeam].maxBid}</span>
                </div>
              </div>
            </div>
            
            <div className="roster-slots">
              {(() => {
                // Clear slot assignments before rendering
                clearSlotAssignments(teams[selectedTeam])
                
                return getRosterSlots().map((slot, index) => {
                  const player = getPlayerForSlot(teams[selectedTeam], slot)
                  const position = slot.split(' ')[0]
                  
                  return (
                    <div key={`${slot}-${index}`} className={`roster-slot ${player ? 'filled' : 'empty'}`}>
                      <div className="slot-label">{slot}</div>
                      {player ? (
                        <div className="roster-player">
                          <div className="player-name">{player.name}</div>
                          <div className="player-info">
                            {player.position} - {player.team}
                            {player.purchasePrice && (
                              <span className="purchase-price"> - ${player.purchasePrice}</span>
                            )}
                            {player.position !== position && position !== 'FLEX' && position !== 'SUPERFLEX' && position !== 'BENCH' && (
                              <span className="position-mismatch"> (in {position})</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="empty-slot">
                          <span>Empty {position}</span>
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TeamRosters