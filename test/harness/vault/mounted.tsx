// The mounted-vault harness (C-M109-1 P1): the Models & Agents panel with
// the vault section offered, as the host serves it once lanes (b) and (c)
// bind the broker. Scenarios: `mounted` (unlocked section), `mounted-locked`
// (locked section) and `mounted-connecting` (offered, host not answered
// yet). Values never appear here; the item carries a fixture label only.
import { createRoot } from 'react-dom/client'
import '../../../src/webview/models/models.css'
import { ModelsPanel } from '../../../src/webview/models/panel'
import { INITIAL_PANEL_UI } from '../../../src/webview/models/reducer'
import { type ModelsPanelState } from '../../../src/shared/modelsPanel'
import { type VaultPanelState } from '../../../src/shared/modelsPanel'

const query = new URLSearchParams(location.search)
const scenario = query.get('scenario') ?? 'mounted'
const now = Date.now()
const item = {
  id: 'd'.repeat(32),
  name: 'deploy',
  handle: 'secret://deploy',
  label: 'Deployment credential',
  kind: 'secret' as const,
  bindings: [],
  requirePresence: true,
  hidden: false,
  firstParty: false,
  policy: { mode: 'askEveryTime' as const, unattendedAllowed: false, allowDisclosure: false },
  dates: { createdAt: now, rotatedAt: null, expiresAt: null, lastUsedAt: now },
  publicKey: null,
  fingerprint: null,
}
const vault: VaultPanelState = {
  status: {
    state: scenario === 'mounted-locked' ? 'locked' : 'unlocked',
    lockEpoch: 1,
    tier: 'osStore',
    provider: 'loginKeychain',
    silentUnlock: true,
    itemCount: 1,
    reason: null,
  },
  items: [item],
  grants: [],
  audit: [],
  pending: [],
  ambientFiles: [],
}
const panelState: ModelsPanelState = {
  presets: [],
  providers: [],
  models: [],
  totalModels: 0,
  filter: {},
  sort: { key: 'name', direction: 'asc' },
  facets: { providers: [], families: [] },
  scans: {},
  suggestions: [],
  lastChoices: {},
  drafts: { edits: {} },
  pendingRemovals: [],
  vaultOffered: true,
}
const root = document.querySelector('#root')
if (root === null) throw new Error('missing harness root')
createRoot(root).render(
  <ModelsPanel
    panelState={panelState}
    ui={{ ...INITIAL_PANEL_UI, section: 'vault' }}
    post={() => {
      /* Test host holds no state. */
    }}
    dispatch={() => {
      /* Test navigation stays put. */
    }}
    vaultRaw={scenario === 'mounted-connecting' ? undefined : { type: 'vaultState', state: vault }}
    vaultPost={() => {
      /* Test host has no secret values. */
    }}
  />,
)
