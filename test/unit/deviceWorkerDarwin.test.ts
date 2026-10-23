// M100 lane H: the macOS worker driver and platform selection, over the
// real tools. Selection returns each platform's real driver and refuses
// mismatches and unknown systems without invoking factories. On macOS the
// driver self-tests through the real launchd domain and compiler, refuses
// empty caps without allocating, and launches a real supervised command
// whose marker file and retirement prove it ran.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { workerEnvironment } from '../../src/core/team/refFence'
import { deviceWorkerDarwin, escapeXml } from '../../src/host/backend/deviceWorkerDarwin'
import { deviceWorkerLinux } from '../../src/host/backend/deviceWorkerLinux'
import { deviceWorkerNative } from '../../src/host/backend/deviceWorkerNative'
import {
  DeviceWorkerHostError,
  selectDeviceWorkerDriver,
  type DeviceWorkerAttempt,
  type DeviceWorkerDriver,
  type DeviceWorkerDriverFactories,
} from '../../src/host/devices/deviceWorkerHost'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import { launchedJob } from './helpers/deviceWorkerReceiver'

const logged: LoggedMessage[] = []
const log = levelLogger(logged)

function uncalledFactory(): DeviceWorkerDriver {
  throw new Error('factory-called')
}

function attempt(processes: number): DeviceWorkerAttempt {
  const check = deviceCheck(deviceGrant('a'.repeat(32)))
  return { identity: check.identity, caps: { ...check.caps, processes } }
}

function launchEnv(): Record<string, string> {
  const filtered = workerEnvironment(process.env, 'darwin')
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(filtered)) {
    if (value !== undefined) env[key] = value
  }
  return env
}

function factories(storageDir: string): DeviceWorkerDriverFactories {
  return {
    darwin: () =>
      deviceWorkerDarwin({
        storageDir: path.join(storageDir, 'darwin'),
        environment: process.env,
        log,
      }),
    linux: () => deviceWorkerLinux({ environment: process.env, log }),
    win32: () =>
      deviceWorkerNative({
        storageDir: path.join(storageDir, 'native'),
        systemRoot: process.env['SystemRoot'] ?? '',
        sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
        environment: process.env,
        log,
      }),
  }
}

describe('M100 worker driver selection', () => {
  it('selects each platform’s real driver', async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), 'm100-select-'))
    try {
      const made = factories(storageDir)
      await expect(selectDeviceWorkerDriver('darwin', made)).resolves.toMatchObject({
        platform: 'darwin',
      })
      await expect(selectDeviceWorkerDriver('linux', made)).resolves.toMatchObject({
        platform: 'linux',
      })
      await expect(selectDeviceWorkerDriver('win32', made)).resolves.toMatchObject({
        platform: 'win32',
      })
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('refuses a driver built for another platform', async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), 'm100-select-'))
    try {
      const made = factories(storageDir)
      const mismatched: DeviceWorkerDriverFactories = {
        ...made,
        darwin: made.linux,
      }
      let failure: unknown
      try {
        await selectDeviceWorkerDriver('darwin', mismatched)
        expect.unreachable('mismatched driver selected')
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DeviceWorkerHostError)
      expect((failure as DeviceWorkerHostError).detail).toBe('helper')
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('refuses an unknown system without invoking any factory', async () => {
    let failure: unknown
    try {
      await selectDeviceWorkerDriver('aix', {
        darwin: uncalledFactory,
        linux: uncalledFactory,
        win32: uncalledFactory,
      })
      expect.unreachable('unknown system selected')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DeviceWorkerHostError)
    expect((failure as DeviceWorkerHostError).detail).toBe('helper')
  })
})

describe('darwin worker plist escaping', () => {
  it('escapes the five XML metacharacters', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    )
  })
})

describe.skipIf(process.platform !== 'darwin')('M100 darwin worker', () => {
  const scratch: { directory: string } = { directory: '' }
  beforeEach(async () => {
    scratch.directory = await mkdtemp(path.join(tmpdir(), 'm100-darwin-'))
  })
  afterEach(async () => {
    await rm(scratch.directory, { recursive: true, force: true })
  })

  function driver(): DeviceWorkerDriver {
    return deviceWorkerDarwin({
      storageDir: scratch.directory,
      environment: process.env,
      log,
    })
  }

  it('refuses empty caps before preparing anything', async () => {
    const launched = await driver().launch(
      { executable: '/usr/bin/true', args: [], cwd: scratch.directory, requiredTools: [] },
      launchEnv(),
      attempt(0),
    )
    expect(launched.kind).toBe('refused')
    await expect(readdir(scratch.directory)).resolves.toEqual([])
  })

  it('reports no GUI domain for a user id without one', async () => {
    const guiLess = deviceWorkerDarwin({
      storageDir: scratch.directory,
      environment: process.env,
      log,
      uid: 2 ** 30,
    })
    await expect(guiLess.selfTest()).resolves.toBe(false)
    const launched = await guiLess.launch(
      { executable: '/usr/bin/true', args: [], cwd: scratch.directory, requiredTools: [] },
      launchEnv(),
      attempt(1),
    )
    expect(launched.kind).toBe('refused')
  })

  // First preparation compiles the ObjC helper and bootstraps a supervised
  // launchd probe: real OS work, so this one case gets a wider deadline.
  it('launches a real supervised command when the host prepares, else refuses', async () => {
    const worker = driver()
    const isPrepared = await worker.selfTest()
    const marker = path.join(scratch.directory, 'marker.txt')
    const launched = await worker.launch(
      {
        executable: '/bin/sh',
        args: ['-c', `echo finished > "${marker}"`],
        cwd: scratch.directory,
        requiredTools: [],
      },
      launchEnv(),
      attempt(1),
    )
    if (launched.kind !== 'launched') {
      expect(isPrepared).toBe(false)
      expect(launched.kind).toBe('refused')
      return
    }
    expect(isPrepared).toBe(true)
    const job = await launchedJob(Promise.resolve(launched))
    try {
      await job.activate()
      await expect(job.retirement).resolves.toMatchObject({ exitCode: 0, failure: 'none' })
      await expect(readFile(marker, 'utf8')).resolves.toBe('finished\n')
    } finally {
      await job.cancel()
      await job.remove()
    }
    await expect(worker.query()).resolves.toMatchObject({ activeProcesses: 0 })
  }, 30_000)
})
