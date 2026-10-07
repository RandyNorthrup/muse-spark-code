// The ACP agent's provider commands (M95, PLAN.md D74): `providers
// list|add|test|remove` and the key target `auth … --provider <id>` uses.
// The terminal runs the same checks as the panel's wizard: the preset, the
// endpoint policy, the key's shape, the free key test and the ticked
// models, driven through lane P's pure `wizardFlow` state machine, so the
// rules cannot drift. The draft lives in memory only; the file and the
// secret are committed once the machine reaches `done`. Reported failures
// compensate the secret change; crash/rollback limits are recorded in PLAN §9.

import { lookup } from 'node:dns/promises'
import { mkdir, rmdir } from 'node:fs/promises'
import { isIP } from 'node:net'
import * as z from 'zod/mini'
import path from 'node:path'
import {
  credentialRecord,
  endpointPolicy,
  presets,
  wizardFlow,
  providersFile,
} from '../host/backend/providersEntry'
import type { SecretStore } from '../host/auth/credentialStore'
const { isCredentialBound } = credentialRecord
const { checkEndpointUrl } = endpointPolicy
import type { ProviderPreset } from '../core/providers/presets'
const { azureOrigin, isKeyShape, OPENROUTER_ATTRIBUTION, presetById } = presets
const { applyWizardEvent, startWizard, wizardBlockers, wizardSummary } = wizardFlow
import type {
  ProviderEntry,
  ProvidersFile,
  ProvidersFileRead,
} from '../core/providers/providersFile'
const { emptyProvidersFile, readProvidersFile, writeProvidersFileAtomic } = providersFile
import {
  CREDENTIAL_RECORD_VERSION,
  HTTP_STATUS,
  PROVIDER_PROBE_MODEL_IDS_MAX,
  PROVIDER_PROBE_TIMEOUT_MS,
  PROVIDERS_CONFIG_DIR_NAME,
  PROVIDERS_FILE_NAME,
  UI_TEXT,
} from '../shared/constants'
import { fill, plural, uiLocale } from '../shared/l10n/text'
import type { ProvidersAddOptions } from './cliArgs'
import {
  formatStoredProviderSecret,
  parseStoredProviderSecret,
  providerSecretAccount,
} from './keyStore'
import {
  isEndpointBindingCurrent,
  allowedProviderPaths,
  pinProviderFetch,
  providerModelsPath,
  resolveProvider,
  type ResolvedProvider,
} from './exec/providerExec'

const EXIT_OK = 0
const EXIT_FAILED = 1

/** Where the runner's own user file lives (D74: beside, never inside, Muse Code's config folder). */
export function providersFilePath(input: {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}): string {
  const base = path.join(
    input.xdgConfigHome ?? path.join(input.homeDir, '.config'),
    PROVIDERS_CONFIG_DIR_NAME,
  )
  // Windows joins with `\`; join keeps one dialect per platform, as the
  // skill and memory roots do.
  return path.join(base, PROVIDERS_FILE_NAME)
}

/** DNS answers for an endpoint name; an IP literal is its own answer. */
export async function resolveEndpointHost(hostname: string): Promise<readonly string[]> {
  if (isIP(hostname) !== 0) {
    return [hostname]
  }
  try {
    const answers = await lookup(hostname, { all: true })
    return answers.map((answer) => answer.address)
  } catch {
    return []
  }
}

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
      const lock = `${filePath}.lock`
      await mkdir(lock)
      try {
        return await operation()
      } finally {
        await rmdir(lock)
      }
    },
  }
}

/**
 * The user file, or why it cannot be used. A missing file is the first-run
 * state (an empty file); anything else is reported, never defaulted.
 */
function fileOrError(
  read: ProvidersFileRead,
): { readonly file: ProvidersFile } | { readonly reason: string } {
  if (read.ok) {
    return { file: read.file }
  }
  return read.reason === 'missing' ? { file: emptyProvidersFile() } : { reason: read.detail }
}

