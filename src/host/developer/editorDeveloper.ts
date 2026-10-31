// The VS Code window's developer-options owner (M108 X, D88 amendment b).
// It opens the same machine folder the terminal owner uses, through
// `agentDataFolder`, so either host honours the other's unlock, expiry and
// audit; only the pool it checks accounts against is the window's own.
// The window supplies native confirmations and pushes snapshots to the
// badge; credentials still enter through K's flows, never here.
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { DeveloperOptions } from '../../core/developer/developerOptions'
import type { DeveloperSnapshot } from '../../shared/developerOptions'
import { developerMachineIdAliases, loadDeveloperMachineId } from '../../core/developer/machineId'
import type { AccountStore, AccountsMetadataPort } from '../../core/providers/accounts'
import { DeveloperLocalFiles } from '../../runtime/developer/localFiles'
import { checkDeveloperAccount } from '../../runtime/providers/runtimeServices'
import { DEVELOPER_PROFILE_ID_BYTES } from '../../shared/constants'

export async function openEditorDeveloperOptions(deps: {
  readonly dataDir: string
  readonly store: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly confirm: (question: 'unlock' | 'multiple' | 'reset' | 'resetForeign') => Promise<boolean>
  readonly changed: (snapshot: DeveloperSnapshot) => void
  readonly now?: () => number
}): Promise<DeveloperOptions> {
  const files = new DeveloperLocalFiles(`${deps.dataDir}/developer`)
  return await DeveloperOptions.open({
    machineId: await loadDeveloperMachineId(deps.dataDir),
    previousMachineIds: developerMachineIdAliases(hostname()),
    now: deps.now ?? Date.now,
    newProfileId: () => `p${randomBytes(DEVELOPER_PROFILE_ID_BYTES).toString('hex')}`,
    store: files,
    resources: files.resources(),
    checkAccount: (provider, account) =>
      checkDeveloperAccount(deps.metadata, deps.store, provider, account),
    confirm: deps.confirm,
    changed: deps.changed,
  })
}
