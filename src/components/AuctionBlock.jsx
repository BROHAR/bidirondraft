import React, { useState, useCallback, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { getReplacementLevels, getPlayerVORP } from '../utils/draftAnalysis'
import { getBidAdvice } from '../utils/bidAdvisor'

function AuctionBlock() {
  const [isSkipping, setIsSkipping] = useState(false)

  const {
    draftState,
    currentPlayer,
    currentBid,
    currentBidder,
    currentNominator,
    timeRemaining,
    teams,
    draftHistory,
    availablePlayers,
    config,
    placeBid,
    skipPlayerAction
  } = useDraftStore()

  const currentBidderTeam = teams.find(t => t.id === currentBidder)
  const nominatorTeam = teams.find(t => t.id === currentNominator)

  const replacementLevels = useMemo(() => {
    if (!config?.rosterPositions) return {}
    const allPlayers = [...availablePlayers, ...teams.flatMap(t => t.roster)]
    return getReplacementLevels(allPlayers, config.rosterPositions, config.numberOfTeams).levels
  }, [availablePlayers, teams, config?.rosterPositions, config?.numberOfTeams])

  const handleBid = (increment) => {
    const humanTeam = teams.find(t => t.isHuman)
    if (humanTeam) {
      placeBid(humanTeam.id, currentBid + increment)
    }
  }

  const getMaxBid = () => {
    const humanTeam = teams.find(t => t.isHuman)
    return humanTeam ? humanTeam.maxBid : 0
  }

  const handleSkipPlayer = useCallback(() => {
    if (isSkipping || draftState !== 'BIDDING') return
    
    setIsSkipping(true)
    skipPlayerAction()
    
    // Reset after a short delay
    setTimeout(() => {
      setIsSkipping(false)
    }, 1000)
  }, [isSkipping, draftState, skipPlayerAction])

  // Show nomination countdown if we're in the nominating phase
  if (draftState === 'NOMINATING') {
    const lastPick = draftHistory.length > 0 ? draftHistory[draftHistory.length - 1] : null

    return (
      <div className="card auction-block">
        <div className="auction-header">
          <h3>Player Nomination</h3>
          <div className="timer">
            <div className={`timer-circle ${timeRemaining <= 5 ? 'urgent' : ''}`}>
              {timeRemaining}
            </div>
          </div>
        </div>

        {lastPick && (
          <div className="last-winner">
            <div className="last-winner-label">Just Won</div>
            <div className="last-winner-body">
              <span className="last-winner-player">{lastPick.player.name}</span>
              <span className="last-winner-pos">{lastPick.player.position}</span>
              <span className="last-winner-arrow">→</span>
              <span className="last-winner-team">{lastPick.team}</span>
              <span className="last-winner-price">${lastPick.price}</span>
            </div>
          </div>
        )}

        <div className="auction-waiting">
          <h4>{nominatorTeam ? nominatorTeam.name : 'Team'} is nominating...</h4>
          {nominatorTeam && !nominatorTeam.isHuman && (
            <p>AI team is selecting a player to nominate</p>
          )}
          {nominatorTeam && nominatorTeam.isHuman && (
            <p>Your turn to nominate a player from the Player Pool</p>
          )}
        </div>

        {draftHistory.length > 0 && (
          <div className="recent-history">
            <h5>Recent Auction Results</h5>
            <div className="recent-picks">
              {draftHistory.slice(-5).reverse().map((pick, index) => (
                <div key={`${pick.player.id}-${pick.timestamp}`} className="recent-pick">
                  <div className="recent-pick-player">
                    <span className="player-name">{pick.player.name}</span>
                    <span className="player-position">{pick.player.position}</span>
                  </div>
                  <div className="recent-pick-values">
                    <span className="auction-price">${pick.price}</span>
                    <span className="estimated-value">(Est: ${pick.player.estimatedValue})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (draftState !== 'BIDDING' || !currentPlayer) {
    return (
      <div className="card auction-block">
        <div className="auction-waiting">
          <h3>Waiting for nomination...</h3>
          <p>A player will be nominated shortly</p>
        </div>
      </div>
    )
  }

  const currentVorp = getPlayerVORP(currentPlayer, replacementLevels)
  let bestOtherVorp = 0
  let hasHigherAvailable = false
  for (const p of availablePlayers) {
    if (p.id === currentPlayer.id || p.position !== currentPlayer.position) continue
    const v = getPlayerVORP(p, replacementLevels)
    if (v > currentVorp) { hasHigherAvailable = true; break }
    if (v > bestOtherVorp) bestOtherVorp = v
  }
  const vonaDisplay = hasHigherAvailable ? '-' : Math.round(currentVorp - bestOtherVorp)

  const humanTeam = teams.find(t => t.isHuman)
  const advice = humanTeam
    ? getBidAdvice(currentPlayer, currentBid, humanTeam, availablePlayers, replacementLevels)
    : null
  const verdictClass = advice ? `advisor-verdict ${advice.verdict.toLowerCase()}` : 'advisor-verdict'

  return (
    <div className="card auction-block">
      <div className="auction-header">
        <h3>Current Auction</h3>
        <div className="timer">
          <div className={`timer-circle ${timeRemaining <= 5 ? 'urgent' : ''}`}>
            {timeRemaining}
          </div>
        </div>
      </div>

      <div className="player-on-block">
        <div className="player-card-large">
          <div className="player-info">
            <h2>{currentPlayer.name}</h2>
            <div className="player-details">
              <span className="position">{currentPlayer.position}</span>
              <span className="team">{currentPlayer.team}</span>
              <span className="bye">Bye: {currentPlayer.byeWeek}</span>
            </div>
            {nominatorTeam && (
              <div className="nominated-by">
                Nominated by <span className="nominated-by-team">{nominatorTeam.name}</span>
              </div>
            )}
            <div className="player-stats">
              <div className="stat">
                <label>Projected Points</label>
                <span className="stat-value">{currentPlayer.projectedPoints.toFixed(1)}</span>
              </div>
              <div className="stat">
                <label>Estimated Value</label>
                <span className="stat-value">${currentPlayer.estimatedValue}</span>
              </div>
              <div className="stat">
                <label>VORP</label>
                <span className="stat-value">{Math.round(currentVorp)}</span>
              </div>
              <div className="stat">
                <label>VONA</label>
                <span className="stat-value">{vonaDisplay}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {advice && (
        <div className="advisor">
          <div className="advisor-header">
            <span className="advisor-label">Bid Advisor</span>
            <span className={verdictClass}>{advice.verdict}</span>
          </div>
          <div className="advisor-max">
            <span className="advisor-max-label">Bid up to</span>
            <span className="advisor-max-value">${advice.maxBid}</span>
          </div>
          {advice.reasons.length > 0 && (
            <ul className="advisor-reasons">
              {advice.reasons.map((r, i) => (
                <li key={i}>
                  <span className="reason-label">{r.label}</span>
                  {r.delta !== 0 && (
                    <span className={`reason-delta ${r.delta > 0 ? 'pos' : 'neg'}`}>
                      {r.delta > 0 ? '+' : ''}${r.delta}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="current-bid">
        <div className="bid-info">
          <div className="bid-amount">${currentBid}</div>
          {currentBidderTeam && (
            <div className="bid-team">
              High bidder: {currentBidderTeam.name}
            </div>
          )}
        </div>
      </div>

      <div className="bid-controls">
        <div className="bid-buttons">
          <button 
            className="btn btn-success"
            onClick={() => handleBid(1)}
            disabled={currentBid + 1 > getMaxBid()}
          >
            +$1 (${currentBid + 1})
          </button>
          <button 
            className="btn btn-success"
            onClick={() => handleBid(5)}
            disabled={currentBid + 5 > getMaxBid()}
          >
            +$5 (${currentBid + 5})
          </button>
          <button 
            className="btn btn-success"
            onClick={() => handleBid(10)}
            disabled={currentBid + 10 > getMaxBid()}
          >
            +$10 (${currentBid + 10})
          </button>
          <button 
            className="btn btn-danger"
            onClick={() => handleBid(getMaxBid() - currentBid)}
            disabled={getMaxBid() <= currentBid}
          >
            Max Bid (${getMaxBid()})
          </button>
        </div>
        
        <div className="skip-section">
          <button 
            className="btn btn-secondary skip-btn"
            onClick={handleSkipPlayer}
            disabled={isSkipping}
            title="Let AI teams bid this out quickly without your participation"
          >
            {isSkipping ? 'Skipping...' : 'Skip Player'}
          </button>
          <small>Let AI teams handle this auction</small>
        </div>
        
        <div className="budget-info">
          <div>Your Budget: ${teams.find(t => t.isHuman)?.remainingBudget || 0}</div>
          <div>Max Bid: ${getMaxBid()}</div>
        </div>
      </div>

    </div>
  )
}

export default AuctionBlock