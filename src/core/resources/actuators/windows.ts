import path from 'node:path'
import * as z from 'zod/mini'
import { powerShellQuoted } from '../../shellQuote'
import {
  RESOURCE_JOB_CPU_RATE_PERCENT,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../shared/constants'
import {
  resourceProcessIdentitySchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
} from '../../../shared/resources'
import { runTreeProgram, type ResourceTreeRun } from '../trees/run'
import type { WindowsTreeDeps } from '../trees/windows'
import type { ResourceActuatorPort, ResourceControl } from './controls'

const priority = z.enum(['normal', 'belowNormal', 'idle'])
const jobPrioritySchema = z.strictObject({
  priority: z.enum(['none', 'normal', 'belowNormal', 'idle']),
  processes: z.array(z.extend(resourceProcessIdentitySchema, { priority })),
})
const rateSchema = z.strictObject({
  flags: z.number().check(z.int(), z.gte(0)),
  rate: z.number().check(z.int(), z.gte(0), z.lte(100 * 100)),
})
// Windows ABI values, not tunable policy. The percentage stays in shared/constants.ts.
const CPU_RATE_ENABLE_HARD_CAP = 0x5
const CPU_RATE_ENABLE_HARD_CAP_NOTIFY = 0xd

/** M96 K's launch record, keyed by ticket and exact birth; null means no proven original. */
export interface WindowsPriorityBaselinePort {
  read(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<unknown>
}

/** Controls use the same compiled helper as T; native mutation holds the proved job/process handles. */
export class WindowsResourceActuator implements ResourceActuatorPort {
  private readonly run: ResourceTreeRun
  constructor(
    private readonly deps: WindowsTreeDeps & {
      readonly cpuRateCap?: boolean
      readonly baselines?: WindowsPriorityBaselinePort
    },
  ) {
    if (!path.win32.isAbsolute(deps.assemblyPath) || !path.win32.isAbsolute(deps.systemRoot))
      throw new Error('Resource helper paths must be absolute')
    this.run = deps.run ?? runTreeProgram
  }

  private async call(body: string): Promise<unknown> {
    const script = `try { [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(this.deps.assemblyPath)}); ${body} } catch { exit 1 }`
    const raw = await this.run(
      path.win32.join(this.deps.systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
      [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
      { SystemRoot: this.deps.systemRoot },
    )
    const result: unknown = JSON.parse(raw)
    return result
  }

  controls(ticket: ResourceTicket): Promise<readonly ResourceControl[]> {
    if (ticket.scope.type !== 'job')
      return Promise.reject(new Error('Windows resource scope must be a job'))
    const name = powerShellQuoted(ticket.scope.name)
    const target = (identity: ResourceProcessIdentity) =>
      `${name}, ${String(identity.pid)}, ${powerShellQuoted(identity.startTime)}`
    let originalPriority: string | null = null
    const controls: ResourceControl[] = [
      {
        key: `${ticket.scope.name}/priority`,
        name: 'jobPriority',
        identity: null,
        reversible: true,
        minimumLevel: 'throttle',
        read: async (identity) => {
          const raw = await this.call(
            `[${SHELL_JOB_TYPE_NAME}]::ReadResourcePriority(${target(identity)})`,
          )
          if (raw === null) return null
          originalPriority = JSON.stringify(jobPrioritySchema.parse(raw))
          return originalPriority
        },
        lower: (level, original) => {
          const saved = jobPrioritySchema.parse(JSON.parse(original))
          const lowest = [saved.priority, ...saved.processes.map((item) => item.priority)]
          saved.priority = level === 'pause' || lowest.includes('idle') ? 'idle' : 'belowNormal'
          return JSON.stringify(saved)
        },
        write: async (value, identity) => {
          const desired = jobPrioritySchema.parse(JSON.parse(value))
          const isRestoring = value === originalPriority
          if (isRestoring) {
            const live = jobPrioritySchema.parse(
              await this.call(
                `[${SHELL_JOB_TYPE_NAME}]::ReadResourcePriority(${target(identity)})`,
              ),
            )
            for (const member of live.processes) {
              if (
                desired.processes.some(
                  (saved) => saved.pid === member.pid && saved.startTime === member.startTime,
                )
              )
                continue
              const birth = { pid: member.pid, startTime: member.startTime }
              const baseline = priority.parse(await this.deps.baselines?.read(ticket, birth))
              desired.processes = desired.processes.filter((saved) => saved.pid !== member.pid)
              desired.processes.push({ ...birth, priority: baseline })
            }
          }
          const baselines = desired.processes
            .map((item) => `${String(item.pid)}/${item.startTime}/${item.priority}`)
            .join(';')
          const raw = await this.call(
            `if ([${SHELL_JOB_TYPE_NAME}]::SetResourcePriority(${target(identity)}, ${powerShellQuoted(desired.priority)}, ${powerShellQuoted(baselines)}, $${String(isRestoring)})) { 'true' } else { 'false' }`,
          )
          return z.boolean().parse(raw) ? value : null
        },
        close: () => Promise.resolve(),
      },
    ]
    if (this.deps.cpuRateCap !== false)
      controls.push({
        key: `${ticket.scope.name}/rate`,
        name: 'jobCpuRate',
        identity: null,
        reversible: true,
        minimumLevel: 'throttle',
        read: async (identity) => {
          const raw = await this.call(
            `[${SHELL_JOB_TYPE_NAME}]::ReadResourceRate(${target(identity)})`,
          )
          return raw === null ? null : JSON.stringify(rateSchema.parse(raw))
        },
        lower: (_level, original) => {
          const saved = rateSchema.parse(JSON.parse(original))
          // Windows ABI flags: enable + hard cap; preserve notification, refuse other modes.
          if (![0, CPU_RATE_ENABLE_HARD_CAP, CPU_RATE_ENABLE_HARD_CAP_NOTIFY].includes(saved.flags))
            throw new Error('Unsupported job CPU rate mode')
          return JSON.stringify({
            flags: saved.flags || CPU_RATE_ENABLE_HARD_CAP,
            rate: Math.min(
              saved.flags === 0 ? Infinity : saved.rate,
              RESOURCE_JOB_CPU_RATE_PERCENT * 100,
            ),
          })
        },
        write: async (value, identity) => {
          const desired = rateSchema.parse(JSON.parse(value))
          const raw = await this.call(
            `[${SHELL_JOB_TYPE_NAME}]::SetResourceRate(${target(identity)}, ${String(desired.flags)}, ${String(desired.rate)})`,
          )
          return raw === null ? null : JSON.stringify(rateSchema.parse(raw))
        },
        close: () => Promise.resolve(),
      })
    return Promise.resolve(controls)
  }
}
