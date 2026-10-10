// Lane CM80CI-R2: the other-CI launcher (action/lib/ci-run.mjs) is the
// GitHub Action's own launcher with a per-system adapter. These tests run it
// in process against each system's predefined variables, a real clone, real
// Git, real npm (a dependency-free local tarball, no network) and the fake
// agent, and plant a fabricated key under every name it could travel by:
// no child's environment or argv, no log and no published file may hold it.

import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { boundedFiles, fileOperation } from '../../action/lib/ci-files.mjs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { azureBoolean, ciFacts, decideCi } from '../../action/lib/ci-adapters.mjs'
import {
  bootstrapStartMs,
  checkJobDeadline,
  CI_OUT_DIR,
  CI_PUBLISHED_FILES,
  jobMinutes,
  jobStartMs,
  parseCiInputs,
  privateTemp,
  refuseExistingOutput,
  requiredJobMinutes,
  requiredRunMs,
  runCi,
  takeCiKey,
} from '../../action/lib/ci-run.mjs'
import {
  ACTION_CHILD_STDOUT_MAX_BYTES,
  ACTION_STDERR_MAX_BYTES,
} from '../../action/lib/lifecycle.mjs'
import {
  completedResult,
  FAST_BOUNDS,
  NODE,
  PROCESS_SUITE,
  tempLayout,
  testOwner,
  type TempLayout,
} from './helpers/actionFixtures'
import {
  agentReports,
  CI_KEY,
  ciPackage,
  cloneFor,
  hasKey,
  systemEnv,
  type CiClone,
  type CiPackage,
} from './helpers/ciFixtures'

const SYSTEMS = ['gitlab', 'azure', 'jenkins', 'bitbucket'] as const
const isPosix = process.platform !== 'win32'

interface Spawned {
  file: string
  args: string[]
  env: Record<string, string>
}

interface CiRun {
  code: number
  spawns: Spawned[]
  written: string
  logged: string
  env: Record<string, string | undefined>
}

const state: { layout?: TempLayout } = {}

beforeEach(() => {
  state.layout = tempLayout()
})

afterEach(() => {
  state.layout?.cleanup()
})

function layout(): TempLayout {
  if (state.layout === undefined) throw new Error('no layout')
  return state.layout
}

function runEnv(
  system: string,
  clone: CiClone,
  pkg: CiPackage,
  extra: Record<string, string> = {},
): Record<string, string | undefined> {
  const outputRoot = path.join(layout().root, 'output')
  if (!existsSync(outputRoot)) mkdirSync(outputRoot, { mode: 0o700 })
  return {
    PATH: process.env['PATH'],
    SystemRoot: process.env['SystemRoot'],
    ...systemEnv(system, layout(), clone),
    MUSE_CI_TEMP: mkdtempSync(path.join(layout().root, 'ci-')),
    MUSE_CI_OUTPUT_ROOT: path.join(layout().root, 'output'),
    MUSE_CI_BOOTSTRAP_START_MS: String(Date.now()),
    MUSE_INPUT_MAX_BUDGET_USD: '1.00',
    MUSE_INPUT_AGENT_PACKAGE: pkg.tarball,
    MUSE_INPUT_AGENT_PACKAGE_SHA256: pkg.sha256,
    MUSE_SPARK_MODEL_API_KEY: CI_KEY,
    MUSE_MODEL_API_KEY: CI_KEY,
    SOME_COPY_OF_THE_SECRET: `bound:${CI_KEY}`,
    ...extra,
  }
}

async function runOn(
  system: string,
  env: Record<string, string | undefined>,
  onSignal?: (signal: 'SIGINT' | 'SIGTERM', run: () => void) => () => void,
  extra?: {
    fileOperation?: typeof fileOperation
    finalBounds?: { publishMs?: number; cleanupMs?: number }
  },
): Promise<CiRun> {
  const spawns: Spawned[] = []
  const held = { key: takeCiKey(env) }
  const run: CiRun = { code: -1, spawns, written: '', logged: '', env }
  run.code = await runCi({
    system,
    env,
    held,
    write: (text) => {
      run.written += text
    },
    log: (text) => {
      if (text !== '') run.logged += `${text}\n`
    },
    ...(extra?.fileOperation !== undefined && { fileOperation: extra.fileOperation }),
    ...(extra?.finalBounds !== undefined && { finalBounds: extra.finalBounds }),
    ownerOptions: {
      bounds: FAST_BOUNDS,
      ...(onSignal !== undefined && { onSignal }),
      spawnChild: (file, args, options): ChildProcess => {
        spawns.push({ file, args, env: options.env })
        return spawn(file, args, options)
      },
    },
  })
  return run
}

