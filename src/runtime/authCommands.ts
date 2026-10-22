// The sign-in commands an editor's terminal sign-in runs (PLAN.md D61,
// D62): `auth set|status|clear` for the Model API key in the OS credential
// store, and `login` for Muse Code's own sign-in. Each returns the process
// exit code. Nothing here prints the key or any part of it.

import type { LaunchResolution } from '../core/backends/musecode/launch'
import type { GuardedChildEnv } from '../core/executables'
import { isValidModelApiKey, type SecretStore } from '../host/auth/credentialStore'
import type { ProvidersFileRead } from '../core/providers/providersFile'
import { distinctProviderLabels } from '../shared/providerLabels'
import {
  CREDENTIAL_RECORD_VERSION,
  type GITHUB_AUTH_ACTIONS,
  MUSE_LOGIN_ARGS,
  SECRET_KEYS,
  UI_TEXT,
} from '../shared/constants'
import { fill, uiLocale } from '../shared/l10n/text'
import { signInFailureText } from '../core/git/deviceFlow'
import type { DeviceFlowSource } from './github/deviceFlowSource'
import { providerKeyFailureText } from './exec/keyInput'
import { isNonTextStdin } from './hiddenInput'
import {
  formatStoredProviderSecret,
  isStoreUnavailable,
  parseStoredProviderSecret,
  providerSecretAccount,
} from './keyStore'

export interface AuthCommandDeps {
  readonly secrets: SecretStore
  /** Where the key lives, as the user knows it (`credentialStoreName`). */
  readonly storeName: string
  /** One line from the user, not echoed when it comes from a terminal. */
  readonly readSecret: (prompt: string) => Promise<string>
  /**
  Whether to use a key that looks like the wrong thing (a URL, a path,
  placeholder text, inner whitespace). A pipe cannot answer, so it names
  the value and proceeds; a terminal asks and waits for the answer.
  */
  readonly confirmKeyUse: (message: string) => Promise<boolean>
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
}

const EXIT_OK = 0
const EXIT_FAILED = 1

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailable(deps: Pick<AuthCommandDeps, 'printError'>, error: unknown): number {
  deps.printError(
    isStoreUnavailable(error)
      ? UI_TEXT.acpStoreDown
      : fill(UI_TEXT.acpStoreUnavailable, { reason: describe(error) }),
  )
  return EXIT_FAILED
}

export async function authSet(deps: AuthCommandDeps): Promise<number> {
  let typed: string
  try {
    typed = await deps.readSecret(UI_TEXT.acpKeyPrompt)
  } catch (error: unknown) {
    // Non-text stdin is not a valid Model API key either; the sentence is
    // the one this command already shows for that input.
    if (isNonTextStdin(error)) {
      deps.printError(UI_TEXT.apiKeyInvalid)
      return EXIT_FAILED
    }
    throw error
  }
  const candidate = typed.trim()
  if (candidate === '') {
    deps.printError(UI_TEXT.acpKeyNotStored)
    return EXIT_FAILED
  }
  if (!isValidModelApiKey(candidate)) {
    deps.printError(UI_TEXT.apiKeyInvalid)
    return EXIT_FAILED
  }
  try {
    await deps.secrets.store(SECRET_KEYS.modelApiKey, candidate)
  } catch (error: unknown) {
    return unavailable(deps, error)
  }
  deps.print(fill(UI_TEXT.acpKeyStored, { store: deps.storeName }))
  return EXIT_OK
}

function storeDown(deps: AuthCommandDeps, error: unknown): number | undefined {
  // A failed read cannot establish whether the store contains a key.
  if (isStoreUnavailable(error)) {
    deps.print(UI_TEXT.acpStoreDown)
    return EXIT_FAILED
  }
  return undefined
}

