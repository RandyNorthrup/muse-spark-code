// The production SystemOne (C) side (M98 phase 2 redesign). A separate id
// `<presetId>:<model>` names one of M95's SystemOne presets and one of its
// captured request models (`openrouter-jev:typesafe/jev-1.13`). The user's
// own key for that preset's provider, already in M95's credential store
// (SecretStorage in the window, the OS store for the CLI), pays; no second
// key store exists. Experimental, untested and opt-in (PLAN 2c and the
// owner's TypeSafe ruling): only an explicit `separate` or `both` engine
// selects it, `auto` never does, and it only adds caution to the Muse
// judge. It never answers the user, writes code or settles a decision alone.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import * as z from 'zod/mini'
import type { PinnedResponse, PinnedTarget } from '../../web/webFetch'
import { isSecretFieldName, redactSecrets } from '../../redact'
import {
  capabilities,
  credentialRecord,
  endpointPolicy,
  presets,
} from '../../../host/backend/providersEntry'
import {
  ADDRESS_FAMILIES,
  JUDGE_FIT_VERSION,
  JUDGE_MAX_BODY_BYTES,
} from '../../../shared/constants'
import type { Phase2SeparateSource } from '../binding'
import type { JudgeCapability } from '../schema'
import { systemOneUsd } from './policy'
import { createSystemOneJudge, type SystemOneJudgeDependencies } from './source'

const { systemOneCapability } = capabilities
const { systemOnePresetById } = presets
const { isCredentialBound, parseCredentialRecord } = credentialRecord
/** What the exact credential becomes wherever a provider echoes it. */
const REDACTED = '[redacted]'
/** Field names that carry a credential, beyond the shared redactor's names. */
const CREDENTIAL_FIELD = /authori[sz]ation|bearer|api[-_]?key|secret|token|cookie/i

/** The secret beside a parsed M95 credential record; read, never logged. */
const storedSecretSchema = z.object({ secret: z.string().check(z.minLength(1)) })

/** One SystemOne route a separate id names, with its captured identity and price. */
export interface SystemOneRoute {
  readonly presetId: string
  readonly model: string
  readonly keyProviderId: string
  /** Where judged state is sent: the preset's fixed origin (PRIVACY names it). */
  readonly recipient: string
  /** The endpoint's common wire was captured (OpenRouter Jev); direct TypeSafe was not. */
  readonly verified: boolean
  readonly capability: JudgeCapability
  /** One request's ceiling: the captured request-token bound at the captured rate. */
  readonly worstCaseUsd: number
  /** The response model ids the capture allows for this request id. */
  readonly servedModels: readonly string[]
  /** The captured per-million rates the route bills (its own tariff, never the chat model's). */
  readonly tariff: { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number }
  /**
  What a consent for this route is bound to: recipient, model and tariff
  ceiling. Another route, or a changed price, never inherits it.
  */
  readonly consentKey: string
}

/** The route a separate id names, or undefined when it names no captured SystemOne model. */
export function systemOneRoute(separateId: string): SystemOneRoute | undefined {
  const at = separateId.indexOf(':')
  if (at <= 0) return undefined
  const presetId = separateId.slice(0, at)
  const model = separateId.slice(at + 1)
  const preset = systemOnePresetById(presetId)
  const captured = systemOneCapability(presetId, model)
  if (preset === undefined || captured === undefined) return undefined
  return {
    presetId,
    model,
    keyProviderId: preset.keyProviderId,
    recipient: preset.origin,
    verified: preset.wireCapture,
    worstCaseUsd: systemOneUsd(captured.requestTokens, 0, captured),
    servedModels: captured.responseModels,
    tariff: {
      inputUsdPerMillion: captured.inputUsdPerMillion,
      outputUsdPerMillion: captured.outputUsdPerMillion,
    },
    consentKey: JSON.stringify([
      preset.origin,
      preset.path,
      presetId,
      model,
      systemOneUsd(captured.requestTokens, 0, captured),
    ]),
    // The judge-side identity of the captured route. SystemOne serves its
    // own wire only: no logprob request exists (`unknown`), and the route
    // neither forces reasoning nor caches a prefix for the judge.
    capability: {
      source: 'separate',
      providerId: preset.id,
      model,
      modelVersion: model,
      endpoint: `${preset.origin}${preset.path}`,
      captureId: captured.captureId,
      logprobs: { kind: 'unknown' },
      stated: false,
      systemone: true,
      reasoningForced: false,
      cache: false,
      contextWindowTokens: captured.requestTokens,
      minOutputTokens: 1,
    },
  }
}

