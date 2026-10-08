import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readdir, rm, readFile, access, writeFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deviceWorkerNative } from '../../src/host/backend/deviceWorkerNative'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { DEVICE_LIMITS, SHELL_JOB_FOLDER } from '../../src/shared/constants'
import {
  DeviceWorkerHost,
  type DeviceWorkerHostDeps,
} from '../../src/host/devices/deviceWorkerHost'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'

const usage = {
  settlementId: 'a'.repeat(32),
  payer: 'local',
  certainty: 'known',
  inputTokens: 0,
  outputTokens: 0,
  returnedUsd: 0,
  retainedLiabilityUsd: 0,
} as const
const scratch = { directory: '' }
function driver() {
  return deviceWorkerNative({
    storageDir: scratch.directory,
    systemRoot: process.env['SystemRoot'] ?? '',
    sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
    environment: process.env,
  })
}
describe.skipIf(process.platform !== 'win32')('M100/H real Windows scheduled worker', () => {
  beforeAll(async () => {
    scratch.directory = await mkdtemp(path.join(tmpdir(), 'm100-worker-native-'))
  })
  afterAll(async () => {
    const powershell = windowsPowerShell(process.env['SystemRoot'] ?? '')
    const script = String.raw`$s = New-Object -ComObject Schedule.Service; $s.Connect(); $f = $s.GetFolder('\'); foreach ($t in $f.GetTasks(0)) { if ($t.Name.StartsWith('MuseSparkDevice-') -and $t.Definition.Actions.Item(1).Arguments.Contains(${powerShellQuoted(scratch.directory)})) { $t.Stop(0); $f.DeleteTask($t.Name, 0) } }; foreach ($t in $f.GetTasks(0)) { if ($t.Name.StartsWith('MuseSparkDevice-') -and $t.Definition.Actions.Item(1).Arguments.Contains(${powerShellQuoted(scratch.directory)})) { [Console]::WriteLine($t.Name) } }`
    try {
      const remaining = await runProgram(
        powershell.file,
        [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
        powershell.env,
      )
      expect(remaining.trim()).toBe('')
    } finally {
      await rm(scratch.directory, { recursive: true, force: true })
    }
  })
  it('compiles and self-tests launch, context, accounting and power', async () => {
    const native = driver()
    expect(await native.selfTest()).toBe(true)
    expect(await native.query()).toMatchObject({
      context: {
        session: expect.any(Number),
        station: expect.any(String),
        desktop: expect.any(String),
      },
      power: expect.stringMatching(/^(?:ac|battery|unknown)$/),
      sleepInhibited: false,
      activeProcesses: 0,
      cpu100ns: 0,
      peakMemoryBytes: 0,
    })
  })
  it('uses a private task desktop, closed stdin, JSON stdout despite stderr banners, and removes the task', async () => {
    const native = driver()
    const script = String.raw`process.stderr.write('PowerShell warning banner\n'); let bytes=0; process.stdin.on('data',b=>bytes+=b.length); process.stdin.on('end',()=>{if(bytes!==0)process.exit(1);process.stdout.write(${JSON.stringify(JSON.stringify({ usage }))})})`
    const deps: DeviceWorkerHostDeps = {
      driver: native,
      environment: process.env,
      retain: () => Promise.resolve(),
      reserve: () =>
        Promise.resolve({
          usage,
          pause: () => Promise.resolve(),
          release: () => Promise.resolve(),
        }),
      command: () =>
        Promise.resolve({
          executable: process.execPath,
          args: ['-e', script],
          cwd: scratch.directory,
          requiredTools: [],
        }),
      recordEnvironment: () => Promise.resolve(),
      pressure: () => undefined,
    }
    const host = new DeviceWorkerHost(deps)
    const attempt = await host.admit(deviceCheck(deviceGrant('a'.repeat(32))))
    try {
      await attempt.start({
        beforeAction: () => Promise.resolve(),
        beforePaidUse: () => Promise.resolve(),
      })
      expect(await attempt.retirement).toEqual({ usage })
      await attempt.release()
    } finally {
      await attempt.cancel()
    }
    // remove happens before the asynchronous finish promise settles; observe its exact directory.
    await expect
      .poll(async () => await readdir(path.join(scratch.directory, 'device-workers')))
      .toEqual([])
    const facts = await host.facts()
    expect(facts.sleepInhibited).toBe(false)
  })
  it('observes a detached descendant after the direct parent exits', async () => {
    const native = driver()
    const marker = path.join(scratch.directory, 'descendant-finished')
    const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'finished'),100)`
    const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',detached:true}).unref();process.stdout.write('structured-parent-result');`
    const job = await native.launch(
      {
        executable: process.execPath,
        args: ['-e', script],
        cwd: scratch.directory,
        requiredTools: [],
      },
      { SystemRoot: process.env['SystemRoot'] ?? '' },
    )
    try {
      await job.activate()
      expect(await job.retirement).toMatchObject({
        exitCode: 0,
        stdout: 'structured-parent-result',
        failure: 'none',
      })
      expect(await readFile(marker, 'utf8')).toBe('finished')
    } finally {
      await job.cancel()
      await job.remove()
    }
  })
  it('keeps the helper awake, samples the whole job, and cancels descendants as a job', async () => {
    const native = driver()
    const marker = path.join(scratch.directory, 'running-tree')
    const script = `require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore',detached:true}).unref();require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},100)`
    const job = await native.launch(
      {
        executable: process.execPath,
        args: ['-e', script],
        cwd: scratch.directory,
        requiredTools: [],
      },
      { SystemRoot: process.env['SystemRoot'] ?? '' },
    )
    try {
      await job.activate()
      await expect
        .poll(async () => {
          try {
            await access(marker)
            return true
          } catch {
            return false
          }
        })
        .toBe(true)
      expect(await native.query()).toMatchObject({
        sleepInhibited: true,
        activeProcesses: expect.any(Number),
        peakMemoryBytes: expect.any(Number),
      })
      await job.cancel()
      expect(await job.retirement).toMatchObject({ exitCode: 1, failure: 'none' })
    } finally {
      await job.cancel()
      await job.remove()
    }
    expect(await native.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
  })
  it('bounds the structured channel and ends a flooding job', async () => {
    const native = driver()
    const job = await native.launch(
      {
        executable: process.execPath,
        args: ['-e', `process.stdout.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes + 1)}))`],
        cwd: scratch.directory,
        requiredTools: [],
      },
      { SystemRoot: process.env['SystemRoot'] ?? '' },
    )
    try {
      await job.activate()
      expect(await job.retirement).toMatchObject({ failure: 'capacity' })
    } finally {
      await job.cancel()
      await job.remove()
    }
  })
  it('a corrupted cached helper fails self-test and refuses launch without fallback', async () => {
    const folder = path.join(scratch.directory, SHELL_JOB_FOLDER)
    const names = await readdir(folder)
    const executable = names.find((name) => name.endsWith('.exe'))
    expect(executable).toBeDefined()
    if (executable === undefined) throw new Error('native test helper missing')
    await writeFile(path.join(folder, executable), 'corrupted helper')
    const native = driver()
    expect(await native.selfTest()).toBe(false)
    await expect(
      native.launch(
        { executable: process.execPath, args: [], cwd: scratch.directory, requiredTools: [] },
        {},
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
  })
})
