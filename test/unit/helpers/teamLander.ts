// The lander as a real process: test/unit/teamLandingChild.entry.ts bundled
// with esbuild and started on a fixture, stopping where the suite asks.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll } from 'vitest'
import * as z from 'zod/mini'
import type { WindowIdentity } from '../../../src/host/team/windowIdentity'
import { ATOMIC_TEMPORARY_SUFFIX } from '../../../src/shared/constants'
import { makeLandingFixture, type LandingFixture } from './teamLandingFixture'

export async function hasFile(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** The exit of `git add` in `root`: it meets the index lock as any git command does. */
export function gitAddExit(root: string, file: string): Promise<number> {
  return new Promise((resolve) => {
    execFile('git', ['add', '--', file], { cwd: root }, (error) => {
      if (error === null) resolve(0)
      else resolve(typeof error.code === 'number' ? error.code : 1)
    })
  })
}

/** What sits in `root` under the name of a stage: a write's replacement, before its rename. */
export async function stagesIn(root: string): Promise<readonly string[]> {
  const names = await readdir(root)
  return names.filter((name) => name.endsWith(ATOMIC_TEMPORARY_SUFFIX))
}

/** A maker of fixtures in one spelling, all disposed after the suite that calls this. */
export function landingFixturesIn(
  spelling: Parameters<typeof makeLandingFixture>[1],
): (taskId: string, files?: readonly string[]) => Promise<LandingFixture> {
  const made: LandingFixture[] = []
  afterAll(async () => {
    for (const fixture of made) await fixture.dispose()
  })
  return async (taskId, files) => {
    const fixture = await makeLandingFixture(taskId, spelling, files)
    made.push(fixture)
    return fixture
  }
}

export interface LanderBuild {
  readonly bundle: string
  readonly children: Set<ChildProcess>
  dispose(): Promise<void>
}

export async function buildLander(): Promise<LanderBuild> {
  const folder = await mkdtemp(path.join(tmpdir(), 'muse-m96c-lander-'))
  const bundle = path.join(folder, 'teamLandingChild.mjs')
  await build({
    entryPoints: [path.resolve('test/unit/teamLandingChild.entry.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
  const children = new Set<ChildProcess>()
  return {
    bundle,
    children,
    dispose: async () => {
      for (const child of children) child.kill('SIGKILL')
      await rm(folder, { recursive: true, force: true })
    },
  }
}

export interface RunningLander {
  /** Once the lander stands at its stop point, alive. */
  stopped(): Promise<void>
  /** Kills it hard (SIGKILL; on Windows Node's kill is TerminateProcess) and waits for the end. */
  kill(): Promise<{ readonly isAliveAtKill: boolean; readonly signal: NodeJS.Signals | null }>
  /** Lets it go on from the stop point and returns what its landing returned. */
  release(): Promise<{ readonly exit: number | null; readonly status: string }>
}

const resultSchema = z.object({ status: z.string() })

/** Starts the checked landing, or its recovery, in a process of its own, as window `owner`. */
export async function startLander(
  build: LanderBuild,
  fixture: LandingFixture,
  owner: WindowIdentity,
  stop: { readonly file: string; readonly atRename: boolean; readonly isRecovery?: boolean },
): Promise<RunningLander> {
  const name = (part: string): string =>
    path.join(fixture.storage, `lander-${randomUUID()}.${part}`)
  const readyFile = name('ready')
  const releaseFile = name('release')
  const resultFile = name('result')
  const planFile = name('plan.json')
  await writeFile(
    planFile,
    JSON.stringify({
      root: fixture.root,
      storage: fixture.storage,
      workerCopy: fixture.workerCopy,
      baseCommit: fixture.baseCommit,
      head: fixture.head,
      agentsRef: fixture.agentsRef,
      taskId: fixture.taskId,
      changedFiles: fixture.changedFiles,
      owner,
      readyFile,
      releaseFile,
      resultFile,
      stopFile: stop.file,
      stopAtRename: stop.atRename,
      isRecovery: stop.isRecovery ?? false,
    }),
  )
  const child = spawn(process.execPath, [build.bundle, planFile], { stdio: 'ignore' })
  build.children.add(child)
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      build.children.delete(child)
      resolve()
    })
  })
  return {
    stopped: async () => {
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (await hasFile(readyFile)) return
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('the lander never reached its stop point')
    },
    kill: async () => {
      const isAliveAtKill = child.exitCode === null && child.signalCode === null
      child.kill('SIGKILL')
      await exited
      return { isAliveAtKill, signal: child.signalCode }
    },
    release: async () => {
      await writeFile(releaseFile, 'go\n')
      await exited
      const result = resultSchema.parse(JSON.parse(await readFile(resultFile, 'utf8')))
      return { exit: child.exitCode, status: result.status }
    },
  }
}
