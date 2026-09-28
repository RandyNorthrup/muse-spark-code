// Muse Code 1.4.0-R4302.1's device sign-in as captured live on 2026-09-27 in
// throwaway homes (test/fixtures/msp/account-login-*.json;
// docs/certification/sign-in-detection.md, "Live capture"; 0 model
// attempts). The unit tests and the fake CLI (test/e2e/fake-muse/serve.mjs)
// replay these frames, not guesses (AGENTS.md rule 13). The user code is its
// shape, AAAA-AAAA; the account's label and avatar are stand-ins.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NotificationHandler } from '@muse-code/sdk'
import * as z from 'zod/mini'

/** The folder the fake CLI reads the captures from (MUSE_FAKE_CAPTURES). */
export const CAPTURES_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'msp',
)

const captureSchema = z.object({
  frames: z.array(
    z.object({
      atMs: z.number(),
      dir: z.enum(['in', 'out']),
      frame: z.object({
        jsonrpc: z.literal('2.0'),
        id: z.optional(z.number()),
        method: z.optional(z.string()),
        params: z.optional(z.record(z.string(), z.unknown())),
        result: z.optional(z.record(z.string(), z.unknown())),
        emittedAtMs: z.optional(z.number()),
      }),
    }),
  ),
})

type CaptureName = 'expired' | 'cancelled' | 'granted' | 'denied' | 'failed'
type CapturedNotification = Parameters<NotificationHandler>[0]

function framesOf(name: CaptureName) {
  const file = path.join(CAPTURES_FOLDER, `account-login-${name}.json`)
  return captureSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).frames
}

/** What the captured host answered each time it was asked `method`, in order. */
function answersOf(name: CaptureName, method: string): Record<string, unknown>[] {
  const frames = framesOf(name)
  return frames
    .filter((entry) => entry.dir === 'out' && entry.frame.method === method)
    .flatMap((asked): Record<string, unknown>[] => {
      const answer = frames.find((entry) => entry.dir === 'in' && entry.frame.id === asked.frame.id)
        ?.frame.result
      return answer === undefined ? [] : [answer]
    })
}

/** What the captured host answered the first time it was asked `method`. */
function answerOf(name: CaptureName, method: string): Record<string, unknown> {
  const [first] = answersOf(name, method)
  if (first === undefined) {
    throw new Error(`the ${name} capture has no answer to ${method}`)
  }
  return first
}

/** The captured `account/loginCompleted` frame, as it arrived. */
function endingOf(name: CaptureName): CapturedNotification {
  const frame = framesOf(name).find(
    (entry) => entry.dir === 'in' && entry.frame.method === 'account/loginCompleted',
  )?.frame
  if (frame?.method === undefined) {
    throw new Error(`the ${name} capture has no account/loginCompleted`)
  }
  return {
    jsonrpc: frame.jsonrpc,
    method: frame.method,
    ...(frame.params !== undefined && { params: frame.params }),
    ...(frame.emittedAtMs !== undefined && { emittedAtMs: frame.emittedAtMs }),
  }
}

/** How long a code lived: from loginStart's answer to the `expired` ending (600.5 s). */
function codeLifetimeMs(): number {
  const frames = framesOf('expired')
  const started = frames.find((entry) => entry.frame.result?.['userCode'] !== undefined)
  const ended = frames.find((entry) => entry.frame.method === 'account/loginCompleted')
  if (started === undefined || ended === undefined) {
    throw new Error('the expired capture has no loginStart answer or no ending')
  }
  return ended.atMs - started.atMs
}

/** The first `account/read` answer in the granted capture that shows the sign-in. */
function signedInAnswer(): Record<string, unknown> {
  const signedIn = answersOf('granted', 'account/read').find(
    (answer) => answer['state'] === 'accountLogin' && answer['label'] !== undefined,
  )
  if (signedIn === undefined) {
    throw new Error('the granted capture has no signed-in account/read answer')
  }
  return signedIn
}

export const CAPTURED_CODE_LIFETIME_MS = codeLifetimeMs()
/** `account/loginStart {type: "deviceCode"}`: `{verificationUrl, userCode}`. */
export const CAPTURED_LOGIN_START = answerOf('cancelled', 'account/loginStart')
/** `account/read` with nothing stored: `{state: "loggedOut", credentialRequired: true}`. */
export const CAPTURED_LOGGED_OUT = answerOf('expired', 'account/read')
/**
 * `account/read` once the browser approved: `{state: "accountLogin", label,
 * avatarUrl, credentialRequired: true}`; the label is an e-mail address in
 * real life (a stand-in here), and `avatarUrl` is not in the MSP schema.
 */
export const CAPTURED_SIGNED_IN = signedInAnswer()
/** 600 s after loginStart: `{outcome: "expired", message: "login failed: the request expired"}`. */
export const CAPTURED_EXPIRED_ENDING = endingOf('expired')
/** Sent before the loginCancel answer: `{outcome: "cancelled"}`, no message. */
export const CAPTURED_CANCELLED_ENDING = endingOf('cancelled')
/**
 * `{outcome: "granted"}`, no message: after the file was written and
 * `account/read` already said `accountLogin` (205 ms after `account/changed`).
 */
export const CAPTURED_GRANTED_ENDING = endingOf('granted')
/** Deny clicked: `{outcome: "denied", message: "login failed: the request was denied"}`. */
export const CAPTURED_DENIED_ENDING = endingOf('denied')
/**
 * Approved, but the file could not be written: `{outcome: "failed", message:
 * "login succeeded but saving failed: failed to write credential file at
 * <path>: …"}`; the message names a path under the user's profile.
 */
export const CAPTURED_FAILED_ENDING = endingOf('failed')
/** `account/loginCancel` with a flow pending: `{cancelled: true}`. */
export const CAPTURED_CANCEL_ANSWER = answerOf('cancelled', 'account/loginCancel')
/** `account/loginCancel` after the flow ended: `{cancelled: false}`. */
export const CAPTURED_CANCEL_AFTER_ENDING = answerOf('expired', 'account/loginCancel')

/**
 * The captured ending frame carrying a word no capture covers (a future
 * one): as the `cancelled` capture, the outcome alone.
 */
export function endingNamed(outcome: string): CapturedNotification {
  return { ...CAPTURED_CANCELLED_ENDING, params: { outcome } }
}