function failed(deps: ProvidersDeps, line: string): number {
  deps.printError(line)
  return EXIT_FAILED
}

/** Read once and report a malformed user file consistently across commands. */
async function commandFile(deps: ProvidersDeps): Promise<ProvidersFile | undefined> {
  const loaded = fileOrError(await deps.readUserFile())
  if ('reason' in loaded) {
    failed(deps, fill(UI_TEXT.providerTestFailed, { reason: loaded.reason }))
    return
  }
  return loaded.file
}

const providerUpdates = new WeakMap<ProvidersDeps['readUserFile'], Promise<void>>()

/** Serialize the commit, re-read after probing, and compensate a failed file write. */
async function commitProviderChange(
  deps: ProvidersDeps,
  id: string,
  change: (file: ProvidersFile) => ProvidersFile | undefined,
  isRemoving: boolean,
  secret?: string,
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
    const account = isRemoving || secret !== undefined ? providerSecretAccount(id) : undefined
    let previous: string | undefined
    if (account !== undefined) {
      try {
        previous = await deps.secrets.get(account)
      } catch {
        return failed(
          deps,
          fill(UI_TEXT.providerSaveFailed, { reason: UI_TEXT.providerSaveSecretFailed }),
        )
      }
    }
    const canRestore = async () => {
      if (account === undefined) return true
      try {
        if (previous === undefined) await deps.secrets.delete(account)
        else await deps.secrets.store(account, previous)
        return true
      } catch {
        return false
      }
    }
    try {
      if (account !== undefined) {
        if (isRemoving) await deps.secrets.delete(account)
        else if (secret !== undefined) await deps.secrets.store(account, secret)
      }
    } catch {
      // A rejecting store may have changed its entry before reporting failure.
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
      /* A failed commit must release queued writers. */
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
  }
  return EXIT_OK
}

function fixedOriginOf(preset: ProviderPreset | undefined): string | undefined {
  return preset?.origin.kind === 'fixed' ? preset.origin.origin : undefined
}

function attributionHeaders(preset: ProviderPreset): Record<string, string> {
  return preset.id === 'openrouter'
    ? {
        [OPENROUTER_ATTRIBUTION.refererHeader]: OPENROUTER_ATTRIBUTION.referer,
        [OPENROUTER_ATTRIBUTION.titleHeader]: OPENROUTER_ATTRIBUTION.title,
        [OPENROUTER_ATTRIBUTION.categoriesHeader]: OPENROUTER_ATTRIBUTION.categories,
      }
    : {}
}

export type ProbeOutcome =
  | { readonly ok: true; readonly modelCount: number | undefined }
  | { readonly ok: false; readonly paid: boolean; readonly reason: string }

/** Model ids from a list body: OpenAI's `{data: [{id}]}` or Gemini's `{models: [{name}]}`. */
const modelId = z.string().check(z.minLength(1))
const modelRows = z
  .array(z.object({ id: modelId }))
  .check(z.maxLength(PROVIDER_PROBE_MODEL_IDS_MAX))
const modelsBody = z.union([
  z.object({ data: modelRows }),
  z.object({
    models: z.array(z.object({ name: modelId })).check(z.maxLength(PROVIDER_PROBE_MODEL_IDS_MAX)),
  }),
])

