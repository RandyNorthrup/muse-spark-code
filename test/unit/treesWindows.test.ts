import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { joinStatement, newShellJob, shellJobAssembly } from '../../src/host/backend/shellJob'
import { killTree, windowsPowerShell } from '../../src/host/processTree'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import type { ResourceProcessIdentity, ResourceTicket } from '../../src/shared/resources'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

const ticket: ResourceTicket = {
  id: 'job-tree',
  root: { pid: 810, startTime: '134040000000000000' },
  scope: { type: 'job', name: String.raw`Local\MuseSpark-owned` },
  kind: 'check',
  class: 'foreground',
  sessionId: 'session-1',
}
const deps = {
  systemRoot: String.raw`C:\Windows`,
  assemblyPath: String.raw`C:\Storage\O'Brien\job.dll`,
}

function jobReader(members: () => readonly ResourceProcessIdentity[]) {
  const run = vi.fn((_file: string, args: readonly string[]) =>
    Promise.resolve(
      args.at(-1)?.includes('::Contains(')
        ? 'true'
        : JSON.stringify({ members: members(), usage: { cpuSeconds: 2, residentBytes: 4096 } }),
    ),
  )
  const reader = new WindowsResourceTreeReader({ ...deps, run })
  return { run, reader, registry: new ResourceTreeRegistry(reader) }
}

function pendingJobAnswer(run: ReturnType<typeof jobReader>['run']) {
  const finish = Promise.withResolvers<string>()
  run.mockReturnValueOnce(finish.promise)
  return finish
}

