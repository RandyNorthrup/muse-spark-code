import path from 'node:path'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { mkdtemp, readdir, rm, readFile, access, writeFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { noWorkspaceChildEnvironment, windowsPowerShell } from '../../src/core/execGuard'
import { deviceWorkerNative } from '../../src/host/backend/deviceWorkerNative'
import { compileJob } from '../../src/host/backend/jobBuild'
import { jobFileName, type JobBuild } from '../../src/host/backend/staleJobs'
import { runProgram } from '../../src/host/processTree'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { DEVICE_LIMITS, SHELL_JOB_FOLDER } from '../../src/shared/constants'
import {
  DeviceWorkerHost,
  parseDeviceWorkerQuery,
  type DeviceWorkerAttempt,
  type DeviceWorkerDriver,
  type DeviceWorkerHostDeps,
} from '../../src/host/devices/deviceWorkerHost'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import { launchedJob } from './helpers/deviceWorkerReceiver'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { build } from 'esbuild'
import { deviceWorkerLinux } from '../../src/host/backend/deviceWorkerLinux'
import { workerEnvironment } from '../../src/core/team/refFence'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'

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
const logged: LoggedMessage[] = []
const log = levelLogger(logged)
function admitted(processes: number): DeviceWorkerAttempt {
  return { identity: check.identity, caps: { ...check.caps, processes } }
}
function driver() {
  return deviceWorkerNative({
    storageDir: scratch.directory,
    systemRoot: process.env['SystemRoot'] ?? '',
    sourceFile: path.resolve('native/windows/MuseSparkDeviceWorker.cs'),
    environment: process.env,
    log,
    // The real program runner compiles the worker, as the job suites do;
    // bootstrap admission has its own suite and no window configures it here.
    compile: runProgram,
  })
}
function launchScript(native: DeviceWorkerDriver, script: string, attempt = admitted(2)) {
  return launchedJob(
    native.launch(
      {
        executable: process.execPath,
        args: ['-e', script],
        cwd: scratch.directory,
        requiredTools: [],
      },
      { SystemRoot: process.env['SystemRoot'] ?? '' },
      attempt,
    ),
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
    noWorkspaceChildEnvironment('win32', process.env, realpathSync),
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
    await compileJob(
      probeBuild,
      probe.file,
      jobLimitProbe,
      process.env['SystemRoot'] ?? '',
      runProgram,
    )
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
      JSON.parse(
        await runProgram(
          path.join(folder, helper ?? ''),
          ['--self-test'],
          noWorkspaceChildEnvironment('win32', process.env, realpathSync),
        ),
      ),
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
      log,
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
    // A refused helper is known before any helper call; its directory is removed.
    expect(
      await native.launch(
        { executable: process.execPath, args: [], cwd: scratch.directory, requiredTools: [] },
        {},
        admitted(2),
      ),
    ).toMatchObject({ kind: 'refused', error: { reason: 'unsupported-host' } })
  })
})

