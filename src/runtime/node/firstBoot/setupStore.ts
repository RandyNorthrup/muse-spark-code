// M110os OS3: the setup's own state. Owner-only on disk, zod-validated on
// every read. The code is kept as a hash and wiped at completion; a
// completed setup answers every route with the done page until its unit
// stops the server.
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { setupChoicesSchema, type SetupChoices } from './schemas'
import { normalizeSetupCode } from './setupCode'

const setupStateSchema = z.strictObject({
  version: z.literal(1),
  codeSha256: z.nullable(z.string()),
  codeConsumed: z.boolean(),
  choices: z.nullable(setupChoicesSchema),
  completed: z.boolean(),
})

export type SetupState = z.infer<typeof setupStateSchema>

const STATE_FILE = 'setup.json'

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
  }
}

function stateFile(dir: string): string {
  return path.join(dir, STATE_FILE)
}

/** Read the state, or null before the first save. A damaged file throws. */
export function loadSetupState(dir: string): SetupState | null {
  let text: string
  try {
    text = readFileSync(stateFile(dir), 'utf8')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw new Error('setup state is not readable', { cause: error })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error('setup state is not valid', { cause: error })
  }
  const checked = setupStateSchema.safeParse(raw)
  if (!checked.success) throw new Error('setup state is not valid', { cause: checked.error })
  return checked.data
}

/** Save the state owner-only. */
export function saveSetupState(dir: string, state: SetupState): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(stateFile(dir), JSON.stringify(state), { mode: 0o600 })
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

/** Record the wizard's choices once the code has opened the setup. */
export function recordChoices(state: SetupState, choices: SetupChoices): SetupState {
  if (state.completed) throw new Error('setup is already complete')
  if (!state.codeConsumed) throw new Error('setup code not accepted')
  return { ...state, choices }
}

/** Finish the setup: the code hash is wiped and never verified again. */
export function completeSetup(state: SetupState): SetupState {
  if (state.completed) throw new Error('setup is already complete')
  if (state.choices === null) throw new Error('setup has no choices')
  return { ...state, choices: state.choices, completed: true, codeSha256: null }
}
