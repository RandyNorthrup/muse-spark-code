import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { SECONDS_PER_MINUTE } from '../../../shared/constants'
import { type MachineLimits } from '../gcode/limits'
import type { MachineRecord } from '../registry'
import { protectMachine, type Machine, type MachineDeps } from './machine'
import type { PrinterTelemetry } from './octoprint'
import type { SerialMachinePort } from './serial'

/** M503 reports feed rates, but not certified travel, heater caps or homing. */
export function marlinFeedLimit(input: unknown): MachineLimits {
  const text = z.string().parse(input)
  const match = /(?:^|\n)(?:echo:\s*)?\s*M203\s+X([\d.]+)\s+Y([\d.]+)\s+Z([\d.]+)/.exec(text)
  if (match === null) return {}
  const rates = match.slice(1).map(Number)
  return rates.some((value) => !Number.isFinite(value) || value <= 0)
    ? {}
    : { feedMmMin: Math.min(...rates) * SECONDS_PER_MINUTE }
}
export function createMarlinMachine(
  record: MachineRecord,
  port: SerialMachinePort,
  deps: MachineDeps,
  telemetry?: PrinterTelemetry,
): Machine {
  let hasEmergencyParser = false
  return protectMachine(
    record,
    {
      statusPayload: 'M115\nM503\n',
      dialect: 'marlin',
      payloadTerminator: '\n',
      stopPayload: 'M112\n',
      async status(signal) {
        const info = z.string().parse(await port.request('M115', signal))
        hasEmergencyParser = /^Cap:EMERGENCY_PARSER:1\s*$/m.test(info)
        const settings = marlinFeedLimit(await port.request('M503', signal))
        const firmware = await telemetry?.read(signal)
        return {
          identity: firmware?.identity ?? info,
          state: firmware?.state ?? 'unknown',
          isHomed: firmware?.isHomed ?? false,
          limits: {
            ...firmware?.limits,
            ...settings,
            ...(firmware?.limits.feedMmMin !== undefined &&
              settings.feedMmMin !== undefined && {
                feedMmMin: Math.min(firmware.limits.feedMmMin, settings.feedMmMin),
              }),
          },
          gcode: firmware?.gcode,
          blockedCommands: [],
          warnings: hasEmergencyParser ? [] : ['physicalStopRequired'],
        }
      },
      async send(payload, signal, beforeWrite) {
        await port.send(Buffer.from(payload), signal, beforeWrite)
      },
      async stop(signal) {
        await port.realtime(Buffer.from('M112\n'), signal)
        return hasEmergencyParser ? [] : ['physicalStopRequired']
      },
      cancel() {
        port.cancel()
      },
    },
    deps,
  )
}
