// Lane CM80CI-R2: the other-CI launcher (action/lib/ci-run.mjs) is the
// GitHub Action's own launcher with a per-system adapter. These tests run it
// in process against each system's predefined variables, a real clone, real
// Git, real npm (a dependency-free local tarball, no network) and the fake
// agent, and plant a fabricated key under every name it could travel by:
// no child's environment or argv, no log and no published file may hold it.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { azureBoolean, ciFacts, decideCi } from '../../action/lib/ci-adapters.mjs'
import {
  checkJobDeadline,
  CI_OUT_DIR,
  jobMinutes,
  parseCiInputs,
  privateTemp,
  requiredJobMinutes,
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
  return {
    PATH: process.env['PATH'],
    SystemRoot: process.env['SystemRoot'],
    ...systemEnv(system, layout(), clone),
    MUSE_CI_TEMP: mkdtempSync(path.join(layout().root, 'ci-')),
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
  return readFileSync(path.join(layout().workspace, CI_OUT_DIR, name), 'utf8')
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
  const out = path.join(layout().workspace, CI_OUT_DIR)
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
    expect(takeCiKey(unmapped)).toBeUndefined()
    expect(unmapped).toEqual({})
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

  it('refuses a timeout the job cannot cover, before anything starts (finding 12)', () => {
    expect(requiredJobMinutes({ timeoutMinutes: 20 })).toBeLessThanOrEqual(35)
    expect(jobMinutes({ CI_JOB_TIMEOUT: '2100' }, 'gitlab')).toBe(35)
    expect(jobMinutes({ MUSE_CI_JOB_TIMEOUT_MINUTES: '35' }, 'azure')).toBe(35)
    expect(() => jobMinutes({}, 'jenkins')).toThrow('MUSE_CI_JOB_TIMEOUT_MINUTES')
    expect(() => {
      checkJobDeadline({ MUSE_CI_JOB_TIMEOUT_MINUTES: '35' }, 'bitbucket', { timeoutMinutes: 20 })
    }).not.toThrow()
    for (const minutes of [30, 120, 360]) {
      expect(() => {
        checkJobDeadline({ MUSE_CI_JOB_TIMEOUT_MINUTES: '35' }, 'bitbucket', {
          timeoutMinutes: minutes,
        })
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
      // The Action's tidy: the private invocation (checkout, prompt, diff) is gone.
      const temp = String(run.env['MUSE_CI_TEMP'])
      expect(readdirSync(path.join(temp, 'muse-spark'))).toEqual([])
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
    expect(existsSync(path.join(layout().workspace, CI_OUT_DIR, 'result.json'))).toBe(false)
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
