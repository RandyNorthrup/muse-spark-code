// The ACP agent's provider commands (M95, PLAN.md D74): `providers
// list|add|test|remove` and the key target `auth … --provider <id>` uses.
// The terminal runs the same checks as the panel's wizard: the preset, the
// endpoint policy, the free key test (never the key's shape) and the ticked
// models, driven through lane P's pure `wizardFlow` state machine, so the
// rules cannot drift. The draft lives in memory only; the file and the
// secret are committed once the machine reaches `done`. Reported failures
// compensate the secret change; crash/rollback limits are recorded in PLAN §9.

import { mkdir, readFile } from 'node:fs/promises'
import * as z from 'zod/mini'
import path from 'node:path'
import {
  capabilities,
  credentialRecord,
  endpointPolicy,
  modelMetadata,
  presets,
  wizardFlow,
  providersFile,
  setUiText as setProvidersUiText,
} from '../host/backend/providersEntry'
import type { SecretStore } from '../host/auth/credentialStore'
import type { Logger } from '../host/logger'
import { failureForLog } from '../core/backends/musecode/logText'
const { isCredentialBound } = credentialRecord
const { checkEndpointUrl } = endpointPolicy
import type { TransportResponse } from '../core/backends/modelapi/transport'
import type { SpendEstimate } from '../core/providers/providerSpend'
import type { ProviderPreset } from '../core/providers/presets'
import { isConnectionFailure } from '../core/networkFailure'
const { azureOrigin, inspectProviderKey, providerKeyNoticeText, presetById } = presets
const { applyWizardEvent, startWizard, wizardBlockers, wizardSummary } = wizardFlow
import type {
  ProviderEntry,
  ProvidersFile,
  ProvidersFileRead,
} from '../core/providers/providersFile'
const { emptyProvidersFile, readProvidersFile, refusalDetail, writeProvidersFileAtomic } =
  providersFile
import {
  ACP_AGENT_NAME,
  CLI_EXIT,
  CREDENTIAL_RECORD_VERSION,
  HTTP_STATUS,
  UI_TEXT,
} from '../shared/constants'
import {
  freeProbeRefusal,
  listModelIds,
  providerListHeaders,
  readProviderJson,
} from './providerReads'
import { credentialLockDir } from '../core/credentialPaths'
import { fill, plural, uiLocale } from '../shared/l10n/text'
import { modelLimitsSchema } from '../shared/providerRouting'
import type { ProvidersAddOptions } from './cliArgs'
import { providerKeyFailureText } from './exec/keyInput'
import { isNonTextStdin } from './hiddenInput'
import {
  formatStoredProviderSecret,
  isStoreUnavailable,
  parseStoredProviderSecret,
  providerAdminSecretAccount,
  providerSecretAccount,
  StoreUnavailableError,
} from './keyStore'
import {
  diffLiveModels,
  isEndpointBindingCurrent,
  allowedProviderPaths,
  isModelUnpriced,
  parseCatalogPresence,
  pinProviderFetch,
  providerModelsPath,
  resolveProvider,
  type CatalogPresence,
  type ResolvedProvider,
} from './exec/providerExec'
// The panel's Refresh Models reads the live list through the commands.
export { listProviderModels } from './exec/providerList'

const EXIT_OK = 0
const EXIT_FAILED = 1

export { providersFilePath, resolveEndpointHost } from './providerPaths'

export interface ProvidersDeps {
  /** The runner's own user file (never a repository file). */
  readonly readUserFile: () => Promise<ProvidersFileRead>
  readonly writeUserFile: (file: ProvidersFile, expected: ProvidersFile) => Promise<boolean>
  /** Production serializes cooperating CLI commits across processes. */
  readonly withUserFileLock?: (operation: () => Promise<number>) => Promise<number>
  readonly secrets: SecretStore
  readonly resolveHost: (hostname: string) => Promise<readonly string[]>
  readonly fetch: typeof fetch
  /** One line from the user, not echoed when it comes from a terminal. */
  readonly readSecret: (prompt: string) => Promise<string>
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
  /**
  D4: the priced catalogue for runnable-model warnings. Absent (or
  unreadable) in tests: add/test/list skip the warnings, never fail.
  */
  readonly readCatalog?: () => Promise<unknown>
  /** The clock, injected so tests own the report period. */
  readonly now?: () => number
  /**
  Our own estimate for the period, from the usage journal (PROVSPEND).
  Undefined when the journal recorded no spend for the provider: the
  provider's figures are then shown alone, never against a zero. The
  reader never throws: a journal failure resolves undefined, recorded
  where it happens.
  */
  readonly readSpendEstimate?: (
    provider: string,
    startMs: number,
    endMs: number,
  ) => Promise<SpendEstimate | undefined>
}

/** The default production file IO over the user's own providers file. */
export function userFileIo(filePath: string): {
  readonly readUserFile: () => Promise<ProvidersFileRead>
  readonly writeUserFile: ProvidersDeps['writeUserFile']
  readonly withUserFileLock: NonNullable<ProvidersDeps['withUserFileLock']>
} {
  return {
    readUserFile: () => readProvidersFile(filePath),
    writeUserFile: async (file, expected) => {
      const current = fileOrError(await readProvidersFile(filePath))
      if ('reason' in current || JSON.stringify(current.file) !== JSON.stringify(expected))
        return false
      const written = await writeProvidersFileAtomic(filePath, file)
      return written.ok
    },
    withUserFileLock: async (operation) => {
      await mkdir(path.dirname(filePath), { recursive: true })
      // The shared dead-owner acquisition (the credential lease's bundle,
      // loaded on the first guarded write): a lock whose owner is proven
      // gone is reclaimed instead of failing with EEXIST on every later
      // command; a live owner's lock still refuses with the busy error its
      // callers already report.
      const { withCredentialLock } = await import('../core/credentialLeaseEntry')
      return await withCredentialLock(credentialLockDir(filePath), operation)
    },
  }
}