function published(name: string): string {
  return readFileSync(path.join(layout().root, 'output', CI_OUT_DIR, name), 'utf8')
}

function outputs(): Record<string, string> {
  return JSON.parse(published('outputs.json')) as Record<string, string>
}

function execReport(pkg: CiPackage): Record<string, unknown> | undefined {
  return agentReports(pkg).find((line) => line['command'] === 'exec' && 'keyLine' in line)
}

/** No child environment or argv, no written or logged text and no published file holds the key. */
function expectNoKeyAnywhere(run: CiRun): void {
  for (const child of run.spawns) {
    expect(hasKey(JSON.stringify(child.args)), child.file).toBe(false)
    expect(hasKey(JSON.stringify(child.env)), child.file).toBe(false)
  }
  expect(hasKey(run.written)).toBe(false)
  expect(hasKey(run.logged)).toBe(false)
  expect(Object.values(run.env).some((value) => value !== undefined && hasKey(value))).toBe(false)
  const out = path.join(layout().root, 'output', CI_OUT_DIR)
  if (existsSync(out)) {
    for (const file of readdirSync(out)) {
      expect(hasKey(readFileSync(path.join(out, file), 'utf8')), file).toBe(false)
    }
  }
}

/** A trusted branch run's facts, with any field replaced. */
function facts(overrides: Partial<CiFacts>): CiFacts {
  return {
    system: 'gitlab',
    workspace: '/w',
    runId: '1',
    attempt: '1',
    event: 'branch',
    label: 'branch main',
    number: null,
    isFork: false,
    isProtected: null,
    headSha: 'a'.repeat(40),
    base: { firstParent: true },
    title: '',
    body: '',
    ...overrides,
  }
}

