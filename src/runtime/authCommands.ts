// The sign-in commands an editor's terminal sign-in runs (PLAN.md D61,
// D62): `auth set|status|clear` for the Model API key in the OS credential
// store, and `login` for Muse Code's own sign-in. Each returns the process
// exit code. Nothing here prints the key or any part of it.

import type { LaunchResolution } from '../core/backends/musecode/launch'
import { isValidModelApiKey, type SecretStore } from '../host/auth/credentialStore'
import type { ProvidersFileRead } from '../core/providers/providersFile'
import {
  CREDENTIAL_RECORD_VERSION,
  MUSE_LOGIN_ARGS,
  SECRET_KEYS,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import {
  formatStoredProviderSecret,
  parseStoredProviderSecret,
  providerSecretAccount,
} from './keyStore'

export interface AuthCommandDeps {
  readonly secrets: SecretStore
  /** Where the key lives, as the user knows it (`credentialStoreName`). */
  readonly storeName: string
  /** One line from the user, not echoed when it comes from a terminal. */
  readonly readSecret: (prompt: string) => Promise<string>
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
}

const EXIT_OK = 0
const EXIT_FAILED = 1

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailable(deps: AuthCommandDeps, error: unknown): number {
  deps.printError(fill(UI_TEXT.acpStoreUnavailable, { reason: describe(error) }))
  return EXIT_FAILED
}

export async function authSet(deps: AuthCommandDeps): Promise<number> {
  const typed = await deps.readSecret(UI_TEXT.acpKeyPrompt)
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

/**
 * D6: bare `auth status` answers every credential, not only the Meta key.
 * Exits 0 when any key is stored (Meta or provider), 1 when none is or the
 * store cannot be read. A missing providers file is the first-run state.
 */
export async function authStatusAll(
  deps: AuthCommandDeps,
  readUserFile: () => Promise<ProvidersFileRead>,
): Promise<number> {
  let stored: string | undefined
  try {
    stored = await deps.secrets.get(SECRET_KEYS.modelApiKey)
  } catch (error: unknown) {
    return unavailable(deps, error)
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
    const label = await providerLabel(read, entry.id)
    if (value === undefined || value === '') {
      deps.print(fill(UI_TEXT.providerKeyAbsent, { provider: label }))
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = undefined
    }
    const record = parsed === undefined ? undefined : parseStoredProviderSecret(parsed)
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
 * `auth set --provider <id>`: the key comes from standard input only (the
 * reader hides terminal typing and takes a pipe's first line), is checked
 * against the preset's shape, and is stored bound to the exact origin it
 * was entered for. Never an argument, a setting, a file or the environment.
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
  const typed = await deps.readSecret(fill(UI_TEXT.providerKeyPrompt, { provider: providerId }))
  const candidate = typed.trim()
  if (candidate === '') {
    deps.printError(UI_TEXT.providerKeyNotStored)
    return EXIT_FAILED
  }
  const { presets } = await import('../host/backend/providersEntry')
  if (!presets.isKeyShape(preset.keyShape, candidate)) {
    deps.printError(
      fill(UI_TEXT.providerKeyShape, { provider: preset.label, hint: preset.keyHint }),
    )
    return EXIT_FAILED
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
    return unavailable(deps, error)
  }
  if (stored === undefined || stored === '') {
    deps.print(fill(UI_TEXT.providerKeyAbsent, { provider: label }))
    return EXIT_FAILED
  }
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    value = undefined
  }
  const parsed = value === undefined ? undefined : parseStoredProviderSecret(value)
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
  readonly environment: () => NodeJS.ProcessEnv
  /** Governed launch with terminal streams forwarded after admission. */
  readonly spawnInTerminal: (
    command: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
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