function listModelIds(body: unknown, preset: ProviderPreset): readonly string[] | undefined {
  // Only Together has the captured top-level array (free list, zero model attempts).
  const parsed = z.safeParse(preset.id === 'together' ? modelRows : modelsBody, body)
  if (!parsed.success) return undefined
  if (Array.isArray(parsed.data)) return parsed.data.map((row) => row.id)
  return 'data' in parsed.data
    ? parsed.data.data.map((row) => row.id)
    : parsed.data.models.map((row) =>
        row.name.startsWith('models/') ? row.name.slice('models/'.length) : row.name,
      )
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

function ignoreProbeLog(): void {
  // Commands return fixed probe outcomes; transport details never reach terminal logs.
}

/**
 * The free check that proves a key works (D74): the preset's models list,
 * or its provider-key path where the list is public. Nothing is billed.
 * Azure's `paid-token` test has no free check and stays in the panel, where
 * its cost is asked first.
 */
export async function probeProvider(
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: ProvidersDeps['resolveHost'],
): Promise<ProbeOutcome> {
  const test = provider.preset.keyTest
  if (test.kind === 'paid-token') {
    return { ok: false, paid: true, reason: 'paid' }
  }
  const headers: Record<string, string> = { ...attributionHeaders(provider.preset) }
  if ((provider.entry.format ?? provider.preset.format) === 'anthropic') {
    // Both captured Anthropic list requests carry this exact version.
    headers['anthropic-version'] = '2023-06-01'
  }
  if (key === undefined && provider.preset.auth === 'apiKey') {
    return { ok: false, paid: false, reason: 'no-key' }
  }
  const shared = await import('../host/backend/modelApiEntry')
  const auth = await import('../host/backend/configuredProvidersEntry')
  shared.setUiText(UI_TEXT, uiLocale())
  auth.setUiText(UI_TEXT, uiLocale())
  const pinned = pinProviderFetch(fetch, provider, allowedProviderPaths(provider), resolveHost)
  let failureReason = 'unreachable'
  const get = async (
    url: string,
    transport: typeof fetch = pinned,
  ): Promise<{ readonly status: number; readonly body: unknown } | undefined> => {
    const origin = new URL(url).origin
    const source =
      key === undefined
        ? new auth.NoAuthSource(origin)
        : new auth.ApiKeyAuthSource(
            () =>
              Promise.resolve({
                record: { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin },
                key,
              }),
            provider.preset.id === 'custom' && provider.entry.format === 'anthropic'
              ? 'x-api-key'
              : (provider.preset.authHeader ?? 'bearer'),
          )
    const client = new shared.RequestTransport({
      baseUrl: origin,
      auth: source,
      // pinProviderFetch rechecks DNS and the saved path/network at every dispatch.
      verifyEndpoint: async (requestUrl) => {
        await source.headers(requestUrl)
      },
      fetch: transport,
      now: Date.now,
      random: Math.random,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      // Commands report fixed probe outcomes; transport detail is never logged.
      log: {
        info: ignoreProbeLog,
        warn: ignoreProbeLog,
        error: ignoreProbeLog,
        trace: ignoreProbeLog,
      },
    })
    let result: Awaited<ReturnType<typeof client.request>>
    try {
      result = await client.request(
        url.slice(origin.length),
        {
          method: 'GET',
          headers,
          accept: 'application/json',
          retries: 'rateLimitOnly',
        },
        AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS),
      )
    } catch (error: unknown) {
      if (error instanceof shared.ModelApiError && error.status !== 0) {
        return { status: error.status, body: undefined }
      }
      failureReason =
        error instanceof Error && error.message === 'rebinding' ? 'rebinding' : 'unreachable'
      return undefined
    }
    try {
      return {
        status: result.response.status,
        body: await shared.parseJsonResponse(result, (value) => value),
      }
    } catch {
      return { status: result.response.status, body: undefined }
    }
  }
  if (test.kind === 'provider-key') {
    const base = test.origin ?? provider.origin
    const keyFetch =
      base === provider.origin
        ? pinned
        : pinProviderFetch(
            fetch,
            { ...provider, origin: base, network: 'public', request: undefined },
            [{ kind: 'exact', path: test.path }],
            resolveHost,
          )
    const checked = await get(`${base}${test.path}`, keyFetch)
    if (checked === undefined) {
      return { ok: false, paid: false, reason: failureReason }
    }
    if (checked.status !== HTTP_STATUS.ok) {
      return { ok: false, paid: false, reason: `HTTP ${String(checked.status)}` }
    }
  }
  const listUrl =
    test.kind === 'provider-key' && test.origin !== undefined && test.origin !== provider.origin
      ? undefined
      : `${provider.origin}${providerModelsPath(provider)}`
  if (listUrl === undefined) {
    return { ok: true, modelCount: undefined }
  }
  const listed = await get(listUrl)
  if (listed === undefined) {
    return { ok: false, paid: false, reason: failureReason }
  }
  if (listed.status !== HTTP_STATUS.ok) {
    return { ok: false, paid: false, reason: `HTTP ${String(listed.status)}` }
  }
  const ids = listModelIds(listed.body, provider.preset)
  return ids === undefined
    ? { ok: false, paid: false, reason: 'unparseable' }
    : { ok: true, modelCount: ids.length }
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
  } catch {
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
      preset.id === 'custom'
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
  if (preset.id === 'custom' && options.as === undefined) {
    return failed(deps, fill(UI_TEXT.providerUnknown, { provider: 'custom (pass --as <id>)' }))
  }
  const id = options.as ?? preset.id
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  if (file.providers.some((entry) => entry.id === id)) {
    return failed(deps, fill(UI_TEXT.providerAlreadyConfigured, { provider: id }))
  }
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
    return failed(deps, state.error)
  }
  let key: string | undefined
  if (preset.auth === 'apiKey') {
    if (!options.keyFromStdin) {
      return failed(deps, fill(UI_TEXT.providerKeyNeeded, { provider: id }))
    }
    const typed = await deps.readSecret(fill(UI_TEXT.providerKeyPrompt, { provider: id }))
    if (typed.trim() === '') {
      return failed(deps, UI_TEXT.providerKeyNotStored)
    }
    key = typed.trim()
    if (!isKeyShape(preset.keyShape, key)) {
      return failed(
        deps,
        fill(UI_TEXT.providerKeyShape, { provider: preset.label, hint: preset.keyHint }),
      )
    }
    state = applyWizardEvent(state, { type: 'submit-key', shapeOk: true })
    if (state.error !== undefined) {
      return failed(deps, state.error)
    }
    state = advance(state)
    if (state.error !== undefined) {
      return failed(deps, state.error)
    }
  }
  if (preset.keyTest.kind === 'paid-token') {
    return failed(deps, fill(UI_TEXT.providerPaidTest, { provider: preset.label }))
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
  const probe = await probeProvider(deps.fetch, resolved.provider, key, deps.resolveHost)
  if (!probe.ok) {
    return failed(
      deps,
      probe.paid
        ? fill(UI_TEXT.providerPaidTest, { provider: preset.label })
        : fill(UI_TEXT.providerTestFailed, { detail: probeReason(probe.reason) }),
    )
  }
  state = applyWizardEvent(state, {
    type: 'test-complete',
    result: { ok: true, modelCount: probe.modelCount },
  })
  state = advance(state)
  if (state.error !== undefined) {
    return failed(deps, state.error)
  }
  const models = options.models
    .map((model) => model.trim())
    .filter((model) => model !== '' && !/\s/.test(model))
  state = applyWizardEvent(state, { type: 'set-models', models })
  if (state.error !== undefined) {
    return failed(deps, state.error)
  }
  state = advance(state)
  if (state.error !== undefined) {
    return failed(deps, state.error)
  }
  if (preset.id === 'openrouter') {
    state = applyWizardEvent(state, {
      type: 'set-privacy',
      privacy: options.privacy ?? 'zdr',
    })
    if (state.error !== undefined) {
      return failed(deps, state.error)
    }
    state = advance(state)
    if (state.error !== undefined) {
      return failed(deps, state.error)
    }
  }
  // The suggestions step has no terminal input: the default model is the
  // first ticked one, and the session budget stays the panel's.
  state = advance(state)
  state = applyWizardEvent(state, { type: 'confirm' })
  const blockers = wizardBlockers(state)
  if (state.step !== 'done' || blockers.length > 0) {
    return failed(
      deps,
      state.error ?? fill(UI_TEXT.providerTestFailed, { detail: blockers[0] ?? 'confirm' }),
    )
  }
  const entry: ProviderEntry = {
    id,
    preset: preset.id,
    address: address.address,
    ...(preset.id === 'custom' && options.format !== undefined && { format: options.format }),
    auth: preset.auth,
    models: [...models],
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
    key === undefined
      ? undefined
      : formatStoredProviderSecret(
          { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: address.origin },
          key,
        ),
  )
  if (committed !== EXIT_OK) return committed
  const summary = wizardSummary(state)
  for (const line of summary.lines) {
    deps.print(line)
  }
  deps.print(fill(UI_TEXT.providerAdded, { provider: id, origin: address.origin }))
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

/** `providers test`: the stored credential, the binding, the endpoint and the free check. */
export async function providersTest(deps: ProvidersDeps, providerId: string): Promise<number> {
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  const resolved = await resolveProvider(file, providerId, presetById, deps.resolveHost)
  if (!resolved.ok) {
    if (resolved.error === 'unknown-provider' || resolved.error === 'unknown-preset') {
      return failed(deps, fill(UI_TEXT.providerUnknown, { provider: providerId }))
    }
    return failed(
      deps,
      resolved.error === 'no-request-path'
        ? fill(UI_TEXT.providerNoRequestPath, { provider: providerId })
        : fill(UI_TEXT.providerEndpointRefused, { reason: resolved.error }),
    )
  }
  const { provider } = resolved
  let key: string | undefined
  if (provider.preset.auth === 'apiKey') {
    const account = providerSecretAccount(provider.entry.id)
    const stored = account === undefined ? undefined : await deps.secrets.get(account)
    if (stored === undefined || stored === '') {
      return failed(deps, fill(UI_TEXT.providerKeyAbsent, { provider: providerId }))
    }
    let value: unknown
    try {
      value = JSON.parse(stored)
    } catch {
      return failed(deps, fill(UI_TEXT.providerSecretUnreadable, { provider: providerId }))
    }
    const parsed = parseStoredProviderSecret(value)
    if (parsed === undefined) {
      return failed(deps, fill(UI_TEXT.providerSecretUnreadable, { provider: providerId }))
    }
    if (!isCredentialBound(parsed.record, provider.origin)) {
      return failed(
        deps,
        fill(UI_TEXT.providerOriginMismatch, {
          provider: providerId,
          stored: parsed.record.origin,
          current: provider.origin,
        }),
      )
    }
    key = parsed.key
  }
  const answers = await deps.resolveHost(new URL(provider.origin).hostname)
  if (!isEndpointBindingCurrent(provider, answers)) {
    return failed(
      deps,
      fill(UI_TEXT.providerEndpointRefused, { reason: UI_TEXT.providerProbeRebinding }),
    )
  }
  const probe = await probeProvider(deps.fetch, provider, key, deps.resolveHost)
  if (!probe.ok) {
    return failed(
      deps,
      probe.paid
        ? fill(UI_TEXT.providerPaidTest, { provider: provider.preset.label })
        : fill(UI_TEXT.providerTestFailed, { detail: probeReason(probe.reason) }),
    )
  }
  deps.print(
    probe.modelCount === undefined
      ? UI_TEXT.providerTestOkKey
      : plural(UI_TEXT.providerTestOk, probe.modelCount),
  )
  return EXIT_OK
}

/** `providers remove`: the entry and its secret, at once. */
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
  const read = await readUserFile()
  if (!read.ok) {
    return { ok: false, reason: read.reason === 'missing' ? unknown : read.detail }
  }
  const entry = read.file.providers.find((candidate) => candidate.id === providerId)
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