describe('adapters: each system’s facts and trust', () => {
  it('reads Azure’s string booleans without case and refuses anything else', () => {
    for (const value of ['True', 'TRUE', 'true', 'tRuE'])
      expect(azureBoolean(value, 'x')).toBe(true)
    for (const value of ['False', 'FALSE', 'false']) expect(azureBoolean(value, 'x')).toBe(false)
    expect(azureBoolean('', 'x')).toBeUndefined()
    expect(() => azureBoolean('yes', 'x')).toThrow('x must be true or false')
  })

  it('names forks, pull requests and protection from each system’s own variables', () => {
    const head = 'a'.repeat(40)
    const base = 'b'.repeat(40)
    const gitlabFork = ciFacts('gitlab', {
      CI_PROJECT_DIR: '/w',
      CI_JOB_ID: '1',
      CI_PIPELINE_SOURCE: 'merge_request_event',
      CI_COMMIT_SHA: head,
      CI_MERGE_REQUEST_IID: '3',
      CI_PROJECT_ID: '10',
      CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '11',
      CI_MERGE_REQUEST_DIFF_BASE_SHA: base,
    })
    expect(gitlabFork).toMatchObject({ event: 'pull_request', isFork: true, isProtected: false })
    const gitlabPush = ciFacts('gitlab', {
      CI_PROJECT_DIR: '/w',
      CI_JOB_ID: '1',
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_SHA: head,
      CI_COMMIT_BEFORE_SHA: '0'.repeat(40),
      CI_COMMIT_REF_PROTECTED: 'true',
    })
    expect(gitlabPush).toMatchObject({
      event: 'branch',
      isProtected: true,
      base: { firstParent: true },
    })
    const azureFork = ciFacts('azure', {
      BUILD_SOURCESDIRECTORY: '/w',
      BUILD_BUILDID: '1',
      BUILD_REASON: 'PullRequest',
      BUILD_SOURCEVERSION: head,
      SYSTEM_PULLREQUEST_ISFORK: 'True',
      SYSTEM_PULLREQUEST_PULLREQUESTID: '4',
    })
    expect(azureFork).toMatchObject({ isFork: true, base: { mergeParent: true } })
    expect(() =>
      ciFacts('azure', {
        BUILD_SOURCESDIRECTORY: '/w',
        BUILD_BUILDID: '1',
        BUILD_REASON: 'PullRequest',
        BUILD_SOURCEVERSION: head,
        SYSTEM_PULLREQUEST_PULLREQUESTID: '4',
      }),
    ).toThrow('System.PullRequest.IsFork is missing')
    const jenkinsFork = ciFacts('jenkins', {
      WORKSPACE: '/w',
      BUILD_NUMBER: '1',
      GIT_COMMIT: head,
      CHANGE_ID: '5',
      CHANGE_FORK: 'someone/fork',
      CHANGE_TARGET: 'main',
    })
    expect(jenkinsFork).toMatchObject({ isFork: true, base: { ref: 'refs/remotes/origin/main' } })
    const bitbucketTag = ciFacts('bitbucket', {
      BITBUCKET_CLONE_DIR: '/w',
      BITBUCKET_BUILD_NUMBER: '1',
      BITBUCKET_COMMIT: head,
      BITBUCKET_TAG: 'v1',
    })
    expect(bitbucketTag.event).toBe('unsupported')
    expect(() => ciFacts('travis', {})).toThrow('the CI system is not one this launcher knows')
    expect(() =>
      ciFacts('jenkins', { WORKSPACE: '/w', BUILD_NUMBER: '1', GIT_COMMIT: 'not-a-sha' }),
    ).toThrow('GIT_COMMIT is missing or malformed')
  })

  it('refuses forks, untrusted pull requests, unprotected refs and images in review', () => {
    const trusted = { trustPullRequests: true, imageGeneration: false, mode: 'review' as const }
    expect(decideCi(facts({}), trusted)).toEqual({ allowed: true })
    expect(decideCi(facts({ isFork: true, event: 'pull_request' }), trusted)).toEqual({
      allowed: false,
      reason: 'the change comes from a fork',
    })
    expect(
      decideCi(facts({ event: 'pull_request' }), { ...trusted, trustPullRequests: false }),
    ).toMatchObject({
      allowed: false,
      reason: 'pull requests run only with trust-pull-requests set to true',
    })
    expect(decideCi(facts({ isProtected: false }), trusted)).toMatchObject({
      reason: 'the source branch is not protected',
    })
    expect(decideCi(facts({ event: 'unsupported' }), trusted)).toMatchObject({ allowed: false })
    expect(decideCi(facts({}), { ...trusted, imageGeneration: true })).toMatchObject({
      reason: 'image-generation needs fix mode',
    })
  })
})