/**
The user file, or why it cannot be used. A missing file is the first-run
state (an empty file); anything else is reported, never defaulted.
*/
function fileOrError(
  read: ProvidersFileRead,
): { readonly file: ProvidersFile } | { readonly reason: string } {
  if (read.ok) {
    return { file: read.file }
  }
  return read.reason === 'missing'
    ? { file: emptyProvidersFile() }
    : { reason: refusalDetail(read) }
}

export function failed(deps: ProvidersDeps, line: string): number {
  deps.printError(line)
  return EXIT_FAILED
}

/** Read once and report a malformed user file consistently across commands. */
export async function commandFile(deps: ProvidersDeps): Promise<ProvidersFile | undefined> {
  const loaded = fileOrError(await deps.readUserFile())
  if ('reason' in loaded) {
    failed(deps, fill(UI_TEXT.providerTestFailed, { detail: loaded.reason }))
    return
  }
  return loaded.file
}

const providerUpdates = new WeakMap<ProvidersDeps['readUserFile'], Promise<void>>()

/** Serialize the commit, re-read after probing, and compensate a failed file write. */
export async function commitProviderChange(
  deps: ProvidersDeps,
  id: string,
  change: (file: ProvidersFile) => ProvidersFile | undefined,
  isRemoving: boolean,
  secret?: string,
  expectedSecret?: string,
): Promise<number> {
  const commit = async () => {
    const loaded = fileOrError(await deps.readUserFile())
    if ('reason' in loaded)
      return failed(deps, fill(UI_TEXT.providerSaveFailed, { reason: loaded.reason }))
    const next = change(loaded.file)
    if (next === undefined)
      return failed(
        deps,
        fill(isRemoving ? UI_TEXT.providerUnknown : UI_TEXT.providerAlreadyConfigured, {
          provider: id,
        }),
      )
    const account =
      isRemoving || secret !== undefined || expectedSecret !== undefined
        ? providerSecretAccount(id)
        : undefined
    // Removing the provider removes its admin report key too (PROVSPEND).
    const adminAccount = isRemoving ? providerAdminSecretAccount(id) : undefined
    const touched = [account, adminAccount].filter((entry) => entry !== undefined)
    const previous = new Map<string, string | undefined>()
    try {
      for (const entry of touched) previous.set(entry, await deps.secrets.get(entry))
    } catch (error: unknown) {
      // Only a store failure fails the save this way; anything else is
      // not this read's answer to give.
      if (!(error instanceof StoreUnavailableError)) throw error
      return failed(
        deps,
        fill(UI_TEXT.providerSaveFailed, { reason: UI_TEXT.providerSaveSecretFailed }),
      )
    }
    const previousSecret = account === undefined ? undefined : previous.get(account)
    if (expectedSecret !== undefined && previousSecret !== expectedSecret)
      return failed(deps, UI_TEXT.providerEditConflict)
    const canRestore = async () => {
      // A borrowed credential is never written or restored: another actor
      // may rotate/remove it even while a configuration write is failing.
      if (account === undefined || (!isRemoving && secret === undefined)) return true
      try {
        for (const entry of touched) {
          const value = previous.get(entry)
          if (value === undefined) await deps.secrets.delete(entry)
          else await deps.secrets.store(entry, value)
        }
        return true
      } catch (error: unknown) {
        // Only a store failure fails the rollback this way; anything else
        // is not this restore's answer to give.
        if (!(error instanceof StoreUnavailableError)) throw error
        return false
      }
    }
    try {
      if (account !== undefined) {
        if (isRemoving) {
          await deps.secrets.delete(account)
          if (adminAccount !== undefined) await deps.secrets.delete(adminAccount)
        } else if (secret !== undefined) await deps.secrets.store(account, secret)
      }
    } catch (error: unknown) {
      // A rejecting store may have changed its entry before reporting failure.
      // Only a store failure fails the save this way; anything else is not
      // this write's answer to give.
      if (!(error instanceof StoreUnavailableError)) throw error
      const wasRestored = await canRestore()
      return failed(
        deps,
        wasRestored
          ? fill(UI_TEXT.providerSaveFailed, { reason: UI_TEXT.providerSaveSecretFailed })
          : fill(UI_TEXT.providerSaveRecoveryFailed, { provider: id }),
      )
    }
    let wasWritten = false
    try {
      wasWritten = await deps.writeUserFile(next, loaded.file)
    } catch {
      /* A failed or conflicting write uses the same compensation. */
    }
    if (!wasWritten) {
      const wasRestored = await canRestore()
      return failed(
        deps,
        wasRestored
          ? fill(UI_TEXT.providerSaveFailed, { reason: UI_TEXT.providerSaveWriteConflict })
          : fill(UI_TEXT.providerSaveRecoveryFailed, { provider: id }),
      )
    }
    return EXIT_OK
  }
  const pending = providerUpdates.get(deps.readUserFile) ?? Promise.resolve()
  const result = (async () => {
    await pending
    return await (deps.withUserFileLock === undefined ? commit() : deps.withUserFileLock(commit))
  })()
  const tail = (async () => {
    try {
      await result
    } catch {
      // A failed commit still releases queued writers: the tail settles either way.
    }
  })()
  providerUpdates.set(deps.readUserFile, tail)
  try {
    return await result
  } catch {
    return failed(deps, fill(UI_TEXT.providerSaveFailed, { reason: UI_TEXT.providerSaveBusy }))
  } finally {
    if (providerUpdates.get(deps.readUserFile) === tail) providerUpdates.delete(deps.readUserFile)
  }
}

