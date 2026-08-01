import React, { useEffect, useSyncExternalStore } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { getHistoryService } from '../services/historyService'

// Wording mirrors the app's existing exit paths: ControlPanel's "Restart
// Draft" dialog for a live draft, PostDraftAnalysis's "Start a New Draft?"
// dialog for the completed-draft report.
const COPY = {
  'leave-draft': {
    title: 'Leave Draft?',
    message: 'All progress will be lost. This cannot be undone.',
    confirmLabel: 'Leave Draft',
  },
  'discard-results': {
    title: 'Start a New Draft?',
    message: 'This report and the completed draft will be discarded. This cannot be undone.',
    confirmLabel: 'New Draft',
  },
}

// Mounts the browser-history service (see historyService.js for the full
// behavior map) and renders its Back-navigation ConfirmDialog. Rendered as a
// sibling of <App /> in main.jsx so the dialog survives App's early-return
// screen branches and App.jsx itself stays untouched.
function BrowserHistoryGate({ service = getHistoryService() }) {
  const request = useSyncExternalStore(service.onConfirmChange, service.getConfirmRequest)

  useEffect(() => service.start(), [service])

  const copy = request ? COPY[request] : null
  if (!copy) return null

  return (
    <ConfirmDialog
      open
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirmLabel}
      danger
      onConfirm={() => service.resolveConfirm(true)}
      onCancel={() => service.resolveConfirm(false)}
    />
  )
}

export default BrowserHistoryGate
