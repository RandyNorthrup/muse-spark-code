import { spawn, type ChildProcess } from 'node:child_process'
import { access, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { landTeamTask, recoverOpenLandings } from '../../src/host/team/teamLandingEntry'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { EN } from '../../src/shared/l10n/en'
import {
  landingRunGit,
  landingTask,
  makeLandingFixture,
  type LandingFixture,
} from './helpers/teamLandingFixture'

// Killed lander (M96c lanes K/I/X2), with real processes: a bundled child
// runs the product's checked landing and is SIGKILLed after its journal
// intent is durable and its index lock held. The next window cannot
// recover while the dead lander's lock stands; once the person removes
// that lock (git's own advice), confirmed-takeover recovery settles the
// dead owner's record, keeps a later user edit, and landing works again.

const holder: { fixture?: LandingFixture; bundle: string; child?: ChildProcess } = { bundle: '' }

async function hasFile(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await hasFile(file)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('the lander child never reached the kill point')
}

beforeAll(async () => {
  holder.fixture = await makeLandingFixture('task-killed')
  holder.bundle = path.join(holder.fixture.storage, 'teamLandingChild.mjs')
  await build({
    entryPoints: [path.resolve('test/unit/teamLandingChild.entry.ts')],
    outfile: holder.bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
}, 120_000)

afterAll(async () => {
  holder.child?.kill('SIGKILL')
  await holder.fixture?.dispose()
})

describe('killed lander recovery (real processes)', () => {
  it('a SIGKILLed lander blocks, then confirmed takeover recovers its record', async () => {
    const fixture = holder.fixture
    if (fixture === undefined) throw new Error('fixture missing')
    const { root, storage } = fixture
    const readyFile = path.join(storage, 'lander-ready')
    const planFile = path.join(storage, 'lander-plan.json')
    const deadOwner = createWindowIdentity(1000)
    await writeFile(
      planFile,
      JSON.stringify({
        root,
        storage,
        workerCopy: fixture.workerCopy,
        baseCommit: fixture.baseCommit,
        head: fixture.head,
        agentsRef: fixture.agentsRef,
        taskId: fixture.taskId,
        readyFile,
        owner: deadOwner,
      }),
    )
    const child = spawn(process.execPath, [holder.bundle, planFile], { stdio: 'ignore' })
    holder.child = child
    const exited = new Promise<void>((resolve) => {
      child.on('exit', () => {
        resolve()
      })
    })

    // The intent is durable and the lock held; no rename has happened.
    await waitFor(readyFile)
    const lockFile = path.join(root, '.git', 'index.lock')
    expect(await hasFile(lockFile)).toBe(true)
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('before\n')

    child.kill('SIGKILL')
    await exited
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('before\n')
    expect(await hasFile(lockFile)).toBe(true)

    const nextOwner = createWindowIdentity(2000)
    const deps = {
      root,
      storage,
      platform: process.platform,
      isTrusted: () => true,
      runGit: landingRunGit,
      policy: {
        owner: nextOwner,
        checks: () => ({
          commands: [{ name: 'check', command: 'true', timeoutSeconds: 60 }],
          platform: process.platform,
          setupCommand: '',
          cacheKey: '',
        }),
        runChecks: () => Promise.resolve({ passed: true }),
        confirmWithoutChecks: () => Promise.resolve(false),
        validateTarget: () => Promise.resolve(),
        hints: () => Promise.resolve([]),
        confirmTakeover: () => Promise.resolve(true),
      },
    }
    const signal = new AbortController().signal

    // The dead lander's lock is never removed silently: recovery waits.
    expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(0)

    // The person removes the stale lock and edits the file themselves.
    await rm(lockFile)
    await writeFile(path.join(root, 'file.txt'), 'user edit\n')

    // Confirmed takeover settles the dead owner's open record and keeps
    // the person's bytes (reported as the recovered landing's conflict).
    expect(await recoverOpenLandings(EN, 'en', deps, signal)).toBe(1)
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('user edit\n')

    // The settled record no longer blocks landing: with the person's edit
    // resolved back to the base bytes, the worker change lands.
    await writeFile(path.join(root, 'file.txt'), 'before\n')
    const result = await landTeamTask(
      EN,
      'en',
      { ...deps, writePaths: undefined },
      landingTask(fixture),
      signal,
      { allowProtected: false },
    )
    expect(result.status).toBe('merged')
    expect(await readFile(path.join(root, 'file.txt'), 'utf8')).toBe('after\n')
    // A real child process, real git checkouts and two recoveries exceed
    // the 5 s default on this rig class.
  }, 120_000)
})
