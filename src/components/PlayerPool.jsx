import React, { useState, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { getReplacementLevels, getPlayerVORP } from '../utils/draftAnalysis'

function PlayerPool() {
  const {
    availablePlayers,
    draftState,
    currentNominator,
    teams,
    config,
    nominatePlayerAction
  } = useDraftStore()
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('ALL')
  const [sortBy, setSortBy] = useState('estimatedValue')
  const [sortDirection, setSortDirection] = useState('desc')

  const replacementLevels = useMemo(() => {
    if (!config?.rosterPositions) return {}
    const allPlayers = [...availablePlayers, ...teams.flatMap(t => t.roster)]
    return getReplacementLevels(allPlayers, config.rosterPositions, config.numberOfTeams).levels
  }, [availablePlayers, teams, config?.rosterPositions, config?.numberOfTeams])

  const filteredPlayers = availablePlayers
    .filter(player => {
      if (positionFilter !== 'ALL' && player.position !== positionFilter) {
        return false
      }
      if (searchTerm && !player.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false
      }
      return true
    })
    .sort((a, b) => {
      let result = 0
      
      if (sortBy === 'estimatedValue') {
        result = a.estimatedValue - b.estimatedValue
      } else if (sortBy === 'projectedPoints') {
        result = a.projectedPoints - b.projectedPoints
      } else if (sortBy === 'name') {
        result = a.name.localeCompare(b.name)
      } else if (sortBy === 'position') {
        result = a.position.localeCompare(b.position)
      } else if (sortBy === 'team') {
        result = a.team.localeCompare(b.team)
      } else if (sortBy === 'byeWeek') {
        result = a.byeWeek - b.byeWeek
      } else if (sortBy === 'vorp') {
        result = getPlayerVORP(a, replacementLevels) - getPlayerVORP(b, replacementLevels)
      }
      
      return sortDirection === 'asc' ? result : -result
    })

  const getValueColor = (player) => {
    if (player.estimatedValue >= 30) return 'value-high'
    if (player.estimatedValue >= 15) return 'value-medium'
    if (player.estimatedValue >= 5) return 'value-low'
    return 'value-waiver'
  }

  const canNominate = () => {
    if (draftState !== 'NOMINATING') return false
    const humanTeam = teams.find(t => t.isHuman)
    return humanTeam && humanTeam.id === currentNominator
  }

  const handleNominate = (player) => {
    if (canNominate()) {
      nominatePlayerAction(player)
    }
  }

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDirection('desc')
    }
  }

  const getSortIcon = (column) => {
    if (sortBy !== column) return ' ↕'
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  return (
    <div className="card player-pool">
      <div className="player-pool-header">
        <h3>Available Players ({filteredPlayers.length})</h3>
        
        <div className="player-pool-filters">
          <input
            type="text"
            placeholder="Search players..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          
          <select 
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="position-filter"
          >
            <option value="ALL">All Positions</option>
            <option value="QB">QB</option>
            <option value="RB">RB</option>
            <option value="WR">WR</option>
            <option value="TE">TE</option>
            <option value="K">K</option>
            <option value="DST">DST</option>
          </select>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="sort-select"
          >
            <option value="estimatedValue">Sort by Value</option>
            <option value="projectedPoints">Sort by Points</option>
            <option value="vorp">Sort by VORP</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
      </div>

      <div className="player-list">
        <div className="player-list-header">
          <div 
            className="sortable-header" 
            onClick={() => handleSort('name')}
            title="Click to sort by Player Name"
          >
            Player{getSortIcon('name')}
          </div>
          <div 
            className="sortable-header" 
            onClick={() => handleSort('position')}
            title="Click to sort by Position"
          >
            Pos{getSortIcon('position')}
          </div>
          <div 
            className="sortable-header" 
            onClick={() => handleSort('team')}
            title="Click to sort by Team"
          >
            Team{getSortIcon('team')}
          </div>
          <div 
            className="sortable-header" 
            onClick={() => handleSort('byeWeek')}
            title="Click to sort by Bye Week"
          >
            Bye{getSortIcon('byeWeek')}
          </div>
          <div
            className="sortable-header"
            onClick={() => handleSort('projectedPoints')}
            title="Click to sort by Projected Points"
          >
            Points{getSortIcon('projectedPoints')}
          </div>
          <div
            className="sortable-header"
            onClick={() => handleSort('vorp')}
            title="Click to sort by VORP (Value Over Replacement Player)"
          >
            VORP{getSortIcon('vorp')}
          </div>
          <div
            className="sortable-header"
            onClick={() => handleSort('estimatedValue')}
            title="Click to sort by Estimated Value"
          >
            Value{getSortIcon('estimatedValue')}
          </div>
          <div>Action</div>
        </div>
        
        {filteredPlayers.map(player => (
          <div key={player.id} className={`player-row ${getValueColor(player)}`}>
            <div className="player-name">
              {player.name}
              {player.injuryStatus && (
                <sup className="injury-status" title={player.injuryStatus}>{player.injuryStatus}</sup>
              )}
            </div>
            <div className="player-position">{player.position}</div>
            <div className="player-team">{player.team}</div>
            <div className="player-bye">{player.byeWeek}</div>
            <div className="player-points">{player.projectedPoints.toFixed(1)}</div>
            <div className="player-vorp">{Math.round(getPlayerVORP(player, replacementLevels))}</div>
            <div className="player-value">${player.estimatedValue}</div>
            <div className="player-action">
              <button 
                className="btn btn-sm btn-primary"
                onClick={() => handleNominate(player)}
                disabled={!canNominate()}
              >
                {canNominate() ? 'Nominate' : 'N/A'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PlayerPool