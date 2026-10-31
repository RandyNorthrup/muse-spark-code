import * as z from 'zod/mini'
import { MachineError, type MachineRecord } from '../registry'
import { protectMachine, type Machine, type MachineDeps } from './machine'

/** The host supplies a LAN-pinned, digest-authenticated request, using MakerHost.secrets. */
export interface PrusaLinkTransport {
  get(path: '/api/v1/info' | '/api/v1/status', signal: AbortSignal): Promise<unknown>
}
const infoSchema = z.object({ name: z.optional(z.string()), serial: z.string() })
const statusSchema = z.object({ printer: z.object({ state: z.string() }) })

/** PrusaLink has no raw G-code or emergency-stop endpoint. Job cancel is actuation. */
export function createPrusalinkMachine(
  record: MachineRecord,
  transport: PrusaLinkTransport,
  deps: MachineDeps,
): Machine {
  return protectMachine(
    record,
    {
      statusPayload: 'GET /api/v1/info\nGET /api/v1/status',
      dialect: 'marlin',
      stopPayload: 'unsupported',
      async status(signal) {
        const info = infoSchema.parse(await transport.get('/api/v1/info', signal))
        const status = statusSchema.parse(await transport.get('/api/v1/status', signal))
        return {
          identity: `${info.name ?? record.name}/${info.serial}`,
          state: status.printer.state,
          isHomed: false,
          limits: {},
          gcode: undefined,
          blockedCommands: [],
          warnings: ['physicalStopRequired', 'limitsUnavailable'],
        }
      },
      send() {
        throw new MachineError('readOnlyMachine')
      },
      stop() {
        throw new MachineError('physicalStopRequired')
      },
      cancel() {
        /* PrusaLink status requests have no command stream. */
      },
    },
    deps,
  )
}