describe('key intake, inputs and the job deadline', () => {
  it('takes the key out under every name that carries it', () => {
    const env: Record<string, string | undefined> = {
      MUSE_SPARK_MODEL_API_KEY: `${CI_KEY}\n`,
      MUSE_MODEL_API_KEY: CI_KEY,
      RENAMED_BINDING: CI_KEY,
      HEADER_WITH_IT: `Bearer ${CI_KEY}`,
      PATH: '/usr/bin',
    }
    expect(takeCiKey(env)).toBe(CI_KEY)
    expect(env).toEqual({ PATH: '/usr/bin' })
    const unmapped: Record<string, string | undefined> = {
      MUSE_MODEL_API_KEY: CI_KEY,
      COPY: CI_KEY,
    }
    expect(takeCiKey(unmapped)).toBe(CI_KEY)
    expect(unmapped).toEqual({})
  })

  it('R4-P1-2: a declared alias is a key source; conflicting names refuse and all values are scrubbed', () => {
    const alias = {
      MUSE_CI_KEY_ALIASES: 'RENAMED_BINDING',
      RENAMED_BINDING: CI_KEY,
      COPY: `Bearer ${CI_KEY}`,
    }
    expect(takeCiKey(alias)).toBe(CI_KEY)
    expect(alias).toEqual({ MUSE_CI_KEY_ALIASES: 'RENAMED_BINDING' })
    const conflict = {
      MUSE_MODEL_API_KEY: CI_KEY,
      META_API_KEY: `LLM_${'d'.repeat(28)}`,
      COPY: CI_KEY,
    }
    expect(takeCiKey(conflict)).toBeUndefined()
    expect(conflict).toEqual({})
  })

  it('R4-P2-5: Azure pipeline time includes slow checkout and UseNode; fallback measures real elapsed time', () => {
    const now = Date.now()
    const env = {
      MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
      MUSE_CI_BOOTSTRAP_START_MS: String(now),
      MUSE_CI_PIPELINE_STARTED_AT: new Date(now - 16 * 60_000).toISOString(),
    }
    expect(() => {
      checkJobDeadline(env, 'azure', { timeoutMinutes: 20 }, now)
    }).toThrow('only 19 of 35 remain')
    expect(
      jobStartMs({ MUSE_CI_BOOTSTRAP_START_MS: String(now - 7 * 60_000) }, 'bitbucket', now),
    ).toBe(now - 7 * 60_000)
  })

  it('uses the Action’s grammar, refuses GitHub-only inputs and reads Azure booleans', () => {
    const base = {
      MUSE_INPUT_MAX_BUDGET_USD: '1.50',
      MUSE_INPUT_AGENT_PACKAGE: '/tmp/agent.tgz',
      MUSE_INPUT_AGENT_PACKAGE_SHA256: 'f'.repeat(64),
    }
    expect(parseCiInputs(base, 'gitlab')).toMatchObject({
      mode: 'review',
      trustPullRequests: false,
    })
    expect(() => parseCiInputs({ ...base, MUSE_INPUT_POST_COMMENT: 'true' }, 'gitlab')).toThrow(
      'MUSE_INPUT_POST_COMMENT is a GitHub Action input',
    )
    expect(() =>
      parseCiInputs({ ...base, MUSE_INPUT_TRUST_PULL_REQUESTS: 'True' }, 'gitlab'),
    ).toThrow('MUSE_INPUT_TRUST_PULL_REQUESTS must be true or false')
    expect(
      parseCiInputs(
        { ...base, MUSE_INPUT_TRUST_PULL_REQUESTS: 'True', MUSE_INPUT_IMAGE_GENERATION: 'FALSE' },
        'azure',
      ),
    ).toMatchObject({ trustPullRequests: true, imageGeneration: false })
    expect(() => parseCiInputs({ MUSE_INPUT_MAX_BUDGET_USD: '1' }, 'jenkins')).toThrow(
      'agent-package and agent-package-sha256 are required',
    )
    expect(() => parseCiInputs({ ...base, MUSE_INPUT_MAX_BUDGET_USD: '' }, 'bitbucket')).toThrow(
      'max-budget-usd must be a plain decimal number of USD',
    )
  })

  it('admits on the time remaining, not the configured duration (P1 finding 5)', () => {
    const now = Date.now()
    const fresh = {
      CI_JOB_TIMEOUT: '2100',
      CI_JOB_STARTED_AT: new Date(now).toISOString(),
    }
    expect(jobStartMs(fresh, 'gitlab', now)).toBe(now)
    expect(() => {
      checkJobDeadline(fresh, 'gitlab', { timeoutMinutes: 20 }, now)
    }).not.toThrow()
    // The review's scenario: a 35-minute job whose checkout took 16 minutes
    // cannot cover a 20-minute turn, although the configured 35 minutes could.
    const spent = {
      CI_JOB_TIMEOUT: '2100',
      CI_JOB_STARTED_AT: new Date(now - 16 * 60_000).toISOString(),
    }
    expect(() => {
      checkJobDeadline(spent, 'gitlab', { timeoutMinutes: 20 }, now)
    }).toThrow('timeout-minutes 20 needs a job timeout of at least')
    // Jenkins measures from the template's vendor start time.
    expect(jobStartMs({ MUSE_CI_JOB_START_MS: String(now - 60_000) }, 'jenkins', now)).toBe(
      now - 60_000,
    )
    // Fallback measures from bootstrap; vendor timestamps can only make admission more conservative.
    const bootstrap = {
      MUSE_CI_BOOTSTRAP_START_MS: String(now),
      MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
    }
    expect(jobStartMs(bootstrap, 'azure', now)).toBe(now)
    expect(() => {
      checkJobDeadline(bootstrap, 'bitbucket', { timeoutMinutes: 20 }, now)
    }).not.toThrow()
    expect(() => {
      checkJobDeadline(
        { ...bootstrap, MUSE_CI_BOOTSTRAP_START_MS: String(now - 16 * 60_000) },
        'bitbucket',
        { timeoutMinutes: 20 },
        now,
      )
    }).toThrow('needs a job timeout of at least')
    // A malformed vendor start falls back to the bootstrap; a missing
    // bootstrap refuses instead of admitting blind.
    expect(jobStartMs({ ...bootstrap, CI_JOB_STARTED_AT: 'not-a-date' }, 'gitlab', now)).toBe(now)
    expect(() => bootstrapStartMs({})).toThrow('MUSE_CI_BOOTSTRAP_START_MS')
    expect(requiredJobMinutes({ timeoutMinutes: 20 })).toBeLessThanOrEqual(35)
    expect(requiredRunMs({ timeoutMinutes: 20 })).toBeLessThan(35 * 60_000)
    expect(jobMinutes({ CI_JOB_TIMEOUT: '2100' }, 'gitlab')).toBe(35)
    expect(jobMinutes({ MUSE_CI_JOB_TIMEOUT_MINUTES: '35' }, 'azure')).toBe(35)
    expect(() => jobMinutes({}, 'jenkins')).toThrow('MUSE_CI_JOB_TIMEOUT_MINUTES')
    for (const minutes of [30, 120, 360]) {
      expect(() => {
        checkJobDeadline(
          {
            MUSE_CI_JOB_TIMEOUT_MINUTES: '35',
            MUSE_CI_BOOTSTRAP_START_MS: String(Date.now()),
          },
          'bitbucket',
          {
            timeoutMinutes: minutes,
          },
        )
      }).toThrow(`timeout-minutes ${String(minutes)} needs a job timeout of at least`)
    }
  })

  it.runIf(isPosix)('accepts only a private temp folder outside the workspace', () => {
    const ws = layout().workspace
    const own = mkdtempSync(path.join(layout().root, 'ci-'))
    expect(privateTemp(own, ws, process.platform)).toBe(own)
    expect(() => privateTemp('relative', ws, process.platform)).toThrow('absolute')
    expect(() => privateTemp(ws, ws, process.platform)).toThrow('outside the workspace')
    expect(() => privateTemp(layout().root, ws, process.platform)).toThrow(
      'must not contain the workspace',
    )
  })
})

