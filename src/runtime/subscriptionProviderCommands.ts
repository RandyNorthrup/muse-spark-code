// One runner for the terminal subscription commands (`providers
// add|remove|status <id>`) and the ACP auth methods: ChatGPT and Grok
// differ only in their binding (host, sign-in, catalogue, entry, text
// and failure sentences). Command behavior is identical: announce the
// sign-in, refuse when a grant already exists, sign in, commit the
// providers-file entry atomically, roll the sign-in back where the
// commit fails, and say every failure in its own sentence. The composed
// subscription client serves every plan leg from the same grants.
import path from 'node:path'
import type { SignInMethod } from '../acp/agent'
import type { ProviderClient } from '../core/backends/modelapi/client'
import type { ProviderEntry, ProvidersFile } from '../core/providers/providersFile'
import { providersFile, modelRef } from '../host/backend/providersEntry'
const { emptyProvidersFile, readProvidersFile, writeProvidersFileAtomic } = providersFile
const { parseModelRef } = modelRef
import { createRuntimeChatGptHost, type RuntimeChatGptOptions } from './chatGptHost'
import { createRuntimeGrokHost } from './grokHost'
import { ChatGptSignIn } from '../core/providers/subscriptions/chatgpt'
import type { ChatGptHostPort } from '../core/providers/subscriptions/chatgpt'
import { GrokSignIn } from '../core/providers/subscriptions/grok'
import type { GrokHostPort } from '../core/providers/subscriptions/grok'
import {
  createSubscriptionClient,
  chatGptAccountId,
  grokAccountId,
} from '../core/providers/subscriptions/registry'
import { providersFileUnreadable } from '../core/accountStoreError'
import { ACP_AGENT_NAME, PROVIDER_SECRET_PREFIX, SECRET_KEYS, UI_TEXT } from '../shared/constants'
import { fill, setUiText, uiLocale } from '../shared/l10n/text'

export type SubscriptionLocalStatus = 'signed-in' | 'expired' | 'signed-out'

/** Translated command text; failure codes never contain service text. */
export interface SubscriptionCommandText {
  beforeSignIn(isDeviceFlow: boolean): string
  alreadyAdded(): string
  status(state: SubscriptionLocalStatus): string
}

/** The per-call OAuth client configuration. ChatGPT ignores it: its issued client lives in its registration. */
export interface SubscriptionCommandClient {
  readonly clientId: string | undefined
  readonly scopes: string | undefined
}

/** The host surface the runner drives; both ports satisfy it. */
export interface SubscriptionCommandHost {
  readonly fetch: typeof fetch
  readRecord(): Promise<unknown>
  withRefreshLock<T>(work: () => Promise<T>): Promise<T>
}

export interface SubscriptionCommandBinding<Host extends SubscriptionCommandHost, SignIn> {
  readonly id: 'chatgpt' | 'grok'
  createHost(client: SubscriptionCommandClient): Host | Promise<Host>
  /** The sign-in over the runner's held lock; the lock is not re-entered. */
  createSignIn(host: Host): SignIn
  signIn(signIn: SignIn, options: { isNewAccount: boolean; isDeviceFlow: boolean }): Promise<void>
  remove(signIn: SignIn): Promise<void>
  readState(host: Host): Promise<SubscriptionLocalStatus>
  catalog(signIn: SignIn): Promise<readonly string[]>
  entry(models: readonly string[]): ProviderEntry
  fileError(kind: 'unreadable' | 'unwritable', reason: string): Error
  alreadyAdded(): Error
  readonly text: SubscriptionCommandText
  /** The failure's own sentence; foreign errors read as their own codes. */
  failureText(error: unknown): string
}

export interface SubscriptionCommandFile {
  read(): Promise<ProvidersFile>
  save(file: unknown): Promise<void>
}

/** The providers file with this provider's typed refusals. */
export function subscriptionCommandFile(
  configFile: string,
  fileError: (kind: 'unreadable' | 'unwritable', reason: string) => Error,
): SubscriptionCommandFile {
  const read = async (): Promise<ProvidersFile> => {
    const result = await readProvidersFile(configFile)
    if (result.ok) return result.file
    if (result.reason === 'missing') return emptyProvidersFile()
    throw fileError('unreadable', result.reason)
  }
  const save = async (file: unknown): Promise<void> => {
    const result = await writeProvidersFileAtomic(configFile, file)
    if (!result.ok) throw fileError('unwritable', result.reason)
  }
  return { read, save }
}

export interface SubscriptionCommandIo {
  readonly file: SubscriptionCommandFile
  print(line: string): void
  /** The failure reporting channel (stderr on the terminal). */
  error(line: string): void
}

export interface SubscriptionCommandDepsOptions {
  readonly uiText: typeof UI_TEXT
  readonly locale: string
  readonly configFile: string
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
}

