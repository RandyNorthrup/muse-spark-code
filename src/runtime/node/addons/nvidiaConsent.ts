// M110os OS5: the NVIDIA install gate. The driver installs only after the
// person accepts NVIDIA's license and clicks install, and the install
// only counts with evidence: the package version, the module flavour it
// installed, and the signing-key fingerprint it was verified against.
import * as z from 'zod/mini'
import { loadOwnerJson, saveOwnerJson } from '../ownerStore'

const nvidiaStateSchema = z.strictObject({
  version: z.literal(1),
  nvidiaTermsAccepted: z.boolean(),
  nvidiaInstallRequested: z.boolean(),
  nvidiaInstalled: z.boolean(),
  nvidiaVersion: z.nullable(z.string()),
  nvidiaFlavor: z.nullable(z.enum(['open', 'proprietary'])),
  nvidiaKeyFingerprint: z.nullable(z.string()),
})

export type NvidiaState = z.infer<typeof nvidiaStateSchema>

const NVIDIA_FILE = 'nvidia.json'
const NVIDIA_LABEL = 'nvidia state'

/** A fresh NVIDIA state: the driver is not accepted, requested or installed. */
export function createNvidiaState(): NvidiaState {
  return {
    version: 1,
    nvidiaTermsAccepted: false,
    nvidiaInstallRequested: false,
    nvidiaInstalled: false,
    nvidiaVersion: null,
    nvidiaFlavor: null,
    nvidiaKeyFingerprint: null,
  }
}

/** Read the state, or null before the first save. A damaged file throws. */
export function loadNvidiaState(dir: string): NvidiaState | null {
  return loadOwnerJson(dir, NVIDIA_FILE, NVIDIA_LABEL, nvidiaStateSchema)
}

/** Save the state owner-only. */
export function saveNvidiaState(dir: string, state: NvidiaState): void {
  saveOwnerJson(dir, NVIDIA_FILE, NVIDIA_LABEL, state)
}

/** Record the person's acceptance of NVIDIA's license. */
export function acceptNvidiaTerms(state: NvidiaState): NvidiaState {
  return { ...state, nvidiaTermsAccepted: true }
}

export type NvidiaInstallRequest =
  | { readonly ok: true; readonly state: NvidiaState }
  | { readonly ok: false; readonly reason: 'terms' | 'click' | 'installed' }

/**
Request the install: the person's explicit click after the license. A
repeat request while one is open succeeds unchanged; an installed
driver refuses.
*/
export function requestNvidiaInstall(
  state: NvidiaState,
  isConfirmed: boolean,
): NvidiaInstallRequest {
  if (state.nvidiaInstalled) return { ok: false, reason: 'installed' }
  if (!state.nvidiaTermsAccepted) return { ok: false, reason: 'terms' }
  return isConfirmed
    ? { ok: true, state: { ...state, nvidiaInstallRequested: true } }
    : { ok: false, reason: 'click' }
}

export interface NvidiaInstallEvidence {
  readonly version: string
  readonly flavor: 'open' | 'proprietary'
  readonly keyFingerprint: string
  /** The pinned fingerprints the executor verified against. */
  readonly pinned: readonly string[]
}

/**
Record a finished install. The fingerprint must be one of the pinned
ones and the version non-empty; anything else throws instead of
recording an install that never verified.
*/
export function recordNvidiaInstalled(
  state: NvidiaState,
  evidence: NvidiaInstallEvidence,
): NvidiaState {
  if (!state.nvidiaInstallRequested) throw new Error('nvidia install was not requested')
  const pinned = evidence.pinned.map((fingerprint) => fingerprint.toUpperCase())
  if (evidence.version.length === 0 || !pinned.includes(evidence.keyFingerprint.toUpperCase())) {
    throw new Error('nvidia install evidence is not valid')
  }
  return {
    ...state,
    nvidiaInstalled: true,
    nvidiaVersion: evidence.version,
    nvidiaFlavor: evidence.flavor,
    nvidiaKeyFingerprint: evidence.keyFingerprint.toUpperCase(),
  }
}