describe('end to end on each system, in process', PROCESS_SUITE, () => {
  it.each([...SYSTEMS])(
    '%s: reviews the change with the Action’s launcher, the key on exec’s stdin only',
    async (system) => {
      const clone = cloneFor(system, layout())
      const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
      const run = await runOn(system, runEnv(system, clone, pkg))
      expect(run.logged).toBe('')
      expect(run.code).toBe(0)
      expect(outputs()).toMatchObject({
        status: 'completed',
        'exit-code': '0',
        'diff-truncated': 'false',
      })
      expect(JSON.parse(published('result.json'))).toMatchObject({ status: 'completed' })
      expect(run.written).toContain('- status: completed')
      const exec = execReport(pkg)
      expect(exec?.['keyLine']).toBe(CI_KEY)
      const args = (exec?.['args'] ?? []) as string[]
      // The prompt travels as a file (finding 9) beside the generated diff (finding 6).
      expect(args).toContain('--prompt-file')
      expect(args.filter((arg) => arg === '--untrusted-file')).toHaveLength(2)
      expect(args).toContain('plan')
      expect(hasKey(JSON.stringify(exec?.['env']))).toBe(false)
      // npm installed the verified tarball (finding 3): git and node children only.
      expect(run.spawns.some((child) => child.args.includes('--ignore-scripts'))).toBe(true)
      expectNoKeyAnywhere(run)
      // The launcher owns the bootstrap's temp directory: nothing survives.
      expect(existsSync(String(run.env['MUSE_CI_TEMP']))).toBe(false)
    },
  )

  it('fix mode publishes the scanned patch; the scanner gets the key on stdin only', async () => {
    const clone = cloneFor('jenkins', layout())
    const pkg = ciPackage(layout().root, {
      exec: { result: completedResult(), writes: [{ path: 'notes.txt', text: 'fixed\n' }] },
    })
    const run = await runOn('jenkins', runEnv('jenkins', clone, pkg, { MUSE_INPUT_MODE: 'fix' }))
    expect(run.code).toBe(0)
    expect(outputs()).toMatchObject({ status: 'completed', 'patch-withheld': '' })
    expect(published('fix.patch')).toContain('+fixed')
    const scan = agentReports(pkg).find((line) => line['command'] === 'scan-secrets')
    expect(scan?.['keyLine']).toBe(CI_KEY)
    expectNoKeyAnywhere(run)
  })

  it('cuts the diff to max-diff-bytes and says so (finding 6)', async () => {
    const clone = cloneFor('gitlab', layout())
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    const run = await runOn(
      'gitlab',
      runEnv('gitlab', clone, pkg, { MUSE_INPUT_MAX_DIFF_BYTES: '1' }),
    )
    expect(run.code).toBe(0)
    expect(outputs()['diff-truncated']).toBe('true')
  })

  it.each([
    ['empty output', { lines: [], exitCode: 0 }],
    ['malformed output', { lines: ['{"not":"an event"}'], exitCode: 0 }],
  ])('%s is never published as completed (finding 10)', async (_name, exec) => {
    const clone = cloneFor('bitbucket', layout())
    const pkg = ciPackage(layout().root, { exec })
    const run = await runOn('bitbucket', runEnv('bitbucket', clone, pkg))
    expect(run.code).toBe(1)
    expect(outputs()).toMatchObject({ status: 'unknown', 'result-path': '' })
    expect(existsSync(path.join(layout().root, 'output', CI_OUT_DIR, 'result.json'))).toBe(false)
  })

  it.runIf(isPosix)('SIGTERM stops the run and kills the agent child (finding 7)', async () => {
    const clone = cloneFor('azure', layout())
    const pkg = ciPackage(layout().root, { exec: { hang: true } })
    const handlers = new Map<string, () => void>()
    const running = runOn('azure', runEnv('azure', clone, pkg), (signal, handler) => {
      handlers.set(signal, handler)
      return () => handlers.delete(signal)
    })
    const deadline = Date.now() + 30_000
    while (agentReports(pkg).every((line) => line['ready'] !== true)) {
      if (Date.now() > deadline) throw new Error('the agent never became ready')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const pid = Number(agentReports(pkg).find((line) => line['ready'] === true)?.['pid'])
    handlers.get('SIGTERM')?.()
    const run = await running
    expect(run.code).toBe(143)
    expect(outputs()['status']).toBe('cancelled')
    expect(() => process.kill(pid, 0)).toThrow()
    expectNoKeyAnywhere(run)
  })

  it('ignores lifecycle scripts and a checked-out .npmrc, and installs only the pinned bytes (finding 3)', async () => {
    const clone = cloneFor('gitlab', layout())
    const sentinel = path.join(layout().sentinels, 'lifecycle-ran')
    const script = `node -e "require('fs').writeFileSync(${JSON.stringify(sentinel).replaceAll('"', "'")},'x')"`
    const pkg = ciPackage(layout().root, {
      exec: { result: completedResult() },
      scripts: { preinstall: script, install: script, postinstall: script },
    })
    writeFileSync(
      path.join(layout().workspace, '.npmrc'),
      'ignore-scripts=false\nregistry=http://127.0.0.1:9/\n',
    )
    const run = await runOn('gitlab', runEnv('gitlab', clone, pkg))
    expect(run.code).toBe(0)
    expect(existsSync(sentinel)).toBe(false)
    // A fresh job workspace for the second run (a stale output refuses first).
    rmSync(path.join(layout().root, 'output', CI_OUT_DIR), { recursive: true, force: true })
    const other = ciPackage(layout().root, { exec: { result: completedResult() } })
    const mismatch = runEnv('gitlab', clone, pkg, { MUSE_INPUT_AGENT_PACKAGE_SHA256: other.sha256 })
    const refused = await runOn('gitlab', mismatch)
    expect(refused.code).toBe(1)
    expect(refused.logged).toContain('agent-package does not match agent-package-sha256')
    expect(refused.spawns).toEqual([])
  })

  it('refuses an impostor package by its identity before anything runs it', async () => {
    const clone = cloneFor('jenkins', layout())
    const pkg = ciPackage(layout().root, { name: 'muse-spark-code-acp-other' })
    const run = await runOn('jenkins', runEnv('jenkins', clone, pkg))
    expect(run.code).toBe(1)
    expect(execReport(pkg)).toBeUndefined()
    expectNoKeyAnywhere(run)
  })

  it.each([
    ['jenkins', { CHANGE_FORK: 'someone/fork' }, 'the change comes from a fork'],
    ['jenkins', { MUSE_INPUT_TRUST_PULL_REQUESTS: 'false' }, 'pull requests run only with'],
    ['gitlab', { CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '99' }, 'the change comes from a fork'],
    ['gitlab', { CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED: 'false' }, 'not protected'],
    ['azure', { SYSTEM_PULLREQUEST_ISFORK: 'TRUE' }, 'the change comes from a fork'],
    ['azure', { MUSE_INPUT_TIMEOUT_MINUTES: '30' }, 'needs a job timeout of at least'],
    [
      'bitbucket',
      { BITBUCKET_PR_ID: '9', BITBUCKET_PR_DESTINATION_BRANCH: 'main' },
      'pull requests run only with',
    ],
  ])(
    '%s refuses %o before installing or spawning anything (findings 2, 12)',
    async (system, extra, reason) => {
      const clone = cloneFor(system, layout())
      const pkg = ciPackage(layout().root)
      const env = runEnv(system, clone, pkg, extra)
      await expect(runOn(system, env)).rejects.toThrow(reason)
      expect(existsSync(path.join(String(env['MUSE_CI_TEMP']), 'muse-spark'))).toBe(false)
      expect(agentReports(pkg)).toEqual([])
    },
  )
})

describe('R4: publication and cleanup own cancellable filesystem work', () => {
  it.each(['planted directory', 'planted symlink'])(
    'R4-P1-3: ignores a repository %s; publishes only in job temp',
    async (name) => {
      const clone = cloneFor('gitlab', layout())
      const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
      const planted = path.join(layout().workspace, CI_OUT_DIR)
      if (name === 'planted symlink') symlinkSync(layout().sentinels, planted, 'junction')
      else {
        mkdirSync(planted)
        writeFileSync(path.join(planted, 'outputs.json'), 'forged')
      }
      const run = await runOn('gitlab', runEnv('gitlab', clone, pkg))
      expect(run.code).toBe(0)
      expect(outputs()['out-dir']).toBe(path.join(layout().root, 'output', CI_OUT_DIR))
      expect(existsSync(planted)).toBe(true)
    },
  )

  it('R4-P2-8: stale-output removal aborts without lying about removal or dispatching', async () => {
    const clone = cloneFor('gitlab', layout())
    const pkg = ciPackage(layout().root)
    const env = runEnv('gitlab', clone, pkg)
    const target = path.join(layout().root, 'output', CI_OUT_DIR)
    mkdirSync(target, { recursive: true, mode: 0o700 })
    const execute: typeof fileOperation = async (operation, signal) => {
      if (operation.kind === 'remove' && operation.target === target)
        await delay(2000, undefined, { signal })
      await fileOperation(operation, signal)
    }
    await expect(
      runOn('gitlab', env, undefined, { fileOperation: execute, finalBounds: { cleanupMs: 1000 } }),
    ).rejects.toThrow()
    expect(existsSync(target)).toBe(true)
    expect(agentReports(pkg)).toEqual([])
    expect(existsSync(String(env['MUSE_CI_TEMP']))).toBe(false)
  })

  it('R4-P2-8: removal failure never claims that an existing output was removed', async () => {
    const target = path.join(layout().root, 'stale')
    mkdirSync(target)
    await expect(
      refuseExistingOutput(target, () => Promise.reject(new Error('EACCES'))),
    ).rejects.toThrow('EACCES')
    expect(existsSync(target)).toBe(true)
  })

  it.each(['malformed facts', 'missing workspace'])(
    'R4-P2-7: %s still cleans the bootstrap directory',
    async (reason) => {
      const clone = cloneFor('jenkins', layout())
      const pkg = ciPackage(layout().root)
      const env = runEnv(
        'jenkins',
        clone,
        pkg,
        reason === 'malformed facts'
          ? { GIT_COMMIT: 'bad' }
          : { WORKSPACE: path.join(layout().root, 'missing') },
      )
      await expect(runOn('jenkins', env)).rejects.toThrow()
      expect(existsSync(String(env['MUSE_CI_TEMP']))).toBe(false)
      expect(agentReports(pkg)).toEqual([])
    },
  )

  it('R4-P2-6: late publication cannot write completed outputs after timeout', async () => {
    const clone = cloneFor('azure', layout())
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    let isAborted = false
    const execute: typeof fileOperation = async (operation, signal) => {
      if (operation.kind === 'publish') {
        try {
          await delay(150, undefined, { signal })
        } catch (error) {
          isAborted = signal.aborted
          throw error
        }
      }
      await fileOperation(operation, signal)
    }
    const run = await runOn('azure', runEnv('azure', clone, pkg), undefined, {
      fileOperation: execute,
      finalBounds: { publishMs: 40 },
    })
    expect(run.code).toBe(1)
    expect(isAborted).toBe(true)
    await delay(180)
    expect(existsSync(path.join(layout().root, 'output', CI_OUT_DIR))).toBe(false)
    expect(run.written).not.toContain('MUSE_CI_OUTPUT_READY')
  })

  it('R4-P2-6: the real filesystem subprocess is killed on abort, including active handles', async () => {
    const sentinel = path.join(layout().sentinels, 'late-output')
    let child: ChildProcess | undefined
    const execute: typeof fileOperation = (operation, signal) =>
      fileOperation(operation, signal, (_file, _args, options) => {
        child = spawn(
          NODE,
          [
            '-e',
            `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'late'), 500); setInterval(() => {}, 1000)`,
          ],
          options,
        )
        return child
      })
    await expect(
      boundedFiles({ kind: 'remove', target: sentinel }, 80, 'test bound', execute),
    ).rejects.toThrow('test bound')
    expect(child?.signalCode).toBe('SIGKILL')
    await delay(550)
    expect(existsSync(sentinel)).toBe(false)
  })

  it('R4-P2-6: final cleanup is aborted at its deadline and reports the retained directory', async () => {
    const clone = cloneFor('azure', layout())
    const pkg = ciPackage(layout().root, { exec: { result: completedResult() } })
    const env = runEnv('azure', clone, pkg)
    let isAborted = false
    const execute: typeof fileOperation = async (operation, signal) => {
      if (operation.target === env['MUSE_CI_TEMP']) {
        try {
          await delay(1000, undefined, { signal })
        } catch (error) {
          isAborted = signal.aborted
          throw error
        }
      }
      await fileOperation(operation, signal)
    }
    const run = await runOn('azure', env, undefined, {
      fileOperation: execute,
      finalBounds: { cleanupMs: 30 },
    })
    expect(run.code).toBe(0)
    expect(run.logged).toContain('could not be cleaned')
    expect(isAborted).toBe(true)
    expect(existsSync(String(env['MUSE_CI_TEMP']))).toBe(true)
  })

  it('publishes only the fixed launcher file set', () => {
    expect(CI_PUBLISHED_FILES).toEqual([
      'outputs.json',
      'result.json',
      'events.jsonl',
      'fix.patch',
      'manifest.json',
    ])
  })
})

describe('the installer’s pipes are drained (finding 8)', PROCESS_SUITE, () => {
  it('a child writing megabytes to both pipes finishes instead of blocking', async () => {
    const { owner } = testOwner({}, 30_000)
    try {
      const outcome = await owner.child({
        file: NODE,
        args: [
          '-e',
          "process.stdout.write('o'.repeat(2097152)); process.stderr.write('e'.repeat(524288))",
        ],
        cwd: layout().root,
        env: { PATH: process.env['PATH'] ?? '' },
        withinMs: 20_000,
        stdoutMaxBytes: ACTION_CHILD_STDOUT_MAX_BYTES,
        stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
      })
      expect(outcome.code).toBe(0)
      expect(outcome.stdout.length).toBe(2_097_152)
      expect(outcome.stderr.length).toBe(524_288)
    } finally {
      await owner.cleanup()
    }
  })
})
