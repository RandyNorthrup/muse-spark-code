import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import { listenOnLoopback } from './loopbackPort'

export const makerLimits = {
  travel: { min: { x: 0, y: 0, z: 0 }, max: { x: 200, y: 200, z: 200 } },
  feedMmMin: 1200,
  extruder: 240,
  bed: 100,
}

export function moonrakerFrame() {
  return {
    result: {
      eventtime: 1,
      status: {
        webhooks: { state: 'ready' },
        print_stats: { state: 'standby' },
        toolhead: {
          extruder: 'extruder',
          axis_minimum: [0, 0, 0, 0],
          axis_maximum: [200, 200, 200, 0],
          position: [10, 10, 10, 0],
          homed_axes: 'xyz',
          max_velocity: 100,
        },
        gcode_move: {
          gcode_position: [10, 10, 10, 0],
          position: [10, 10, 10, 0],
          homing_origin: [0, 0, 0, 0],
          absolute_coordinates: true,
          speed: 10,
          speed_factor: 1,
        },
        configfile: {
          settings: {
            printer: { max_velocity: 100 },
            stepper_x: { position_min: 0, position_max: 200 },
            stepper_y: { position_min: 0, position_max: 200 },
            stepper_z: { position_min: 0, position_max: 200 },
            extruder: { max_temp: 250 },
            heater_bed: { max_temp: 120 },
          },
        },
      },
    },
  }
}
export function octoprintFrame() {
  return {
    state: {
      text: 'Operational',
      flags: {
        operational: true,
        printing: false,
        paused: false,
        error: false,
        closedOrError: false,
      },
    },
    temperature: { tool0: { actual: 20, target: 0 }, bed: { actual: 20, target: 0 } },
  }
}
export interface SimulatorRequest {
  readonly path: string
  readonly method: string | undefined
  readonly body: unknown
  readonly hasKey: boolean
}
async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new TypeError('bufferExpected')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  const parsed: unknown = text === '' ? null : JSON.parse(text)
  return z.json().parse(parsed)
}
export async function machineSimulator() {
  const requests: SimulatorRequest[] = []
  const moonraker = moonrakerFrame()
  const octoprint = octoprintFrame()
  let hostname = 'virtual-klipper'
  let held: ServerResponse | undefined
  let shouldHoldSend = false
  let shouldLoseReply = false
  let override: { status: number; body: string; headers?: Record<string, string> } | undefined
  const server = createServer((request, response) => {
    void requestBody(request)
      .then((body) => {
        const path = request.url ?? ''
        requests.push({
          path,
          method: request.method,
          body,
          hasKey: typeof request.headers['x-api-key'] === 'string',
        })
        if (override !== undefined) {
          response.writeHead(override.status, override.headers)
          response.end(override.body)
          return
        }
        if (path === '/printer/gcode/script' && shouldLoseReply) {
          const script = z.object({ script: z.string() }).parse(body).script
          if (script !== 'G91\nG1 X1 F600\nG90') throw new Error('unexpectedScript')
          for (const position of [
            moonraker.result.status.toolhead.position,
            moonraker.result.status.gcode_move.position,
            moonraker.result.status.gcode_move.gcode_position,
          ])
            position[0] = (position[0] ?? 0) + 1
          response.destroy()
          return
        }
        if (path === '/printer/gcode/script' && shouldHoldSend) {
          held = response
          return
        }
        if (path === '/api/printer/command') {
          response.writeHead(204)
          response.end()
          return
        }
        response.setHeader('content-type', 'application/json')
        const replies: Record<string, unknown> = {
          '/printer/info': { result: { state: 'ready', hostname, software_version: 'test' } },
          '/printer/objects/query': moonraker,
          '/api/printer': octoprint,
          '/api/connection': { current: { port: 'VIRTUAL', printerProfile: '_default' } },
        }
        const result = replies[path] ?? { result: 'ok' }
        response.end(JSON.stringify(result))
      })
      .catch(() => {
        response.writeHead(400)
        response.end()
      })
  })
  const port = await listenOnLoopback(server)
  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    requests,
    moonraker,
    octoprint,
    changeIdentity() {
      hostname = 'different-printer'
    },
    holdSend() {
      shouldHoldSend = true
    },
    loseSendReply(shouldLose = true) {
      shouldLoseReply = shouldLose
    },
    dropHeldReply() {
      held?.destroy()
    },
    releaseSend() {
      held?.end(JSON.stringify({ result: 'ok' }))
    },
    reply(value: typeof override) {
      override = value
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    },
  }
}