/**
D6: bare `auth status` answers every credential, not only the Meta key.
Exits 0 when any key is stored (Meta or provider), 1 when none is or the
store cannot be read. A missing providers file is the first-run state.
*/
export async function authStatusAll(
  deps: AuthCommandDeps,
  readUserFile: () => Promise<ProvidersFileRead>,
): Promise<number> {
  let stored: string | undefined
  try {
    stored = await deps.secrets.get(SECRET_KEYS.modelApiKey)
  } catch (error: unknown) {
    return storeDown(deps, error) ?? unavailable(deps, error)
  }
  const hasMetaKey = stored !== undefined && stored !== ''
  deps.print(
    hasMetaKey ? fill(UI_TEXT.acpKeyPresent, { store: deps.storeName }) : UI_TEXT.acpKeyAbsent,
  )
  const read = await readUserFile()
  if (!read.ok && read.reason !== 'missing') {
    deps.printError(read.detail)
    return EXIT_FAILED
  }
  const entries = read.ok ? read.file.providers : []
  // Two providers can carry one preset's label (two Anthropic keys): the
  // lines then tell them apart by id, as the Models panel does.
  const named: { id: string; label: string }[] = []
  for (const entry of entries)
    named.push({ id: entry.id, label: await providerLabel(read, entry.id) })
  const labels = new Map(distinctProviderLabels(named).map((row) => [row.id, row.label]))
  const labelFor = (id: string): string => labels.get(id) ?? id
  let hasAnyKey = hasMetaKey
  let hasFailure = false
  for (const entry of entries) {
    const account = providerSecretAccount(entry.id)
    let value: string | undefined
    try {
      value = account === undefined ? undefined : await deps.secrets.get(account)
    } catch (error: unknown) {
      return unavailable(deps, error)
    }
    const label = labelFor(entry.id)
    if (value === undefined || value === '') {
      // One truth from both (RLTESTDRIVE item 7): a ChatGPT entry with
      // no stored grant reads as not signed in, as `providers status
      // chatgpt` says, not as a missing API key.
      if (entry.id === 'chatgpt') deps.print(UI_TEXT.acpChatGpt.states['signed-out'])
      else deps.print(fill(UI_TEXT.providerKeyAbsent, { provider: label }))
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      // Only malformed text fails here; anything else is not this parse's answer.
      if (!(error instanceof SyntaxError)) throw error
      parsed = undefined
    }
    const record = parsed === undefined ? undefined : parseStoredProviderSecret(parsed)
    if (record === undefined && entry.id === 'chatgpt') {
      // A ChatGPT sign-in is a subscription grant, not an API-key
      // envelope: read it as the grant, with `providers status chatgpt`'s
      // verdict and remedy, through the subscriptions entry (D207).
      const { chatGptGrantStatus, chatGptRecordSchema } =
        await import('../host/backend/subscriptionsEntry')
      const grant = chatGptRecordSchema.safeParse(parsed)
      if (!grant.success) {
        deps.printError(UI_TEXT.acpChatGpt.grantUnreadable)
        hasFailure = true
        continue
      }
      deps.print(UI_TEXT.acpChatGpt.states[chatGptGrantStatus(grant.data, Date.now())])
      hasAnyKey = true
      continue
    }
    if (record === undefined) {
      deps.printError(fill(UI_TEXT.providerSecretUnreadable, { provider: label }))
      hasFailure = true
      continue
    }
    hasAnyKey = true
    deps.print(
      fill(UI_TEXT.providerKeyPresent, {
        provider: label,
        store: deps.storeName,
        origin: record.record.origin,
      }),
    )
  }
  return hasFailure || !hasAnyKey ? EXIT_FAILED : EXIT_OK
}

/** D6: the stored-key sentence names the provider's label, never its bare id. */
async function providerLabel(
  read: ProvidersFileRead | undefined,
  providerId: string,
): Promise<string> {
  if (read?.ok !== true) return providerId
  const entry = read.file.providers.find((candidate) => candidate.id === providerId)
  if (entry === undefined) return providerId
  // D6: presets load only in the providers bundle; the split gate forbids
  // carrying them in any other entry.
  const { presets } = await import('../host/backend/providersEntry')
  return presets.presetById(entry.preset)?.label ?? providerId
}

export async function authClear(deps: AuthCommandDeps): Promise<number> {
  try {
    await deps.secrets.delete(SECRET_KEYS.modelApiKey)
  } catch (error: unknown) {
    return unavailable(deps, error)
  }
  deps.print(UI_TEXT.acpKeyCleared)
  return EXIT_OK
}

