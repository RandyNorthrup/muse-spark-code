import * as z from 'zod/mini'
import type { GcodeState } from '../gcode/analyser'
import { limitsSchema, type MachineLimits } from '../gcode/limits'
import type { MachineRecord } from '../registry'
import { type MachineHttp } from './http'
import { protectMachine, type Machine, type MachineDeps } from './machine'

/** A host-owned firmware telemetry reader. REST's operational flag is not homing. */
export interface PrinterTelemetry {
  /** Identity includes the active tool/heater selection; limits apply to
   * that selection. Unknown selection returns gcode: undefined. */
  read(signal: AbortSignal): Promise<{
    readonly identity: string
    readonly state: string
    readonly isHomed: boolean
    readonly limits: MachineLimits
    readonly gcode: GcodeState | undefined
  }>
}
const statusSchema = z.object({
  state: z.object({
    text: z.string(),
    flags: z.object({
      operational: z.boolean(),
      printing: z.boolean(),
      paused: z.boolean(),
      error: z.boolean(),
      closedOrError: z.boolean(),
    }),
  }),
  temperature: z.record(z.string(), z.unknown()),
})
const connectionSchema = z.object({
  current: z.object({ port: z.nullable(z.string()), printerProfile: z.string() }),
})
const nullReply = z.null()

export function createOctoprintMachine(
  record: MachineRecord,
  http: MachineHttp,
  deps: MachineDeps,
  telemetry?: PrinterTelemetry,
): Machine {
  http.assertTarget(record)
  let active: AbortController | undefined
  return protectMachine(
    record,
    {
      statusPayload: 'GET /api/printer\nGET /api/connection',
      dialect: 'marlin',
      stopPayload: JSON.stringify({ commands: ['M112'] }),
      async status(signal) {
        const status = statusSchema.parse(await http.json('GET', '/api/printer', undefined, signal))
        const connection = connectionSchema.parse(
          await http.json('GET', '/api/connection', undefined, signal),
        ).current
        const firmware = await telemetry?.read(signal)
        const { flags } = status.state
        return {
          identity: `${connection.port ?? ''}/${connection.printerProfile}/${firmware?.identity ?? ''}`,
          state:
            flags.operational &&
            !flags.printing &&
            !flags.paused &&
            !flags.error &&
            !flags.closedOrError
              ? (firmware?.state ?? 'operational')
              : status.state.text,
          isHomed: firmware?.isHomed ?? false,
          limits: limitsSchema.parse(firmware?.limits ?? {}),
          gcode: firmware?.gcode,
          blockedCommands: [],
          warnings: firmware === undefined ? ['limitsUnavailable'] : [],
        }
      },
      async send(payload, signal, beforeWrite) {
        active = new AbortController()
        try {
          nullReply.parse(
            await http.json(
              'POST',
              '/api/printer/command',
              { commands: payload.split('\n') },
              AbortSignal.any([signal, active.signal]),
              beforeWrite,
            ),
          )
        } finally {
          active = undefined
        }
      },
      async stop(signal) {
        // OctoPrint's emergency command parser dispatches M112 out of band.
        nullReply.parse(
          await http.json('POST', '/api/printer/command', { commands: ['M112'] }, signal),
        )
        return []
      },
      cancel() {
        active?.abort()
      },
    },
    deps,
  )
}