/** What a surface supplies to build the C side. Construction touches none of it. */
export interface SystemOneSideIo {
  /** M95's stored credential value for a provider id (SecretStorage or the OS store). */
  readonly readStoredCredential: (providerId: string) => Promise<string | undefined>
  readonly post: SystemOneJudgeDependencies['post']
  readonly reserve: SystemOneJudgeDependencies['reserve']
  /** Paid consent for exactly this route (recipient and tariff), read at every checkpoint. */
  readonly consent: (route: SystemOneRoute) => 'granted' | 'needed' | 'declined'
  /**
  The surface's current trigger generation for this run (the window's
  owner, chat model, engine, separate source and turn). Lane C fences
  admission, the key read and the POST on it: a change refunds before
  anything is sent.
  */
  readonly generation: () => number
  /** The route grant's revocation count ("Ask again", a price change); absent where none exists. */
  readonly revocation?: (() => number) | undefined
  readonly confidential: () => boolean
  readonly measureTokens: (text: string) => number
  /** An explicit `separate`/`both` engine; `auto` never selects an untested route. */
  readonly isExplicit: () => boolean
  /**
  The window's paid-use popup for this route's price and recipient, asked
  before the first charge (D48). Absent on a surface whose admission is
  its hard budget (the CLI's `--budget-usd`).
  */
  readonly askConsent?: ((route: SystemOneRoute) => Promise<boolean>) | undefined
}

/**
The key for one provider id, only when M95's record binds it to exactly
the route's origin. A damaged, unbound or absent record reads as no key.
*/
export async function systemOneKey(
  io: Pick<SystemOneSideIo, 'readStoredCredential'>,
  providerId: string,
  origin: string,
): Promise<string | undefined> {
  const stored = await io.readStoredCredential(providerId)
  if (stored === undefined || stored === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const record = parseCredentialRecord(value)
  const secret = storedSecretSchema.safeParse(value)
  return record?.auth === 'apiKey' && isCredentialBound(record, origin) && secret.success
    ? secret.data.secret
    : undefined
}

/** The pinned send the M95 providers use (`pinnedPostRequest`), as an injectable seam. */
export type SystemOneSend = (
  target: PinnedTarget,
  body: string,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
  onConnected: () => void,
  /** Read once connected, before any request byte is written: false withdraws it unsent. */
  shouldWrite: () => boolean,
) => Promise<PinnedResponse>

/** Name resolution for the route's host; every address is returned. */
export type SystemOneResolve = (host: string) => Promise<readonly string[]>

async function defaultResolve(host: string): Promise<readonly string[]> {
  const rows = await lookup(host, { all: true })
  return rows.map((row) => row.address)
}

async function defaultSend(...args: Parameters<SystemOneSend>): Promise<PinnedResponse> {
  // The Model API bundle's pinned POST, loaded only when a request is made.
  const { pinnedPostRequest } = await import('../../../host/backend/modelApiEntry')
  const [target, body, headers, signal, onConnected, shouldWrite] = args
  return await pinnedPostRequest(
    target,
    body,
    headers,
    signal,
    onConnected,
    undefined,
    undefined,
    shouldWrite,
  )
}

async function boundedJson(response: PinnedResponse): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > JUDGE_MAX_BODY_BYTES) return undefined
      chunks.push(chunk)
    }
  } finally {
    response.close()
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/** The service's owned shape: kept by name, every value still scrubbed. */
const OWNED_FIELDS = new Set(['model', 'answers', 'usage'])
const recordSchema = z.record(z.string(), z.unknown())

/** A field that names a credential is dropped with its value. */
function isCredentialName(name: string): boolean {
  return CREDENTIAL_FIELD.test(name) || isSecretFieldName(name)
}

/**
A property name that carries a credential: the exact active key anywhere in
it, or text the shared redactor would change. Dropped with its value at
every depth, owned maps included (no question id or counter carries one).
*/
function isCredentialBearingName(name: string, key: string): boolean {
  return name.includes(key) || redactSecrets(name) !== name
}

function scrubValue(value: unknown, key: string, isOwnedMap = false): unknown {
  if (typeof value === 'string') return redactSecrets(value.split(key).join(REDACTED))
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, key))
  const record = recordSchema.safeParse(value)
  if (!record.success) return value
  return Object.fromEntries(
    Object.entries(record.data).flatMap(([name, item]) =>
      // Names in an owned map (question ids, usage counters) are ours, but
      // never one that carries the credential itself.
      isCredentialBearingName(name, key) || (!isOwnedMap && isCredentialName(name))
        ? []
        : [[name, scrubValue(item, key)]],
    ),
  )
}

/**
A provider body as it may enter a result: the exact active credential is
replaced wherever it appears, string values pass the shared redactor, and
every unknown addition that names a credential is dropped, before any of
it reaches results, receipts, stdout or MCP. The owned shape (`model`,
the answers keyed by question id, `usage`) keeps its names for lane C's
own validation.
*/
export function scrubSystemOneBody(value: unknown, key: string): unknown {
  const record = recordSchema.safeParse(value)
  if (!record.success) return scrubValue(value, key)
  return Object.fromEntries(
    Object.entries(record.data).flatMap(([name, item]) => {
      if (OWNED_FIELDS.has(name))
        return [[name, scrubValue(item, key, name === 'answers' || name === 'usage')]]
      return isCredentialName(name) || isCredentialBearingName(name, key)
        ? []
        : [[name, scrubValue(item, key)]]
    }),
  )
}

