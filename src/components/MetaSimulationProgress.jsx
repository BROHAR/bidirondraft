import React from 'react'
import { useDraftStore } from '../store/draftStore'
import '../styles/components/metaSimulation.css'

// Modal shown while a meta-simulation batch runs in the worker. Driven entirely
// by the store's metaSim progress fields.
export default function MetaSimulationProgress() {
  const metaSim = useDraftStore(state => state.metaSim)
  const cancelMetaSimulation = useDraftStore(state => state.cancelMetaSimulation)

  const { done, total, error } = metaSim
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="modal-overlay">
      <div className="modal-content meta-progress-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{error ? 'Meta Simulation Failed' : 'Running Meta Simulation'}</h2>
        </div>
        <div className="modal-body">
          {error ? (
            <p className="meta-progress-error">{error}</p>
          ) : (
            <>
              <p className="meta-progress-label">Simulating draft {done} / {total}</p>
              <div className="meta-progress-bar">
                <div className="meta-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="meta-progress-pct">{pct}%</p>
              <p className="meta-progress-hint">
                Your team auto-pilots each strategy against your league over many seeded drafts. Results show which plays best for you.
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={cancelMetaSimulation}>
            {error ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