export interface SubscriptionCommandDeps<Host extends SubscriptionCommandHost, SignIn> {
  readonly io: SubscriptionCommandIo
  readonly binding: SubscriptionCommandBinding<Host, SignIn>
}

/** Production terminal and ACP composition, using the shared atomic nonsecret file. */
export function subscriptionCommandDeps<Host extends SubscriptionCommandHost, SignIn>(
  options: SubscriptionCommandDepsOptions,
  binding: SubscriptionCommandBinding<Host, SignIn>,
): SubscriptionCommandDeps<Host, SignIn> {
  setUiText(options.uiText, options.locale)
  return {
    io: {
      file: subscriptionCommandFile(options.configFile, (kind, reason) =>
        binding.fileError(kind, reason),
      ),
      print: options.print,
      error: options.printError,
    },
    binding,
  }
}

export type SubscriptionProviderAction = 'add' | 'remove' | 'status'

export async function runSubscriptionProviderCommand<Host extends SubscriptionCommandHost, SignIn>(
  action: SubscriptionProviderAction,
  io: SubscriptionCommandIo,
  binding: SubscriptionCommandBinding<Host, SignIn>,
  options?: {
    readonly isNewAccount?: boolean
    readonly isDeviceFlow?: boolean
    readonly client?: SubscriptionCommandClient
  },
): Promise<number> {
  const isDeviceFlow = options?.isDeviceFlow ?? false
  try {
    if (action === 'add') io.print(binding.text.beforeSignIn(isDeviceFlow))
    const host = await binding.createHost(
      options?.client ?? { clientId: undefined, scopes: undefined },
    )
    if (action === 'status') {
      const state = await host.withRefreshLock(() => binding.readState(host))
      io.print(binding.text.status(state))
      return state === 'signed-out' ? 1 : 0
    }
    return await host.withRefreshLock(async () => {
      const signIn = binding.createSignIn(host)
      if (action === 'remove') {
        try {
          await binding.remove(signIn)
        } finally {
          const file = await io.file.read()
          const { defaultModel, ...rest } = file
          await io.file.save({
            ...rest,
            ...(defaultModel !== undefined &&
              parseModelRef(defaultModel)?.providerId !== binding.id && { defaultModel }),
            providers: file.providers.filter((entry) => entry.id !== binding.id),
          })
        }
        io.print(fill(UI_TEXT.acpProviderRemoved, { id: binding.id }))
        return 0
      }
      // Never overwrite an unrevoked grant, including an expired one.
      if ((await host.readRecord()) !== undefined) {
        io.error(binding.text.alreadyAdded())
        return 1
      }
      await binding.signIn(signIn, {
        isNewAccount: options?.isNewAccount ?? false,
        isDeviceFlow,
      })
      try {
        const file = await io.file.read()
        if (file.providers.some((entry) => entry.id === binding.id)) throw binding.alreadyAdded()
        // The plan's own catalogue, read the way every surface reads it,
        // so a refused, unreadable or empty list names its cause. The
        // command already holds the nonreentrant grant lock through this
        // commit.
        const models = await binding.catalog(signIn)
        await io.file.save({
          ...file,
          providers: [...file.providers, binding.entry(models)],
        })
      } catch (error) {
        // Best-effort revocation after a failed setup: the setup failure
        // dominates, so a revoke failure is attempted and dropped, never
        // replacing the cause.
        try {
          await binding.remove(signIn)
        } catch {
          /* The failed setup still fails; revocation attempted and the local record deleted. */
        }
        throw error
      }
      io.print(fill(UI_TEXT.acpProviderAdded, { id: binding.id }))
      return 0
    })
  } catch (error) {
    io.error(binding.failureText(error))
    return 1
  }
}

export interface SubscriptionAuthAction {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly args: readonly string[]
  readonly kind: 'add' | 'remove' | 'status'
  /** Re-read the pre-command grant: a baselined add must change it. */
  readonly baseline?: boolean
}

export interface SubscriptionAuthBinding<Host extends SubscriptionCommandHost> {
  createHost(): Host | Promise<Host>
  readonly actions: readonly SubscriptionAuthAction[]
  /** Throw the unreadable-grant failure where the stored record is not a grant. */
  checkRecord(stored: unknown): void
  /** The stored grant's account identity for baselined adds. */
  grantIdentity(record: unknown): string | undefined
  missing(): Error
  present(): Error
  unchanged(): Error
  failureText(error: unknown): string
}