/** `providers list`: every configured provider, never any secret. */
export async function providersList(deps: ProvidersDeps): Promise<number> {
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  if (file.providers.length === 0) {
    deps.print(UI_TEXT.providersNoneFound)
    return EXIT_OK
  }
  for (const entry of file.providers) {
    const preset = presetById(entry.preset)
    const where = entry.address ?? fixedOriginOf(preset) ?? entry.preset
    const models = entry.models.length === 0 ? '—' : entry.models.join(', ')
    deps.print(`${entry.id} — ${preset?.label ?? entry.preset} — ${where} — ${models}`)
    // D4: a listed model no run can reserve for says why here, not only at
    // run time.
    const warnings = await missingPriceWarnings(deps, entry)
    for (const line of warnings) deps.print(line)
    // A listed model states its tool-calling limit here too (F83): the
    // same sentence the panel picker shows and the turn refusal repeats.
    if (preset === undefined || entry.auth === 'subscription') continue
    const unconfirmed = await unconfirmedToolModels(
      preset,
      entry.id,
      entry.format,
      entry.models,
      entry.modelCapabilities,
    )
    for (const nativeModel of unconfirmed) {
      deps.print(fill(UI_TEXT.providerModelNoToolCalling, { model: `${entry.id}/${nativeModel}` }))
    }
  }
  return EXIT_OK
}

/**
Bare `providers usage` (RLTESTDRIVE2 14): the id is missing, so the run
names it and lists the configured ids to choose from. A misuse, so exit 2;
the list itself is the plain ids, one per line, never the full rows.
*/
export async function providersUsageTargets(deps: ProvidersDeps): Promise<number> {
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  deps.print(fill(UI_TEXT.providerUsageNeedsId, { command: ACP_AGENT_NAME }))
  if (file.providers.length === 0) {
    deps.print(UI_TEXT.providersNoneFound)
  } else {
    for (const entry of file.providers) deps.print(entry.id)
  }
  return CLI_EXIT.usage
}

/**
D4: one warning per configured model without a price card. An unreadable
catalogue warns nothing; the run-time refusal stays the backstop.
*/
async function missingPriceWarnings(
  deps: ProvidersDeps,
  entry: ProviderEntry,
): Promise<readonly string[]> {
  if (deps.readCatalog === undefined) return []
  let catalog: CatalogPresence | undefined
  try {
    catalog = parseCatalogPresence(await deps.readCatalog())
  } catch {
    catalog = undefined
  }
  return catalog === undefined
    ? []
    : entry.models
        .filter((model) => isModelUnpriced(catalog, entry.preset, entry, model))
        .map((model) => fill(UI_TEXT.providerModelNoPrice, { ref: `${entry.id}/${model}` }))
}

function fixedOriginOf(preset: ProviderPreset | undefined): string | undefined {
  return preset?.origin.kind === 'fixed' ? preset.origin.origin : undefined
}

export type ProbeOutcome = presets.KeyProbeOutcome

const catalogProviders = z.object({
  providers: z.record(z.string(), z.object({ models: z.record(z.string(), z.unknown()) })),
})

/**
Which added models the catalogue does not confirm for tool calling
(F83): the same catalogue evidence the registry resolves, so the
warning matches what the list states and the turn refusal repeats.
A missing catalogue stays silent; the list and the refusal still say it.
*/
async function unconfirmedToolModels(
  preset: ProviderPreset,
  providerId: string,
  format: ProviderEntry['format'],
  nativeModels: readonly string[],
  overrides?: ProviderEntry['modelCapabilities'],
): Promise<readonly string[]> {
  let catalogue: z.infer<typeof catalogProviders>
  try {
    catalogue = catalogProviders.parse(
      JSON.parse(await readFile(path.resolve(__dirname, 'providerCatalog.json'), 'utf8')),
    )
  } catch {
    return []
  }
  const catalogId = preset.id.replace('-plan', '')
  const listed = catalogue.providers[catalogId]?.models
  return nativeModels.filter((nativeModel) => {
    try {
      const known = listed?.[nativeModel]
      const evidence =
        known === undefined
          ? []
          : [
              modelMetadata.nativeCapabilityEvidence(preset.id, known, {
                kind: 'catalogue',
                ref: catalogId,
              }),
            ]
      // The registry resolves the person's own capability overrides over
      // the catalogue; the warning reads the same evidence (F83).
      const entered = overrides?.[nativeModel]
      if (entered !== undefined)
        evidence.push({
          source: { kind: 'user', ref: `${providerId}/${nativeModel}` },
          fields: entered,
        })
      const record = capabilities.resolveModelCapabilities(
        { provider: providerId, nativeModel, format: format ?? preset.format },
        evidence,
      )
      return !capabilities.capabilitiesOf({ capabilityRecord: record }).toolCalling
    } catch {
      return true
    }
  })
}

function probeReason(reason: string): string {
  switch (reason) {
    case 'unreachable': {
      return UI_TEXT.providerProbeUnreachable
    }
    case 'unparseable': {
      return UI_TEXT.providerProbeUnparseable
    }
    case 'no-key': {
      return UI_TEXT.providerProbeNoKey
    }
    case 'rebinding': {
      return UI_TEXT.providerProbeRebinding
    }
    default: {
      return reason
    }
  }
}

/**
One pinned read-only JSON GET, shared by the key probe and the spend
fetcher: an HTTP failure (a status, even 4xx/5xx) comes back as a page so
the caller can report it; anything below HTTP rethrows for the caller to
classify. An unreadable body is a page without a body, never a zero.
*/
export async function getPinnedJsonPage(
  send: () => Promise<TransportResponse>,
  read: (result: TransportResponse) => Promise<unknown>,
  httpStatusOf: (error: unknown) => number | undefined,
  log?: Logger,
): Promise<{ readonly status: number; readonly body: unknown }> {
  let result: TransportResponse
  try {
    result = await send()
  } catch (error: unknown) {
    const status = httpStatusOf(error)
    if (status === undefined) throw error
    // The page itself reaches the caller, who reports it; the log, when
    // the caller passes one, keeps the failure's kind beside the status.
    log?.warn(`Pinned provider read answered HTTP ${String(status)} (${failureForLog(error)})`)
    return { status, body: undefined }
  }
  try {
    return { status: result.response.status, body: await read(result) }
  } catch (error: unknown) {
    // The shared reader wraps a damaged body as the transport's own
    // error; anything else is not this page's answer to give.
    if (!(error instanceof Error) || error.name !== 'ModelApiError') throw error
    return { status: result.response.status, body: undefined }
  }
}

