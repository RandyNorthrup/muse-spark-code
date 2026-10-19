// macOS has no /proc: the encoder's resident memory comes from the resource
// governor's own process-table read (`trees/posixTable.ts`'s absolute
// /bin/ps, numeric columns and parser, as `trees/mac.ts` reads the table),
// asked for one PID. This is `convert.ts`'s `readRssBytes` port (M105 lane
// VB): a bounded sampler bound to one encoder's child handle, which throws
// when no reading exists, never 0.

import {
  MEDIA_RSS_SAMPLE_INTERVAL_MS,
  MEDIA_RSS_SAMPLE_MAX_AGE_MS,
  MEDIA_RSS_SAMPLE_MAX_BYTES,
  MEDIA_RSS_SAMPLE_RUN_TIMEOUT_MS,
} from '../../shared/constants'
import { readMacProcess } from '../resources/trees/posixTable'
import { boundedTreeProgram, type ResourceTreeRun } from '../resources/trees/run'

/** No reading: a failed, late, foreign, exited or missing sample refuses the encode. */
export class RssSampleRefused extends Error {
  readonly code = 'EMEDIA_RSS_UNAVAILABLE'
  constructor() {
    super('The encoder memory reading is unavailable')
  }
}

/** The encoder's handle as conversion holds it (a `ChildProcess`): its PID and its exit. */
export interface EncoderChild {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  once(event: 'exit', listener: () => void): unknown
}

export interface MacRssSamplerDeps {
  /** The ps runner (tests); production bounds one run's time and output. */
  readonly run?: ResourceTreeRun
  readonly now?: () => number
  /** Whose child the encoder must be; this process by default. */
  readonly parentPid?: number
}

/**
 * `readRssBytes(pid)` for one encoder, over /bin/ps. Conversion asks every
 * few milliseconds; ps runs at most once per `MEDIA_RSS_SAMPLE_INTERVAL_MS`,
 * the next run starts while the last reading is still fresh, and no reading
 * older than `MEDIA_RSS_SAMPLE_MAX_AGE_MS` is returned: past it the call
 * waits for the run, which the caller's own sample deadline bounds.
 *
 * A reading belongs to one live child identity. Every ps run checks the PID,
 * that its parent is `parentPid`, that it is not a zombie and that its start
 * time is the first run's (a reused PID is someone else). Between runs the
 * child handle vouches for it: its exit drops the reading, and from then on
 * every call refuses, as does a run that finishes after the exit. One
 * failure is final.
 */
export function macRssSampler(
  child: EncoderChild,
  deps: MacRssSamplerDeps = {},
): (pid: number) => Promise<number> {
  const run =
    deps.run ?? boundedTreeProgram(MEDIA_RSS_SAMPLE_RUN_TIMEOUT_MS, MEDIA_RSS_SAMPLE_MAX_BYTES)
  const now = deps.now ?? Date.now
  const parentPid = deps.parentPid ?? process.pid
  const state: {
    hasExited: boolean
    hasFailed: boolean
    started?: string
    reading?: { readonly bytes: number; readonly at: number }
    pending?: Promise<void>
  } = { hasExited: child.exitCode !== null || child.signalCode !== null, hasFailed: false }
  child.once('exit', () => {
    state.hasExited = true
    delete state.reading
  })
  /** Read through a call: an await can change it between two checks. */
  const isUnusable = () => state.hasExited || state.hasFailed

  const sample = async (pid: number): Promise<number> => {
    const found = await readMacProcess(pid, run)
    if (
      found?.row.pid !== pid ||
      found.row.parent !== parentPid ||
      found.row.exited ||
      !Number.isSafeInteger(found.row.residentBytes) ||
      found.row.residentBytes <= 0 ||
      (state.started !== undefined && found.started !== state.started)
    )
      throw new RssSampleRefused()
    state.started ??= found.started
    return found.row.residentBytes
  }

  // One run at a time; a failure drops the reading. A run that ends after the
  // exit never answers: every call checks the exit again after its await.
  const refresh = (pid: number): Promise<void> => {
    if (state.pending !== undefined) return state.pending
    const startedAt = now()
    const pending = (async () => {
      try {
        state.reading = { bytes: await sample(pid), at: startedAt }
      } catch {
        state.hasFailed = true
        delete state.reading
      } finally {
        delete state.pending
      }
    })()
    state.pending = pending
    return pending
  }

  return async (pid) => {
    if (pid !== child.pid || pid <= 0 || !Number.isSafeInteger(pid) || isUnusable())
      throw new RssSampleRefused()
    const age = state.reading === undefined ? Infinity : now() - state.reading.at
    if (age >= MEDIA_RSS_SAMPLE_INTERVAL_MS) {
      const pending = refresh(pid)
      if (age >= MEDIA_RSS_SAMPLE_MAX_AGE_MS) await pending
    }
    const { reading } = state
    if (reading === undefined || isUnusable() || now() - reading.at >= MEDIA_RSS_SAMPLE_MAX_AGE_MS)
      throw new RssSampleRefused()
    return reading.bytes
  }
}