const linux = {
  directory: '',
  units: new Set<string>(),
  helpers: new Map<string, ReturnType<typeof spawn>>(),
}
function linuxEnvironment(): Record<string, string> {
  const clean: Record<string, string> = {}
  const entries = Object.entries(workerEnvironment(process.env, 'linux'))
  for (const [key, value] of entries) if (value !== undefined) clean[key] = value
  return clean
}
/** Instrument command names only; every unit, inhibitor and cgroup is native. */
function linuxControlEnvironment() {
  return noWorkspaceChildEnvironment(
    'linux',
    { ...linuxEnvironment(), XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'] },
    realpathSync,
  )
}
function linuxDriver() {
  return deviceWorkerLinux({
    environment: process.env,
    log,
    start: (file, args, env) => {
      const unit = args.find((arg) => arg.startsWith('--unit='))?.slice('--unit='.length)
      if (unit !== undefined) linux.units.add(unit)
      const child = spawn(file, [...args], { env, stdio: 'pipe' })
      if (unit !== undefined) linux.helpers.set(unit, child)
      return child
    },
  })
}
function linuxLaunch(native: DeviceWorkerDriver, script: string, processes = 64) {
  return launchedJob(
    native.launch(
      { executable: '/bin/sh', args: ['-c', script], cwd: linux.directory, requiredTools: [] },
      linuxEnvironment(),
      admitted(processes),
    ),
  )
}
async function disposeLinux(job: Awaited<ReturnType<typeof linuxLaunch>>): Promise<void> {
  try {
    await job.cancel()
    await job.retirement
  } finally {
    await job.remove()
  }
}
describe.skipIf(process.platform !== 'linux' || process.env['XDG_RUNTIME_DIR'] === undefined)(
  'M100/H native Linux worker and inhibitor units',
  () => {
    beforeAll(async () => {
      linux.directory = await mkdtemp(path.join(tmpdir(), 'm100-linux-native-'))
      await build({
        entryPoints: ['src/host/backend/deviceWorkerLinux.ts'],
        outfile: path.join(linux.directory, 'driver.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      })
      const source = String.raw`const {deviceWorkerLinux}=require('./driver.cjs');
const {workerEnvironment}=require('./environment.cjs');
(async()=>{
 const driver=deviceWorkerLinux({environment:process.env,log:{trace:()=>{},info:()=>{},warn:()=>{},error:()=>{}}});
 const launched=await driver.launch({executable:'/bin/sh',args:['-c',process.argv[2]],cwd:process.cwd(),requiredTools:[]},workerEnvironment(process.env,'linux'),${JSON.stringify(admitted(64))});
 if(launched.kind!=='launched')throw launched.error;
 const job=launched.job;
 await job.activate();process.stdout.write(JSON.stringify(job.query)+'\n');
 setInterval(()=>{},100);
})().catch(()=>{process.stderr.write('parent launch failed');process.exit(1)});`
      await build({
        entryPoints: ['src/core/team/refFence.ts'],
        outfile: path.join(linux.directory, 'environment.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
      })
      await writeFile(path.join(linux.directory, 'crash-parent.cjs'), source)
    })
    afterAll(async () => {
      try {
        for (const unit of linux.units) {
          try {
            await runProgram(
              '/usr/bin/systemctl',
              ['--user', 'stop', unit],
              linuxControlEnvironment(),
            )
          } catch {
            /* A collected unit is already removed. */
          }
          const status = await runProgram(
            '/usr/bin/systemctl',
            ['--user', 'show', unit, '--property=LoadState,ActiveState,ControlGroup'],
            linuxControlEnvironment(),
          )
          expect(status).toContain('LoadState=not-found')
          expect(status).toContain('ActiveState=inactive')
          expect(status).toContain('ControlGroup=\n')
        }
      } finally {
        await rm(linux.directory, { recursive: true, force: true })
      }
    })

    it.each([false, true])(
      'SIGKILL of the owning host stops its worker; fresh host cleans leftover=%s',
      async (leaveOrphan) => {
        const marker = path.join(linux.directory, `crash-ready-${String(leaveOrphan)}`)
        const parent = spawn(
          process.execPath,
          [
            path.join(linux.directory, 'crash-parent.cjs'),
            `printf ready > '${marker}'; exec sleep 100`,
          ],
          {
            cwd: linux.directory,
            env: linuxControlEnvironment(),
            stdio: 'pipe',
          },
        )
        const exited = once(parent, 'close')
        const lines = createInterface({ input: parent.stdout })
        let orphan: string | undefined
        try {
          const [line] = await Promise.race([
            once(lines, 'line'),
            (async () => {
              await exited
              throw new Error('parent exited before ready')
            })(),
          ])
          const ready = parseDeviceWorkerQuery(JSON.parse(String(line)))
          const unit = path.posix.basename(ready.context.desktop)
          const inhibitor = unit.replace('.service', '-inhibit.service')
          linux.units.add(unit)
          linux.units.add(inhibitor)
          await expect.poll(() => isPresent(marker)).toBe(true)
          const active = await runProgram(
            '/usr/bin/systemctl',
            ['--user', 'show', unit, '--property=ActiveState,BindsTo,After'],
            linuxControlEnvironment(),
          )
          expect(active).toContain('ActiveState=active')
          // Seed a separate unbound unit from this incarnation, simulating an old/crashed launch.
          if (leaveOrphan) {
            orphan = unit.replace(/-[a-f0-9]{32}\.service$/, () => `-${'d'.repeat(32)}.service`)
            linux.units.add(orphan)
            await runProgram(
              '/usr/bin/systemd-run',
              ['--user', '--quiet', '--collect', `--unit=${orphan}`, '/bin/sleep', '100'],
              linuxControlEnvironment(),
            )
          }
          parent.kill('SIGKILL')
          await exited
          await expect
            .poll(
              async () =>
                await runProgram(
                  '/usr/bin/systemctl',
                  ['--user', 'show', unit, '--property=ActiveState,ControlGroup'],
                  linuxControlEnvironment(),
                ),
            )
            .toContain('ActiveState=inactive')
          await expect
            .poll(
              async () =>
                await runProgram(
                  '/usr/bin/systemctl',
                  ['--user', 'show', inhibitor, '--property=ActiveState'],
                  linuxControlEnvironment(),
                ),
            )
            .toContain('ActiveState=inactive')
          if (orphan !== undefined) {
            expect(
              await runProgram(
                '/usr/bin/systemctl',
                ['--user', 'show', orphan, '--property=ActiveState'],
                linuxControlEnvironment(),
              ),
            ).toContain('ActiveState=active')
            await linuxDriver().query()
          }
          for (const owned of [unit, inhibitor, ...(orphan === undefined ? [] : [orphan])]) {
            await expect
              .poll(
                async () =>
                  await runProgram(
                    '/usr/bin/systemctl',
                    ['--user', 'show', owned, '--property=LoadState,ActiveState,ControlGroup'],
                    linuxControlEnvironment(),
                  ),
              )
              .toContain('LoadState=not-found')
          }
          const remaining = await runProgram(
            '/usr/bin/systemctl',
            [
              '--user',
              'list-units',
              '--all',
              '--no-legend',
              `muse-spark-device-${String(parent.pid ?? 0)}-*.service`,
            ],
            linuxControlEnvironment(),
          )
          expect(remaining.trim()).toBe('')
        } finally {
          lines.close()
          parent.kill('SIGKILL')
          await exited
          // afterAll cleans every named unit, including a deliberately unbound orphan.
        }
      },
    )
    it('runs in the real service cgroup, with closed stdin, canonical environment and stdout JSON despite stderr', async () => {
      const native = linuxDriver()
      const script = `read -r input && exit 1; [ -z "$NODE_OPTIONS$META_API_KEY$SSH_AUTH_SOCK" ] || exit 1; printf warning >&2; printf '${JSON.stringify({ usage })}'`
      const job = await linuxLaunch(native, script)
      try {
        const ready = parseDeviceWorkerQuery(job.query)
        expect(ready.context.desktop).toContain('muse-spark-device-')
        expect(await readFile('/proc/self/cgroup', 'utf8')).not.toContain(ready.context.desktop)
        await job.activate()
        expect(await job.retirement).toEqual({
          exitCode: 0,
          stdout: JSON.stringify({ usage }),
          failure: 'none',
        })
      } finally {
        await disposeLinux(job)
      }
    })
    it('proves real whole-cgroup retirement after a detached descendant outlives the parent', async () => {
      const marker = path.join(linux.directory, 'detached-finished')
      const script = `setsid /bin/sh -c 'sleep 0.2; printf finished > "$1"' child '${marker}' </dev/null >/dev/null 2>&1 & printf parent`
      const native = linuxDriver()
      const job = await linuxLaunch(native, script)
      try {
        await job.activate()
        expect(await job.retirement).toEqual({ exitCode: 0, stdout: 'parent', failure: 'none' })
        expect(await readFile(marker, 'utf8')).toBe('finished')
        expect(await native.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
      } finally {
        await disposeLinux(job)
      }
    })
    it('reads pids.max=2 from the real cgroup and the kernel refuses a third task', async () => {
      const native = linuxDriver()
      const script = 'sleep 0.2 & /bin/true; printf admitted'
      const narrow = await linuxLaunch(native, script, 2)
      try {
        const ready = parseDeviceWorkerQuery(narrow.query)
        const limit = await readFile(
          path.posix.join('/sys/fs/cgroup', ready.context.desktop, 'pids.max'),
          'utf8',
        )
        expect(limit.trim()).toBe('2')
        await narrow.activate()
        expect(await narrow.retirement).toEqual({ exitCode: 2, stdout: '', failure: 'none' })
      } finally {
        await disposeLinux(narrow)
      }
      const wide = await linuxLaunch(native, script, 3)
      try {
        await wide.activate()
        expect(await wide.retirement).toEqual({ exitCode: 0, stdout: 'admitted', failure: 'none' })
      } finally {
        await disposeLinux(wide)
      }
    })
    it('a real whole-unit stop cancels a detached descendant and releases its native inhibitor', async () => {
      const native = linuxDriver()
      const marker = path.join(linux.directory, 'running')
      const job = await linuxLaunch(
        native,
        `setsid sleep 100 </dev/null >/dev/null 2>&1 & printf ready > '${marker}'; wait`,
      )
      try {
        await job.activate()
        await expect.poll(() => isPresent(marker)).toBe(true)
        expect(await native.query()).toMatchObject({ sleepInhibited: true })
        await job.cancel()
        await job.retirement
        expect(await native.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
      } finally {
        await disposeLinux(job)
      }
    })
    it('qualifies the real per-factory probe and proves logind inhibition held/released', async () => {
      const native = linuxDriver()
      expect(await native.selfTest()).toBe(true)
      const job = await linuxLaunch(native, 'read -r x; sleep 0.2')
      const ready = parseDeviceWorkerQuery(job.query)
      const unit = path.posix.basename(ready.context.desktop)
      try {
        const held = await runProgram(
          '/usr/bin/systemd-inhibit',
          ['--list', '--no-pager', '--no-legend'],
          linuxControlEnvironment(),
        )
        expect(held).toContain(unit)
        expect(held).toContain('sleep:idle')
        await job.activate()
        await job.retirement
        const released = await runProgram(
          '/usr/bin/systemd-inhibit',
          ['--list', '--no-pager', '--no-legend'],
          linuxControlEnvironment(),
        )
        expect(released).not.toContain(unit)
      } finally {
        await disposeLinux(job)
      }
    })
    it('injected missing manager refuses cleanly and never creates a real unit', async () => {
      const native = deviceWorkerLinux({ environment: {}, log })
      expect(await native.selfTest()).toBe(false)
      await expect(linuxLaunch(native, 'printf forbidden')).rejects.toMatchObject({
        launch: 'refused',
        reason: 'unsupported-host',
      })
    })
    it('holds overlapping real inhibitors until each entire unit retires', async () => {
      const native = linuxDriver()
      const first = await linuxLaunch(native, 'printf first')
      const second = await linuxLaunch(native, 'printf second')
      const secondUnit = path.posix.basename(parseDeviceWorkerQuery(second.query).context.desktop)
      try {
        await first.activate()
        await first.retirement
        expect(await native.query()).toMatchObject({ sleepInhibited: true, activeProcesses: 1 })
        const held = await runProgram(
          '/usr/bin/systemd-inhibit',
          ['--list', '--no-pager', '--no-legend'],
          linuxControlEnvironment(),
        )
        expect(held).toContain(secondUnit)
        await second.activate()
        await second.retirement
        expect(await native.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
      } finally {
        await disposeLinux(first)
        await disposeLinux(second)
      }
    })
    it.each(['worker', 'inhibitor'])(
      '%s launcher loss releases the real inhibitor, stops the tree and never claims retirement',
      async (owner) => {
        const native = linuxDriver()
        const job = await linuxLaunch(native, 'sleep 100')
        const unit = path.posix.basename(parseDeviceWorkerQuery(job.query).context.desktop)
        const failure = expect(job.retirement).rejects.toMatchObject({ reason: 'uncertain' })
        try {
          await job.activate()
          const helperUnit =
            owner === 'worker' ? unit : unit.replace(/\.service$/, '-inhibit.service')
          expect(linux.helpers.get(helperUnit)?.kill('SIGKILL')).toBe(true)
          await failure
          await job.cancel()
          expect(await native.query()).toMatchObject({ sleepInhibited: false, activeProcesses: 0 })
          const released = await runProgram(
            '/usr/bin/systemd-inhibit',
            ['--list', '--no-pager', '--no-legend'],
            linuxControlEnvironment(),
          )
          expect(released).not.toContain(unit)
          expect(() => job.remove()).toThrow()
        } finally {
          await job.cancel()
        }
      },
    )
    it('bounds real stdout and stops the entire flooding unit', async () => {
      const native = linuxDriver()
      const job = await launchedJob(
        native.launch(
          {
            executable: process.execPath,
            args: [
              '-e',
              `process.stdout.write('x'.repeat(${String(DEVICE_LIMITS.frameBytes + 1)}))`,
            ],
            cwd: linux.directory,
            requiredTools: [],
          },
          linuxEnvironment(),
          admitted(64),
        ),
      )
      try {
        await job.activate()
        expect(await job.retirement).toMatchObject({ failure: 'capacity' })
      } finally {
        await disposeLinux(job)
      }
    })
    it('reports one real multithreaded process rather than its kernel task count', async () => {
      const native = linuxDriver()
      const marker = path.join(linux.directory, 'threaded-ready')
      const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},100)`
      const job = await launchedJob(
        native.launch(
          {
            executable: process.execPath,
            args: ['-e', script],
            cwd: linux.directory,
            requiredTools: [],
          },
          linuxEnvironment(),
          admitted(64),
        ),
      )
      try {
        await job.activate()
        await expect.poll(() => isPresent(marker)).toBe(true)
        const ready = parseDeviceWorkerQuery(job.query)
        const tasks = await readFile(
          path.posix.join('/sys/fs/cgroup', ready.context.desktop, 'pids.current'),
          'utf8',
        )
        expect(Number(tasks.trim())).toBeGreaterThan(1)
        expect(await native.query()).toMatchObject({ activeProcesses: 1 })
      } finally {
        await disposeLinux(job)
      }
    })
  },
)
