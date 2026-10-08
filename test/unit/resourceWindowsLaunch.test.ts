import { once } from 'node:events'
import { spawn } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnMcpJob } from '../../src/host/backend/mcpJobLaunch'
import { joinStatement, newShellJob, shellJobAssembly } from '../../src/host/backend/shellJob'
import { loadJobAssembly, runProgram, windowsPowerShell } from '../../src/host/processTree'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { SHELL_JOB_TYPE_NAME, WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import type { ResourceProcessLaunch } from '../../src/core/resources/launch'
import { fixtureJobLifecycle } from './helpers/mcpFixtures'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'
import { holdResourceJob } from '../../src/host/resources/resourceJobHolder'
import { resourceGovernorHost } from '../../src/core/resources/resourceGovernorEntry'
import { spawnResourceMuseConnection } from '../../src/host/resources/museResourceLaunch'
import { ResourceLaunchHost } from '../../src/core/resources/launchHost'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceEvents } from '../../src/core/resources/events'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { FakeResourceClock, ScriptedResourceSampler } from './helpers/resources/fakes'
import type { ResourceLease } from '../../src/core/resources/launch'
import type { ResourceProcessIdentity } from '../../src/shared/resources'
import * as resourceAdmission from '../../src/core/resources/admission'
import { runResourceCommand } from '../../src/host/backend/toolIo'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { fakeInitializeResult } from './helpers/fakeMsp'
import * as sdk from '@muse-code/sdk'
import { nativeCreated, useCreatedNative } from './helpers/createdNative'

useCreatedNative()

vi.mock('node:child_process', { spy: true })
vi.mock('@muse-code/sdk', { spy: true })

const job = fixtureJobLifecycle()
beforeAll(job.setup, 60_000)
afterAll(job.dispose)

async function stopOrphan(
  reader: WindowsResourceTreeReader,
  orphan: ResourceProcessIdentity | null,
): Promise<void> {
  if (orphan === null) return
  const current = await reader.identity(orphan.pid)
  if (current?.startTime !== orphan.startTime) return
  try {
    process.kill(orphan.pid)
  } catch (error: unknown) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'))
      throw error
  }
}

