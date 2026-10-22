// Two app instances starting at the same moment must share the
// created-resources registry: one failed session/new with `Command failed:
// powershell.exe ... [MuseSparkCreated]::Execute('publish', ...)` when lanes
// RLSCHED and RLFINISH started together (2026-10-22 00:52, published 0.19.0).
// The losing compare-and-swap ended the session, and a winning save dropped
// whatever the other process had written. Two real processes meet at the
// same instant here through the product's own native file commands on every
// platform; every created entry must survive in the live manifest and no
// save may fail. The driver (test/hosts/created-registry-race.mjs) is a
// plain node script, so the lead can also run it by hand on any machine.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureResources } from '../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'

const scratch: {
  folder: string
  bundle: string
  storage: string
  nativeRoot: string
  disposeAdmission: (() => void) | undefined
} = {
  folder: '',
  bundle: '',
  storage: '',
  nativeRoot: '',
  disposeAdmission: undefined,
}
const PROCESSES = 2
const ROUNDS = 2
const CREATES = 2

beforeAll(async () => {
  scratch.folder = await mkdtemp(path.join(path.resolve('temp'), 'created-registry-race-'))
  scratch.bundle = path.join(scratch.folder, 'createdRegistryRace.cjs')
  await build({
    entryPoints: [path.resolve('test/unit/createdRegistryRaceEntry.ts')],
    outfile: scratch.bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  // The product's own helper builds, so the workers run the confined native
  // protocol the product ships, never a copy of its flags.
  if (process.platform === 'linux') {
    scratch.nativeRoot = path.join(scratch.folder, 'native')
    buildLinuxHelper(path.join(scratch.nativeRoot, 'linux', process.arch))
    scratch.storage = path.join(scratch.folder, 'jobs')
  } else if (process.platform === 'win32') {
    // The job helpers build where the Windows pipe helper suite builds them:
    // the temporary root, which the run's TEMP keeps private. Both workers
    // reuse this build through the storage folder they are given.
    scratch.storage = await mkdtemp(path.join(tmpdir(), 'created-race-jobs-'))
    const windowsJob = runtimeWindowsJob(scratch.storage, path.resolve('.'))
    // The build is admitted through the governor, configured as the host does.
    scratch.disposeAdmission = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
    scratch.nativeRoot = path.resolve('native')
  } else {
    scratch.storage = path.join(scratch.folder, 'jobs')
    scratch.nativeRoot = path.resolve('native')
  }
})

afterAll(async () => {
  scratch.disposeAdmission?.()
  scratch.disposeAdmission = undefined
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
  if (process.platform === 'win32' && scratch.storage !== '')
    await rm(scratch.storage, { recursive: true, force: true })
})

interface Summary {
  readonly processes: number
  readonly rounds: number
  readonly creates: number
  readonly created: number
  readonly failures: readonly string[]
  readonly missing: readonly string[]
  readonly crashed: number
}

describe('the created registry under a race (RLWINFIX2 item 1)', () => {
  it('shares the manifest between two processes started together, losing nothing', async () => {
    const driver = spawn(
      process.execPath,
      [
        path.resolve('test/hosts/created-registry-race.mjs'),
        scratch.bundle,
        path.join(scratch.folder, 'work'),
        scratch.storage,
        path.resolve('.'),
        scratch.nativeRoot,
        String(PROCESSES),
        String(ROUNDS),
        String(CREATES),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    let output = ''
    driver.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    const [code] = await once(driver, 'exit')
    const summary = JSON.parse(output) as Summary
    expect(summary.crashed).toBe(0)
    expect(summary.failures).toEqual([])
    // Every created entry survives in the live manifest: no lost update.
    expect(summary.missing).toEqual([])
    expect(summary.created).toBe(PROCESSES * ROUNDS * CREATES)
    expect(code).toBe(0)
    // Two processes times two rounds of native compare-and-swap publishes
    // takes seconds, not milliseconds: the timeout covers the genuinely
    // long race, nothing else.
  }, 120_000)
})