/** ACP terminal auth methods run the exact same CLI actions in every editor. */
export function subscriptionAuthenticationMethods<Host extends SubscriptionCommandHost>(
  binding: SubscriptionAuthBinding<Host>,
): SignInMethod[] {
  // The grant as it was before the editor runs the terminal command (these
  // methods are built when the agent starts, the command runs later in its
  // own process). A baselined add must change it: the refused command
  // leaves the old grant, so an unchanged grant stays failed instead of
  // reporting the different-account authentication as succeeded.
  const baselineRecord = (async (): Promise<unknown> => {
    const host = await binding.createHost()
    return await host.withRefreshLock(async () => await host.readRecord())
  })()
  // A startup host, lock or store failure must surface through `verify`,
  // never as an unhandled rejection that ends the standalone agent before
  // any verifier runs: this marks the rejection handled while each `await`
  // below still observes it.
  void baselineRecord.then(undefined, () => {
    /* Marked handled; `verify` observes the rejection through `await`. */
  })
  return binding.actions.map((action) => ({
    id: action.id,
    name: action.name,
    description: action.description,
    args: action.args,
    command: `${ACP_AGENT_NAME} ${action.args.join(' ')}`,
    verify: async () => {
      try {
        const host = await binding.createHost()
        // Inside the try so a baseline the store cannot read fails closed
        // through the same sentence mapping, never as a success.
        const prior = action.baseline === true ? await baselineRecord : undefined
        await host.withRefreshLock(async () => {
          const stored = await host.readRecord()
          if (stored === undefined) {
            if (action.kind === 'add') throw binding.missing()
            return
          }
          binding.checkRecord(stored)
          // An expired access token refreshes on use (as `status` says), so
          // a stored grant is a completed sign-in.
          if (action.kind === 'remove') throw binding.present()
          if (
            action.baseline === true &&
            binding.grantIdentity(prior) === binding.grantIdentity(stored)
          ) {
            // The grant never changed: the command refused with
            // `already-added` and the account is still the old one.
            throw binding.unchanged()
          }
        })
        return
      } catch (error) {
        return binding.failureText(error)
      }
    },
  }))
}

/** The same registry serves JetBrains, Visual Studio, Eclipse and every ACP client. */
export function runtimeSubscriptionClient(
  options: RuntimeChatGptOptions & { readonly configFile: string; readonly catalogFile?: string },
) {
  let chatGptHost: Promise<ChatGptHostPort> | undefined
  const getChatGptHost = () =>
    (chatGptHost ??= (async () => {
      try {
        return await createRuntimeChatGptHost(options)
      } catch (error) {
        chatGptHost = undefined
        throw error
      }
    })())
  // Promise-shaped like the ChatGPT host factory above, so the leg awaits
  // the same way; building the host itself is synchronous.
  const getGrokHost = (): Promise<GrokHostPort> =>
    Promise.resolve(
      createRuntimeGrokHost({
        secrets: options.secrets,
        fetch: options.fetch,
        // A session never signs in: the terminal command does (`providers
        // add grok`). Refresh reads the client id from the stored grant.
        clientId: undefined,
        scopes: undefined,
        openBrowser: options.openBrowser,
        callbackText: options.callbackText,
        ...(options.signal !== undefined && { signal: options.signal }),
        ...(options.lock !== undefined && { lock: options.lock }),
      }),
    )
  const accountId = async () => {
    const chatGptStored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
    if (chatGptStored !== undefined) return chatGptAccountId(chatGptStored)
    const grokStored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}grok`)
    if (grokStored !== undefined) return grokAccountId(grokStored)
    const entry = await import('../host/backend/configuredProvidersEntry')
    entry.setUiText(UI_TEXT, uiLocale())
    return await entry
      .createConfiguredProviderServices(undefined, {
        configFile: options.configFile,
        catalogFile: options.catalogFile ?? path.resolve(__dirname, 'providerCatalog.json'),
        secrets: options.secrets,
      })
      .accountId()
  }
  return {
    accountId,
    createClient: async (meta: ProviderClient): Promise<ProviderClient> => {
      const read = async () => {
        const result = await readProvidersFile(options.configFile)
        if (result.ok) return result.file
        if (result.reason === 'missing') return emptyProvidersFile()
        // A session reads its cause here, not through the command layer:
        // the file's own fault in the refusal the editor boundary names.
        throw providersFileUnreadable(result.reason)
      }
      const file = await read()
      const subscribed = file.providers.some(
        (entry) => entry.id === 'chatgpt' || entry.id === 'grok',
      )
        ? createSubscriptionClient(meta, {
            fetch: options.fetch,
            hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
            providers: read,
            accountId,
            chatgpt: async () => new ChatGptSignIn(await getChatGptHost()),
            grok: async () => new GrokSignIn(await getGrokHost()),
          })
        : meta
      if (file.providers.every((entry) => entry.auth === 'subscription')) return subscribed
      const entry = await import('../host/backend/configuredProvidersEntry')
      entry.setUiText(UI_TEXT, uiLocale())
      return entry.createConfiguredProviderServices(subscribed, {
        configFile: options.configFile,
        catalogFile: options.catalogFile ?? path.resolve(__dirname, 'providerCatalog.json'),
        secrets: options.secrets,
        hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
      }).client
    },
  }
}
