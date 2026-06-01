import React from 'react'
import { X } from 'lucide-react'

function TeamDetailsModal({ team, isOpen, onClose, allPlayers }) {
  if (!isOpen || !team) return null

  // Look up players by ID across the full pool (undrafted + drafted). Using
  // only `availablePlayers` would silently hide modifiers and DND entries
  // for players already on a roster — the common case after a simulation.
  const getDoNotDraftPlayers = () => {
    if (!team.doNotDraftList || team.doNotDraftList.size === 0) return []

    return Array.from(team.doNotDraftList)
      .map(playerId => allPlayers.find(p => p.id === playerId))
      .filter(Boolean)
  }

  const getValueModifiedPlayers = () => {
    if (!team.valueModifiers || team.valueModifiers.size === 0) return []

    return Array.from(team.valueModifiers.entries())
      .map(([playerId, modifier]) => {
        const player = allPlayers.find(p => p.id === playerId)
        return player ? { player, modifier } : null
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.modifier - 1) - Math.abs(a.modifier - 1)) // Sort by most significant modifiers first
  }

  const getStrategyDescription = (strategyName) => {
    switch (strategyName) {
      case 'Stars and Scrubs':
        return 'Spends hard on $30+ elites and fills the rest cheap. Less interested in mid-tier players, very aggressive on the top of the board.'
      case 'Balanced':
        return 'Spreads budget across positions with a mild lean toward RB/WR/QB. Consistent $1–2 increments and moderate skip rate.'
      case 'Zero RB':
        return 'Refuses to bid on RBs over $20. Pushes WR/TE hard early and waits for cheap RB scraps later.'
      case 'Hero RB':
        return 'Hunts one elite RB ($35+) early at near-market price, then plays conservatively on every other RB.'
      case 'Value Hunter':
        return 'Highly selective — skips often, but bids aggressively when a player is priced below value. Hard cap near projected worth.'
      case 'Late Round QB':
        return 'Will not bid more than $10 on a QB. Pours that saved budget into elite RB/WR/TE like a Stars-and-Scrubs.'
      case 'Taco':
        return 'Overpays for top-tier QBs and his random "home team" players. Hoards backup K/DST/TE late when others have moved on.'
      default:
        return 'AI-driven draft strategy'
    }
  }

  const doNotDraftPlayers = getDoNotDraftPlayers()
  const valueModifiedPlayers = getValueModifiedPlayers()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content team-details-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{team.name} - Team Details</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body">
          <div className="team-details-section">
            <h4>Basic Information</h4>
            <div className="team-info-grid">
              <div className="info-item">
                <label>Team Type:</label>
                <span className={team.isHuman ? 'human-team' : 'ai-team'}>
                  {team.isHuman ? 'Human Player' : 'AI Team'}
                </span>
              </div>
              <div className="info-item">
                <label>Budget:</label>
                <span>${team.remainingBudget} / ${team.budget}</span>
              </div>
              <div className="info-item">
                <label>Roster Size:</label>
                <span>{team.roster.length} players</span>
              </div>
              <div className="info-item">
                <label>Roster Spots Remaining:</label>
                <span>{team.getRosterSpotsRemaining()}</span>
              </div>
            </div>
          </div>

          {!team.isHuman && team.draftStrategy && (
            <div className="team-details-section">
              <h4>Draft Strategy</h4>
              <div className="strategy-info">
                <div className="strategy-name">{team.draftStrategy.name}</div>
                <div className="strategy-description">
                  {getStrategyDescription(team.draftStrategy.name)}
                </div>
                
                {team.draftStrategy.preferences?.positionMultipliers && (
                  <div className="position-preferences">
                    <h5>Position Preferences</h5>
                    <div className="preferences-grid">
                      {Object.entries(team.draftStrategy.preferences.positionMultipliers).map(([position, multiplier]) => (
                        <div key={position} className={`preference-item ${multiplier > 1 ? 'positive' : multiplier < 1 ? 'negative' : 'neutral'}`}>
                          <span className="position">{position}</span>
                          <span className="multiplier">
                            {multiplier > 1 ? '+' : ''}{((multiplier - 1) * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!team.isHuman && doNotDraftPlayers.length > 0 && (
            <div className="team-details-section">
              <h4>Do Not Draft List</h4>
              <div className="player-list-compact">
                {doNotDraftPlayers.map(player => (
                  <div key={player.id} className="player-item-compact">
                    <span className="player-name">{player.name}</span>
                    <span className="player-position">{player.position}</span>
                    <span className="player-value">${player.estimatedValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!team.isHuman && valueModifiedPlayers.length > 0 && (
            <div className="team-details-section">
              <h4>Player Value Adjustments</h4>
              <div className="value-modifiers-list">
                {valueModifiedPlayers.slice(0, 10).map(({ player, modifier }) => (
                  <div key={player.id} className="value-modifier-item">
                    <div className="player-info">
                      <span className="player-name">{player.name}</span>
                      <span className="player-position">{player.position}</span>
                    </div>
                    <div className="value-info">
                      <span className="base-value">${player.estimatedValue}</span>
                      {modifier === 0 ? (
                        <span className="modifier zero-value">
                          WILL NOT DRAFT
                        </span>
                      ) : modifier < 0.8 ? (
                        <>
                          <span className="modifier very-negative">
                            {((modifier - 1) * 100).toFixed(0)}%
                          </span>
                          <span className="adjusted-value">
                            ≈ ${Math.round(player.estimatedValue * modifier)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className={`modifier ${modifier > 1 ? 'positive' : 'negative'}`}>
                            {modifier > 1 ? '+' : ''}{((modifier - 1) * 100).toFixed(0)}%
                          </span>
                          <span className="adjusted-value">
                            ≈ ${Math.round(player.estimatedValue * modifier)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {valueModifiedPlayers.length > 10 && (
                  <div className="more-items">
                    +{valueModifiedPlayers.length - 10} more players with value adjustments
                  </div>
                )}
              </div>
            </div>
          )}

          {team.isHuman && (
            <div className="team-details-section">
              <h4>Your Team</h4>
              <p>This is your team! You control all drafting decisions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TeamDetailsModal