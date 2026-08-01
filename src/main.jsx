import React from 'react'
import ReactDOM from 'react-dom/client'
import { enableMapSet } from 'immer'
import App from './App.jsx'
import BrowserHistoryGate from './components/BrowserHistoryGate.jsx'
import { useDraftStore } from './store/draftStore.js'
import { initAnalyticsTracker } from './services/analyticsService.js'
import './styles/design-tokens.css'

// Immer needs the MapSet plugin enabled because the store contains Map/Set
// values (e.g. valueModifiers, doNotDraftList). Without this, mutations after
// a New Draft reset throw "[Immer] The plugin for 'MapSet' has not been loaded".
enableMapSet()

// One store subscription drives all screen/lifecycle GA4 events (no-ops
// entirely when gtag isn't loaded — dev server, ad-blocked browsers).
initAnalyticsTracker(useDraftStore)
import './styles/main.css'
import './styles/components/title.css'
import './styles/components/setup.css'
import './styles/components/draftboard.css'
import './styles/components/playerpool.css'
import './styles/components/auction.css'
import './styles/components/rosters.css'
import './styles/components/history.css'
import './styles/components/controls.css'
import './styles/components/teamDetailsModal.css'
import './styles/components/playerValueModal.css'
import './styles/components/playerCustomizationModal.css'
import './styles/components/strategyBuilderModal.css'
import './styles/components/emailSignup.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* History integration lives beside App so its Back-navigation dialog
        survives App's early-return screen branches (App.jsx untouched). */}
    <BrowserHistoryGate />
    <App />
  </React.StrictMode>,
)