describe('C1 native Windows launch boundary', () => {
  it.runIf(process.platform === 'win32')(
    'registers a short CLI in a native job, preserves its arguments and cancels its whole tree',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-short-cli-'))
      const systemRoot = process.env['SystemRoot']!
      const assembly = await shellJobAssembly({
        storageDir: folder,
        systemRoot,
        readJobSource,
        log: () => undefined,
      })()
      if (assembly === undefined || job.path === undefined)
        throw new Error('Native launch unavailable')
      const reader = new WindowsResourceTreeReader({ assemblyPath: assembly, systemRoot })
      let registered: ResourceProcessLaunch | undefined
      let stopRegistered: (() => Promise<boolean>) | undefined
      const lease: ResourceLease = {
        kill: async () => (await stopRegistered?.()) ?? false,
        register: (launch) => {
          registered = launch
        },
        complete: vi.fn(),
        background: vi.fn(),
      }
      const admission = vi.spyOn(resourceAdmission, 'admitResource').mockResolvedValue(lease)
      const helper = vi
        .spyOn(resourceAdmission, 'resourceWindowsJob')
        .mockResolvedValue({ assemblyPath: assembly, executablePath: job.path })
      const marker = path.join(folder, 'pid')
      const script = path.join(folder, 'short.cjs')
      await writeFile(
        script,
        `require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.stdout.write(JSON.stringify(process.argv.slice(2)));setInterval(()=>{},1000)`,
      )
      const stop = new AbortController()
      const args = ['sp ace', "O'Brien", 'embedded"quote', '& | ;']
      const pending = runResourceCommand(
        { command: process.execPath, args: [script, ...args] },
        30_000,
        folder,
        { SystemRoot: systemRoot },
        stop.signal,
      )
      try {
        await vi.waitFor(
          async () => {
            expect(Number(await readFile(marker, 'utf8'))).toBeGreaterThan(0)
          },
          { timeout: 5000 },
        )
        const name = registered?.job?.name
        if (name === undefined) throw new Error('Short CLI not registered')
        const root = await reader.rootOfJob(name)
        if (root === null) throw new Error('Short CLI membership unknown')
        const registry = new ResourceTreeRegistry(reader)
        const ticket = {
          id: 'short-cli',
          root,
          scope: { type: 'job', name } as const,
          kind: 'other' as const,
          class: 'foreground' as const,
          sessionId: null,
        }
        await registry.register(ticket)
        stopRegistered = async () => {
          const result = await registry.kill(ticket)
          return result.status === 'done'
        }
        expect(await registry.contains(ticket, root)).toBe(true)
        expect(
          await registry.signal(
            ticket,
            { ...root, startTime: String(BigInt(root.startTime) + 1n) },
            'SIGKILL',
          ),
        ).toBe('refused')
        expect(await registry.contains(ticket, root)).toBe(true)
        let foreignLaunch: ResourceProcessLaunch | undefined
        const foreign = spawnMcpJob({
          executablePath: job.path,
          file: process.execPath,
          args: ['-e', 'setInterval(()=>{},1000)'],
          cwd: folder,
          env: { SystemRoot: systemRoot },
          isVerbatim: false,
          resourceAssembly: assembly,
          log: () => undefined,
          resource: {
            ...lease,
            register: (launch) => {
              foreignLaunch = launch
            },
          },
        })
        foreign.stdout.resume()
        foreign.stderr.resume()
        try {
          const foreignName = foreignLaunch?.job?.name
          if (foreignName === undefined) throw new Error('Foreign fixture job not registered')
          const foreignRoot = await vi.waitFor(
            async () => {
              const root = await reader.rootOfJob(foreignName)
              if (root === null) throw new Error('Foreign fixture identity unknown')
              return root
            },
            { timeout: 5000 },
          )
          expect(await registry.signal(ticket, foreignRoot, 'SIGKILL')).toBe('refused')
          expect(await registry.contains(ticket, root)).toBe(true)
        } finally {
          const exited = once(foreign, 'exit')
          foreign.kill()
          await exited
        }
        stop.abort()
        const result = await pending
        expect(result).toMatchObject({ exitCode: -1, stdout: JSON.stringify(args) })
        expect(await reader.jobGone(name)).toBe(true)
        expect(lease.complete).toHaveBeenCalledWith(false)
        registry.unregister(ticket)
      } finally {
        stop.abort()
        await pending
        await stopRegistered?.()
        admission.mockRestore()
        helper.mockRestore()
        await removeFolder(folder)
      }
    },
  )
  it
    .runIf(process.platform === 'win32')
    .each(['handshake', 'child', 'initialized', 'unknown'] as const)(
    'bounds %s close of the registered SDK job including an EOF-ignoring CLI',
    async (surface) => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-sdk-close-'))
      const systemRoot = process.env['SystemRoot']!
      const assembly = await shellJobAssembly({
        storageDir: folder,
        systemRoot,
        readJobSource,
        log: () => undefined,
      })()
      if (assembly === undefined) throw new Error('Native job unavailable')
      const reader = new WindowsResourceTreeReader({ assemblyPath: assembly, systemRoot })
      const refuseKill =
        surface === 'unknown' ? vi.spyOn(reader, 'signal').mockResolvedValue('refused') : undefined
      if (job.path === undefined) throw new Error('Native SDK launcher unavailable')
      const helper = vi
        .spyOn(resourceAdmission, 'resourceWindowsJob')
        .mockResolvedValue({ assemblyPath: assembly, executablePath: job.path })
      const { spawnMspConnection: originalSpawn } =
        await vi.importActual<typeof sdk>('@muse-code/sdk')
      const stalledSDK =
        surface === 'unknown'
          ? vi.spyOn(sdk, 'spawnMspConnection').mockImplementation((options) => {
              const handshake = originalSpawn(options)
              handshake.close = () => new Promise(() => undefined)
              return handshake
            })
          : undefined
      const clock = new FakeResourceClock()
      const events = new ResourceEvents(vi.fn())
      const settings = resourceSettingsSchema.parse({ enabled: false })
      const governor = new ResourceGovernor({
        clock,
        events,
        settings,
        sampler: new ScriptedResourceSampler([]),
        hasRelocationTarget: () => false,
        onError: vi.fn(),
      })
      let jobName: string | undefined
      const host = new ResourceLaunchHost({
        clock,
        events,
        governor,
        settings: () => settings,
        onError: vi.fn(),
        bindTree: async (launch) => {
          if (launch.job === undefined) return null
          const job = launch.job
          jobName = job.name
          return {
            reader,
            root: await reader.rootOfJob(job.name),
            scope: { type: 'job', name: job.name },
            gone: async () => await reader.jobGone(job.name),
          }
        },
      })
      const identityFile = path.join(folder, 'cli-pid')
      const script = path.join(folder, 'cli.cjs')
      await writeFile(
        script,
        String.raw`require('fs').writeFileSync(${JSON.stringify(identityFile)},String(process.pid));require('readline').createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:${JSON.stringify(fakeInitializeResult)}})+'\n')});setInterval(()=>{},1000)`,
      )
      let cli: ResourceProcessIdentity | null = null
      const handshake = await spawnResourceMuseConnection(
        {
          command: process.execPath,
          args: [script],
          env: { SystemRoot: systemRoot },
          shutdownTimeoutMs: 100,
        },
        await host.admit('museServe'),
        () => Promise.resolve(assembly),
        systemRoot,
        () => Promise.resolve(),
      )
      try {
        let pid = 0
        await vi.waitFor(
          async () => {
            pid = Number(await readFile(identityFile, 'utf8'))
            expect(pid).toBeGreaterThan(0)
          },
          { timeout: 5000 },
        )
        cli = await reader.identity(pid)
        await host.refreshTrees()
        expect(host.tickets()).toHaveLength(1)
        const initialized =
          surface === 'initialized'
            ? await handshake.initialize({ clientInfo: { name: 'm107_fixture', version: 'test' } })
            : undefined
        let isSettled = false
        const close = (async () => {
          let outcome: unknown
          try {
            await (initialized?.close() ??
              (surface === 'child' ? handshake.child.close() : handshake.close()))
          } catch (error: unknown) {
            outcome = error
          } finally {
            isSettled = true
          }
          return outcome
        })()
        await vi.waitFor(
          () => {
            expect(isSettled).toBe(true)
          },
          { timeout: surface === 'unknown' ? 15_000 : 8000 },
        )
        expect(await close).toEqual(
          expect.objectContaining({
            message:
              surface === 'unknown'
                ? 'Muse Code shutdown did not prove process exit within its bound'
                : 'Muse Code shutdown force-stopped its registered tree',
          }),
        )
        if (surface === 'unknown') {
          expect(await reader.identity(pid)).toEqual(cli)
          expect(host.tickets()).toHaveLength(1)
        } else {
          expect(await reader.identity(pid)).toBeNull()
          await vi.waitFor(
            async () => {
              await host.refreshTrees()
              expect(host.tickets()).toHaveLength(0)
            },
            { timeout: 5000 },
          )
        }
      } finally {
        if (jobName !== undefined) {
          const ps = windowsPowerShell(systemRoot)
          await runProgram(
            ps.file,
            [
              ...WINDOWS_POWERSHELL_COMMAND_ARGS,
              `${loadJobAssembly(assembly)}; [void][${SHELL_JOB_TYPE_NAME}]::Terminate(${powerShellQuoted(jobName)}, 1)`,
            ],
            ps.env,
          )
        }
        await stopOrphan(reader, cli)
        try {
          await handshake.close()
        } catch {
          // Forced or unproved shutdown is the outcome under test.
        }
        host.dispose()
        refuseKill?.mockRestore()
        helper.mockRestore()
        stalledSDK?.mockRestore()
        await removeFolder(folder)
      }
    },
  )
  it.runIf(process.platform === 'win32')(
    'runs no payload when governed Windows membership fails',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-c1-membership-'))
      const systemRoot = process.env['SystemRoot']!
      const ps = windowsPowerShell(systemRoot)
      const root = spawn(
        ps.file,
        [
          ...WINDOWS_POWERSHELL_COMMAND_ARGS,
          `${joinStatement({ name: String.raw`Local\M107C1-invalid`, assemblyPath: path.join(folder, 'absent.dll') }, true)}[Console]::Out.Write('payload-ran')`,
        ],
        { env: ps.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let output = ''
      root.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
      })
      root.stderr.resume()
      try {
        const exit = await once(root, 'exit')
        expect(exit[0]).toBe(1)
        expect(output).toBe('')
      } finally {
        root.kill()
        await removeFolder(folder)
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'keeps a failed holder unknown even when its job name vanishes',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-c1-holder-fault-'))
      const systemRoot = process.env['SystemRoot']!
      const assembly = await shellJobAssembly({
        storageDir: folder,
        systemRoot,
        readJobSource,
        log: () => undefined,
      })()
      const host = resourceGovernorHost({
        inspect: (key) => (key === 'resourceGovernor' ? { globalValue: false } : undefined),
        onError: vi.fn(),
        registryFile: path.join(folder, 'registry.json'),
        createdDirectories: nativeCreated,
      })
      const native = vi.spyOn(childProcess, 'spawn')
      native.mockClear()
      const owned = newShellJob(assembly!)
      const held = await holdResourceJob(await host.admit('toolShell'), owned, systemRoot)
      const result = native.mock.results[0]
      if (result?.type !== 'return') throw new Error('Holder was not spawned')
      const holder = result.value
      const ps = windowsPowerShell(systemRoot)
      const root = spawn(
        ps.file,
        [
          ...WINDOWS_POWERSHELL_COMMAND_ARGS,
          `${joinStatement(owned)}[Console]::Out.WriteLine('joined'); [void][Console]::In.ReadLine()`,
        ],
        { env: ps.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      const death = once(root, 'exit')
      try {
        await once(root.stdout, 'data')
        held.register({ pid: root.pid, job: owned })
        await host.refreshTrees()
        expect(host.tickets()).toHaveLength(1)
        const holderDeath = once(holder, 'exit')
        holder.kill()
        await holderDeath
        root.stdin.end('end\n')
        await death
        held.complete(false)
        await host.refreshTrees()
        await host.refreshTrees()
        expect(host.tickets()).toHaveLength(1)
      } finally {
        host.dispose()
        if (root.exitCode === null && root.signalCode === null) {
          root.kill()
          await death
        }
        holder.kill()
        native.mockRestore()
        await removeFolder(folder)
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'refuses an already existing job name rather than adopting it',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-c1-holder-collision-'))
      const systemRoot = process.env['SystemRoot']!
      const assembly = await shellJobAssembly({
        storageDir: folder,
        systemRoot,
        readJobSource,
        log: () => undefined,
      })()
      const owned = newShellJob(assembly!)
      const lease = { register: vi.fn(), complete: vi.fn(), background: vi.fn() }
      const first = await holdResourceJob(lease, owned, systemRoot)
      let duplicate: ResourceLease | undefined
      let failure: unknown
      try {
        try {
          duplicate = await holdResourceJob(lease, owned, systemRoot)
        } catch (error: unknown) {
          failure = error
        }
        expect(failure).toBeInstanceOf(Error)
      } finally {
        first.complete(true)
        duplicate?.complete(true)
        await removeFolder(folder)
      }
    },
  )
  it.runIf(process.platform === 'win32')(
    'keeps an orphan job occupied after its original root exits',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-c1-orphan-'))
      const systemRoot = process.env['SystemRoot']!
      const assembly = await shellJobAssembly({
        storageDir: folder,
        systemRoot,
        readJobSource,
        log: () => undefined,
      })()
      expect(assembly).toBeDefined()
      const owned = newShellJob(assembly!)
      let registered: ResourceProcessLaunch | undefined
      const held = await holdResourceJob(
        {
          register: (launch) => {
            registered = launch
          },
          complete: () => undefined,
          background: () => undefined,
        },
        owned,
        systemRoot,
      )
      const ps = windowsPowerShell(systemRoot)
      const reader = new WindowsResourceTreeReader({ assemblyPath: assembly!, systemRoot })
      let orphan: ResourceProcessIdentity | null = null
      try {
        const root = spawn(
          ps.file,
          [
            ...WINDOWS_POWERSHELL_COMMAND_ARGS,
            `${joinStatement(owned)}$s = [Diagnostics.ProcessStartInfo]::new(); $s.FileName = ${powerShellQuoted(process.execPath)}; $s.Arguments = '-e "setTimeout(()=>{},30000)"'; $s.UseShellExecute = $false; $s.CreateNoWindow = $true; [Console]::Out.WriteLine(([Diagnostics.Process]::Start($s)).Id)`,
          ],
          { env: ps.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        )
        const death = once(root, 'exit')
        held.register({ pid: root.pid, job: owned })
        const rootOutput = await once(root.stdout, 'data')
        const output: unknown = rootOutput[0]
        if (!(output instanceof Buffer)) throw new Error('No fixture child identity')
        orphan = await reader.identity(Number(output.toString('utf8').trim()))
        const rootExit = await death
        expect(rootExit[0]).toBe(0)
        held.complete(false)
        expect(registered?.job?.isRetired?.()).toBe(false)
        expect(await reader.rootOfJob(owned.name)).not.toBeNull()
        expect(await reader.jobGone(owned.name)).toBe(false)
      } finally {
        await runProgram(
          ps.file,
          [
            ...WINDOWS_POWERSHELL_COMMAND_ARGS,
            `${loadJobAssembly(assembly!)}; [void][${SHELL_JOB_TYPE_NAME}]::Terminate(${powerShellQuoted(owned.name)}, 1)`,
          ],
          ps.env,
        )
        await stopOrphan(reader, orphan)
        held.complete(false)
        await vi.waitFor(
          () => {
            expect(registered?.job?.isRetired?.()).toBe(true)
          },
          { timeout: 5000 },
        )
        await removeFolder(folder)
      }
    },
  )
  it.runIf(process.platform === 'win32')(
    'preserves both CDP pipes and registers the suspended-before-resume job',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-c1-pipes-'))
      const systemRoot = process.env['SystemRoot']!
      const assembly = await shellJobAssembly({
        storageDir: folder,
        systemRoot,
        readJobSource,
        log: () => undefined,
      })()
      expect(assembly).toBeDefined()
      let registered: ResourceProcessLaunch | undefined
      const child = spawnMcpJob({
        executablePath: job.path!,
        file: process.execPath,
        args: [
          '-e',
          "const fs=require('fs');const b=Buffer.alloc(4);fs.readSync(3,b,0,4,null);fs.writeSync(4,b);setInterval(()=>{},1000)",
        ],
        cwd: folder,
        env: { SystemRoot: systemRoot },
        isVerbatim: false,
        debugPipes: true,
        resourceAssembly: assembly,
        resource: {
          register: (launch) => {
            registered = launch
          },
          complete: () => undefined,
          background: () => undefined,
        },
        log: () => undefined,
      })
      const death = once(child, 'exit')
      try {
        const writer = child.stdio[3]
        const reader = child.stdio[4]
        if (!(writer instanceof Duplex) || !(reader instanceof Duplex))
          throw new Error('Missing native pipes')
        const reply = once(reader, 'data')
        writer.write(Buffer.from([0, 1, 2, 255]))
        const ended = async () => {
          await death
          throw new Error('Native child exited before replying')
        }
        const response = await Promise.race([reply, ended()])
        expect(response[0]).toEqual(Buffer.from([0, 1, 2, 255]))
        expect(registered?.job).toBeDefined()
        const registryReader = new WindowsResourceTreeReader({
          assemblyPath: assembly!,
          systemRoot,
        })
        const root = await registryReader.rootOfJob(registered!.job!.name)
        expect(root).not.toBeNull()
        expect(root?.pid).not.toBe(child.pid)
        expect(await registryReader.jobGone(registered!.job!.name)).toBe(false)
        child.kill()
        await death
        expect(await registryReader.jobGone(registered!.job!.name)).toBe(true)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill()
          await death
        }
        await removeFolder(folder)
      }
    },
  )
})
