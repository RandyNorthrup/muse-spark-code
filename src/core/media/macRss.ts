// macOS has no /proc: the encoder's resident memory comes from the resource
// governor's own process-table read (`trees/posixTable.ts`'s absolute
// /bin/ps, numeric columns and parser, as `trees/mac.ts` reads the table),
// asked for one PID. This is `convert.ts`'s `readRssBytes` port (M105 lane
// VB): a bounded sampler that throws when no reading exists, never 0.

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

export interface MacRssSamplerDeps {
  /** The ps runner (tests); production bounds one run's time and output. */
  readonly run?: ResourceTreeRun
  readonly now?: () => number
  /** Whose child the encoder must be; this process by default. */
  readonly parentPid?: number
}

interface PidState {
  reading?: { readonly bytes: number; readonly at: number }
  pending?: Promise<void>
  hasFailed: boolean
  readAt: number
}

/**
 * `readRssBytes(pid)` over /bin/ps. Conversion asks every few milliseconds;
 * ps runs at most once per `MEDIA_RSS_SAMPLE_INTERVAL_MS` per PID, the next
 * run starts while the last reading is still fresh, and no reading older
 * than `MEDIA_RSS_SAMPLE_MAX_AGE_MS` is returned: past it the call waits
 * for the run, which the caller's own sample deadline bounds. The PID must
 * be a live, non-zombie child of `parentPid` (a reaped PID that the OS
 * reused is someone else's). One failure is final for that PID.
 */
export function macRssSampler(deps: MacRssSamplerDeps = {}): (pid: number) => Promise<number> {
  const run =
    deps.run ?? boundedTreeProgram(MEDIA_RSS_SAMPLE_RUN_TIMEOUT_MS, MEDIA_RSS_SAMPLE_MAX_BYTES)
  const now = deps.now ?? Date.now
  const parentPid = deps.parentPid ?? process.pid
  const states = new Map<number, PidState>()

  const sample = async (pid: number): Promise<number> => {
    const rows = await readMacProcess(pid, run)
    const row = rows?.length === 1 ? rows[0] : undefined
    if (
      row?.pid !== pid ||
      row.parent !== parentPid ||
      row.exited ||
      !Number.isSafeInteger(row.residentBytes) ||
      row.residentBytes <= 0
    )
      throw new RssSampleRefused()
    return row.residentBytes
  }

  // One run per PID at a time; a failure also drops the last reading.
  const refresh = (pid: number, state: PidState): Promise<void> => {
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

  const forgetIdle = (time: number) => {
    for (const [pid, state] of states)
      if (state.pending === undefined && time - state.readAt > MEDIA_RSS_SAMPLE_MAX_AGE_MS)
        states.delete(pid)
  }

  return async (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new RssSampleRefused()
    const time = now()
    forgetIdle(time)
    const state = states.get(pid) ?? { hasFailed: false, readAt: time }
    states.set(pid, state)
    state.readAt = time
    if (state.hasFailed) throw new RssSampleRefused()
    const age = state.reading === undefined ? Infinity : time - state.reading.at
    if (age >= MEDIA_RSS_SAMPLE_INTERVAL_MS) {
      const pending = refresh(pid, state)
      if (age >= MEDIA_RSS_SAMPLE_MAX_AGE_MS) await pending
    }
    const { reading } = state
    if (reading === undefined || now() - reading.at >= MEDIA_RSS_SAMPLE_MAX_AGE_MS)
      throw new RssSampleRefused()
    return reading.bytes
  }
}
