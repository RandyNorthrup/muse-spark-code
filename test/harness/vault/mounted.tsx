// The mounted-vault harness (C-M109-1 P1, RVCM1091D P3): the Models & Agents
// panel with the vault section offered, as the host serves it once lanes (b)
// and (c) bind the broker. Scenarios (test/harness/vault/scenarios.ts):
// `mounted` (unlocked section), `mounted-locked` (a real locked snapshot:
// no items, no observed slot), `mounted-connecting` (offered, host not
// answered yet), `mounted-uncreated`, `mounted-setup-pending`,
// `mounted-unavailable` (lost: the disabled toggle and Reset) and
// `mounted-first-party-only`. Values never appear here; the item carries a
// fixture label only.
import { createRoot } from 'react-dom/client'
import '../../../src/webview/models/models.css'
import { ModelsPanel } from '../../../src/webview/models/panel'
import { INITIAL_PANEL_UI } from '../../../src/webview/models/reducer'
import { type ModelsPanelState } from '../../../src/shared/modelsPanel'
import { VAULT_MOUNTED_SCENARIOS, vaultScenarioState, type VaultMountedScenario } from './scenarios'

const query = new URLSearchParams(location.search)
const scenario: VaultMountedScenario =
  VAULT_MOUNTED_SCENARIOS.find((entry) => entry === query.get('scenario')) ?? 'mounted'
const now = Date.now()
const vault = vaultScenarioState(scenario, now)
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
    vaultRaw={vault === undefined ? undefined : { type: 'vaultState', state: vault }}
    vaultPost={() => {
      /* Test host has no secret values. */
    }}
  />,
)
