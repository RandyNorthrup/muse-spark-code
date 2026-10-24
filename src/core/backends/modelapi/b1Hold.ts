// D107 §9.3-§9.6 (M125): the Model API session's B1 hold, built into
// dist/modelApiB1.js with modelApiB1Entry.ts and loaded on the first shell
// ask that reaches the hold with a packaged helper. The session keeps the
// ask and the card; this side opens the session's confined runner, races the
// reviewer against B1's run of the line, and audits a skip. A session with no
// helper never loads it: today's reviewer runs unchanged.

import process from 'node:process'
import {
  raceB1Hold,
  resolveB1Executable,
  type B1Conditions,
  type B1FloorContext,
} from '../../judge/fast/approval'
import {
  b1Realpath,
  openInspectSession,
  type InspectSessionBinding,
} from '../../judge/fast/inspectExec'
import type { JudgeFence } from '../../judge/use'
import { spawnResourceFile } from '../../resources/launcher'
import { JUDGE_FAST_B1_READY_PLATFORMS, JUDGE_FAST_VETO_WINDOW_MS } from '../../../shared/constants'
import { fastPathAuditSchema, type FastPathAudit } from '../../../shared/fastPathAudit'

/**
The session's B1 runner over the packaged helper. Undefined keeps today's
reviewer: no confinement on this platform, no workspace identity, no
scratch. The helper starts through the governed boundary: refused when it
sits inside the workspace, the guarded child environment for it.
*/
export function openB1Runner(
  helper: string,
  workspaceRoot: string,
): Promise<InspectSessionBinding | undefined> {
  return openInspectSession(helper, workspaceRoot, (file, args, options) =>
    spawnResourceFile('bootstrap', file, args, options),
  )
}

/** What one held shell ask hands the hold: the line, the floor, the live answers and the reviewer. */
export interface B1AskPorts<R> {
  /** The line the reviewer would see. */
  readonly line: string
  readonly floor: B1FloorContext
  readonly conditions: Pick<
    B1Conditions,
    'mode' | 'isHeadlessRun' | 'isUntrustedOrigin' | 'isWorkspaceTrusted' | 'sessionProcessAlive'
  >
  /** The ask's own stop: the reviewer and B1's run end with it as with the race. */
  readonly signal: AbortSignal
  /** Today's reviewer, reporting each judge fence it starts through shareFence. */
  readonly startReviewer: (
    signal: AbortSignal,
    shareFence: () => JudgeFence | undefined,
  ) => Promise<R>
  readonly startJudgeFence: () => JudgeFence | undefined
}

/** A won skip: the confined run's delivered output and its well-formed audit. */
export interface B1Skip {
  readonly output: { readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  readonly audit: FastPathAudit
}

/**
One shell ask through the hold: the reviewer races B1's confined run of
the line, the veto polling the judge fence the reviewer starts. A skip
with a well-formed audit comes back for perform to serve; anything else
(not applicable, the reviewer first, a malformed audit) is undefined, and
the session runs today's reviewer fresh, so the card may ask again.
*/
export async function holdB1Ask<R>(
  opened: InspectSessionBinding,
  ports: B1AskPorts<R>,
): Promise<B1Skip | undefined> {
  const outcome = await raceB1Hold<R>({
    line: ports.line,
    platform: process.platform,
    floor: ports.floor,
    conditions: {
      ...ports.conditions,
      // The runner opened: its helper is there, its scratch is made, and
      // the platform confines. The race's first run is the session's
      // self-test; the runner latches a failure.
      confinementReady: true,
      platform: process.platform,
      certifiedPlatforms: JUDGE_FAST_B1_READY_PLATFORMS,
    },
    startReviewer: (raceSignal, shareFence) =>
      ports.startReviewer(AbortSignal.any([ports.signal, raceSignal]), shareFence),
    startJudgeFence: ports.startJudgeFence,
    runInspect: (canonical, raceSignal) =>
      opened.runner.run(canonical, opened.workspace, AbortSignal.any([ports.signal, raceSignal])),
    vetoWindowMs: JUDGE_FAST_VETO_WINDOW_MS,
  })
  if (outcome.kind !== 'skip') return undefined
  // The skip won and the reviewer is cancelled: only a well-formed audit
  // sends it.
  const executable = resolveB1Executable(outcome.parsed.program, b1Realpath)
  const audit = fastPathAuditSchema.safeParse({
    class: 'B1',
    program: outcome.parsed.program,
    ...(executable !== undefined && { executable }),
    confinement: opened.confinement,
    confinementVersion: opened.runner.probedAbi,
    deadlineMs: JUDGE_FAST_VETO_WINDOW_MS,
    excluded: outcome.excluded,
    ...(outcome.detail !== undefined && {
      engine: outcome.detail.engine,
      pYesMilli: outcome.detail.pYesMilli,
      thresholdMilli: outcome.detail.thresholdMilli,
    }),
  })
  if (!audit.success) return undefined
  return {
    output: { stdout: outcome.stdout, stderr: outcome.stderr, exitCode: outcome.exitCode },
    audit: audit.data,
  }
}