/**
`auth set --provider <id>`: the key comes from standard input only (the
reader hides terminal typing and takes a pipe's first line), is never
refused for its shape (the provider judges it), and is stored bound to
the exact origin it was entered for. Never an argument, a setting, a
file or the environment.
*/
export async function authSetProvider(
  deps: AuthCommandDeps,
  providerId: string,
  /** The runner's own user file (never a repository file). */
  readUserFile: () => Promise<ProvidersFileRead>,
): Promise<number> {
  const { keyTargetFor } = await import('./providersCommands')
  const target = await keyTargetFor(readUserFile, providerId)
  if (!target.ok) {
    deps.printError(target.reason)
    return EXIT_FAILED
  }
  const { preset, origin } = target
  if (preset.auth !== 'apiKey') {
    deps.printError(fill(UI_TEXT.providerNotConfigured, { provider: providerId }))
    return EXIT_FAILED
  }
  const { presets, setUiText } = await import('../host/backend/providersEntry')
  // Any non-blank key is stored for the provider to judge; a value that
  // looks like the wrong thing is named first. A pipe cannot answer, so
  // the run continues; a "no" on a terminal asks for the key again, like
  // the panel's password box. The notice is formatted in the providers
  // bundle, which keeps its own installed language: install this
  // command's table before reading it.
  setUiText(UI_TEXT, uiLocale())
  let candidate: string
  for (;;) {
    let typed: string
    try {
      typed = await deps.readSecret(fill(UI_TEXT.providerKeyPrompt, { provider: providerId }))
    } catch (error: unknown) {
      if (isNonTextStdin(error)) {
        deps.printError(providerKeyFailureText('invalid'))
        return EXIT_FAILED
      }
      throw error
    }
    const key = typed.trim()
    if (key === '') {
      deps.printError(providerKeyFailureText('empty'))
      return EXIT_FAILED
    }
    const inspection = presets.inspectProviderKey(key)
    if (
      inspection === 'ok' ||
      inspection === 'empty' ||
      (await deps.confirmKeyUse(presets.providerKeyNoticeText(inspection)))
    ) {
      candidate = key
      break
    }
  }
  const account = providerAccount(deps, providerId)
  if (account === undefined) return EXIT_FAILED
  try {
    await deps.secrets.store(
      account,
      formatStoredProviderSecret(
        { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin },
        candidate,
      ),
    )
  } catch (error: unknown) {
    return unavailable(deps, error)
  }
  deps.print(fill(UI_TEXT.providerKeyStored, { provider: providerId, store: deps.storeName }))
  return EXIT_OK
}

/** The validated account, with one consistent refusal for every auth command. */
function providerAccount(deps: AuthCommandDeps, providerId: string): string | undefined {
  const account = providerSecretAccount(providerId)
  if (account === undefined)
    deps.printError(fill(UI_TEXT.providerUnknown, { provider: providerId }))
  return account
}

/** `auth status --provider <id>`: the stored key's bound origin, never the key. */
export async function authStatusProvider(
  deps: AuthCommandDeps,
  providerId: string,
  readUserFile?: () => Promise<ProvidersFileRead>,
): Promise<number> {
  const account = providerAccount(deps, providerId)
  if (account === undefined) return EXIT_FAILED
  // D6: the stored-key sentence names the provider's label, never its bare id.
  let label = providerId
  if (readUserFile !== undefined) {
    try {
      label = await providerLabel(await readUserFile(), providerId)
    } catch {
      label = providerId
    }
  }
  let stored: string | undefined
  try {
    stored = await deps.secrets.get(account)
  } catch (error: unknown) {
    return storeDown(deps, error) ?? unavailable(deps, error)
  }
  if (stored === undefined || stored === '') {
    if (providerId === 'chatgpt') deps.print(UI_TEXT.acpChatGpt.states['signed-out'])
    else deps.print(fill(UI_TEXT.providerKeyAbsent, { provider: label }))
    return EXIT_FAILED
  }
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch (error) {
    // Only malformed text fails here; anything else is not this parse's answer.
    if (!(error instanceof SyntaxError)) throw error
    value = undefined
  }
  const parsed = value === undefined ? undefined : parseStoredProviderSecret(value)
  if (parsed === undefined && providerId === 'chatgpt') {
    // As the file loop above: a ChatGPT sign-in is a subscription
    // grant, read with `providers status chatgpt`'s verdict and remedy.
    const { chatGptGrantStatus, chatGptRecordSchema } =
      await import('../host/backend/subscriptionsEntry')
    const grant = chatGptRecordSchema.safeParse(value)
    if (!grant.success) {
      deps.printError(UI_TEXT.acpChatGpt.grantUnreadable)
      return EXIT_FAILED
    }
    // A stored grant is a completed sign-in even expired: its token
    // refreshes on use, as `providers status chatgpt` agrees (exit 0).
    deps.print(UI_TEXT.acpChatGpt.states[chatGptGrantStatus(grant.data, Date.now())])
    return EXIT_OK
  }
  if (parsed === undefined) {
    deps.printError(fill(UI_TEXT.providerSecretUnreadable, { provider: label }))
    return EXIT_FAILED
  }
  deps.print(
    fill(UI_TEXT.providerKeyPresent, {
      provider: label,
      store: deps.storeName,
      origin: parsed.record.origin,
    }),
  )
  return EXIT_OK
}

