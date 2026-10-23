// M110os OS3: the setup's own state. Owner-only on disk, zod-validated on
// every read. The code is kept as a hash and wiped at completion; a
// completed setup answers every route with the done page until its unit
// stops the server.
import { createHash, timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'
import { loadOwnerJson, saveOwnerJson } from '../ownerStore'
import { setupChoicesSchema, setupNetworkSchema, type SetupChoices } from './schemas'
import { issueRecoveryKey, normalizeSetupCode } from './setupCode'
import type { SeedOutcome } from './seed'

const setupStateSchema = z.strictObject({
  version: z.literal(1),
  codeSha256: z.nullable(z.string()),
  codeConsumed: z.boolean(),
  choices: z.nullable(setupChoicesSchema),
  completed: z.boolean(),
  seedHostname: z.nullable(z.string()),
  seedNetwork: z.nullable(setupNetworkSchema),
  seedSshKeys: z.array(z.string()),
  seedIgnored: z.array(z.string()),
  seedRefusal: z.nullable(z.string()),
  recoveryKey: z.nullable(z.string()),
})

export type SetupState = z.infer<typeof setupStateSchema>

const STATE_FILE = 'setup.json'
const STATE_LABEL = 'setup state'

/** The code's hash: what the store keeps instead of the code. */
export function hashSetupCode(code: string): string {
  return createHash('sha256').update(normalizeSetupCode(code), 'utf8').digest('hex')
}

/** A fresh setup holding one code. */
export function createSetupState(code: string): SetupState {
  return {
    version: 1,
    codeSha256: hashSetupCode(code),
    codeConsumed: false,
    choices: null,
    completed: false,
    seedHostname: null,
    seedNetwork: null,
    seedSshKeys: [],
    seedIgnored: [],
    seedRefusal: null,
    recoveryKey: null,
  }
}

/** Fold a consumed seed into a fresh setup: prefill, notes and refusal. */
export function applySeed(state: SetupState, outcome: SeedOutcome): SetupState {
  if (state.codeConsumed || state.completed) throw new Error('setup already started')
  if (!outcome.ok) return { ...state, seedRefusal: outcome.code }
  return {
    ...state,
    seedHostname: outcome.user.hostname ?? null,
    seedNetwork: outcome.network.network,
    seedSshKeys: [...outcome.user.sshKeys],
    seedIgnored: [...outcome.network.ignored, ...outcome.user.ignored],
  }
}

/** Read the state, or null before the first save. A damaged file throws. */
export function loadSetupState(dir: string): SetupState | null {
  return loadOwnerJson(dir, STATE_FILE, STATE_LABEL, setupStateSchema)
}

/** Save the state owner-only. */
export function saveSetupState(dir: string, state: SetupState): void {
  saveOwnerJson(dir, STATE_FILE, STATE_LABEL, state)
}

export type AcceptCodeResult =
  | { readonly ok: true; readonly state: SetupState }
  | { readonly ok: false; readonly reason: 'wrong' | 'used' | 'completed' }

/** Spend the code, or say why it does not open the setup. */
export function acceptSetupCode(state: SetupState, candidate: string): AcceptCodeResult {
  if (state.completed) return { ok: false, reason: 'completed' }
  if (state.codeConsumed || state.codeSha256 === null) return { ok: false, reason: 'used' }
  const candidateHash = hashSetupCode(candidate)
  const expected = Buffer.from(state.codeSha256, 'utf8')
  const actual = Buffer.from(candidateHash, 'utf8')
  return expected.length !== actual.length || !timingSafeEqual(expected, actual)
    ? { ok: false, reason: 'wrong' }
    : { ok: true, state: { ...state, codeConsumed: true } }
}

/**
Record the wizard's choices once the code has opened the setup, with a
fresh recovery key for the disk enrollment to consume.
*/
export function recordChoices(state: SetupState, choices: SetupChoices): SetupState {
  if (state.completed) throw new Error('setup is already complete')
  if (!state.codeConsumed) throw new Error('setup code not accepted')
  return { ...state, choices, recoveryKey: issueRecoveryKey() }
}

/** Whether a presented code opens a setup already past its gate. */
export function isCodeHolder(state: SetupState, candidate: string): boolean {
  if (state.completed || !state.codeConsumed || state.codeSha256 === null) return false
  const expected = Buffer.from(state.codeSha256, 'utf8')
  const actual = Buffer.from(hashSetupCode(candidate), 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Finish the setup: the code hash is wiped and never verified again. */
export function completeSetup(state: SetupState): SetupState {
  if (state.completed) throw new Error('setup is already complete')
  if (state.choices === null) throw new Error('setup has no choices')
  return { ...state, choices: state.choices, completed: true, codeSha256: null }
}
