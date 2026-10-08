import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, readdir, rm, readFile, access, writeFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deviceWorkerNative } from '../../src/host/backend/deviceWorkerNative'
import { compileJob, jobFileName, type JobBuild } from '../../src/host/backend/jobBuild'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { DEVICE_LIMITS, SHELL_JOB_FOLDER } from '../../src/shared/constants'
import {
  DeviceWorkerHost,
  type DeviceWorkerAttempt,
  type DeviceWorkerDriver,
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
const check = deviceCheck(deviceGrant('a'.repeat(32)))
function admitted(processes: number): DeviceWorkerAttempt {
  return { identity: check.identity, caps: { ...check.caps, processes } }
}
function driver() {
  return deviceWorkerNative({
    storageDir: scratch.directory,
    systemRoot: process.env['SystemRoot'] ?? '',
    sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
    environment: process.env,
  })
}
function launchScript(native: DeviceWorkerDriver, script: string, attempt = admitted(2)) {
  return native.launch(
    {
      executable: process.execPath,
      args: ['-e', script],
      cwd: scratch.directory,
      requiredTools: [],
    },
    { SystemRoot: process.env['SystemRoot'] ?? '' },
    attempt,
  )
}
async function isPresent(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
// Reads the OS job itself (JOBOBJECT_EXTENDED_LIMIT_INFORMATION), not the helper's request file.
const jobLimitProbe = `using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class M100JobLimitProbe {
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum;
    public uint Active; public IntPtr Affinity; public uint Priority, Scheduling;
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Limits info, int size, IntPtr returned);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void Main(string[] args) {
    IntPtr job = OpenJobObjectW(4, false, args[0]);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      Limits limits;
      if (!QueryInformationJobObject(job, 9, out limits, Marshal.SizeOf(typeof(Limits)), IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
      Console.WriteLine(limits.Flags + " " + limits.Active);
    } finally { CloseHandle(job); }
  }
}
`
const probeBuild: JobBuild = {
  stem: 'M100JobLimitProbe-',
  extension: '.exe',
  outputType: 'exe',
  references: [],
  label: 'job limit probe',
  isPresent: (file) => isPresent(file),
}
const probe = { file: '' }
/** The one pending job's limit flags and ActiveProcessLimit, read by name from Windows. */
async function pendingJobLimit(): Promise<{ flags: number; activeProcessLimit: number }> {
  const ids = await readdir(path.join(scratch.directory, 'device-workers'))
  expect(ids).toHaveLength(1)
  const output = await runProgram(
    probe.file,
    [String.raw`Global\MuseSparkDevice-${ids[0] ?? ''}`],
    process.env,
  )
  const [flags, activeProcessLimit] = output.trim().split(' ').map(Number)
  return { flags: flags ?? NaN, activeProcessLimit: activeProcessLimit ?? NaN }
}
describe.skipIf(process.platform !== 'win32')('M100/H real Windows scheduled worker', () => {
  beforeAll(async () => {
    scratch.directory = await mkdtemp(path.join(tmpdir(), 'm100-worker-native-'))
    probe.file = path.join(
      scratch.directory,
      'job-limit-probe',
      jobFileName(probeBuild, jobLimitProbe),
    )
    await compileJob(probeBuild, probe.file, jobLimitProbe, process.env['SystemRoot'] ?? '')
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
    // The real helper claims only its in-process job probe, never the scheduler path.
    const folder = path.join(scratch.directory, SHELL_JOB_FOLDER)
    const built = await readdir(folder)
    const helper = built.find((name) => name.endsWith('.exe'))
    expect(helper).toBeDefined()
    expect(
      JSON.parse(await runProgram(path.join(folder, helper ?? ''), ['--self-test'], process.env)),
    ).toEqual({
      jobProbe: true,
      query: true,
      power: expect.stringMatching(/^(?:ac|battery|unknown)$/),
      scheduler: 'untested',
    })
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
    const job = await launchScript(native, script)
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
    const job = await launchScript(native, script)
    try {
      await job.activate()
      await expect.poll(() => isPresent(marker)).toBe(true)
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
  it('limits the OS job to the admitted process cap and the OS refuses a child beyond it', async () => {
    const native = driver()
    // Admitted cap 2: this script and its held child fill the job, so a third process is
    // refused; once the held child has exited, the same spawn succeeds.
    const script = `const cp=require('node:child_process');const spawnZero=()=>{const run=cp.spawnSync(process.execPath,['-e','0'],{stdio:'ignore'});return run.error?.code??run.status};const held=cp.spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore'});held.on('spawn',()=>{const beyond=spawnZero();held.on('exit',()=>process.stdout.write(JSON.stringify({beyond,after:spawnZero()})));held.kill()})`
    const job = await launchScript(native, script, admitted(2))
    try {
      // Set before activation: the job exists and no child has run yet.
      expect(await pendingJobLimit()).toEqual({
        flags: Number('0x2000') | Number('0x8'),
        activeProcessLimit: 2,
      })
      await job.activate()
      // libuv reports CreateProcess's job-quota refusal as UNKNOWN.
      expect(await job.retirement).toEqual({
        exitCode: 0,
        stdout: JSON.stringify({ beyond: 'UNKNOWN', after: 0 }),
        failure: 'none',
      })
    } finally {
      await job.cancel()
      await job.remove()
    }
  })
  it('bounds the structured channel and ends a flooding job', async () => {
    const native = driver()
    const job = await launchScript(
      native,
      `process.stdout.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes + 1)}))`,
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
        admitted(2),
      ),
    ).rejects.toMatchObject({ reason: 'unsupported-host' })
  })
})
