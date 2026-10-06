import * as z from 'zod/mini'
import { SECONDS_PER_MINUTE } from '../../../shared/constants'
import { payloadDigest } from '../deviceLog'
import { pointSchema } from '../gcode/limits'
import { canonicalGcodeCommand } from '../gcode/tokenizer'
import { type MachineRecord } from '../registry'
import { type MachineHttp } from './http'
import { protectMachine, type Machine, type MachineDeps, type MachineStatus } from './machine'

const AXES = ['x', 'y', 'z'] as const
const positionSchema = z.array(z.number()).check(z.minLength(AXES.length))
const range = z.object({ position_min: z.number(), position_max: z.number() })
const heater = z.object({ max_temp: z.number() })
const reportSchema = z.object({
  result: z.object({
    status: z.object({
      webhooks: z.object({ state: z.string() }),
      print_stats: z.object({ state: z.string() }),
      toolhead: z.object({
        extruder: z.string(),
        axis_minimum: positionSchema,
        axis_maximum: positionSchema,
        position: positionSchema,
        homed_axes: z.string(),
        max_velocity: z.number(),
      }),
      gcode_move: z.object({
        gcode_position: positionSchema,
        position: positionSchema,
        homing_origin: positionSchema,
        absolute_coordinates: z.boolean(),
        speed: z.number(),
        speed_factor: z.number(),
      }),
      configfile: z.object({ settings: z.record(z.string(), z.unknown()) }),
    }),
  }),
})
const infoSchema = z.object({
  result: z.object({ hostname: z.string(), software_version: z.string(), state: z.string() }),
})
const okay = z.object({ result: z.literal('ok') })
const printerSettings = z.object({ max_velocity: z.number() })
function xyz(values: readonly number[]): { x: number; y: number; z: number } {
  return pointSchema.parse({ x: values[0], y: values[1], z: values[2] })
}

export function createMoonrakerMachine(
  record: MachineRecord,
  http: MachineHttp,
  deps: MachineDeps,
): Machine {
  http.assertTarget(record)
  let active: AbortController | undefined
  return protectMachine(
    record,
    {
      statusPayload: 'GET /printer/info\nPOST /printer/objects/query',
      dialect: 'klipper',
      stopPayload: 'POST /printer/emergency_stop',
      async status(signal): Promise<MachineStatus> {
        const info = infoSchema.parse(
          await http.json('GET', '/printer/info', undefined, signal),
        ).result
        const report = reportSchema.parse(
          await http.json(
            'POST',
            '/printer/objects/query',
            {
              objects: {
                webhooks: null,
                print_stats: null,
                toolhead: null,
                gcode_move: null,
                configfile: null,
              },
            },
            signal,
          ),
        ).result.status
        const {
          toolhead,
          gcode_move: move,
          configfile: { settings },
        } = report
        const x = range.parse(settings['stepper_x'])
        const y = range.parse(settings['stepper_y'])
        const zz = range.parse(settings['stepper_z'])
        const minimum = xyz(toolhead.axis_minimum)
        const maximum = xyz(toolhead.axis_maximum)
        const position = xyz(move.gcode_position)
        const isUntransformed =
          move.homing_origin.slice(0, AXES.length).every((value) => value === 0) &&
          JSON.stringify(position) === JSON.stringify(xyz(move.position)) &&
          JSON.stringify(position) === JSON.stringify(xyz(toolhead.position)) &&
          move.speed_factor === 1
        const extruder = heater.safeParse(settings[toolhead.extruder])
        const bed = heater.safeParse(settings['heater_bed'])
        let state = report.print_stats.state
        if (info.state !== 'ready') state = info.state
        else if (report.webhooks.state !== 'ready') state = report.webhooks.state
        else if (['standby', 'complete', 'cancelled', 'error'].includes(state)) state = 'ready'
        return {
          identity: `${info.hostname}/${info.software_version}/${toolhead.extruder}/${payloadDigest(JSON.stringify(settings))}`,
          state,
          isHomed: AXES.every((axis) => toolhead.homed_axes.includes(axis)),
          limits: {
            travel: {
              min: {
                x: Math.max(minimum.x, x.position_min),
                y: Math.max(minimum.y, y.position_min),
                z: Math.max(minimum.z, zz.position_min),
              },
              max: {
                x: Math.min(maximum.x, x.position_max),
                y: Math.min(maximum.y, y.position_max),
                z: Math.min(maximum.z, zz.position_max),
              },
            },
            feedMmMin:
              Math.min(
                toolhead.max_velocity,
                printerSettings.parse(settings['printer']).max_velocity,
              ) * SECONDS_PER_MINUTE,
            ...(extruder.success && { extruder: extruder.data.max_temp - 1 }),
            ...(bed.success && { bed: bed.data.max_temp - 1 }),
          },
          gcode:
            isUntransformed && extruder.success
              ? {
                  position,
                  absolute: move.absolute_coordinates,
                  unit: 'mm',
                  feedMmMin: move.speed * SECONDS_PER_MINUTE,
                }
              : undefined,
          blockedCommands: Object.keys(settings)
            .filter((key) => key.startsWith('gcode_macro '))
            .map((key) => canonicalGcodeCommand(key.slice('gcode_macro '.length))),
          warnings: [],
        }
      },
      async send(payload, signal, beforeWrite) {
        active = new AbortController()
        try {
          okay.parse(
            await http.json(
              'POST',
              '/printer/gcode/script',
              { script: payload },
              AbortSignal.any([signal, active.signal]),
              beforeWrite,
            ),
          )
        } finally {
          active = undefined
        }
      },
      async stop(signal) {
        okay.parse(await http.json('POST', '/printer/emergency_stop', undefined, signal))
        return []
      },
      cancel() {
        active?.abort()
      },
    },
    deps,
  )
}
