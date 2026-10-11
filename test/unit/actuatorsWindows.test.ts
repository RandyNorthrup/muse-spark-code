import { describe, expect, it, vi } from 'vitest'
import { ResourceActuators } from '../../src/core/resources/actuators'
import {
  WindowsResourceActuator,
  type WindowsPriorityBaselinePort,
} from '../../src/core/resources/actuators/windows'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import { shellJobAssembly, newShellJob, joinStatement } from '../../src/host/backend/shellJob'
import { powerShellQuoted } from '../../src/core/shellQuote'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../src/shared/constants'
import type { ResourceTicket } from '../../src/shared/resources'
import { FakeResourceTree } from './helpers/resources/fakes'
import { readJobSource } from './helpers/jobSource'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { removeFolder } from './helpers/temporaryFolders'

// The real job helper compiles under the bootstrap runner; only its admission is a fixture.
vi.mock('../../src/core/resources/admission', async (original) => {
  const { withFixtureBootstrap } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureBootstrap(await original())
})

const ticket: ResourceTicket = {
  id: 'windows',
  root: { pid: 810, startTime: '134040000000000000' },
  scope: { type: 'job', name: String.raw`Local\MuseSpark-owned` },
  kind: 'check',
  class: 'background',
  sessionId: null,
}
const paths = {
  assemblyPath: String.raw`C:\Owned\O'Brien\job.dll`,
  systemRoot: String.raw`C:\Windows`,
}
function fixture(
  priority: 'none' | 'normal' | 'belowNormal' | 'idle' = 'none',
  rateInput?: { flags: number; rate: number },
  baselines?: WindowsPriorityBaselinePort,
) {
  const rate = rateInput ?? { flags: 0, rate: 0 }
  const tree = new FakeResourceTree()
  tree.register(ticket)
  tree.put(ticket.id, ticket.root, { cpuSeconds: 1, residentBytes: 100 })
  const original = {
    priority,
    processes: [{ ...ticket.root, priority: priority === 'none' ? 'normal' : priority }],
  }
  const run = vi.fn((_file: string, args: readonly string[], _env?: NodeJS.ProcessEnv) => {
    const script = args.at(-1) ?? ''
    if (script.includes('::ReadResourcePriority(')) return Promise.resolve(JSON.stringify(original))
    if (script.includes('::SetResourcePriority(')) return Promise.resolve('true')
    if (script.includes('::ReadResourceRate(')) return Promise.resolve(JSON.stringify(rate))
    const match = /::SetResourceRate\([^)]*, (\d+), (\d+)\)/.exec(script)
    if (match === null) throw new Error('Unrecognized helper call')
    return Promise.resolve(JSON.stringify({ flags: Number(match[1]), rate: Number(match[2]) }))
  })
  const port = new WindowsResourceActuator({
    ...paths,
    run,
    ...(baselines !== undefined && { baselines }),
  })
  return { tree, run, port, actuators: new ResourceActuators(tree, port) }
}

function priorityRestores(run: ReturnType<typeof fixture>['run']): string[] {
  return run.mock.calls
    .map((call) => call[1].at(-1) ?? '')
    .filter((script) => script.includes('::SetResourcePriority(') && script.includes('$true'))
}

// These cases compile and drive the real Windows job helper (C#) and real
// child processes. Hosted Windows runners passed 15 s in PR #140 while the
// Win11 rig took a few seconds, so the suite has a named deadline.
// PLAN.md §8 (2026-10-07).
const REAL_WINDOWS_JOB_TIMEOUT_MS = 60_000

