// M110os OS7: the Chrome install gate. Chrome installs only after the
// person accepts Google's terms and clicks install, and the install only
// counts with evidence: the package version and the signing-key
// fingerprint it was verified against. Without Chrome the node uses
// Chromium, which is the default from the start.
import * as z from 'zod/mini'
import { loadOwnerJson, saveOwnerJson } from '../ownerStore'

const browserStateSchema = z.strictObject({
  version: z.literal(1),
  chromeTermsAccepted: z.boolean(),
  chromeInstallRequested: z.boolean(),
  chromeInstalled: z.boolean(),
  chromeVersion: z.nullable(z.string()),
  chromeKeyFingerprint: z.nullable(z.string()),
  defaultBrowser: z.enum(['chromium', 'chrome']),
})

export type BrowserState = z.infer<typeof browserStateSchema>

const BROWSER_FILE = 'browser.json'
const BROWSER_LABEL = 'browser state'

/** A fresh browser state: Chromium is the default, nothing accepted. */
export function createBrowserState(): BrowserState {
  return {
    version: 1,
    chromeTermsAccepted: false,
    chromeInstallRequested: false,
    chromeInstalled: false,
    chromeVersion: null,
    chromeKeyFingerprint: null,
    defaultBrowser: 'chromium',
  }
}

/** Read the state, or null before the first save. A damaged file throws. */
export function loadBrowserState(dir: string): BrowserState | null {
  return loadOwnerJson(dir, BROWSER_FILE, BROWSER_LABEL, browserStateSchema)
}

/** Save the state owner-only. */
export function saveBrowserState(dir: string, state: BrowserState): void {
  saveOwnerJson(dir, BROWSER_FILE, BROWSER_LABEL, state)
}

/** Record the person's acceptance of Google's terms. */
export function acceptChromeTerms(state: BrowserState): BrowserState {
  return { ...state, chromeTermsAccepted: true }
}

export type InstallRequest =
  | { readonly ok: true; readonly state: BrowserState }
  | { readonly ok: false; readonly reason: 'terms' | 'click' | 'installed' }

/**
Request the install: the person's explicit click after the terms. A
repeat request while one is open succeeds unchanged; an installed
Chrome refuses.
*/
export function requestChromeInstall(state: BrowserState, isConfirmed: boolean): InstallRequest {
  if (state.chromeInstalled) return { ok: false, reason: 'installed' }
  if (!state.chromeTermsAccepted) return { ok: false, reason: 'terms' }
  return isConfirmed
    ? { ok: true, state: { ...state, chromeInstallRequested: true } }
    : { ok: false, reason: 'click' }
}

export interface InstallEvidence {
  readonly version: string
  readonly keyFingerprint: string
  /** The pinned fingerprints the executor verified against. */
  readonly pinned: readonly string[]
}

/**
Record a finished install. The fingerprint must be one of the pinned
ones and the version non-empty; anything else throws instead of
recording an install that never verified.
*/
export function recordChromeInstalled(
  state: BrowserState,
  evidence: InstallEvidence,
): BrowserState {
  if (!state.chromeInstallRequested) throw new Error('chrome install was not requested')
  const pinned = evidence.pinned.map((fingerprint) => fingerprint.toUpperCase())
  if (evidence.version.length === 0 || !pinned.includes(evidence.keyFingerprint.toUpperCase())) {
    throw new Error('chrome install evidence is not valid')
  }
  return {
    ...state,
    chromeInstalled: true,
    chromeVersion: evidence.version,
    chromeKeyFingerprint: evidence.keyFingerprint.toUpperCase(),
    defaultBrowser: 'chrome',
  }
}