/**
The raw connection failure behind the endpoint pin's refused-connection
refusal: the pin answers `providerProbeUnreachable` with the fetch
failure as its cause. A refusal with no such cause (a failed DNS lookup,
a codeless local refusal) has no codes to name and keeps the fixed
sentence.
*/
function pinRefusedCause(error: unknown): unknown {
  return error instanceof Error &&
    error.name === 'UserRefusalError' &&
    error.message === UI_TEXT.providerProbeUnreachable &&
    error.cause !== undefined &&
    isConnectionFailure(error.cause)
    ? error.cause
    : undefined
}

/**
The free check that proves a key works (D74): the preset's models list,
or its provider-key path where the list is public. Nothing is billed.
Azure's `paid-token` test has no free check and stays in the panel, where
its cost is asked first.
*/
type ProbeProviderSeamArgs = [
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: ProvidersDeps['resolveHost'],
]

type ProbeProviderDialArgs = [
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: ProvidersDeps['resolveHost'],
]

export async function probeProvider(...args: ProbeProviderSeamArgs): Promise<ProbeOutcome>
export async function probeProvider(...args: ProbeProviderDialArgs): Promise<ProbeOutcome>
export async function probeProvider(
  ...args: ProbeProviderSeamArgs | ProbeProviderDialArgs
): Promise<ProbeOutcome> {
  // The key test keeps its fetch seam for the refusal suites and dials the
  // checked address everywhere else. The first argument tells the shapes
  // apart; each tuple casts exactly once below because positional typing
  // cannot follow it.
  if (typeof args[0] === 'function') {
    const [fetch, provider, key, resolveHost] = args as ProbeProviderSeamArgs
    return await probeWithTransport(fetch, provider, key, resolveHost)
  }
  const [provider, key, resolveHost] = args as ProbeProviderDialArgs
  return await probeWithTransport(undefined, provider, key, resolveHost)
}

async function probeWithTransport(
  fetch: typeof globalThis.fetch | undefined,
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: ProvidersDeps['resolveHost'],
): Promise<ProbeOutcome> {
  const refusal = freeProbeRefusal(provider, key)
  if (refusal !== undefined) return refusal
  const test = provider.preset.keyTest
  const headers = providerListHeaders(provider)
  const shared = await import('../host/backend/modelApiEntry')
  const auth = await import('../host/backend/configuredProvidersEntry')
  shared.setUiText(UI_TEXT, uiLocale())
  auth.setUiText(UI_TEXT, uiLocale())
  const pinned =
    fetch === undefined
      ? pinProviderFetch(provider, allowedProviderPaths(provider), resolveHost)
      : pinProviderFetch(fetch, provider, allowedProviderPaths(provider), resolveHost)
  // Lane PROVERRORS: an answer reads with the provider's own format parser
  // and refusal sentence, a send with no answer with the network codes and
  // its unknown fate — the configured path's one reader, never a bare status.
  const reader = auth.providerFailureReader(provider.entry, provider.preset)
  let failureReason = 'unreachable'
  const get = async (
    url: string,
    transport: typeof fetch = pinned,
  ): Promise<
    { readonly status: number; readonly body: unknown; readonly refusal?: string } | undefined
  > => {
    const read = await readProviderJson(
      transport,
      provider,
      key,
      url,
      headers,
      {
        parseError: reader.parseError,
        sendFailure: reader.sendFailure,
      },
      { noAuth: auth.NoAuthSource, apiKey: auth.ApiKeyAuthSource },
    )
    if ('cause' in read) {
      const error = read.cause
      if (shared.isModelApiError(error) && error.status !== 0) {
        return { status: error.status, body: undefined, refusal: reader.refusal(error) }
      }
      if (error instanceof Error && error.message === 'rebinding') failureReason = 'rebinding'
      // A send with no answer says what failed; the probe's own time running
      // out, a pin refusal before sending, or a codeless failure keeps the
      // fixed sentence.
      else if (shared.isModelApiError(error) && !read.signal.aborted) failureReason = error.message
      else {
        const refused = pinRefusedCause(error)
        // A refused connection names its codes and its unknown fate through
        // the configured path's one reader, as `providers add` and
        // `providers test` promise.
        failureReason = refused === undefined ? 'unreachable' : reader.sendFailure(refused)
      }
      return undefined
    }
    return { status: read.status, body: read.body }
  }
  return await presets.runProviderKeyTest(
    test,
    provider.origin,
    async (base, path) => {
      const keyed: ResolvedProvider = {
        ...provider,
        origin: base,
        network: 'public',
        request: undefined,
      }
      let keyFetch: typeof pinned
      if (base === provider.origin) {
        keyFetch = pinned
      } else if (fetch === undefined) {
        keyFetch = pinProviderFetch(keyed, [{ kind: 'exact', path }], resolveHost)
      } else {
        keyFetch = pinProviderFetch(fetch, keyed, [{ kind: 'exact', path }], resolveHost)
      }
      const checked = await get(`${base}${path}`, keyFetch)
      if (checked === undefined) return { ok: false, paid: false, reason: failureReason }
      return checked.status === HTTP_STATUS.ok
        ? { ok: true, modelCount: undefined }
        : {
            ok: false,
            paid: false,
            reason: checked.refusal ?? `HTTP ${String(checked.status)}`,
          }
    },
    async () => {
      const listed = await get(`${provider.origin}${providerModelsPath(provider)}`)
      if (listed === undefined) return { ok: false, paid: false, reason: failureReason }
      if (listed.status !== HTTP_STATUS.ok)
        return {
          ok: false,
          paid: false,
          reason: listed.refusal ?? `HTTP ${String(listed.status)}`,
        }
      const ids = listModelIds(listed.body, provider.preset)
      return ids === undefined
        ? { ok: false, paid: false, reason: 'unparseable' }
        : { ok: true, modelCount: ids.length, modelIds: ids }
    },
  )
}

