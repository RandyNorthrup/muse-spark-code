// Shared fixtures for the Action's tests (M80 lane C): a private temp
// layout with a workspace and RUNNER_TEMP, an invocation allocated the way
// step 2 allocates one, a launcher owner with short test bounds and
// injectable signals, plain Git for building fixture repositories (never
// the Action's own runner), and fabricated credentials only.

import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkoutHead } from '../../../action/lib/checkout.mjs'
import { stageInputs } from '../../../action/lib/inputs.mjs'
import { childEnvironment, createLauncherOwner } from '../../../action/lib/lifecycle.mjs'
import {
  allocateInvocation,
  findGit,
  invocationId,
  parseActionInputs,
  rawInputs,
} from '../../../action/lib/tools.mjs'
import { resultRecord } from './execContract'

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
export const ACTION_DIR = path.join(REPO_ROOT, 'action')
export const TEST_ACTION_DIR = path.join(REPO_ROOT, 'test', 'action')
export const FAKE_AGENT = path.join(TEST_ACTION_DIR, 'fake-agent.mjs')
export const FAKE_NPM = path.join(TEST_ACTION_DIR, 'fake-npm.mjs')
export const SENTINEL = path.join(TEST_ACTION_DIR, 'sentinel.mjs')
export const TEMPLATES_DIR = path.join(ACTION_DIR, 'prompts')
export const NODE = realpathSync.native(process.execPath)
// Fabricated: shaped like a Meta key and a GitHub token, valid for nothing.
export const TEST_KEY = `LLM_${'k'.repeat(24)}`
export const PERCENT_KEY = 'LLM|123|before%after+/.=$&'
export const TEST_TOKEN = `ghs_${'t'.repeat(36)}`
export const SECRET_TOKEN = `ghp_${'S'.repeat(36)}`
export const FAST_BOUNDS = { killAfterMs: 400, reapMs: 2000, cleanupMs: 3000 }
// Plain Git's global file: no automatic maintenance after a fixture commit,
// fetch or merge. On POSIX that maintenance detaches, and with Git 2.55 (the
// hosted runners' Git) it can still be writing into the repository after the
// command returns, racing cleanup (orchestration gotcha G65).
const PLAIN_GITCONFIG = '[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n'
// Suites that start real Git and agent children: on the Windows VM one full run
// (fixture origin, checkout, exec, patch, scan) takes about 1.5 s and a case
// loops over up to four. Per-suite, as the MCP process suites do.
export const PROCESS_SUITE = { timeout: 60_000 }

export interface TempLayout {
  readonly root: string
  readonly workspace: string
  readonly runnerTemp: string
  readonly sentinels: string
  cleanup(): void
}

/** A private layout; `isSpaced` puts a space in the workspace and RUNNER_TEMP paths. */
export function tempLayout(isSpaced = false): TempLayout {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'muse-action-')))
  const workspace = path.join(root, isSpaced ? 'work space' : 'workspace')
  const runnerTemp = path.join(root, isSpaced ? 'runner temp' : 'runner-temp')
  const sentinels = path.join(root, 'sentinels')
  for (const directory of [workspace, runnerTemp, sentinels]) mkdirSync(directory)
  writeFileSync(path.join(root, 'plain-gitconfig'), PLAIN_GITCONFIG)
  return {
    root,
    workspace,
    runnerTemp,
    sentinels,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    },
  }
}

const allocated = { count: 0 }

/** One invocation as step 2 allocates it, with the raw inputs it would store. */
export function allocate(
  layout: TempLayout,
  role: 'run' | 'apply' = 'run',
  inputs?: Record<string, string>,
): ActionPaths {
  allocated.count += 1
  const invocations = allocated.count
  const id = invocationId({
    runId: '4242',
    attempt: '1',
    job: 'review',
    random: invocations.toString(16).padStart(16, '0'),
  })
  const paths = allocateInvocation({
    runnerTemp: layout.runnerTemp,
    role,
    id,
    checkout: path.join(layout.workspace, `pr-${String(invocations)}`),
  })
  writeFileSync(
    paths.action,
    JSON.stringify(rawInputs(inputs ?? { MUSE_INPUT_MAX_BUDGET_USD: '1.00' })),
  )
  return paths
}

export interface TestOwner {
  readonly owner: LauncherOwner
  send(signal: 'SIGINT' | 'SIGTERM'): void
  readonly dropped: () => boolean
}

