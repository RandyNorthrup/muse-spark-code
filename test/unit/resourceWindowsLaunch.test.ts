import { once } from 'node:events'
import { spawn } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnMcpJob } from '../../src/host/backend/mcpJobLaunch'
import { joinStatement, newShellJob, shellJobAssembly } from '../../src/host/backend/shellJob'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { SHELL_JOB_TYPE_NAME, WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import type { ResourceProcessLaunch } from '../../src/core/resources/launch'
import { fixtureJobLifecycle } from './helpers/mcpFixtures'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'
import { holdResourceJob } from '../../src/host/resources/resourceJobHolder'
import { resourceGovernorHost } from '../../src/core/resources/resourceGovernorEntry'
import type { ResourceLease } from '../../src/core/resources/launch'
import type { ResourceProcessIdentity } from '../../src/shared/resources'

vi.mock('node:child_process', { spy: true })

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
            `${joinStatement(owned)}$s = New-Object Diagnostics.ProcessStartInfo; $s.FileName = ${powerShellQuoted(process.execPath)}; $s.Arguments = '-e "setTimeout(()=>{},30000)"'; $s.UseShellExecute = $false; $s.CreateNoWindow = $true; [Console]::Out.WriteLine(([Diagnostics.Process]::Start($s)).Id)`,
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
            `Add-Type -Path ${powerShellQuoted(assembly!)}; [void][${SHELL_JOB_TYPE_NAME}]::Terminate(${powerShellQuoted(owned.name)}, 1)`,
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
