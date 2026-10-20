// The crash offer's marker (src/host/support/reportJournal.ts) on real files
// and real processes. Windows real use, 0.19.0: "Muse Spark Code stopped
// unexpectedly last time — report it?" showed at every VS Code start,
// because deactivate cleared the marker only after the whole shutdown, which
// the editor cuts short, and because a marker whose process id Windows had
// handed to another process read as a live window and was never consumed.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createWindowJournal } from '../../src/host/support/recorderEntry'
import { ReportRecorder } from '../../src/host/support/reportRecorder'

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const state = { dir: '', children: [] as ChildProcess[] }

beforeEach(async () => {
  state.dir = await mkdtemp(path.join(tmpdir(), 'muse-crash-marker-'))
})
afterEach(async () => {
  for (const child of state.children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  state.children = []
  await rm(state.dir, { recursive: true, force: true })
})

function journal(pid: number, now: () => number = () => Date.now()) {
  return createWindowJournal({
    globalStorageDir: state.dir,
    instance: randomUUID(),
    ext: '0.19.0',
    host: 'test',
    pid,
    log: silent,
    isAlive,
    extensionRoot: state.dir,
    now,
  })
}

async function markers(): Promise<string[]> {
  const names = await readdir(path.join(state.dir, 'reports'))
  return names.filter((name) => name.startsWith('marker-'))
}

/** A real process that ends at once: its id is gone after it exits. */
async function endedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(child, 'exit')
  if (child.pid === undefined) throw new Error('the child never started')
  return child.pid
}

it('an orderly stop clears the marker before the shutdown, so the next start offers nothing', async () => {
  const pid = await endedPid()
  const recorder = new ReportRecorder({
    load: () => Promise.resolve(journal(pid)),
    now: () => Date.now(),
    onUnavailable: () => undefined,
  })
  await expect(recorder.start()).resolves.toBe(false)
  expect(await markers()).toHaveLength(1)
  // deactivate: the marker goes first, while recording still runs.
  await recorder.markOrderlyStop()
  expect(await markers()).toEqual([])
  // The editor ends the host before the rest of the shutdown: no crash.
  await expect(journal(process.pid).startup()).resolves.toBe(false)
})

it('a window that really ended without stopping still offers a report once', async () => {
  const pid = await endedPid()
  await expect(journal(pid).startup()).resolves.toBe(false)
  await expect(journal(process.pid).startup()).resolves.toBe(true)
  await expect(journal(process.pid).startup()).resolves.toBe(false)
})

it.runIf(process.platform === 'win32' || process.platform === 'darwin')(
  'a marker whose process id now names a newer process is consumed as gone',
  async () => {
    // The marker was written a minute ago; its id now belongs to a process
    // born after that, as when Windows hands the id out again.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], {
      stdio: 'ignore',
    })
    state.children.push(child)
    await once(child, 'spawn')
    if (child.pid === undefined) throw new Error('the child never started')
    const minuteAgo = Date.now() - 60_000
    await expect(journal(child.pid, () => minuteAgo).startup()).resolves.toBe(false)
    expect(isAlive(child.pid)).toBe(true)
    await expect(journal(process.pid).startup()).resolves.toBe(true)
    // Only the newest window's own marker is left.
    expect(await markers()).toHaveLength(1)
  },
)

it('a live window whose process predates its marker is never consumed', async () => {
  await expect(journal(process.pid).startup()).resolves.toBe(false)
  await expect(journal(process.pid).startup()).resolves.toBe(false)
  expect(await markers()).toHaveLength(2)
})