/** A `providers add` address before the policy sees it. */
function addAddressCandidate(
  preset: ProviderPreset,
  address: string | undefined,
): string | undefined {
  switch (preset.origin.kind) {
    case 'fixed': {
      return preset.origin.origin
    }
    case 'loopback': {
      return address ?? `http://127.0.0.1:${String(preset.origin.defaultPort)}`
    }
    case 'azure-resource': {
      if (address === undefined) {
        return undefined
      }
      // A resource name builds its URL; a URL passes through to the parse below.
      return azureOrigin(address) ?? address
    }
    default: {
      return address
    }
  }
}

/** Where a `providers add` address comes from, and what the policy says. */
async function checkAddAddress(
  deps: ProvidersDeps,
  preset: ProviderPreset,
  address: string | undefined,
  isPrivateOk: boolean,
): Promise<
  | {
      readonly ok: true
      readonly origin: string
      readonly address: string
      readonly privateNetwork: boolean
    }
  | { readonly ok: false; readonly reason: string }
> {
  const candidate = addAddressCandidate(preset, address)
  if (candidate === undefined) {
    return { ok: false, reason: 'missing-address' }
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch (error: unknown) {
    // Only an invalid address fails here; anything else is not this check's answer.
    if (!(error instanceof TypeError)) throw error
    return { ok: false, reason: 'bad-address' }
  }
  const answers = await deps.resolveHost(url.hostname)
  const verdict = checkEndpointUrl(url.href, answers)
  if (verdict.kind === 'refused') {
    return { ok: false, reason: verdict.reason }
  }
  if (!isPrivateOk && verdict.kind === 'confirm-private') {
    return { ok: false, reason: `private:${verdict.origin}` }
  }
  return {
    ok: true,
    origin: verdict.origin,
    address:
      preset.id === 'custom' || preset.origin.kind === 'azure-resource'
        ? `${verdict.origin}${url.pathname.replace(/\/+$/u, '')}`
        : verdict.origin,
    privateNetwork: verdict.kind === 'confirm-private',
  }
}

/** `providers add`: the wizard's checks in a terminal, then the file and the secret together. */
export async function providersAdd(
  deps: ProvidersDeps,
  options: ProvidersAddOptions,
): Promise<number> {
  const preset = presetById(options.preset)
  if (preset === undefined) {
    return failed(deps, fill(UI_TEXT.providerUnknown, { provider: options.preset }))
  }
  if (
    options.contextWindow !== undefined &&
    (preset.category !== 'local' ||
      !modelLimitsSchema.shape.contextTokens.safeParse(options.contextWindow).success)
  ) {
    return failed(deps, UI_TEXT.localContextWindowInvalid)
  }
  if (preset.category === 'local' && options.contextWindow === undefined) {
    return failed(deps, fill(UI_TEXT.localModelWindowUnknown, { model: options.models.join(', ') }))
  }
  if (preset.id === 'custom' && options.as === undefined) {
    return failed(deps, fill(UI_TEXT.providerUnknown, { provider: 'custom (pass --as <id>)' }))
  }
  const id = options.as ?? preset.id
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  if (file.providers.some((entry) => entry.id === id)) {
    return failed(deps, fill(UI_TEXT.providerAlreadyConfigured, { provider: id }))
  }
  const invalidWizard = () =>
    failed(deps, fill(UI_TEXT.providerCliConfigure, { preset: preset.id }))
  let state = applyWizardEvent(startWizard(), {
    type: 'select-preset',
    presetId: preset.id,
    auth: preset.auth,
  })
  const address = await checkAddAddress(deps, preset, options.address, options.privateOk)
  if (!address.ok) {
    if (address.reason === 'missing-address') {
      return failed(deps, fill(UI_TEXT.providerEndpointRefused, { reason: 'missing address' }))
    }
    if (address.reason.startsWith('private:')) {
      return failed(
        deps,
        fill(UI_TEXT.providerPrivateNeedsConfirm, {
          origin: address.reason.slice('private:'.length),
        }),
      )
    }
    return failed(deps, fill(UI_TEXT.providerEndpointRefused, { reason: address.reason }))
  }
  state = applyWizardEvent(state, {
    type: 'edit-form',
    fields: {
      address: address.address,
      ...(options.format !== undefined && { customFormat: options.format }),
      ...(preset.id === 'openrouter' && {
        privacy: options.privacy ?? 'zdr',
        allowFallbacks: true,
        providerOrder: [],
      }),
      ...(address.privateNetwork && { privateConfirmed: true }),
    },
  })
  state = applyWizardEvent(state, {
    type: 'validate-endpoint',
    address: address.address,
    answers: await deps.resolveHost(new URL(address.address).hostname),
  })
  if (address.privateNetwork)
    state = applyWizardEvent(state, { type: 'confirm-private', confirmed: true })
  // The machine walks configure → credential → test for a keyed provider
  // and configure → test for a keyless local server.
  const advance = (current: typeof state) => applyWizardEvent(current, { type: 'next' })
  state = advance(state)
  if (state.error !== undefined) {
    return invalidWizard()
  }
  let key: string | undefined
  let reusedSecret: string | undefined
  if (preset.auth === 'apiKey') {
    let typed: string
    if (options.keyFromStdin) {
      try {
        typed = await deps.readSecret(fill(UI_TEXT.providerKeyPrompt, { provider: id }))
      } catch (error: unknown) {
        if (isNonTextStdin(error)) return failed(deps, providerKeyFailureText('invalid'))
        throw error
      }
    } else {
      if (preset.id !== 'openrouter')
        return failed(deps, fill(UI_TEXT.providerKeyNeeded, { provider: id }))
      const account = providerSecretAccount(id)
      const stored = account === undefined ? undefined : await deps.secrets.get(account)
      let value: unknown
      try {
        value = stored === undefined ? undefined : JSON.parse(stored)
      } catch {
        return failed(deps, fill(UI_TEXT.providerSecretUnreadable, { provider: id }))
      }
      const parsed = parseStoredProviderSecret(value)
      if (parsed === undefined || !isCredentialBound(parsed.record, address.origin)) {
        return failed(deps, fill(UI_TEXT.providerKeyNeeded, { provider: id }))
      }
      typed = parsed.key
      reusedSecret = stored
    }
    if (typed.trim() === '') {
      return failed(deps, providerKeyFailureText('empty'))
    }
    key = typed.trim()
    // Any non-blank key goes to the free key test: the provider judges
    // it, never its shape. A value that looks like the wrong thing is
    // named, and stdin cannot answer, so the run continues to the test.
    // The notice is formatted in the providers bundle, which keeps its
    // own installed language: install this command's table before reading it.
    setProvidersUiText(UI_TEXT, uiLocale())
    const inspection = inspectProviderKey(key)
    if (inspection !== 'ok' && inspection !== 'empty') {
      deps.printError(providerKeyNoticeText(inspection))
    }
    state = applyWizardEvent(state, { type: 'submit-key' })
    if (state.error !== undefined) {
      return invalidWizard()
    }
    state = advance(state)
    if (state.error !== undefined) {
      return invalidWizard()
    }
  }
  if (preset.keyTest.kind === 'paid-token') {
    return failed(
      deps,
      `${fill(UI_TEXT.providerNoRequestPath, { provider: preset.label })} ${fill(UI_TEXT.providerCliConfigure, { preset: 'openai|anthropic|gemini|custom' })}`,
    )
  }
  const resolved = await resolvedForAdd(
    deps,
    preset,
    address.address,
    id,
    address.privateNetwork,
    options.format,
  )
  if (!resolved.ok) {
    return failed(
      deps,
      resolved.error === 'no-request-path'
        ? fill(UI_TEXT.providerNoRequestPath, { provider: preset.label })
        : fill(UI_TEXT.providerEndpointRefused, { reason: UI_TEXT.providerProbeRebinding }),
    )
  }
  const probe = await probeProvider(resolved.provider, key, deps.resolveHost)
  if (!probe.ok) {
    return failed(
      deps,
      probe.paid
        ? `${fill(UI_TEXT.providerNoRequestPath, { provider: preset.label })} ${fill(UI_TEXT.providerCliConfigure, { preset: 'openai|anthropic|gemini|custom' })}`
        : fill(UI_TEXT.providerTestFailed, { detail: probeReason(probe.reason) }),
    )
  }
  state = applyWizardEvent(state, {
    type: 'test-complete',
    result: { ok: true, modelCount: probe.modelCount },
  })
  state = advance(state)
  if (state.error !== undefined) {
    return invalidWizard()
  }
  if (options.models.length === 0)
    return failed(
      deps,
      fill(UI_TEXT.providerCliModelsRequired, {
        models: probe.modelIds?.join(', ') ?? `providers test ${id}`,
      }),
    )
  const models = options.models
    .map((model) => model.trim())
    .filter((model) => model !== '' && !/\s/.test(model))
  if (models.length === 0) {
    // The panel keeps its own "tick" wording; the terminal names the flag
    // and lists what the key test just read (F85). A key test that read no
    // list (an identity check on another origin, an empty list) still gets
    // the terminal's own sentence, never the wizard's tick wording.
    const listed = probe.modelIds ?? []
    if (listed.length === 0) {
      return failed(deps, UI_TEXT.providerAddNeedsModel)
    }
    deps.printError(UI_TEXT.providerAddPickModel)
    for (const id of listed) deps.printError(id)
    return EXIT_FAILED
  }
  state = applyWizardEvent(state, { type: 'set-models', models })
  if (state.error !== undefined) {
    return invalidWizard()
  }
  state = advance(state)
  if (state.error !== undefined) {
    return invalidWizard()
  }
  if (preset.id === 'openrouter') {
    state = applyWizardEvent(state, {
      type: 'set-privacy',
      privacy: options.privacy ?? 'zdr',
    })
    if (state.error !== undefined) {
      return invalidWizard()
    }
    state = advance(state)
    if (state.error !== undefined) {
      return invalidWizard()
    }
  }
  // The suggestions step has no terminal input: the default model is the
  // first ticked one, and the session budget stays the panel's.
  state = advance(state)
  state = applyWizardEvent(state, { type: 'confirm' })
  const blockers = wizardBlockers(state)
  if (state.step !== 'done' || blockers.length > 0) {
    return invalidWizard()
  }
  const contextWindow = options.contextWindow
  const entry: ProviderEntry = {
    id,
    preset: preset.id,
    address: address.address,
    ...(preset.id === 'custom' && options.format !== undefined && { format: options.format }),
    auth: preset.auth,
    models: [...models],
    ...(contextWindow !== undefined && {
      modelLimits: Object.fromEntries(
        models.map((model) => [
          model,
          { contextTokens: contextWindow, outputTokens: contextWindow },
        ]),
      ),
    }),
    ...(preset.id === 'openrouter' && {
      routing: { privacy: options.privacy ?? 'zdr', allowFallbacks: true },
    }),
    ...(address.privateNetwork && { privateNetwork: true }),
  }
  const committed = await commitProviderChange(
    deps,
    entry.id,
    (current) => {
      if (current.providers.some((saved) => saved.id === id)) return
      return {
        ...current,
        ...(current.defaultModel === undefined &&
          models[0] !== undefined && { defaultModel: `${id}/${models[0]}` }),
        providers: [...current.providers, entry],
      }
    },
    false,
    key === undefined || reusedSecret !== undefined
      ? undefined
      : formatStoredProviderSecret(
          { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: address.origin },
          key,
        ),
    reusedSecret,
  )
  if (committed !== EXIT_OK) return committed
  const summary = wizardSummary(state)
  for (const line of summary.lines) {
    deps.print(line)
  }
  // Added with its limit stated: the list shows it and an agent turn on
  // it is refused with the same sentence (F83).
  const unconfirmed = await unconfirmedToolModels(preset, id, options.format, models)
  for (const nativeModel of unconfirmed) {
    deps.print(fill(UI_TEXT.providerModelNoToolCalling, { model: `${id}/${nativeModel}` }))
  }
  deps.print(fill(UI_TEXT.providerAdded, { provider: id, origin: address.origin }))
  const addedWarnings = await missingPriceWarnings(deps, entry)
  for (const line of addedWarnings) deps.print(line)
  return EXIT_OK
}

/** A resolved provider for the address `providers add` just checked. */
async function resolvedForAdd(
  deps: ProvidersDeps,
  preset: ProviderPreset,
  origin: string,
  id: string,
  isPrivateNetwork: boolean,
  format: ProviderEntry['format'],
) {
  const file: ProvidersFile = {
    ...emptyProvidersFile(),
    providers: [
      {
        id,
        preset: preset.id,
        address: origin,
        auth: preset.auth,
        models: [],
        privateNetwork: isPrivateNetwork,
        ...(format !== undefined && { format }),
      },
    ],
  }
  return await resolveProvider(file, id, presetById, deps.resolveHost)
}

/**
The stored key behind a provider read: the key, or the line that says why
not. Silent reads (the models list) report nothing; the caller notes the
unreadable list instead.
*/
export async function storedProviderKey(
  deps: ProvidersDeps,
  provider: ResolvedProvider,
  isQuiet = false,
): Promise<{ readonly ok: true; readonly key: string | undefined } | { readonly ok: false }> {
  if (provider.preset.auth !== 'apiKey') return { ok: true, key: undefined }
  const refuse = (line: string): { readonly ok: false } => {
    if (!isQuiet) deps.printError(line)
    return { ok: false }
  }
  const account = providerSecretAccount(provider.entry.id)
  let stored: string | undefined
  try {
    stored = account === undefined ? undefined : await deps.secrets.get(account)
  } catch (error: unknown) {
    // Only a down store answers this way; anything else is not this
    // read's answer to give.
    if (!isStoreUnavailable(error)) throw error
    return refuse(UI_TEXT.acpStoreDown)
  }
  if (stored === undefined || stored === '') {
    return refuse(fill(UI_TEXT.providerKeyAbsent, { provider: provider.entry.id }))
  }
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    return refuse(fill(UI_TEXT.providerSecretUnreadable, { provider: provider.entry.id }))
  }
  const parsed = parseStoredProviderSecret(value)
  if (parsed === undefined) {
    return refuse(fill(UI_TEXT.providerSecretUnreadable, { provider: provider.entry.id }))
  }
  if (!isCredentialBound(parsed.record, provider.origin)) {
    return refuse(
      fill(UI_TEXT.providerOriginMismatch, {
        provider: provider.entry.id,
        stored: parsed.record.origin,
        current: provider.origin,
      }),
    )
  }
  return { ok: true, key: parsed.key }
}