/** `auth clear --provider <id>`: removes the provider's secret. */
export async function authClearProvider(
  deps: AuthCommandDeps,
  providerId: string,
): Promise<number> {
  const account = providerAccount(deps, providerId)
  if (account === undefined) return EXIT_FAILED
  try {
    await deps.secrets.delete(account)
  } catch (error: unknown) {
    return unavailable(deps, error)
  }
  deps.print(fill(UI_TEXT.providerKeyCleared, { provider: providerId }))
  return EXIT_OK
}

/** The two events of a child process `login` waits for. */
export interface ExitingProcess {
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null) => void): unknown
}

export interface LoginDeps {
  readonly resolveLaunch: () => LaunchResolution
  /**
  The guarded serve environment for `cwd` below: only a guarded child
  environment flows into the login spawn.
  */
  readonly environment: () => GuardedChildEnv
  /**
  The directory the login child runs in: the same directory the
  environment is guarded for, so no workspace program resolves from PATH.
  */
  readonly cwd: string
  /** Governed launch with terminal streams forwarded after admission. */
  readonly spawnInTerminal: (
    command: string,
    args: readonly string[],
    env: GuardedChildEnv,
    cwd: string,
  ) => ExitingProcess | Promise<ExitingProcess>
  readonly printError: (line: string) => void
}

/** `muse login` in this terminal, run the way the agent runs `muse serve` (same CLI, same environment). */
export function login(deps: LoginDeps): Promise<number> {
  const resolution = deps.resolveLaunch()
  if (!resolution.ok) {
    deps.printError(
      `${resolution.reason} ${fill(UI_TEXT.cliSearched, { paths: resolution.searched.join(', ') })}`,
    )
    return Promise.resolve(EXIT_FAILED)
  }
  const { launch } = resolution
  const prefix = launch.args.slice(0, launch.args.length - launch.serveArgs.length)
  const child = deps.spawnInTerminal(
    launch.command,
    [...prefix, ...MUSE_LOGIN_ARGS],
    deps.environment(),
    deps.cwd,
  )
  const waitForExit = (process: ExitingProcess): Promise<number> =>
    new Promise((resolve) => {
      process.once('error', (error) => {
        deps.printError(describe(error))
        resolve(EXIT_FAILED)
      })
      process.once('exit', (code) => {
        resolve(code ?? EXIT_FAILED)
      })
    })
  const waitForLaunch = async (pending: Promise<ExitingProcess>) => await waitForExit(await pending)
  return child instanceof Promise ? waitForLaunch(child) : waitForExit(child)
}

export type GitHubAuthAction = (typeof GITHUB_AUTH_ACTIONS)[number]

export interface GitHubAuthDeps {
  readonly source: DeviceFlowSource
  /** Where the token lives, as the user knows it (`credentialStoreName`). */
  readonly storeName: string
  /** Ctrl+C. */
  readonly signal: AbortSignal
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
}

/**
`auth github login|logout|status` (M123, PLAN.md D104 source b): the
device flow in this terminal, its code printed here; the token goes only
into the credential store and is never printed.
*/
export async function authGitHub(action: GitHubAuthAction, deps: GitHubAuthDeps): Promise<number> {
  const text = UI_TEXT.githubSignIn
  try {
    switch (action) {
      case 'status': {
        const isSignedIn = await deps.source.isSignedIn()
        deps.print(isSignedIn ? fill(text.signedIn, { store: deps.storeName }) : text.notSignedIn)
        return isSignedIn ? EXIT_OK : EXIT_FAILED
      }
      case 'logout': {
        await deps.source.signOut()
        return EXIT_OK
      }
      case 'login': {
        const credential = await deps.source.credential('ask', deps.signal)
        if (credential === undefined) {
          deps.printError(text.notSignedIn)
          return EXIT_FAILED
        }
        deps.print(fill(text.signedIn, { store: deps.storeName }))
        return EXIT_OK
      }
    }
  } catch (error: unknown) {
    if (deps.signal.aborted) {
      deps.printError(text.cancelled)
      return EXIT_FAILED
    }
    const failure = signInFailureText(error)
    if (failure === undefined) return unavailable(deps, error)
    deps.printError(failure)
    return EXIT_FAILED
  }
}
