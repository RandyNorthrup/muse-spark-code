// The production SystemOne (C) side (M98 phase 2 redesign). A separate id
// `<presetId>:<model>` names one of M95's SystemOne presets and one of its
// captured request models (`openrouter-jev:typesafe/jev-1.13`). The user's
// own key for that preset's provider, already in M95's credential store
// (SecretStorage in the window, the OS store for the CLI), pays; no second
// key store exists. Experimental, untested and opt-in (PLAN 2c and the
// owner's TypeSafe ruling): only an explicit `separate` or `both` engine
// selects it, `auto` never does, and it only adds caution to the Muse
// judge. It never answers the user, writes code or settles a decision alone.
import * as z from 'zod/mini'
import { capabilities, credentialRecord, presets } from '../../../host/backend/providersEntry'
import { JUDGE_FIT_VERSION, JUDGE_MAX_BODY_BYTES } from '../../../shared/constants'
import type { Phase2SeparateSource } from '../binding'
import type { JudgeCapability } from '../schema'
import { systemOneUsd } from './policy'
import { createSystemOneJudge, type SystemOneJudgeDependencies } from './source'

const { systemOneCapability } = capabilities
const { systemOnePresetById } = presets
const { isCredentialBound, parseCredentialRecord } = credentialRecord

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
  /** Paid consent for this route's price, asked before the first charge. */
  readonly consent: () => 'granted' | 'needed' | 'declined'
  readonly confidential: () => boolean
  readonly measureTokens: (text: string) => number
  /** An explicit `separate`/`both` engine; `auto` never selects an untested route. */
  readonly isExplicit: () => boolean
  /**
   * The window's paid-use popup for this route's price and recipient, asked
   * before the first charge (D48). Absent on a surface whose admission is
   * its hard budget (the CLI's `--budget-usd`).
   */
  readonly askConsent?: ((route: SystemOneRoute) => Promise<boolean>) | undefined
}

/**
 * The key for one provider id, only when M95's record binds it to exactly
 * the route's origin. A damaged, unbound or absent record reads as no key.
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
  } catch {
    return undefined
  }
  const record = parseCredentialRecord(value)
  const secret = storedSecretSchema.safeParse(value)
  return record?.auth === 'apiKey' && isCredentialBound(record, origin) && secret.success
    ? secret.data.secret
    : undefined
}

/**
 * The SystemOne POST over the platform's `fetch`: the preset's fixed
 * origin and path only, the key as a bearer header, no redirect followed,
 * and a bounded JSON body. A thrown send keeps its liability (lane C's
 * source treats it as sent); only a parsed 200 can become an answer.
 */
export function fetchSystemOnePost(fetcher: typeof fetch): SystemOneJudgeDependencies['post'] {
  return async (request) => {
    const response = await fetcher(new URL(request.path, request.origin), {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${request.key}`, 'content-type': 'application/json' },
      body: request.body,
      signal: request.signal,
    })
    const text = await response.text()
    let body: unknown
    try {
      body = Buffer.byteLength(text) <= JUDGE_MAX_BODY_BYTES ? JSON.parse(text) : undefined
    } catch {
      body = undefined
    }
    return { sent: true, status: response.status, body }
  }
}

/** The C side: lane C's SystemOne runtime over the surface's key, ledger and transport. */
export function createSystemOneSide(
  route: SystemOneRoute,
  io: SystemOneSideIo,
): Phase2SeparateSource {
  const runtime = createSystemOneJudge({
    configuration: () => ({
      generation: 0,
      presetId: route.presetId,
      model: route.model,
      enabled: true,
      selection: io.isExplicit() ? 'explicit' : 'auto',
      confidential: io.confidential(),
      consent: io.consent(),
    }),
    readKey: (providerId) => systemOneKey(io, providerId, route.recipient),
    measureTokens: io.measureTokens,
    reserve: io.reserve,
    post: io.post,
  })
  const askConsent = io.askConsent
  return {
    runtime:
      askConsent === undefined
        ? runtime
        : {
            judge: async (request, signal) =>
              (await askConsent(route))
                ? await runtime.judge(request, signal)
                : { outcome: 'no-answer', reason: 'consent-declined' },
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
