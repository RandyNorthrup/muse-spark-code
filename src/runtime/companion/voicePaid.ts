import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { PaidUseConsent, type PaidUseAnswer } from '../../core/paid/paidConsent'
import type { PaidUsage } from '../../core/paid/paidFeatures'
import type { CoreLogger } from '../../core/logging'
import type { SpendClaim } from '../../core/paid/spendClaim'
import type { PaidGrantStore } from '../../acp/paid'
import { unlessAborted } from '../../core/timeouts'
import { companionWavSeconds } from '../../shared/companionWav'
import {
  MODEL_API_BASE_URL,
  MUSE_VOICE_MODEL,
  MILLISECONDS_PER_SECOND,
  PAID_PRICES_USD,
  SECONDS_PER_HOUR,
  UI_TEXT,
  VOICE_TEXT_MAX_BYTES,
} from '../../shared/constants'
import { Usd, type UsdAmount } from '../../shared/usd'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { fill } from '../../shared/l10n/text'
import type { CompanionVoiceWindow } from './voiceHandler'

// U18 T9, round3-2026-10-08.jsonl: PUSH_TO_TALK JSON, 3 captured attempts.
const responseSchema = z.object({
  sessionId: z.string(),
  transcript: z.string(),
  audioDurationMs: z.number().check(z.gte(0)),
  turns: z.array(
    z.object({
      turnId: z.number(),
      startMs: z.number(),
      endMs: z.number(),
      transcript: z.string(),
      speaker: z.string(),
    }),
  ),
})
const digest = (key: string) => createHash('sha256').update(key).digest('hex')
const voiceCost = (milliseconds: number) =>
  Usd.from(PAID_PRICES_USD.voicePerHour)
    .times(milliseconds)
    .divideIntegerCeiling(SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND)