describe(
  'Windows identity-bound resource controls',
  { timeout: REAL_WINDOWS_JOB_TIMEOUT_MS },
  () => {
    it('lowers job priority and rate, reads back, then restores the exact originals', async () => {
      const f = fixture()
      expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
        { control: 'jobPriority', status: 'applied' },
        { control: 'jobCpuRate', status: 'applied' },
      ])
      await f.actuators.setLevel(ticket, 'pause')
      expect(await f.actuators.retire(ticket)).toHaveProperty('retired', true)
      const scripts = f.run.mock.calls.map((call) => call[1].at(-1) ?? '')
      expect(scripts.some((script) => script.includes("'belowNormal'"))).toBe(true)
      expect(scripts.some((script) => script.includes("'idle'"))).toBe(true)
      expect(scripts.some((script) => script.includes(', 5, 5000)'))).toBe(true)
      expect(scripts.at(-1)).toContain(', 0, 0)')
      expect(
        scripts.some((script) => script.includes("'none', '810/134040000000000000/normal', $true")),
      ).toBe(true)
      for (const [file, args, env] of f.run.mock.calls) {
        expect(file).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
        expect(args.at(-1)).toContain("O''Brien")
        expect(args.at(-1)).toContain("810, '134040000000000000'")
        expect(env).toEqual({ SystemRoot: String.raw`C:\Windows` })
      }
    })
    it('never widens an already-idle priority or stricter CPU cap', async () => {
      const f = fixture('idle', { flags: 13, rate: 2000 })
      expect(await f.actuators.setLevel(ticket, 'throttle')).toEqual([
        { control: 'jobPriority', status: 'unchanged' },
        { control: 'jobCpuRate', status: 'unchanged' },
      ])
      expect(f.run.mock.calls.every((call) => !call[1].at(-1)?.includes('::SetResource'))).toBe(
        true,
      )
    })
    it('retains notification flags while narrowing and restoring a CPU cap', async () => {
      const f = fixture('belowNormal', { flags: 13, rate: 8000 })
      await f.actuators.setLevel(ticket, 'throttle')
      await f.actuators.retire(ticket)
      expect(f.run.mock.calls.map((call) => call[1].at(-1)).join('\n')).toContain(', 13, 5000)')
      expect(f.run.mock.calls.at(-1)?.[1].at(-1)).toContain(', 13, 8000)')
    })
    it('refuses unsupported rate modes and malformed or failed OS responses', async () => {
      const f = fixture('none', { flags: 3, rate: 2000 })
      expect(await f.actuators.setLevel(ticket, 'throttle')).toContainEqual({
        control: 'jobCpuRate',
        status: 'unknown',
      })
      expect(f.run.mock.calls.every((call) => !call[1].at(-1)?.includes('::SetResourceRate'))).toBe(
        true,
      )
      for (const response of [
        'null',
        '"true"',
        '{"priority":"high","processes":[]}',
        '{"priority":"none","processes":[],"path":"private-canary"}',
        'not JSON',
      ]) {
        const broken = fixture()
        broken.run.mockResolvedValueOnce(response)
        expect(await broken.actuators.setLevel(ticket, 'pause')).toContainEqual({
          control: 'jobPriority',
          status: 'unknown',
        })
      }
      const denied = fixture()
      denied.run.mockRejectedValueOnce(new Error('denied'))
      expect(await denied.actuators.setLevel(ticket, 'pause')).toContainEqual({
        control: 'jobPriority',
        status: 'unknown',
      })
    })
    it('honors a disabled CPU cap and rejects non-job scopes and relative executable paths', async () => {
      const f = fixture()
      const port = new WindowsResourceActuator({ ...paths, run: f.run, cpuRateCap: false })
      expect(await port.controls(ticket)).toHaveLength(1)
      await expect(
        port.controls({ ...ticket, scope: { type: 'group', pgid: 810 } }),
      ).rejects.toThrow('job')
      expect(() => new WindowsResourceActuator({ ...paths, assemblyPath: 'relative.dll' })).toThrow(
        'absolute',
      )
      expect(() => new WindowsResourceActuator({ ...paths, systemRoot: 'Windows' })).toThrow(
        'absolute',
      )
    })
    it('treats native membership refusal during mutation as unknown', async () => {
      const f = fixture()
      f.run
        .mockResolvedValueOnce(
          JSON.stringify({ priority: 'none', processes: [{ ...ticket.root, priority: 'normal' }] }),
        )
        .mockResolvedValueOnce('false')
      expect(await f.actuators.setLevel(ticket, 'pause')).toContainEqual({
        control: 'jobPriority',
        status: 'unknown',
      })
    })
    it('rejects unexpected rate fields and a mismatched rate readback', async () => {
      for (const answer of [
        { flags: 0, rate: 0, path: 'private-canary' },
        { flags: 5, rate: 6000 },
      ]) {
        const f = fixture()
        const before = JSON.stringify({
          priority: 'none',
          processes: [{ ...ticket.root, priority: 'normal' }],
        })
        f.run.mockResolvedValueOnce(before).mockResolvedValueOnce('true')
        if ('path' in answer) f.run.mockResolvedValueOnce(JSON.stringify(answer))
        else
          f.run
            .mockResolvedValueOnce(JSON.stringify({ flags: 0, rate: 0 }))
            .mockResolvedValueOnce(JSON.stringify(answer))
        expect(await f.actuators.setLevel(ticket, 'throttle')).toContainEqual({
          control: 'jobCpuRate',
          status: 'unknown',
        })
      }
    })
    it.each([true, false])(
      'restores a later member only with a proven launch baseline (available=%s)',
      async (isAvailable) => {
        const child = { pid: 811, startTime: '134040000000000001' }
        const baselines: WindowsPriorityBaselinePort = {
          read: vi.fn(() => Promise.resolve(isAvailable ? 'normal' : null)),
        }
        const f = fixture('none', undefined, baselines)
        await f.actuators.setLevel(ticket, 'throttle')
        f.tree.put(ticket.id, child, { cpuSeconds: 1, residentBytes: 100 })
        f.run.mockResolvedValueOnce(
          JSON.stringify({
            priority: 'belowNormal',
            processes: [
              { ...ticket.root, priority: 'belowNormal' },
              { ...child, priority: 'belowNormal' },
            ],
          }),
        )
        expect(await f.actuators.retire(ticket)).toHaveProperty('retired', isAvailable)
        expect(baselines.read).toHaveBeenCalledWith(ticket, child)
        const restores = priorityRestores(f.run)
        expect(restores).toHaveLength(isAvailable ? 1 : 0)
        if (isAvailable) expect(restores[0]).toContain('811/134040000000000001/normal')
      },
    )
    it.each([true, false])(
      'does not reuse a departed member baseline for a recycled child PID (available=%s)',
      async (isAvailable) => {
        const old = { pid: 811, startTime: '134040000000000001' }
        const replacement = { ...old, startTime: '134040000000000002' }
        const baselines: WindowsPriorityBaselinePort = {
          read: vi.fn(() => Promise.resolve(isAvailable ? 'normal' : null)),
        }
        const f = fixture('none', undefined, baselines)
        f.run.mockResolvedValueOnce(
          JSON.stringify({
            priority: 'none',
            processes: [
              { ...ticket.root, priority: 'normal' },
              { ...old, priority: 'idle' },
            ],
          }),
        )
        await f.actuators.setLevel(ticket, 'pause')
        f.tree.put(ticket.id, replacement, { cpuSeconds: 1, residentBytes: 100 })
        f.run.mockResolvedValueOnce(
          JSON.stringify({
            priority: 'idle',
            processes: [
              { ...ticket.root, priority: 'idle' },
              { ...replacement, priority: 'idle' },
            ],
          }),
        )
        expect(await f.actuators.retire(ticket)).toHaveProperty('retired', isAvailable)
        expect(baselines.read).toHaveBeenCalledWith(ticket, replacement)
        const restores = priorityRestores(f.run)
        expect(restores).toHaveLength(isAvailable ? 1 : 0)
        if (!isAvailable) {
          return
        }

        expect(restores[0]).toContain('811/134040000000000002/normal')
        expect(restores[0]).not.toContain('811/134040000000000001/idle')
      },
    )
    it('ships native same-handle proofs, saved process priorities and actual job readbacks', async () => {
      const source = await readJobSource('shellJob')
      const region = source.slice(
        source.indexOf('// M107 A priority/rate region.'),
        source.indexOf('// End M107 A priority/rate region.'),
      )
      expect(region).toContain('Creation(process) == expected && Member(process, job)')
      expect(region).toContain('JOB_OBJECT_QUERY | (write ? JOB_OBJECT_SET_ATTRIBUTES : 0)')
      expect(region).toContain(
        'saved.TryGetValue(member, out baseline) || Creation(process) != baseline.Key',
      )
      expect(region).toContain('PriorityRank(desired) > PriorityRank(ceiling)')
      expect(region).toContain('GetPriorityClass(process.Key) != process.Value')
      expect(region).toContain('ReadJobControl<JOB_RATE>(job, CPU_RATE_CONTROL)')
      expect(region).not.toMatch(
        /TerminateJobObject|SuspendThread|memory\.max|SetProcessWorkingSetSize/,
      )
    })
    it.runIf(process.platform === 'win32')(
      'reads back and restores our real Windows job without elevation',
      async () => {
        const folder = await mkdtemp(path.join(tmpdir(), 'm107-a-job-'))
        try {
          const systemRoot = process.env['SystemRoot'] ?? String.raw`C:\Windows`
          const assembly = await shellJobAssembly({
            storageDir: folder,
            systemRoot,
            log: () => undefined,
            readJobSource,
          })()
          if (assembly === undefined) throw new Error('Windows helper unavailable')
          const job = newShellJob(assembly)
          // Resolve one exact OS module before lowering this process's priority;
          // implicit discovery in the minimal environment can exceed the probe deadline.
          const utility = path.win32.join(
            systemRoot,
            'System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1',
          )
          const script = `${joinStatement(job)}
$identity = [MuseSparkJob]::Identity($PID) | ConvertFrom-Json
$before = [MuseSparkJob]::ReadResourcePriority('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
$baselines = ($before.processes | ForEach-Object { "$($_.pid)/$($_.startTime)/$($_.priority)" }) -join ';'
$rateBefore = [MuseSparkJob]::ReadResourceRate('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
try {
  $lowered = [MuseSparkJob]::SetResourcePriority('${job.name}', $PID, $identity.startTime, 'belowNormal', $baselines, $false)
  $priority = [MuseSparkJob]::ReadResourcePriority('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
  $idle = [MuseSparkJob]::SetResourcePriority('${job.name}', $PID, $identity.startTime, 'idle', $baselines, $false)
  $idleRead = [MuseSparkJob]::ReadResourcePriority('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
  $back = [MuseSparkJob]::SetResourcePriority('${job.name}', $PID, $identity.startTime, 'belowNormal', $baselines, $false)
  $backRead = [MuseSparkJob]::ReadResourcePriority('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
  $rate = [MuseSparkJob]::SetResourceRate('${job.name}', $PID, $identity.startTime, 5, 5000) | ConvertFrom-Json
  $refused = [MuseSparkJob]::SetResourcePriority('${job.name}', $PID, '0', 'idle', $baselines, $false)
} finally {
  $restored = [MuseSparkJob]::SetResourcePriority('${job.name}', $PID, $identity.startTime, $before.priority, $baselines, $true)
  $rateRestored = [MuseSparkJob]::SetResourceRate('${job.name}', $PID, $identity.startTime, $rateBefore.flags, $rateBefore.rate) | ConvertFrom-Json
}
$priorityRestored = [MuseSparkJob]::ReadResourcePriority('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
$rateRead = [MuseSparkJob]::ReadResourceRate('${job.name}', $PID, $identity.startTime) | ConvertFrom-Json
@{ lowered=$lowered; priority=$priority.priority; idle=$idle; idlePriority=$idleRead.priority; back=$back; backPriority=$backRead.priority; rate=$rate.rate; restored=$restored; rateRestored=$rateRestored.rate; originalRate=$rateBefore.rate; refused=$refused; priorityExact=(($priorityRestored | ConvertTo-Json -Compress) -ceq ($before | ConvertTo-Json -Compress)); rateExact=(($rateRead | ConvertTo-Json -Compress) -ceq ($rateBefore | ConvertTo-Json -Compress)); rateFlags=$rate.flags; rateRestoredFlags=$rateRestored.flags; originalRateFlags=$rateBefore.flags } | ConvertTo-Json -Compress`
          const output = await runTreeProgram(
            path.win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            [
              ...WINDOWS_POWERSHELL_COMMAND_ARGS,
              `try { $ErrorActionPreference='Stop'; $PSModuleAutoloadingPreference='None'; Import-Module ${powerShellQuoted(utility)}; ${script} } catch { exit 1 }`,
            ],
            { SystemRoot: systemRoot },
          )
          const result: unknown = JSON.parse(output)
          expect(result).toMatchObject({
            lowered: true,
            priority: 'belowNormal',
            rate: 5000,
            restored: true,
            refused: false,
            idle: true,
            idlePriority: 'idle',
            back: true,
            backPriority: 'belowNormal',
            priorityExact: true,
            rateExact: true,
            rateFlags: 5,
            rateRestoredFlags: 0,
            originalRateFlags: 0,
          })
          expect(result).toHaveProperty('rateRestored', 0)
        } finally {
          await removeFolder(folder)
        }
      },
    )
  },
)