/**
A command's probed provider (D74): the file resolves the provider, the
stored key and the binding check pass, and the free check answers. Every
failure prints its own refusal and answers undefined. The fetch seam is
the suites': the commands dial the checked address everywhere else.
*/
async function probeCommandProvider(
  deps: ProvidersDeps,
  providerId: string,
  fetch?: typeof globalThis.fetch,
): Promise<
  | {
      readonly provider: ResolvedProvider
      readonly probe: Extract<ProbeOutcome, { readonly ok: true }>
    }
  | undefined
> {
  const file = await commandFile(deps)
  if (file === undefined) return undefined
  const resolved = await resolveProvider(file, providerId, presetById, deps.resolveHost)
  if (!resolved.ok) {
    if (resolved.error === 'unknown-provider' || resolved.error === 'unknown-preset') {
      failed(deps, fill(UI_TEXT.providerUnknown, { provider: providerId }))
      return undefined
    }
    failed(
      deps,
      resolved.error === 'no-request-path'
        ? fill(UI_TEXT.providerNoRequestPath, { provider: providerId })
        : fill(UI_TEXT.providerEndpointRefused, { reason: resolved.error }),
    )
    return undefined
  }
  const { provider } = resolved
  const stored = await storedProviderKey(deps, provider)
  if (!stored.ok) return undefined
  const answers = await deps.resolveHost(new URL(provider.origin).hostname)
  if (!isEndpointBindingCurrent(provider, answers)) {
    failed(deps, fill(UI_TEXT.providerEndpointRefused, { reason: UI_TEXT.providerProbeRebinding }))
    return undefined
  }
  const probe =
    fetch === undefined
      ? await probeProvider(provider, stored.key, deps.resolveHost)
      : await probeProvider(fetch, provider, stored.key, deps.resolveHost)
  if (!probe.ok) {
    failed(
      deps,
      probe.paid
        ? `${fill(UI_TEXT.providerNoRequestPath, { provider: provider.preset.label })} ${fill(UI_TEXT.providerCliConfigure, { preset: 'openai|anthropic|gemini|custom' })}`
        : fill(UI_TEXT.providerTestFailed, { detail: probeReason(probe.reason) }),
    )
    return undefined
  }
  return { provider, probe }
}