export function paidVoiceWindow(deps: {
  readonly getKey: () => Promise<string | undefined>
  readonly isOn: () => boolean
  readonly isCurrent: () => boolean
  readonly canRemember: () => boolean
  readonly workspaceRoot: string
  readonly grants: PaidGrantStore
  readonly dailyBudgetUsd: () => UsdAmount
  readonly reserve: (cost: UsdAmount, signal: AbortSignal) => Promise<SpendClaim | undefined>
  readonly usage: Pick<PaidUsage, 'addVoiceBatch'>
  readonly fetch: typeof globalThis.fetch
  readonly log: CoreLogger
}): CompanionVoiceWindow {
  let consent: PaidUseConsent | undefined
  let identity: string | undefined
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted()
    if (!deps.isOn() || !deps.isCurrent()) throw new Error(UI_TEXT.museVoiceRefused)
  }
  return {
    async prepare(ask, signal) {
      check(signal)
      const held = { key: await deps.getKey() }
      let current: string
      try {
        check(signal)
        if (held.key === undefined) throw new Error(UI_TEXT.museVoiceNoKey)
        current = digest(held.key)
      } finally {
        held.key = undefined
      }
      if (current !== identity) {
        consent = undefined
        identity = current
      }
      const scope = `${deps.workspaceRoot}/${current}/${PAID_PRICES_USD.voicePerHour}`
      const answer = async (
        title: string,
        detail: string,
        canRemember: boolean,
      ): Promise<PaidUseAnswer> =>
        (await unlessAborted(ask(title, detail, canRemember), signal)) ?? 'deny'
      consent ??= new PaidUseConsent({
        isOn: () => deps.isOn() && deps.isCurrent(),
        windowOnceFeatures: new Set(['voice']),
        canRemember: deps.canRemember,
        readGrants: () => deps.grants.read(scope),
        writeGrants: (grants) => deps.grants.add(scope, [...grants]),
        ask: () => Promise.resolve('deny'),
        log: deps.log,
      })
      const isAllowed = await consent.allows(
        { feature: 'voice' },
        false,
        (_request, canRemember) =>
          answer(
            UI_TEXT.paidUseVoiceTitle,
            [
              fill(UI_TEXT.paidUseVoiceDetail, {
                price: fill(UI_TEXT.paidVoicePrice, {
                  price: formatUsd(PAID_PRICES_USD.voicePerHour, 2),
                }),
              }),
              fill(UI_TEXT.paidDailyBudgetLine, { budget: formatUsd(deps.dailyBudgetUsd(), 2) }),
            ].join('\n\n'),
            canRemember,
          ),
        signal,
      )
      check(signal)
      if (!isAllowed) throw new Error(UI_TEXT.museVoiceRefused)
    },
    async transcribe(wav, signal) {
      check(signal)
      const seconds = companionWavSeconds(wav)
      const boundMs = Math.ceil(seconds * MILLISECONDS_PER_SECOND)
      const bound = voiceCost(boundMs)
      const held = { key: await deps.getKey() }
      try {
        check(signal)
        if (consent === undefined || held.key === undefined || digest(held.key) !== identity)
          throw new Error(UI_TEXT.museVoiceRefused)
      } finally {
        held.key = undefined
      }
      const claim = await deps.reserve(bound.toAmount(), signal)
      let hasSent = false
      let receiptMs: number | undefined
      try {
        check(signal)
        // Key rotation during durable admission invalidates this capture.
        held.key = await deps.getKey()
        check(signal)
        if (held.key === undefined || digest(held.key) !== identity)
          throw new Error(UI_TEXT.museVoiceRefused)
        claim?.check()
        const id = randomUUID()
        const form = new FormData()
        form.append(
          'request',
          JSON.stringify({ model: MUSE_VOICE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' }),
        )
        form.append(
          'audio',
          new Blob([Uint8Array.from(wav)], { type: 'audio/wav' }),
          'dictation.wav',
        )
        hasSent = true
        const response = await deps.fetch(`${MODEL_API_BASE_URL}/asr/transcribe?sessionId=${id}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${held.key}`, Accept: 'application/json' },
          body: form,
          signal,
          redirect: 'error',
        })
        held.key = undefined
        if (!response.ok || response.body === null) throw new Error(UI_TEXT.companionVoiceFailed)
        const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
        let text = ''
        let bytes = 0
        const decoder = new TextDecoder('utf-8', { fatal: true })
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > VOICE_TEXT_MAX_BYTES) throw new Error(UI_TEXT.companionVoiceFailed)
            text += decoder.decode(chunk.value, { stream: true })
          }
          text += decoder.decode()
        } finally {
          await reader.cancel()
          reader.releaseLock()
        }
        const raw: unknown = JSON.parse(text)
        const result = responseSchema.parse(raw)
        if (result.sessionId !== id || !Number.isSafeInteger(result.audioDurationMs))
          throw new Error(UI_TEXT.companionVoiceFailed)
        // U18: returned audioDurationMs, rounded DOWN to seconds, is the bill.
        receiptMs = result.audioDurationMs
        if (receiptMs > boundMs) throw new Error(UI_TEXT.sessionBudgetVoiceUnavailable)
        held.key = await deps.getKey()
        check(signal)
        if (held.key === undefined || digest(held.key) !== identity)
          throw new Error(UI_TEXT.museVoiceRefused)
        if (result.transcript.trim() === '') throw new Error(UI_TEXT.companionVoiceFailed)
        return { text: result.transcript, seconds: Math.floor(receiptMs / MILLISECONDS_PER_SECOND) }
      } finally {
        held.key = undefined
        const billedMs =
          receiptMs === undefined
            ? undefined
            : Math.floor(receiptMs / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND
        try {
          if (hasSent)
            deps.usage.addVoiceBatch(
              billedMs === undefined ? seconds : billedMs / MILLISECONDS_PER_SECOND,
              billedMs === undefined
                ? { uncertain: true, retainedLiabilityUsd: bound.toAmount(), outcome: 'failed' }
                : {},
            )
        } finally {
          const billedCost = billedMs === undefined ? bound : voiceCost(billedMs)
          // An unknown bill is counted as cost unknown, never the bound (D208).
          const hasUnknownCost = hasSent && billedMs === undefined
          if (claim !== undefined) {
            if (!hasSent) await claim.settle(Usd.from(0).toAmount())
            else if (hasUnknownCost) await claim.settle(undefined)
            else await claim.settle(billedCost.toAmount())
          }
        }
      }
    },
  }
}
