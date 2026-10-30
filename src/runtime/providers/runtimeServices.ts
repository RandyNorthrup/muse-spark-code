import { ACCOUNT_REQUEST_CERTIFICATION } from '../../shared/constants'
import { createAccountRequestOwner } from './accountRequestOwner'
import { activeAccountBilling } from '../../core/accounts/requestWriter'
import type { AccountRequestPort } from '../../core/accounts/requestWriter'
import type { ProviderClient } from '../../core/backends/modelapi/client'
import { randomBytes } from 'node:crypto'
// One AccountStore serves terminal metadata, ACP sessions and headless runs.
// The existing pool owns per-attempt selection. Credentials remain in the OS
// store; durable claims retain original-account liability and fixed shared
// budget scopes. Profiles and the vault remain their named owning lanes.
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
import {
  createAccountPlacements,
  localPlacementDeviceMatcher,
  localPlacementId,
} from '../../core/accounts/placement'
import type { AccountPlacements } from '../../core/team/remotePool'
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

export interface AccountServicesSettings {
  readonly isSwapOn: boolean
  readonly isParallelOn: boolean
  /** D88 b2: several accounts of one provider on this machine (off until X4 restores the read). */
  readonly severalOnThisDevice: boolean
}

export type RuntimeAccountServicesInput = {
  readonly settings?: (() => AccountServicesSettings) | undefined
  /** Placement devices; absent reads as this client alone plus profile devices. */
  readonly devices?: { localId: string; isKnownDevice: (id: string) => boolean } | undefined
  readonly askPolicy?: Parameters<typeof createAccountRequestOwner>[0]['askPolicy']
  readonly onNotice?: Parameters<typeof createAccountRequestOwner>[0]['publish']
  readonly dataDir: string
  readonly registerSecret?: AccountSecretsDeps['registerSecret']
  readonly now?: () => number
} & (
  | { readonly openEntry: KeyringEntryFactory; readonly secrets?: undefined }
  | { readonly secrets: SecretStore; readonly openEntry?: undefined }
)

