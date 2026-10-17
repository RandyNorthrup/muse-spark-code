// What the browser check (dist/browserCheck.js) and the runtime's
// acquisition (dist/browserRuntime.js) exchange (M81 A1, design spec v4 §5).
// Types only: across the bundle boundary nothing is imported as a value
// (the split gate checks it), and the host's loader checks the bundle's one
// function before it is used (PLAN.md §8, the same-build trust pattern).

import type { PreparationFailure } from './browserRun'

/** The four pinned runtimes; any other OS or architecture refuses. */
export type RuntimePlatform = 'win64' | 'linux64' | 'mac-x64' | 'mac-arm64'

/** Why a preparation ended without a runtime. */
export type PreparationReason = PreparationFailure | 'cancelled'

/** A bounded, cancellable piece of work: the preparation, or the check (workLifetime.ts). */
export interface WorkLifetime {
  readonly signal: AbortSignal
  /** The monotonic time (`performance.now()`) it ends at, at the latest. */
  readonly deadlineAt: number
  /**
   * Runs `run` while the lifetime lasts; refuses, and closes a late result,
   * after its end. A step whose value has no `close` names its `dispose`,
   * run on a late value instead.
   */
  step<T>(
    run: (signal: AbortSignal) => Promise<T>,
    dispose?: (value: T) => Promise<void>,
  ): Promise<T>
  /** A cleanup run once at the end, newest first, within the cleanup bound. */
  onEnd(cleanup: () => Promise<void>): void
  /** Ends it now; idempotent. */
  end(): void
}

/** A runtime the runtime bundle verified against the pin this release ships. */
export interface VerifiedRuntime {
  readonly version: string
  readonly platform: RuntimePlatform
  /** Canonical absolute path in the extension's own storage. */
  readonly executable: string
  /** SHA-256 of the pin manifest the verification used. */
  readonly manifestDigest: string
  readonly executableDigest: string
  readonly executableBytes: number
  readonly executableMtimeMs: number
  /** The pin's immutable Stable publication time (ChromiumDash), epoch milliseconds. */
  readonly publishedAtMs: number
}

export type RuntimePreparation =
  | { readonly ok: true; readonly runtime: VerifiedRuntime }
  | { readonly ok: false; readonly reason: PreparationReason }

/** The native question before a download: Download, or anything else. */
export type RuntimeConsent = (
  version: string,
  archiveBytes: number,
  signal: AbortSignal,
) => Promise<'download' | 'decline'>

export interface RuntimePrepareRequest {
  /** The extension's global storage folder. */
  readonly storageDir: string
  /** The preparation's own lifetime (15 minutes), never the check's. */
  readonly lifetime: WorkLifetime
  /** Read around every await: trust, mode, network posture, the runtime setting, the scope. */
  readonly admissionStillValid: () => boolean
  readonly consent: RuntimeConsent
}

/** dist/browserRuntime.js's one export. */
export interface BrowserRuntimeBundle {
  prepareRuntime(request: RuntimePrepareRequest): Promise<RuntimePreparation>
}
