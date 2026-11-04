// A real `supervise panel --companion` from the build, and a page a browser could
// reach (cc-int11's open edge): whatever takes the supervisor, nothing keeps serving.
// POSIX only: Windows contains the run in a kill-on-close job, and there the
// companion's opener would start the machine's real browser. PATH holds Node alone
// here, so the opener finds nothing to run. No model call, no Muse Code.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const ACP = path.join(ROOT, 'dist', 'acp.js')
const STARTS_WITHIN_MS = 60_000
const ENDS_WITHIN_MS = 30_000
const SECOND_SIGNAL_GAP_MS = 5

const folders: string[] = []
const running: ChildProcess[] = []

function scratch(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-sup-'))
  folders.push(folder)
  return folder
}

/** Whether the page still answers: a refused connection is the run gone. */
async function isAnswering(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ENDS_WITHIN_MS) })
    await response.arrayBuffer()
    return true
  } catch (error: unknown) {
    if (error instanceof TypeError) return false
    throw error
  }
}

/** The supervised page up and answering. */
async function supervisedPage() {
  const home = scratch()
  const bin = path.join(home, 'bin')
  mkdirSync(bin)
  symlinkSync(process.execPath, path.join(bin, 'node'))
  const supervisor = spawn(process.execPath, [ACP, 'supervise', 'panel', '--companion'], {
    cwd: scratch(),
    env: { HOME: home, PATH: bin, LANG: 'C.UTF-8' },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  running.push(supervisor)
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    supervisor.once('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })
  const url = await new Promise<string>((resolve, reject) => {
    let printed = ''
    const timer = setTimeout(() => {
      reject(new Error(`the page did not start: ${printed}`))
    }, STARTS_WITHIN_MS)
    supervisor.stdout.on('data', (chunk: Buffer) => {
      printed += chunk.toString('utf8')
      const found = /http:\/\/127\.0\.0\.1:\d+\//u.exec(printed)?.[0]
      if (found === undefined) return
      clearTimeout(timer)
      resolve(found)
    })
  })
  expect(await isAnswering(url)).toBe(true)
  return { supervisor, ended, url }
}

/** Polls the page until it is gone; a page still answering at the bound is the failure. */
async function expectPageGone(url: string): Promise<void> {
  const deadline = Date.now() + ENDS_WITHIN_MS
  while (await isAnswering(url)) {
    if (Date.now() > deadline) throw new Error('the supervised page outlived its supervisor')
    await delay(100)
  }
}

describe.skipIf(process.platform === 'win32')('a supervised run and its supervisor', () => {
  beforeAll(() => {
    assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  })

  afterEach(() => {
    for (const each of running.splice(0)) each.kill('SIGKILL')
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  it('ends when a KILL takes its supervisor', { timeout: 120_000 }, async () => {
    const { supervisor, ended, url } = await supervisedPage()
    supervisor.kill('SIGKILL')
    expect(await ended).toEqual({ code: null, signal: 'SIGKILL' })
    await expectPageGone(url)
  })

  // A hard stop from an editor's teardown or a closed terminal, heard as a stop.
  it('stops in order when the terminal closes', { timeout: 120_000 }, async () => {
    const { supervisor, ended, url } = await supervisedPage()
    supervisor.kill('SIGHUP')
    expect(await ended).toEqual({ code: 0, signal: null })
    await expectPageGone(url)
  })

  it('lets a second TERM find the first stop still in hand', { timeout: 120_000 }, async () => {
    const { supervisor, ended, url } = await supervisedPage()
    supervisor.kill('SIGTERM')
    await delay(SECOND_SIGNAL_GAP_MS)
    supervisor.kill('SIGTERM')
    expect(await ended).toEqual({ code: 0, signal: null })
    await expectPageGone(url)
  })

  it('stops in order on one TERM, its record gone with it', { timeout: 120_000 }, async () => {
    const { supervisor, ended, url } = await supervisedPage()
    supervisor.kill('SIGTERM')
    expect(await ended).toEqual({ code: 0, signal: null })
    expect(await isAnswering(url)).toBe(false)
  })
})