/** A launcher owner with the test bounds and signals the test sends itself. */
export function testOwner(
  paths: Partial<ActionPaths>,
  totalMs = 60_000,
  temporaryFiles: readonly string[] = [],
  bounds: ActionBounds = FAST_BOUNDS,
): TestOwner {
  const handlers = new Map<string, () => void>()
  let isDropped = false
  const owner = createLauncherOwner({
    paths,
    totalMs,
    bounds,
    temporaryFiles,
    dropSecrets: () => {
      isDropped = true
    },
    onSignal: (signal, run) => {
      handlers.set(signal, run)
      return () => {
        handlers.delete(signal)
      }
    },
  })
  return {
    owner,
    send: (signal) => {
      handlers.get(signal)?.()
    },
    dropped: () => isDropped,
  }
}

export function gitPath(layout: TempLayout): string {
  return findGit({ env: process.env, platform: process.platform, workspace: layout.workspace })
}

/** Plain Git for fixture setup only: an isolated home and identity, nothing sanitized. */
export function plainGit(layout: TempLayout, cwd: string, args: readonly string[]): string {
  return execFileSync(gitPath(layout), [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      SystemRoot: process.env['SystemRoot'] ?? '',
      HOME: layout.root,
      USERPROFILE: layout.root,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(layout.root, 'plain-gitconfig'),
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  }).trim()
}

export interface FixtureRepo {
  readonly bare: string
  readonly base: string
  readonly head: string
}

/**
 * A bare origin with a base commit and a head commit on `feature`. The head
 * edits notes.txt, deletes old.txt (whose removed line holds `deleted`), and
 * keeps context.txt's line `context` beside an edit.
 */
export function fixtureRepo(
  layout: TempLayout,
  deleted = 'plain line',
  context = 'context line',
): FixtureRepo {
  return originRepo(
    layout,
    (source) => {
      writeFileSync(path.join(source, 'notes.txt'), 'first\n')
      writeFileSync(path.join(source, 'old.txt'), `${deleted}\n`)
      writeFileSync(path.join(source, 'context.txt'), `${context}\nsecond\n`)
    },
    (source) => {
      writeFileSync(path.join(source, 'notes.txt'), 'first\nsecond\n')
    },
  )
}

/**
 * A bare origin built with plain Git: `writeBase` lays out the base commit on
 * main, `writeHead` the head commit on `feature` (every change staged).
 */
export function originRepo(
  layout: TempLayout,
  writeBase: (source: string) => void,
  writeHead: (source: string) => void,
): FixtureRepo {
  const source = path.join(
    layout.root,
    `source-${String(Date.now())}-${String(Math.random()).slice(2)}`,
  )
  mkdirSync(source)
  plainGit(layout, source, ['init', '--quiet', '--initial-branch=main'])
  writeBase(source)
  plainGit(layout, source, ['add', '--all'])
  plainGit(layout, source, ['commit', '--quiet', '-m', 'base'])
  const base = plainGit(layout, source, ['rev-parse', 'HEAD'])
  plainGit(layout, source, ['checkout', '--quiet', '-b', 'feature'])
  writeHead(source)
  plainGit(layout, source, ['add', '--all'])
  plainGit(layout, source, ['commit', '--quiet', '-m', 'head'])
  const head = plainGit(layout, source, ['rev-parse', 'HEAD'])
  const bare = `${source}.git`
  // A push into a local path runs receive-pack here, with this repository's
  // configuration and the pusher's global file but not the pusher's `-c`
  // options, so safeGit's maintenance.auto=false does not reach it. With
  // receive.autoGc on, receive-pack starts `git maintenance run --auto`,
  // which on POSIX detaches; Git 2.55's default strategy then repacks in the
  // background whenever objects/17 holds two or more loose objects, after the
  // push has returned. A hosted origin does that work on its own servers.
  plainGit(layout, layout.root, [
    'clone',
    '--quiet',
    '--bare',
    '--config',
    'receive.autoGc=false',
    source,
    bare,
  ])
  return { bare, base, head }
}

/** Files the sentinel program created: any entry means a configured program ran. */
export function sentinelHits(layout: TempLayout): string[] {
  return readdirSync(layout.sentinels)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One JSON object from text; anything else fails the test. */
export function jsonRecord(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('expected a JSON object')
  return value
}

/** A valid completed Model API result, with any fields replaced. */
export function completedResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...resultRecord(), ...overrides }
}