export interface RuntimeAccountServices {
  readonly store: AccountStore
  readonly metadata: AccountsMetadataPort
  /** D88 placement (a): the one pin owner for this profile. */
  readonly placements: AccountPlacements
  readonly commands: Omit<AccountsCommandDeps, 'print' | 'printError'>
  readonly exec: ExecAccountsPort
  requests(
    client: ProviderClient,
    options?: { account: string; isInteractive: boolean; hasPoolFlag: boolean },
  ): Promise<AccountRequestPort>
  billing: typeof activeAccountBilling
  confirmations(
    provider: string,
  ): Promise<Awaited<ReturnType<typeof createAccountRequestOwner>>['confirmations']>
  hold(isHeld: boolean): void
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
    private readonly owner: () => ReturnType<typeof createAccountRequestOwner>,
    private readonly settings: () => AccountServicesSettings,
  ) {}

  private async snapshot(sessionId: string): ReturnType<AccountsSessionPort['read']> {
    const accounts = await this.store.list(this.provider)
    const owner = await this.owner()
    const selected = owner.pool.current('conversation', sessionId) ?? this.account
    const current = accounts.some((row) => row.id === selected) ? selected : null
    const { isSwapOn, isParallelOn } = this.settings()
    return {
      type: 'accounts/state',
      provider: this.provider,
      accounts,
      currentAccount: current,
      isSwapOn,
      isParallelOn,
    }
  }

  private async publishAll(): Promise<void> {
    for (const [key, group] of this.listeners) {
      if (!key.startsWith(`${this.provider} `)) continue
      const state = await this.snapshot(key.slice(`${this.provider} `.length))
      for (const listener of group) listener(state)
    }
  }

  public get supportsNextRequestSelection(): boolean {
    return ACCOUNT_REQUEST_CERTIFICATION.isComplete
  }

  public usageUrl(): string {
    // No vendor usage-page source is bundled; the research that certifies the
    // policy record holds terms pages, not dashboards. Callers keep the
    // notice without a link rather than guess one.
    throw new Error(UI_TEXT.accounts.unavailable)
  }

  public async read(sessionId: string): ReturnType<AccountsSessionPort['read']> {
    try {
      return await this.snapshot(sessionId)
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
    canCommit: () => boolean,
  ): ReturnType<AccountsSessionPort['use']> {
    const owner = await this.owner()
    await owner.refresh()
    const entry = await this.store.list(this.provider)
    if (entry.every((row) => row.id !== account)) throw new Error(UI_TEXT.accounts.invalidAccount)
    if (!ACCOUNT_REQUEST_CERTIFICATION.isComplete) {
      const state = await this.snapshot(sessionId)
      if (state.currentAccount === account) return state
      // No current account (it was removed): there is nothing to stay on,
      // so the stay-put sentence would name a gone account as current.
      if (state.currentAccount === null) throw new Error(UI_TEXT.accounts.unavailable)
      throw new AccountSwitchRefusedError(
        this.provider,
        state.accounts.find((row) => row.id === state.currentAccount)?.label ??
          state.currentAccount,
      )
    }
    owner.pool.useNext('conversation', sessionId, account, canCommit)
    const state = await this.snapshot(sessionId)
    const listeners = this.listeners.get(`${this.provider} ${sessionId}`) ?? []
    for (const listener of listeners) listener(state)
    return state
  }

  public notice(sessionId: string, event: Parameters<SessionListener>[0]): void {
    const listeners = this.listeners.get(`${this.provider} ${sessionId}`) ?? []
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        /* Publication already committed; observers cannot undo it. */
      }
    }
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
    private readonly published: (provider: string) => Promise<void>,
    placement?: ConstructorParameters<typeof AccountStore>[2],
  ) {
    super(metadata, credentials, placement)
  }

  public override async pin(provider: string, account: string, device: string): Promise<void> {
    await super.pin(provider, account, device)
    await this.published(provider)
  }

  public override async add(provider: string, value: Account): Promise<symbol> {
    const token = await super.add(provider, value)
    await this.published(provider)
    return token
  }

  public override async update(provider: string, value: Account): Promise<void> {
    await super.update(provider, value)
    await this.published(provider)
  }

  public override async order(provider: string, ids: readonly string[]): Promise<void> {
    await super.order(provider, ids)
    await this.published(provider)
  }

  public override async thresholds(
    provider: string,
    account: string,
    value: AccountThresholds,
  ): Promise<void> {
    await super.thresholds(provider, account, value)
    await this.published(provider)
  }

  public override async setCredential(
    provider: string,
    account: string,
    value: Parameters<AccountStore['setCredential']>[2],
  ): Promise<void> {
    await super.setCredential(provider, account, value)
    await this.published(provider)
  }

  public override async remove(
    provider: string,
    account: string,
    addition?: symbol,
  ): Promise<void> {
    await super.remove(provider, account, addition)
    await this.published(provider)
  }
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
    ...(metadata.readNow !== undefined && {
      readNow: (provider: string) => {
        try {
          return metadata.readNow?.(provider)
        } catch (error: unknown) {
          if (!isInvalidProvidersFileError(error)) throw error
          const refusal = new AccountStoreError('invalidProvidersFile')
          refusal.message = UI_TEXT.accounts.providersInvalid
          throw refusal
        }
      },
    }),
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
  const settings: () => AccountServicesSettings =
    input.settings ??
    (() => ({
      isSwapOn: SETTING_DEFAULTS.accountSwap,
      isParallelOn: SETTING_DEFAULTS.accountParallel,
      severalOnThisDevice: SETTING_DEFAULTS['accounts.severalOnThisDevice'],
    }))
  let isHeld = false
  const files = fileAccountsMetadata(input.dataDir)
  const metadata = withProvidersFileRefusal(files)
  const localDevice = input.devices?.localId ?? localPlacementId(input.dataDir)
  const isKnownDevice = input.devices?.isKnownDevice ?? localPlacementDeviceMatcher(localDevice)
  const placement = {
    localDevice: () => localDevice,
    isOnePerDevice: () => !settings().severalOnThisDevice,
  }
  const credentials = new AccountSecrets({
    vault: secretStorageAccountVault(
      input.openEntry === undefined ? input.secrets : keyringSecretStore(input.openEntry),
    ),
    revokeSignIn: runtimeRevokeSignIn,
    registerSecret: input.registerSecret,
  })
  const sessionsByProvider = new Map<string, RuntimeAccountSessions>()
  const publish = async (provider: string): Promise<void> => {
    const held = owners.get(provider)
    if (held !== undefined) {
      const live = await held
      await live.refresh()
    }
    for (const [key, port] of sessionsByProvider) {
      if (key.startsWith(`${provider} `)) port.publish()
    }
  }
  const store = new PublishingAccountStore(metadata, credentials, publish, placement)
  const placements = createAccountPlacements({
    store,
    metadata,
    listProviders: () => files.listProviders(),
    localDevice,
    isKnownDevice,
    isOnePerDevice: placement.isOnePerDevice,
  })
  const owners = new Map<string, ReturnType<typeof createAccountRequestOwner>>()
  const owner = (provider: string) => {
    let created = owners.get(provider)
    if (created === undefined) {
      created = createAccountRequestOwner({
        provider,
        store,
        metadata,
        directory: input.dataDir,
        now: input.now ?? Date.now,
        settings,
        isHeld: () => isHeld || !ACCOUNT_REQUEST_CERTIFICATION.isComplete,
        askPolicy: input.askPolicy,
        publish: (sessionId, event, accounts) => {
          for (const [key, port] of sessionsByProvider)
            if (key.startsWith(`${provider} `)) port.notice(sessionId, event)
          try {
            input.onNotice?.(sessionId, event, accounts)
          } catch {
            /* Committed notices cannot roll back admission. */
          }
        },
      })
      owners.set(provider, created)
      void created.catch(() => {
        if (owners.get(provider) === created) owners.delete(provider)
      })
    }
    return created
  }
  const requests: RuntimeAccountServices['requests'] = async (client, options) => {
    if (!ACCOUNT_REQUEST_CERTIFICATION.isComplete) throw new Error(UI_TEXT.accounts.poolUnavailable)
    const live = await owner('meta')
    return live.requests(
      client,
      options ?? { account: ACCOUNT_DEFAULT_ID, isInteractive: true, hasPoolFlag: false },
    )
  }
  const sessions = (provider: string, account = ACCOUNT_DEFAULT_ID): AccountsSessionPort => {
    const key = `${provider} ${account}`
    let port = sessionsByProvider.get(key)
    if (port === undefined) {
      port = new RuntimeAccountSessions(store, provider, account, () => owner(provider), settings)
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
    resources: base.files.resources(),
    checkAccount: base.checkAccount,
    confirm: base.confirm,
    changed: base.changed,
  })
  return {
    store,
    metadata,
    placements,
    commands: { accounts: store, metadata, placements },
    requests,
    billing: activeAccountBilling,
    confirmations: async (provider) => {
      const live = await owner(provider)
      return live.confirmations
    },
    hold: (value) => {
      isHeld = value
    },
    exec: {
      create: (deps, selection, createBackend) => {
        if (!ACCOUNT_REQUEST_CERTIFICATION.isComplete && selection.hasPoolFlag)
          throw new Error(UI_TEXT.accounts.poolUnavailable)
        // The initial account supplies the original run budget identity;
        // every native Meta request then takes the installed pooled lease.
        if (
          (deps.options.backend !== 'modelApi' || deps.exec?.providerRun !== undefined) &&
          selection.hasPoolFlag
        )
          throw new Error(UI_TEXT.accounts.poolUnavailable)
        return {
          runtime: createBackend({
            ...deps,
            secrets: secretsFor('meta', selection.account, deps.secrets),
            // The account the run bills; its headless paid policy still decides.
            billingAccount: selection.account,
            accountRequests: (client) => requests(client, selection),
            accountBilling: activeAccountBilling,
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
      isHeld = true
      credentials.dispose()
    },
  }
}