/** `providers test`: the stored credential, the binding, the endpoint and the free check. */
export async function providersTest(deps: ProvidersDeps, providerId: string): Promise<number> {
  const probed = await probeCommandProvider(deps, providerId)
  if (probed === undefined) return EXIT_FAILED
  const { provider, probe } = probed
  deps.print(
    probe.modelCount === undefined
      ? UI_TEXT.providerTestOkKey
      : plural(UI_TEXT.providerTestOk, probe.modelCount),
  )
  if (probe.modelIds !== undefined) deps.print(probe.modelIds.join(', '))
  const testedWarnings = await missingPriceWarnings(deps, provider.entry)
  for (const line of testedWarnings) deps.print(line)
  return EXIT_OK
}

/** `providers remove`: the entry and its secret, at once. */
/**
`providers refresh`: re-read the provider's live model list and store
every live id the file lacks (RLTESTDRIVE item 5). The file's list
freezes at `providers add`; refresh unfreezes it without touching the
person's selection: filed ids the list lacks stay, reported as still
configured. A list that cannot be read fails with the probe's reason
and leaves the file untouched. The fetch seam is the suites': the
command dials the checked address everywhere else, as the probe does.
*/
export async function providersRefresh(
  deps: ProvidersDeps,
  providerId: string,
  fetch?: typeof globalThis.fetch,
): Promise<number> {
  const probed = await probeCommandProvider(deps, providerId, fetch)
  if (probed === undefined) return EXIT_FAILED
  const { provider, probe } = probed
  const live = probe.modelIds ?? []
  const { added, missing } = diffLiveModels(provider.entry.models, live)
  if (added.length === 0) {
    deps.print(
      plural(UI_TEXT.providerRefreshCurrent, provider.entry.models.length, {
        provider: provider.entry.id,
      }),
    )
    if (missing.length > 0) {
      deps.print(
        fill(UI_TEXT.providerRefreshMissing, {
          provider: provider.entry.id,
          models: missing.join(', '),
        }),
      )
    }
    return EXIT_OK
  }
  const vanishFlag = { value: false }
  const committed = await commitProviderChange(
    deps,
    provider.entry.id,
    (current) => {
      const filed = current.providers.find((candidate) => candidate.id === provider.entry.id)
      if (filed === undefined) {
        vanishFlag.value = true
        return current
      }
      const fresh = added.filter((model) => !filed.models.includes(model))
      return {
        ...current,
        providers: current.providers.map((candidate) =>
          candidate.id === provider.entry.id
            ? { ...candidate, models: [...candidate.models, ...fresh] }
            : candidate,
        ),
      }
    },
    false,
  )
  if (committed !== EXIT_OK) return committed
  if (vanishFlag.value)
    return failed(deps, fill(UI_TEXT.providerUnknown, { provider: provider.entry.id }))
  deps.print(
    plural(UI_TEXT.providerRefreshAdded, added.length, {
      provider: provider.entry.id,
      models: added.join(', '),
    }),
  )
  if (missing.length > 0) {
    deps.print(
      fill(UI_TEXT.providerRefreshMissing, {
        provider: provider.entry.id,
        models: missing.join(', '),
      }),
    )
  }
  const addedWarnings = await missingPriceWarnings(deps, { ...provider.entry, models: [...added] })
  for (const line of addedWarnings) deps.print(line)
  return EXIT_OK
}