/** A GITHUB_OUTPUT file's `name<<DELIMITER` records as a map. */
export function readOutputs(file: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return outputs
  }
  const record = /^([\w-]+)<<(\S+)\n([\s\S]*?)\n\2\n/gm
  for (const match of text.matchAll(record)) outputs[match[1] ?? ''] = match[3] ?? ''
  return outputs
}

/**
 * A fetch stub answering each call with the next JSON body: an answer shaped
 * `{ status, body }` sets the status, anything else is the body with 200.
 */
export function jsonFetch(
  ...answers: readonly unknown[]
): typeof fetch & { calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const stub = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    let url: string
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.href
    else url = input.url
    calls.push({ url, init })
    const answer = answers[calls.length - 1]
    const isShaped = isRecord(answer) && typeof answer['status'] === 'number' && 'body' in answer
    const status = isShaped ? Number(answer['status']) : 200
    const body = isShaped ? answer['body'] : answer
    return Promise.resolve(Response.json(body, { status }))
  }
  return Object.assign(stub, { calls })
}

export interface PreparedRun {
  readonly paths: ActionPaths
  readonly repo: FixtureRepo
  readonly test: TestOwner
  readonly input: ActionRunInput
  readonly logs: string[]
}

export interface RunOptions {
  readonly mode: 'review' | 'fix'
  readonly exec?: Record<string, unknown>
  readonly scan?: Record<string, unknown>
  readonly inputs?: Record<string, string>
  readonly repo?: FixtureRepo
  readonly parentEnv?: Record<string, string | undefined>
  readonly totalMs?: number
  readonly bounds?: ActionBounds
  readonly key?: string
}

/**
 * Steps 2–6 for real against a fixture origin (allocation, gated checkout,
 * staged inputs), then the run step's input for runProposal with the fake
 * agent and its scenario. The run owner is fresh; the checkout had its own.
 */
export async function preparedRun(layout: TempLayout, options: RunOptions): Promise<PreparedRun> {
  const repo = options.repo ?? fixtureRepo(layout)
  const raw = {
    MUSE_INPUT_MAX_BUDGET_USD: '1.00',
    MUSE_INPUT_MODE: options.mode,
    ...options.inputs,
  }
  const paths = allocate(layout, 'run', raw)
  const inputs = parseActionInputs(raw)
  const git = gitPath(layout)
  const baseEnv = childEnvironment({
    platform: process.platform,
    parentEnv: options.parentEnv ?? process.env,
    paths,
    nodePath: NODE,
  })
  const setup = testOwner(paths)
  await checkoutHead({
    owner: setup.owner,
    git,
    paths,
    baseEnv,
    directory: paths.checkout,
    remote: repo.bare,
    shas: [repo.head, repo.base],
    token: '',
  })
  await setup.owner.cleanup()
  writeFileSync(
    paths.gate,
    JSON.stringify({
      prNumber: 72,
      headSha: repo.head,
      baseSha: repo.base,
      headRef: 'feature',
      task: 'Tidy the notes',
      title: 'Notes for @someone',
      body: 'Untrusted body',
    }),
  )
  await stageInputs({ paths, inputs })
  writeFileSync(
    path.join(paths.work, 'fake-scenario.json'),
    JSON.stringify({
      exec: options.exec ?? { result: completedResult() },
      scan: options.scan ?? {},
    }),
  )
  const temporary = [paths.resultTmp, paths.manifestTmp, paths.eventsTmp, paths.diffFull]
  const test = testOwner(paths, options.totalMs, temporary, options.bounds)
  const logs: string[] = []
  const input: ActionRunInput = {
    owner: test.owner,
    paths,
    inputs,
    key: options.key ?? TEST_KEY,
    node: NODE,
    git,
    agentJs: FAKE_AGENT,
    baseEnv,
    templatesDir: TEMPLATES_DIR,
    identity: {
      runId: '4242',
      attempt: '1',
      invocation: path.basename(paths.invocation).replace(/^run-/, ''),
    },
    log: (text) => {
      logs.push(text)
    },
  }
  return { paths, repo, test, input, logs }
}

/** The fake agent's report lines. */
export function fakeReports(paths: ActionPaths): Record<string, unknown>[] {
  try {
    return readFileSync(path.join(paths.work, 'fake-report.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => jsonRecord(line))
  } catch {
    return []
  }
}

/** A compare function for sorting text in tests. */
export function byText(left: string, right: string): number {
  return left.localeCompare(right)
}
