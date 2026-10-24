// M125 lane F1b drill: the hold against the real helper, the real
// governor and the real clock. No model, no judge backend, no
// network: the veto never settles, so the reviewer wins by fallback.
// The drill proves the fallback runs real confinement and returns
// the reviewer's verdict without waiting out the window. The drill
// supplies the platform claim under test (Linux); production passes
// the certified constant, which is empty. The skip path needs a
// settling veto (a judge run), which waits for the owner's go; its
// logic is covered by the hold and race suites over the ports.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  raceB1Hold,
  type B1ConditionReason,
  type B1Conditions,
  type B1FloorContext,
  type B1HoldOutcome,
} from '../../src/core/judge/fast/approval'
import {
  closeInspectSession,
  openInspectSession,
  type InspectSessionBinding,
} from '../../src/core/judge/fast/inspectExec'
import { configureResources } from '../../src/core/resources/admission'
import { spawnResourceProcess } from '../../src/core/resources/launcher'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import {
  JUDGE_FAST_B1_MAX_ABI,
  JUDGE_FAST_B1_MIN_ABI,
  JUDGE_FAST_B1_READY_PLATFORMS,
  JUDGE_FAST_VETO_WINDOW_MS,
} from '../../src/shared/constants'

interface DrillVerdict {
  readonly approved: boolean
}

const FLOOR: B1FloorContext = {
  settledBy: undefined,
  tool: { network: false, paid: false, spawn: false, mcpWrite: false },
  confidentialNonlocal: false,
}

function conditions(over: Partial<B1Conditions>): B1Conditions {
  return {
    mode: 'onRequest',
    isHeadlessRun: false,
    isUntrustedOrigin: false,
    isWorkspaceTrusted: true,
    sessionProcessAlive: false,
    confinementReady: true,
    platform: process.platform,
    certifiedPlatforms: JUDGE_FAST_B1_READY_PLATFORMS,
    ...over,
  }
}

/** The hold refuses the race for the reason, starting neither port. */
async function expectNotApplicable(
  over: Partial<B1Conditions>,
  reason: B1ConditionReason,
): Promise<void> {
  const outcome = await raceB1Hold<DrillVerdict>({
    line: 'ls',
    platform: process.platform,
    floor: FLOOR,
    conditions: conditions(over),
    startReviewer: () => {
      throw new Error('the reviewer must not start')
    },
    startJudgeFence: () => undefined,
    runInspect: () => {
      throw new Error('the run must not start')
    },
  })
  expect(outcome).toEqual({ kind: 'notApplicable', reason })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
Races `ls` over the live session on the drill's Linux claim against a
reviewer that answers after `reviewerMs` and starts no fence: this rig
has no judge backend, so the veto never settles.
*/
function raceLiveReviewer(
  live: InspectSessionBinding,
  verdict: DrillVerdict,
  reviewerMs: number,
): Promise<B1HoldOutcome<DrillVerdict>> {
  return raceB1Hold<DrillVerdict>({
    line: 'ls',
    platform: process.platform,
    floor: FLOOR,
    conditions: conditions({ certifiedPlatforms: ['linux'] }),
    startReviewer: async () => {
      await sleep(reviewerMs)
      return verdict
    },
    startJudgeFence: () => undefined,
    runInspect: (canonical, raceSignal) => live.runner.run(canonical, live.workspace, raceSignal),
  })
}

describe('B1 hold drill', () => {
  let workspace = ''
  let binding: InspectSessionBinding | undefined
  let unconfigure: (() => void) | undefined

  // The C compiles measured ~7 s on linuxlt, like the native suite's
  // own hook: this hook carries the same shared fixture-build budget.
  beforeAll(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'b1-drill-'))
    // The governor is configured as the extension host configures it;
    // without it the bootstrap spawn has no admission.
    unconfigure = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob: runtimeWindowsJob(path.join(root, 'jobs'), process.cwd()),
    })
    workspace = path.join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(path.join(workspace, 'allowed.txt'), 'ALLOWED_CANARY\n')
    try {
      execFileSync(process.execPath, ['scripts/build-confine.mjs'], {
        env: { PATH: '/usr/bin:/bin' },
        timeout: 100_000,
      })
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error
      throw new Error('the drill needs its helper binary', { cause: error })
    }
    binding = await openInspectSession(
      path.resolve('temp/confine/muse-confine'),
      workspace,
      (file, args, options) => spawnResourceProcess('bootstrap', file, args, options),
    )
  }, 100_000)

  afterAll(async () => {
    await closeInspectSession(binding)
    unconfigure?.()
  })

  it('runs no race on an uncertified platform', async () => {
    await expectNotApplicable({}, 'uncertifiedPlatform')
  })

  it('the session probes its confinement', async () => {
    if (binding === undefined || process.platform !== 'linux') {
      await expectNotApplicable({}, 'uncertifiedPlatform')
      return
    }
    const ran = await binding.runner.run('ls', binding.workspace)
    if (ran.kind === 'refused') {
      // A rig that id-maps the system files away from root: the
      // self-test fails closed on the untrusted ancestry, as the
      // native suite's own run-or-refuse rows do.
      expect(ran.reason).toBe('systemFile')
      return
    }
    expect(ran.stdout).toContain('allowed.txt')
    const abi = binding.runner.probedAbi
    expect(abi).toBeGreaterThanOrEqual(JUDGE_FAST_B1_MIN_ABI)
    expect(abi).toBeLessThanOrEqual(JUDGE_FAST_B1_MAX_ABI)
  })

  it('falls back to a slow reviewer over the real run', async () => {
    if (process.platform !== 'linux') {
      // The drill claims Linux only; anywhere else the claim misses.
      await expectNotApplicable({ certifiedPlatforms: ['linux'] }, 'uncertifiedPlatform')
      return
    }
    if (binding === undefined) {
      // Root, a missing helper or an unprovable workspace: confinement
      // cannot open, so the hold does not race.
      await expectNotApplicable(
        { certifiedPlatforms: ['linux'], confinementReady: false },
        'confinement',
      )
      return
    }
    const live = binding
    const verdict: DrillVerdict = { approved: true }
    const started = Date.now()
    // A slow reviewer: the veto never settles and the verdict wins.
    const outcome = await raceLiveReviewer(live, verdict, 150)
    const elapsed = Date.now() - started
    expect(outcome).toEqual({ kind: 'reviewer', verdict })
    // The verdict won the race; a veto-window expiry would have taken
    // the whole window first.
    expect(elapsed).toBeLessThan(JUDGE_FAST_VETO_WINDOW_MS)
    // The confined probe really ran: the session reports its ABI.
    const abi = live.runner.probedAbi
    expect(abi).toBeGreaterThanOrEqual(JUDGE_FAST_B1_MIN_ABI)
    expect(abi).toBeLessThanOrEqual(JUDGE_FAST_B1_MAX_ABI)
  })

  it('a fast reviewer waits for nothing', async () => {
    if (binding === undefined || process.platform !== 'linux') {
      await expectNotApplicable({}, 'uncertifiedPlatform')
      return
    }
    const live = binding
    const verdict: DrillVerdict = { approved: false }
    const started = Date.now()
    const outcome = await raceLiveReviewer(live, verdict, 10)
    expect(outcome).toEqual({ kind: 'reviewer', verdict })
    expect(Date.now() - started).toBeLessThan(JUDGE_FAST_VETO_WINDOW_MS)
  })
})