export async function providersRemove(deps: ProvidersDeps, providerId: string): Promise<number> {
  const committed = await commitProviderChange(
    deps,
    providerId,
    (file) => {
      if (file.providers.every((entry) => entry.id !== providerId)) return
      return {
        ...file,
        ...(file.defaultModel?.startsWith(`${providerId}/`) && { defaultModel: undefined }),
        providers: file.providers.filter((entry) => entry.id !== providerId),
      }
    },
    true,
  )
  if (committed !== EXIT_OK) return committed
  deps.print(fill(UI_TEXT.providerRemoved, { id: providerId }))
  return EXIT_OK
}

/** What `auth … --provider <id>` stores the key for: the preset and the bound origin. */
export async function keyTargetFor(
  readUserFile: () => Promise<ProvidersFileRead>,
  providerId: string,
): Promise<
  | { readonly ok: true; readonly preset: ProviderPreset; readonly origin: string }
  | { readonly ok: false; readonly reason: string }
> {
  const unknown = fill(UI_TEXT.providerUnknown, { provider: providerId })
  const loaded = fileOrError(await readUserFile())
  if ('reason' in loaded) {
    return { ok: false, reason: loaded.reason }
  }
  const entry = loaded.file.providers.find((candidate) => candidate.id === providerId)
  if (entry !== undefined) {
    const preset = presetById(entry.preset)
    if (preset === undefined) {
      return { ok: false, reason: unknown }
    }
    const origin = entry.address ?? fixedOriginOf(preset)
    if (origin === undefined) {
      return {
        ok: false,
        reason: fill(UI_TEXT.providerNotConfigured, { provider: providerId }),
      }
    }
    return { ok: true, preset, origin }
  }
  const preset = presetById(providerId)
  const origin = fixedOriginOf(preset)
  if (preset === undefined || origin === undefined) {
    return {
      ok: false,
      reason:
        preset === undefined
          ? unknown
          : fill(UI_TEXT.providerNotConfigured, { provider: providerId }),
    }
  }
  return { ok: true, preset, origin }
}

/**
The rebinding check every provider request repeats before dispatch:
false after reporting the refusal.
*/
export async function isEndpointSafe(
  deps: ProvidersDeps,
  provider: ResolvedProvider,
): Promise<boolean> {
  const answers = await deps.resolveHost(new URL(provider.origin).hostname)
  if (isEndpointBindingCurrent(provider, answers)) return true
  failed(deps, fill(UI_TEXT.providerEndpointRefused, { reason: UI_TEXT.providerProbeRebinding }))
  return false
}
