// Classic Vim's live conversation drill (M66, RLF-HOSTS2): real Vim drives
// the packed agent's shipped plugin for three short turns on the contributor
// model, one quoting a file read. Opt-in only, never in CI: it bills the
// owner's subscription, so it runs when MUSE_LIVE_VIM=1 with
// MUSE_LIVE_VIM_TARBALL pointing at the packed agent tarball, Vim 8.1+ with
// +job/+channel on PATH (or VIM_BIN), and the owner's own sign-in. The
// model attempts are counted from the CLI's own trace log for the session
// (test/e2e/liveCli.ts); the session log names the model of every request.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  countAttempts,
  countSessionResponses,
  LIVE_MODEL_ID,
  sessionJsonlPath,
  sessionLog,
} from './liveCli'

const IS_ENABLED = process.env['MUSE_LIVE_VIM'] === '1'
// Three live model turns plus session start and shutdown.
const DRILL_TIMEOUT_MS = 600_000
// The trace log unlocks once the CLI's host process has exited.
const COUNT_TIMEOUT_MS = 60_000
// A reply-only turn is 25 to 45 model attempts on Muse Code 1.3.0 (one for
// the answer, the rest the CLI's bundled reminder agents; live.e2e.test.ts):
// three turns fit under 200 with headroom for the read turn's tool loop.
const ATTEMPT_BUDGET = 200
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
    const match = /^\[session (\S+) on (\S+)\]$/.exec(sessionLine ?? '')
    if (match?.[1] === undefined || match[1] === '') {
      throw new Error('the transcript names no session')
    }
    run.sessionId = match[1]
    run.sessionModel = match[2] ?? ''
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

  it(
    'counts the model attempts from the CLI trace log',
    async () => {
      const attempts = countAttempts(await sessionLog(run.sessionId))
      expect(attempts).toBeGreaterThan(0)
      expect(attempts).toBeLessThanOrEqual(ATTEMPT_BUDGET)
    },
    COUNT_TIMEOUT_MS,
  )

  it('names the contributor on every completed request', () => {
    const { responses, models } = countSessionResponses(sessionJsonlPath(run.sessionId))
    expect(responses).toBeGreaterThan(0)
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) expect(model).toBe(LIVE_MODEL_ID)
  })
})