describe('Windows resource job reader', () => {
  it('uses the compiled helper for exact identity, job membership and lifetime CPU / resident memory', async () => {
    const run = vi.fn((_file: string, args: readonly string[], _env?: NodeJS.ProcessEnv) => {
      const body = args.at(-1)!
      if (body.includes('::Identity(')) return Promise.resolve(JSON.stringify(ticket.root))
      if (body.includes('::Contains(')) return Promise.resolve('true\r\n')
      return Promise.resolve(
        JSON.stringify({
          members: [ticket.root, { pid: 811, startTime: '134040000000000001' }],
          usage: { cpuSeconds: 12.5, residentBytes: 8192 },
        }),
      )
    })
    const reader = new WindowsResourceTreeReader({ ...deps, run })
    expect(run).not.toHaveBeenCalled()
    const registry = new ResourceTreeRegistry(reader)
    expect(await reader.identity(810)).toEqual(ticket.root)
    await registry.register(ticket)
    expect(await registry.members(ticket)).toHaveLength(2)
    expect(await registry.usage(ticket)).toEqual({ cpuSeconds: 12.5, residentBytes: 8192 })
    expect(await registry.contains(ticket, ticket.root)).toBe(true)
    for (const [file, args, env] of run.mock.calls) {
      expect(file).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
      expect(args.slice(0, -1)).toEqual(WINDOWS_POWERSHELL_COMMAND_ARGS)
      expect(args.at(-1)).toContain(String.raw`LoadFrom('C:\Storage\O''Brien\job.dll')`)
      expect(args.at(-1)).not.toMatch(/Terminate|Stop-Process|SetInformation|Join\(/)
      expect(env).toEqual({ SystemRoot: String.raw`C:\Windows` })
    }
  })

  it('requeries membership for every action, refuses reused identities and validates every answer', async () => {
    const run = vi.fn((_file: string, _args: readonly string[], _env?: NodeJS.ProcessEnv) =>
      Promise.resolve('true'),
    )
    const reader = new WindowsResourceTreeReader({ ...deps, run })
    expect(await reader.contains(ticket, ticket.root)).toBe(true)
    run.mockResolvedValueOnce('false')
    expect(await reader.contains(ticket, { ...ticket.root, startTime: 'reused' })).toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
    run.mockResolvedValueOnce('"true"')
    expect(await reader.contains(ticket, ticket.root)).toBe(false)
    run.mockResolvedValueOnce('null')
    expect(await reader.usage(ticket)).toBeNull()
    run.mockResolvedValueOnce(
      JSON.stringify({
        members: [ticket.root],
        usage: { cpuSeconds: 0, residentBytes: 0 },
        command: 'canary',
      }),
    )
    expect(await reader.usage(ticket)).toBeNull()
    run.mockResolvedValueOnce(
      JSON.stringify({
        members: [ticket.root, { pid: -1, startTime: 'invalid' }],
        usage: { cpuSeconds: 0, residentBytes: 0 },
      }),
    )
    expect(await reader.members(ticket)).toEqual([])
    run.mockRejectedValueOnce(new Error('access denied'))
    expect(await reader.usage(ticket)).toBeNull()
    run.mockResolvedValueOnce(JSON.stringify({ pid: 999, startTime: 'other' }))
    expect(await reader.identity(810)).toBeNull()
    expect(await reader.identity(-1)).toBeNull()
    run.mockResolvedValueOnce('not-json')
    expect(await reader.identity(810)).toBeNull()
    expect(
      await reader.contains({ ...ticket, scope: { type: 'group', pgid: 810 } }, ticket.root),
    ).toBe(false)
    expect(await reader.usage({ ...ticket, scope: { type: 'group', pgid: 810 } })).toBeNull()
    expect(() => new WindowsResourceTreeReader({ ...deps, assemblyPath: 'job.dll' })).toThrow(
      'absolute',
    )
  })

  it('ships the query API with read-only job rights and exact start/membership through the same handle', async () => {
    const source = await readJobSource('shellJob')
    expect(source).toContain('public static string Query(string name)')
    expect(source).toContain('public static string Identity(uint pid)')
    expect(source).toContain('public static bool Contains(string name, uint pid, string startTime)')
    const queryRegion = source.slice(
      source.indexOf('// M107 T query region.'),
      source.indexOf('// End M107 T query region.'),
    )
    expect(queryRegion).toContain('OpenJobObjectW(JOB_OBJECT_QUERY, false, name)')
    expect(queryRegion).toContain('Creation(process) == expected && Member(process, job)')
    expect(queryRegion).not.toMatch(
      /TerminateJobObject|AssignProcessToJobObject|SetInformationJobObject|SuspendThread/,
    )
  })

  it('retains an observed orphan job but refuses a reused job name or root identity', async () => {
    let members = [ticket.root, { pid: 811, startTime: '134040000000000001' }]
    const { reader } = jobReader(() => members)
    const observed = await reader.members(ticket)
    expect(observed).toEqual(members)
    observed[1]!.startTime = 'forged-copy'
    expect(await reader.contains(ticket, ticket.root)).toBe(true)
    members = [members[1]!]
    expect(await reader.contains(ticket, members[0]!)).toBe(true)
    members = [{ pid: 900, startTime: '134040000000000002' }]
    expect(await reader.members(ticket)).toEqual([])
    expect(await reader.contains(ticket, members[0]!)).toBe(false)
    expect(await reader.usage(ticket)).toBeNull()
    members = [{ ...ticket.root, startTime: '134040000000000003' }]
    expect(await reader.usage(ticket)).toBeNull()
    members = [ticket.root, { pid: 811, startTime: '134040000000000001' }]
    expect(await reader.members(ticket)).toEqual(members)
    reader.forget(ticket)
    members = [{ pid: 811, startTime: '134040000000000001' }]
    expect(await reader.members(ticket)).toEqual([])
  })

  it.each(['query', 'root-proof'] as const)(
    'does not restore Windows witnesses when a pending %s finishes after retirement',
    async (stage) => {
      const answer = JSON.stringify({
        members: [ticket.root],
        usage: { cpuSeconds: 2, residentBytes: 4096 },
      })
      const { run, reader, registry } = jobReader(() => [ticket.root])
      await registry.register(ticket)
      const finish = pendingJobAnswer(run)
      const pending =
        stage === 'query' ? reader.usage(ticket) : reader.contains(ticket, ticket.root)
      registry.unregister(ticket)
      finish.resolve(stage === 'query' ? answer : 'true')
      if (stage === 'query') expect(await pending).toBeNull()
      else expect(await pending).toBe(false)
      expect(registry.tickets()).toEqual([])
      expect(reader).toHaveProperty('known.size', 0)
    },
  )

  it('isolates a new Windows ticket epoch from an old job query', async () => {
    let members = [ticket.root, { pid: 811, startTime: '134040000000000001' }]
    const { run, registry } = jobReader(() => members)
    await registry.register(ticket)
    const finish = pendingJobAnswer(run)
    const pending = registry.usage(ticket)
    registry.unregister(ticket)
    await registry.register(ticket)
    expect(await registry.members(ticket)).toEqual(members)
    finish.resolve(
      JSON.stringify({
        members: [{ ...ticket.root, startTime: 'reused' }],
        usage: { cpuSeconds: 0, residentBytes: 0 },
      }),
    )
    expect(await pending).toBeNull()
    members = [members[1]!]
    expect(await registry.members(ticket)).toEqual(members)
  })

  it.runIf(process.platform === 'win32')(
    'compiles and queries our real job and refuses the harness and a reused start time',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-t-job-'))
      const systemRoot = process.env['SystemRoot']!
      try {
        const assembly = await shellJobAssembly({
          storageDir: folder,
          systemRoot,
          log: () => undefined,
          readJobSource,
        })()
        expect(assembly).toBeDefined()
        const job = newShellJob(assembly!)
        const ps = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
        const child = spawn(
          ps.file,
          [
            ...WINDOWS_POWERSHELL_COMMAND_ARGS,
            `${joinStatement(job)}[Console]::Out.WriteLine('ready'); [Threading.Thread]::Sleep(30000)`,
          ],
          { env: ps.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        )
        const death = once(child, 'exit')
        const startedAt = Date.now()
        try {
          await once(child.stdout, 'data')
          const reader = new WindowsResourceTreeReader({ assemblyPath: assembly!, systemRoot })
          const root = await reader.identity(child.pid!)
          expect(root).not.toBeNull()
          const launch: ResourceTicket = {
            ...ticket,
            root: root!,
            scope: { type: 'job', name: job.name },
          }
          const registry = new ResourceTreeRegistry(reader)
          await registry.register(launch)
          const members = await registry.members(launch)
          expect(members).toContainEqual(root)
          for (const member of members) expect(await registry.contains(launch, member)).toBe(true)
          const usage = await registry.usage(launch)
          expect(usage?.cpuSeconds).toBeGreaterThan(0)
          expect(usage?.residentBytes).toBeGreaterThan(0)
          const own = await reader.identity(process.pid)
          expect(await registry.contains(launch, own!)).toBe(false)
          expect(
            await reader.contains(launch, {
              ...root!,
              startTime: String(BigInt(root!.startTime) + 1n),
            }),
          ).toBe(false)
        } finally {
          await killTree(
            child,
            { platform: 'win32', systemRoot, log: () => undefined },
            startedAt,
            job,
          )
          await death
        }
      } finally {
        await removeFolder(folder)
      }
    },
  )
})