/**
The SystemOne POST over the M95 providers' own transport: the preset's
fixed origin and path, resolved once and checked by M95's endpoint policy
(a private or refused address never connects), then sent pinned to that
address with `pinnedPostRequest`. In VS Code that request takes the
user's proxy and certificates, exactly as the M95 providers' requests do
(`src/host/web/pinnedRequest.ts`). No redirect is followed and the body
is bounded. A refusal before the connection is up is not a send (lane C
refunds it); anything after it keeps its liability.
*/
export function pinnedSystemOnePost(
  seams: { readonly resolve?: SystemOneResolve; readonly send?: SystemOneSend } = {},
): SystemOneJudgeDependencies['post'] {
  return async (request) => {
    const notSent = { sent: false, status: 0, body: undefined }
    const url = new URL(request.path, request.origin)
    if (url.origin !== request.origin || url.protocol !== 'https:') return notSent
    const host = url.hostname.replaceAll(/^\[|\]$/g, '')
    let answers: readonly string[]
    try {
      answers = isIP(host) === 0 ? await (seams.resolve ?? defaultResolve)(host) : [host]
    } catch {
      return notSent
    }
    const verdict = endpointPolicy.checkEndpointUrl(url.href, answers)
    const address = answers[0]
    // Only a public address: a SystemOne preset never has a private one.
    if (address === undefined || verdict.kind !== 'ok' || verdict.network !== 'public')
      return notSent
    // Name resolution is a wait: the run must still hold before connecting.
    if (!request.proceed()) return notSent
    const target: PinnedTarget = {
      url,
      host,
      address,
      family:
        isIP(address) === ADDRESS_FAMILIES.ipv6 ? ADDRESS_FAMILIES.ipv6 : ADDRESS_FAMILIES.ipv4,
    }
    const connection = { isUp: false }
    try {
      const response = await (seams.send ?? defaultSend)(
        target,
        request.body,
        {
          authorization: `Bearer ${request.key}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        request.signal,
        () => {
          // Connected and past the final fence: the request is dispatched.
          connection.isUp = true
          request.onDispatch?.()
        },
        // Connecting is the last wait: the run must still hold before any
        // request byte is written.
        () => request.proceed(),
      )
      return {
        sent: true,
        status: response.status,
        body: scrubSystemOneBody(await boundedJson(response), request.key),
      }
    } catch (error: unknown) {
      if (!connection.isUp) return notSent
      throw error
    }
  }
}

/**
The route popup's answer, read against the run's identity captured before
it was asked: an answer given while the identity changed (owner, chat
model, source, Ask again) belongs to no run.
*/
async function askUnchanged(
  identity: () => string,
  canCharge: () => Promise<boolean>,
): Promise<'allowed' | 'declined' | 'changed'> {
  const before = identity()
  const isAllowed = await canCharge()
  const isUnchanged = identity() === before
  if (isAllowed && isUnchanged) return 'allowed'
  return isAllowed ? 'changed' : 'declined'
}

/** The C side: lane C's SystemOne runtime over the surface's key, ledger and transport. */
export function createSystemOneSide(
  route: SystemOneRoute,
  io: SystemOneSideIo,
): Phase2SeparateSource {
  const runtime = createSystemOneJudge({
    configuration: () => ({
      generation: io.generation(),
      presetId: route.presetId,
      model: route.model,
      enabled: true,
      selection: io.isExplicit() ? 'explicit' : 'auto',
      confidential: io.confidential(),
      consent: io.consent(route),
      revocation: io.revocation?.() ?? 0,
    }),
    readKey: (providerId) => systemOneKey(io, providerId, route.recipient),
    measureTokens: io.measureTokens,
    reserve: io.reserve,
    post: io.post,
  })
  // The run's identity apart from its consent answer: owner, chat model,
  // engine, source and turn (the generation), the route grant's revocation
  // count, confidentiality and the explicit opt-in.
  const identity = () =>
    JSON.stringify([io.generation(), io.revocation?.() ?? 0, io.confidential(), io.isExplicit()])
  const askConsent = io.askConsent
  return {
    runtime:
      askConsent === undefined
        ? runtime
        : {
            judge: async (request, signal) => {
              const asked = await askUnchanged(identity, () => askConsent(route))
              if (asked === 'declined') return { outcome: 'no-answer', reason: 'consent-declined' }
              return asked === 'changed' || signal.aborted
                ? { outcome: 'no-answer', reason: 'cancelled' }
                : await runtime.judge(request, signal)
            },
          },
    capability: route.capability,
    servedModels: route.servedModels,
    fitVersion: JUDGE_FIT_VERSION,
    // Captured wire and an explicit opt-in: `auto` never reads the route
    // as verified, so its status says why it stays on the same model.
    verified: route.verified && io.isExplicit(),
    locality: 'remote',
  }
}
