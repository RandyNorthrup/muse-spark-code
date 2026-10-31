import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { type MachineLimits } from '../gcode/limits'
import { MachineError, type MachineRecord } from '../registry'
import { protectMachine, type Machine, type MachineDeps, type MachineStatus } from './machine'
import type { SerialMachinePort } from './serial'

export interface FluidNcConfigPort {
  /** Normalized by the host's captured YAML reader; network ports are not guessed. */
  read(signal: AbortSignal): Promise<unknown>
}
const fluidAxis = z.object({
  max_travel_mm: z.number().check(z.positive()),
  max_rate_mm_per_min: z.number().check(z.positive()),
  soft_limits: z.boolean(),
})
const fluidConfigSchema = z.object({ axes: z.object({ x: fluidAxis, y: fluidAxis, z: fluidAxis }) })
export interface GrblReport {
  readonly state: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly settings: ReadonlyMap<string, number>
}

export function parseGrblReport(statusInput: unknown, settingsInput: unknown): GrblReport {
  const status = z.string().parse(statusInput)
  const match = /^<([^|>]+)\|MPos:([+-]?[\d.]+),([+-]?[\d.]+),([+-]?[\d.]+)(?:\||>)/m.exec(status)
  if (match?.[1] === undefined) throw new MachineError('grblStatus')
  const position = { x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) }
  if (Object.values(position).some((value) => !Number.isFinite(value)))
    throw new MachineError('grblStatus')
  const settings = new Map<string, number>()
  for (const line of z.string().parse(settingsInput).split(/\r?\n/)) {
    const entry = /^\$(\d+)=([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s|$)/.exec(line)
    if (entry?.[1] === undefined || entry[2] === undefined) continue
    const value = Number(entry[2])
    if (!Number.isFinite(value) || settings.has(entry[1])) throw new MachineError('grblSettings')
    settings.set(entry[1], value)
  }
  return { state: match[1], position, settings }
}
function grblLimits(settings: ReadonlyMap<string, number>): MachineLimits {
  const x = settings.get('130'),
    y = settings.get('131'),
    zz = settings.get('132')
  const rates = ['110', '111', '112'].map((key) => settings.get(key))
  if (
    x === undefined ||
    y === undefined ||
    zz === undefined ||
    rates.some((rate) => rate === undefined || rate <= 0) ||
    x <= 0 ||
    y <= 0 ||
    zz <= 0
  )
    return {}
  return {
    travel: { min: { x: -x, y: -y, z: -zz }, max: { x: 0, y: 0, z: 0 } },
    feedMmMin: Math.min(...rates.filter((rate) => rate !== undefined)),
  }
}

export function createGrblMachine(
  record: MachineRecord,
  port: SerialMachinePort,
  deps: MachineDeps,
  fluidConfig?: FluidNcConfigPort,
): Machine {
  let hasStartupMotion = true
  return protectMachine(
    record,
    {
      statusPayload: '?$$\n$I\n$N\n',
      dialect: 'grbl',
      stopPayload: Buffer.from('218518', 'hex'),
      async status(signal): Promise<MachineStatus> {
        const report = parseGrblReport(
          await port.request('?', signal),
          await port.request('$$', signal),
        )
        const identity = z.string().parse(await port.request('$I', signal))
        const startup = z.string().parse(await port.request('$N', signal))
        hasStartupMotion = /^\$N\d+=[ \t]*[^ \t\r\n]/m.test(startup)
        let limits = grblLimits(report.settings)
        let isHomed =
          !report.state.startsWith('Alarm') &&
          report.settings.get('20') === 1 &&
          report.settings.get('22') === 1
        if (record.kind === 'fluidnc') {
          const result = fluidConfigSchema.safeParse(await fluidConfig?.read(signal))
          if (result.success) {
            const { x, y, z: zz } = result.data.axes
            isHomed &&= x.soft_limits && y.soft_limits && zz.soft_limits
            limits = {
              travel: {
                min: { x: -x.max_travel_mm, y: -y.max_travel_mm, z: -zz.max_travel_mm },
                max: { x: 0, y: 0, z: 0 },
              },
              feedMmMin: Math.min(
                x.max_rate_mm_per_min,
                y.max_rate_mm_per_min,
                zz.max_rate_mm_per_min,
              ),
            }
          } else {
            limits = {}
            isHomed = false
          }
        }
        return {
          identity,
          state: report.state,
          isHomed,
          limits,
          gcode: undefined,
          blockedCommands: [],
          warnings: hasStartupMotion ? ['startupMotion'] : [],
        }
      },
      send() {
        throw new MachineError('readOnlyMachine')
      },
      async stop(signal) {
        // One real-time write, with the exact order required by D83.5.
        await port.realtime(Buffer.from('218518', 'hex'), signal)
        return hasStartupMotion ? ['startupMotion'] : []
      },
      cancel() {
        port.cancel()
      },
    },
    deps,
  )
}
