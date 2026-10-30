import { randomBytes } from 'node:crypto'
// M108/W: the runtime's parent-owned account service (K/P/H follow-ups).
// One AccountStore per process over the runtime's providers file and the OS
// credential store (PLAN.md D61). It serves the CLI commands, ACP sessions
// and headless runs in this process. Independent processes coordinate only
// through atomic file writes; cross-process serialization needs M109's vault
// lifecycle, and per-request backend pooling needs the profile-owned pool
// (P-W), so serve sessions observe and select state while credential movement
// stays with the fixed account or an explicit error, never a silent default.
import { hostname } from 'node:os'
import { AccountStore, type AccountsMetadataPort } from '../../core/providers/accounts'
import { AccountStoreError } from '../../core/providers/accountCredentialRecord'
import type { Account, AccountThresholds } from '../../shared/accounts'
import {
  AccountSwitchRefusedError,
  RevokeUnsupportedError,
  isInvalidProvidersFileError,
} from '../../acp/accountText'
import {
  AccountSecrets,
  secretStorageAccountVault,
  type AccountSecretsDeps,
} from '../../host/providers/accountSecrets'
import type { SecretStore } from '../../host/auth/credentialStore'
import { keyringSecretStore, type KeyringEntryFactory } from '../keyStore'
import { DeveloperOptions } from '../../core/developer/developerOptions'
import type { DeveloperSnapshot } from '../../shared/developerOptions'
import { developerMachineIdAliases, loadDeveloperMachineId } from '../../core/developer/machineId'
import { DeveloperLocalFiles } from '../developer/localFiles'
import { developerConfirmation, developerStatusText } from '../../core/developer/surfaces'
import { accountPolicyFor } from '../../core/providers/accountPolicy'
import type { AccountsSessionPort } from '../../acp/accounts'
import type { AccountsCommandDeps } from './accountsCommand'
import type { ExecAccountsPort } from '../exec/execAccounts'
import { fileAccountsMetadata } from './providersFileStore'
import {
  ACCOUNT_DEFAULT_ID,
  DEVELOPER_PROFILE_ID_BYTES,
  SECRET_KEYS,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../shared/constants'

/** No M95b revoker exists outside VS Code: removing a sign-in refuses loudly
rather than orphan it. API keys delete normally; revoke is never called
for them. The refusal is branded so `AccountSecrets.remove` preserves it
instead of reporting a generic store outage. */
export function runtimeRevokeSignIn(): Promise<void> {
  return Promise.reject(new RevokeUnsupportedError())
}

export interface RuntimeAccountServicesInput {
  readonly dataDir: string
  readonly openEntry: KeyringEntryFactory
  /**
  The process's one owned secret store (the single-flight wrapper over
  the OS store), shared so account reads dedupe with every other
  credential read in the process. Absent, a raw store is built from
  `openEntry` as before.
  */
  readonly secrets?: SecretStore | undefined
  readonly registerSecret?: AccountSecretsDeps['registerSecret']
  readonly now?: () => number
}

export interface RuntimeAccountServices {
  readonly store: AccountStore
  readonly metadata: AccountsMetadataPort
  readonly commands: Omit<AccountsCommandDeps, 'print' | 'printError'>
  readonly exec: ExecAccountsPort
  sessions(provider: string, account?: string): AccountsSessionPort
  sessionsIfPresent(provider: string): Promise<AccountsSessionPort | undefined>
  /** The backend's key reads through the fixed account; nothing else changes. */
  secretsFor(provider: string, account: string, fallback: SecretStore): SecretStore
  /** The terminal `developer` owner: real store, real confirmation, while
  profile processes wait for M109's broker binding. */
  developer(deps: {
    readLine(prompt: string): Promise<string>
    print(line: string): void
  }): Promise<DeveloperOptions>
  /** The terminal `developer reset` recovery when stored state belongs to
  another machine identity: `open` refuses it, so reset runs here without
  an owner (DEVID017B). */
  developerReset(deps: {
    readLine(prompt: string): Promise<string>
    print(line: string): void
  }): Promise<DeveloperSnapshot>
  dispose(): void
}

type SessionListener = Parameters<AccountsSessionPort['subscribe']>[1]

class RuntimeAccountSessions implements AccountsSessionPort {
  private readonly listeners = new Map<string, Set<SessionListener>>()

  public constructor(
    private readonly store: AccountStore,
    private readonly provider: string,
    private readonly account: string,
  ) {}

  private async snapshot(): ReturnType<AccountsSessionPort['read']> {
    const accounts = await this.store.list(this.provider)
    const current = accounts.some((row) => row.id === this.account) ? this.account : null
    return {
      type: 'accounts/state',
      provider: this.provider,
      accounts,
      currentAccount: current,
      isSwapOn: SETTING_DEFAULTS.accountSwap,
      isParallelOn: SETTING_DEFAULTS.accountParallel,
    }
  }

  private async publishAll(): Promise<void> {
    for (const [key, group] of this.listeners) {
      if (!key.startsWith(`${this.provider} `)) continue
      const state = await this.snapshot()
      for (const listener of group) listener(state)
    }
  }

  public usageUrl(): string {
    // No vendor usage-page source is bundled; the research that certifies the
    // policy record holds terms pages, not dashboards. Callers keep the
    // notice without a link rather than guess one.
    throw new Error(UI_TEXT.accounts.unavailable)
  }

  public async read(_sessionId: string): ReturnType<AccountsSessionPort['read']> {
    try {
      return await this.snapshot()
    } catch (error: unknown) {
      // A refused providers file travels with its brand: the runtime is
      // already on the account service, so the connection sentence would lie.
      if (isInvalidProvidersFileError(error)) throw error
      throw new Error(UI_TEXT.accounts.unavailable, { cause: error })
    }
  }

  public async use(
    sessionId: string,
    account: string,
    _canCommit: () => boolean,
  ): ReturnType<AccountsSessionPort['use']> {
    const state = await this.read(sessionId)
    if (state.accounts.every((row) => row.id !== account))
      throw new Error(UI_TEXT.accounts.invalidAccount)
    if (state.currentAccount === account) return state
    // Moving another session's credential needs the profile-owned pool and
    // its synchronous adoption transaction. A no-op re-adoption is the only
    // safe in-process change; anything else refuses with the session's
    // stay-put text instead of dispatching under the wrong identity (D88.7).
    // The commit signal has no transaction to guard here: AcpAccounts fences
    // generations and staleness before this port is reached.
    if (state.currentAccount === null) throw new Error(UI_TEXT.accounts.none)
    const current = state.accounts.find((row) => row.id === state.currentAccount)
    throw new AccountSwitchRefusedError(this.provider, current?.label ?? state.currentAccount)
  }

  public subscribe(sessionId: string, listener: SessionListener): () => void {
    const key = `${this.provider} ${sessionId}`
    let group = this.listeners.get(key)
    if (group === undefined) {
      group = new Set()
      this.listeners.set(key, group)
    }
    group.add(listener)
    return () => {
      group.delete(listener)
      if (group.size === 0) this.listeners.delete(key)
    }
  }

  public publish(): void {
    void this.publishAll().catch(() => {
      /* A failed refresh keeps the last published state; the next read
       * reports the store truthfully. */
    })
  }
}

class PublishingAccountStore extends AccountStore {
  public constructor(
    metadata: AccountsMetadataPort,
    credentials: AccountSecrets,
    private readonly published: (provider: string) => void,
  ) {
    super(metadata, credentials)
  }

  public override async add(provider: string, value: Account): Promise<symbol> {
    const token = await super.add(provider, value)
    this.published(provider)
    return token
  }

  public override async update(provider: string, value: Account): Promise<void> {
    await super.update(provider, value)
    this.published(provider)
  }

  public override async order(provider: string, ids: readonly string[]): Promise<void> {
    await super.order(provider, ids)
    this.published(provider)
  }

  public override async thresholds(
    provider: string,
    account: string,
    value: AccountThresholds,
  ): Promise<void> {
    await super.thresholds(provider, account, value)
    this.published(provider)
  }

  public override async setCredential(
    provider: string,
    account: string,
    value: Parameters<AccountStore['setCredential']>[2],
  ): Promise<void> {
    await super.setCredential(provider, account, value)
    this.published(provider)
  }

  public override async remove(
    provider: string,
    account: string,
    addition?: symbol,
  ): Promise<void> {
    await super.remove(provider, account, addition)
    this.published(provider)
  }
}

function developerUnavailableProfile(): Promise<void> {
  return Promise.reject(new Error(UI_TEXT.developer.unavailable))
}

/** The one mapping point for a refused providers file: every runtime caller
(exec `--account`, the ACP store, developer multiple-accounts open, the
CLI account commands) reads through this port, so the brand reaches the
person as its own refusal sentence here — never a keyring-outage message
and never a raw code. The brand is kept so typed checks (the ACP store's
`providersInvalid` code, the CLI command's sentence) still match; only the
message becomes the person-facing sentence. Sibling typed failures pass
through untouched, each keeping its own refusal. */
function withProvidersFileRefusal(metadata: AccountsMetadataPort): AccountsMetadataPort {
  return {
    read: async (provider) => {
      try {
        return await metadata.read(provider)
      } catch (error: unknown) {
        if (!isInvalidProvidersFileError(error)) throw error
        const refusal = new AccountStoreError('invalidProvidersFile')
        refusal.message = UI_TEXT.accounts.providersInvalid
        throw refusal
      }
    },
    writeAccounts: (provider, accounts) => metadata.writeAccounts(provider, accounts),
  }
}

/** The terminal `developer` owner's account check against the stored pool. */
export async function checkDeveloperAccount(
  metadata: AccountsMetadataPort,
  store: AccountStore,
  provider: string,
  account: string,
): Promise<void> {
  const entry = await metadata.read(provider)
  let rows: Account[]
  try {
    rows = entry === undefined ? [] : await store.list(provider)
  } catch (error: unknown) {
    // A list the store cannot hand out is not an empty team (an empty team
    // refuses as invalid below): the check is unavailable, with the cause
    // kept, as the session read above answers the same failure.
    if (isInvalidProvidersFileError(error)) throw error
    throw new Error(UI_TEXT.accounts.unavailable, { cause: error })
  }
  if (entry === undefined || rows.every((row) => row.id !== account))
    throw new Error(UI_TEXT.developer.invalidRequest)
  const policy = accountPolicyFor(entry.policyProvider, entry.product)
  if (entry.product === 'muse-code' || policy?.pooling === 'notOffered')
    throw new Error(UI_TEXT.developer.unavailable)
}

export function createRuntimeAccountServices(
  input: RuntimeAccountServicesInput,
): RuntimeAccountServices {
  const metadata = withProvidersFileRefusal(fileAccountsMetadata(input.dataDir))
  const credentials = new AccountSecrets({
    vault: secretStorageAccountVault(input.secrets ?? keyringSecretStore(input.openEntry)),
    revokeSignIn: runtimeRevokeSignIn,
    registerSecret: input.registerSecret,
  })
  const sessionsByProvider = new Map<string, RuntimeAccountSessions>()
  const publish = (provider: string): void => {
    for (const [key, port] of sessionsByProvider) {
      if (key.startsWith(`${provider} `)) port.publish()
    }
  }
  const store = new PublishingAccountStore(metadata, credentials, publish)
  const sessions = (provider: string, account = ACCOUNT_DEFAULT_ID): AccountsSessionPort => {
    const key = `${provider} ${account}`
    let port = sessionsByProvider.get(key)
    if (port === undefined) {
      port = new RuntimeAccountSessions(store, provider, account)
      sessionsByProvider.set(key, port)
    }
    return port
  }
  const secretsFor = (provider: string, account: string, fallback: SecretStore): SecretStore => ({
    get: async (key) => {
      if (key !== SECRET_KEYS.modelApiKey) return await fallback.get(key)
      const entry = await metadata.read(provider)
      // Meta's entry is built in, so an undefined entry is an unconfigured
      // provider. The vault serves the pre-existing default key through the
      // same OS-store name (rule 8's original key) with nothing re-entered;
      // a missing account is an invalid account, never a silent default key.
      if (entry === undefined) throw new Error(UI_TEXT.accounts.unavailable)
      return await store.useCredential(provider, account, entry.origin, (_binding, credential) =>
        Promise.resolve(credential?.secret),
      )
    },
    store: (key, value) => fallback.store(key, value),
    delete: (key) => fallback.delete(key),
  })
  const developerCheckAccount = (provider: string, account: string): Promise<void> =>
    checkDeveloperAccount(metadata, store, provider, account)
  const developerBase = (deps: {
    readLine(prompt: string): Promise<string>
    print(line: string): void
  }): {
    now: () => number
    files: DeveloperLocalFiles
    checkAccount: (provider: string, account: string) => Promise<void>
    confirm: (question: 'unlock' | 'multiple' | 'reset' | 'resetForeign') => Promise<boolean>
    changed: (snapshot: DeveloperSnapshot) => void
  } => {
    const now = input.now ?? Date.now
    const files = new DeveloperLocalFiles(`${input.dataDir}/developer`)
    return {
      now,
      files,
      checkAccount: developerCheckAccount,
      confirm: async (question) => {
        const asked = developerConfirmation(question)
        deps.print(`${asked.title}: ${asked.message}`)
        const raw = await deps.readLine(`${asked.accept} / ${asked.cancel}: `)
        return raw.trim() === asked.accept
      },
      changed: (snapshot) => {
        deps.print(developerStatusText(snapshot))
      },
    }
  }
  const developerArgs = (base: ReturnType<typeof developerBase>, machineId: string) => ({
    machineId,
    now: base.now,
    newProfileId: () => `p${randomBytes(DEVELOPER_PROFILE_ID_BYTES).toString('hex')}`,
    store: base.files,
    resources: {
      // Profile processes, credential slots and pool registration need
      // M109's broker binding. Nothing starts here; the failure names
      // the missing binding instead of running half a profile. Foreign
      // reset (DEVID017C) clears the record without this port, so the
      // unbound stub never blocks recovery.
      start: developerUnavailableProfile,
      stop: developerUnavailableProfile,
      remove: developerUnavailableProfile,
    },
    checkAccount: base.checkAccount,
    confirm: base.confirm,
    changed: base.changed,
  })
  return {
    store,
    metadata,
    commands: { accounts: store, metadata },
    exec: {
      create: (deps, selection, createBackend) => {
        // One run, one account: the backend's key reads through it. Pool
        // swaps at user caps need the profile-owned pool, so --account-pool
        // refuses loudly instead of running unpooled (D88.5).
        if (selection.hasPoolFlag) throw new Error(UI_TEXT.accounts.poolUnavailable)
        return {
          runtime: createBackend({
            ...deps,
            secrets: secretsFor('meta', selection.account, deps.secrets),
          }),
          accounts: sessions('meta', selection.account),
        }
      },
    },
    sessions,
    async sessionsIfPresent(provider) {
      return (await metadata.read(provider)) === undefined ? undefined : sessions(provider)
    },
    secretsFor,
    async developer(deps: {
      readLine(prompt: string): Promise<string>
      print(line: string): void
    }): Promise<DeveloperOptions> {
      const base = developerBase(deps)
      // One stable identity for every host (DEVID017B): the extension host
      // loads the same stored id from the same machine folder, so either
      // host honours the other's unlock. Grants stored under this machine's
      // legacy hostname or hostname digest are adopted once and persisted
      // at once, never written back raw.
      const host = hostname()
      return await DeveloperOptions.open({
        ...developerArgs(base, await loadDeveloperMachineId(input.dataDir)),
        previousMachineIds: developerMachineIdAliases(host),
      })
    },
    async developerReset(deps: {
      readLine(prompt: string): Promise<string>
      print(line: string): void
    }): Promise<DeveloperSnapshot> {
      const base = developerBase(deps)
      return await DeveloperOptions.resetForeign(
        developerArgs(base, await loadDeveloperMachineId(input.dataDir)),
        'terminal',
      )
    },
    dispose(): void {
      credentials.dispose()
    },
  }
}
