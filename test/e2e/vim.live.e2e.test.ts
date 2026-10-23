// Classic Vim's live conversation drill (M66, RLF-HOSTS2): real Vim drives
// the packed agent's shipped plugin for three short turns on the contributor
// model, one quoting a file read. Opt-in only, never in CI: it bills the
// owner's subscription, so it runs when MUSE_LIVE_VIM=1 with
// MUSE_LIVE_VIM_TARBALL pointing at the packed agent tarball, Vim 8.1+ with
// +job/+channel on PATH (or VIM_BIN), and the owner's own sign-in. The
// session log (test/e2e/liveCli.ts) names every completed request and its
// model: the requests are counted from it, at most four for the prompts.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countSessionResponses, LIVE_MODEL_ID, sessionJsonlPath } from './liveCli'

const IS_ENABLED = process.env['MUSE_LIVE_VIM'] === '1'
// Three live model turns plus session start and shutdown.
const DRILL_TIMEOUT_MS = 600_000
// The brief's cap: three prompts, at most four model requests (the read
// turn takes two: one for the tool call, one for the quoted answer).
const REQUEST_BUDGET = 4
const EXPECTED_TURNS = 3

interface DrillRun {
  root: string
  installedRoot: string
  transcript: readonly string[]
  sessionId: string
  sessionModel: string
}

function vimBinary(): string {
  return process.env['VIM_BIN'] ?? 'vim'
}

function requireVim(): void {
  const version = spawnSync(vimBinary(), ['--version'], { encoding: 'utf8' })
  if (version.status !== 0) {
    throw new Error(
      `Vim is not runnable: ${vimBinary()} --version exited ${String(version.status)}`,
    )
  }
  const firstLine = version.stdout.split('\n', 1)[0] ?? ''
  for (const feature of ['+job', '+channel']) {
    if (!version.stdout.includes(feature)) {
      throw new Error(`this Vim has no ${feature}: ${firstLine}`)
    }
  }
}

function unpackTarball(run: DrillRun): string {
  const tarball = process.env['MUSE_LIVE_VIM_TARBALL']
  if (tarball === undefined || tarball === '') {
    throw new Error('set MUSE_LIVE_VIM_TARBALL to the packed agent tarball')
  }
  run.installedRoot = mkdtempSync(path.join(tmpdir(), 'vim-live-inst-'))
  execFileSync('tar', ['-xzf', tarball, '-C', run.installedRoot], { stdio: 'pipe' })
  return path.join(run.installedRoot, 'package')
}

describe.skipIf(!IS_ENABLED)('classic Vim, live (MUSE_LIVE_VIM=1)', () => {
  const run: DrillRun = {
    root: '',
    installedRoot: '',
    transcript: [],
    sessionId: '',
    sessionModel: '',
  }

  beforeAll(() => {
    requireVim()
    run.root = mkdtempSync(path.join(tmpdir(), 'vim-live-'))
    const installed = unpackTarball(run)
    const cwd = path.join(run.root, 'workspace')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      path.join(cwd, 'notes.txt'),
      'first line is alpha\nsecond line is bravo\nthird line is charlie\n',
    )
    const transcriptPath = path.join(run.root, 'transcript.txt')
    const launched = spawnSync(
      vimBinary(),
      ['--not-a-term', '-Nu', 'NONE', '-n', '-S', path.resolve('test/hosts/vim-live-driver.vim')],
      {
        env: {
          ...process.env,
          VIMLIVE_PLUGIN: path.join(installed, 'editors', 'vim'),
          VIMLIVE_NODE: process.execPath,
          VIMLIVE_ACP_JS: path.join(installed, 'dist', 'acp.js'),
          VIMLIVE_CWD: cwd,
          VIMLIVE_TRANSCRIPT: transcriptPath,
        },
        encoding: 'utf8',
        timeout: DRILL_TIMEOUT_MS,
      },
    )
    if (!existsSync(transcriptPath)) {
      throw new Error(
        `the live driver left no transcript (exit ${String(launched.status)}): ${launched.stderr.slice(-500)}`,
      )
    }
    run.transcript = readFileSync(transcriptPath, 'utf8').split('\n')
    if (launched.status !== 0) {
      throw new Error(
        `the live driver left ${String(launched.status)}: ${run.transcript[0] ?? '(empty)'}`,
      )
    }
    const sessionLine = run.transcript.find((line) => line.startsWith('[session '))
    const sessionMatch = /^\[session (\S+) on \S+\]$/.exec(sessionLine ?? '')
    if (sessionMatch?.[1] === undefined || sessionMatch[1] === '') {
      throw new Error('the transcript names no session')
    }
    run.sessionId = sessionMatch[1]
    // The [session] line names the model at open; the header names the
    // model the turns ran on after the driver's :MuseSparkModel switch
    // (`# Muse Spark — <model>`, with an optional ` (mode)` suffix).
    const headerLine = run.transcript.find((line) => line.startsWith('# Muse Spark — '))
    const headerMatch = /^# Muse Spark — (\S+)/.exec(headerLine ?? '')
    if (headerMatch?.[1] === undefined || headerMatch[1] === '') {
      throw new Error('the transcript names no model')
    }
    run.sessionModel = headerMatch[1]
  }, DRILL_TIMEOUT_MS)

  afterAll(() => {
    if (run.root !== '') rmSync(run.root, { recursive: true, force: true })
    if (run.installedRoot !== '') rmSync(run.installedRoot, { recursive: true, force: true })
  })

  it('holds three turns that answer as asked', () => {
    expect(run.transcript[0]).toBe('LIVE stop stop stop')
    expect(run.transcript.filter((line) => line.startsWith('[stop: end_turn]'))).toHaveLength(
      EXPECTED_TURNS,
    )
    expect(run.transcript).toContainEqual(expect.stringContaining('READY'))
    expect(run.transcript).toContainEqual(expect.stringContaining('second line is bravo'))
    expect(run.transcript).toContainEqual(expect.stringContaining('DONE'))
  })

  it('runs the session on the contributor model', () => {
    expect(run.sessionId).not.toBe('')
    expect(run.sessionModel).toBe(LIVE_MODEL_ID)
  })

  it('sends at most four model requests', () => {
    const { responses } = countSessionResponses(sessionJsonlPath(run.sessionId))
    expect(responses).toBeGreaterThan(0)
    expect(responses).toBeLessThanOrEqual(REQUEST_BUDGET)
  })

  it('names the contributor on every completed request', () => {
    const { responses, models } = countSessionResponses(sessionJsonlPath(run.sessionId))
    expect(responses).toBeGreaterThan(0)
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) expect(model).toBe(LIVE_MODEL_ID)
  })
})
