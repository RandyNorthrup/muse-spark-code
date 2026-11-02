import * as z from 'zod/mini'
import { HTTP_NOT_FOUND, HTTP_OK, RUNTIME_MAKER_HTTP_NO_CONTENT } from '../../../shared/constants'
import type { GcodeState } from '../gcode/analyser'
import { limitsSchema, type MachineLimits } from '../gcode/limits'
import { MachineError, type MachineRecord } from '../registry'
import { type MachineHttp } from './http'
import { protectMachine, type Machine, type MachineDeps } from './machine'

/** A host-owned firmware telemetry reader. REST's operational flag is not homing. */
export interface PrinterTelemetry {
  /** Identity includes the active tool/heater selection; limits apply to
  that selection. Unknown selection returns gcode: undefined. */
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

// OctoPrint's application-keys data model (docs.octoprint.org appkeys): the
// authorization response carries the poll token and the auth-dialog URL, the
// key response the issued key. The token becomes a URL path segment, so it
// must be one safe segment; anything else refuses the flow, never the poll.
const appkeysAuthorizationSchema = z.strictObject({
  app_token: z.string().check(z.minLength(1), z.regex(/^[^/\s#?]+$/)),
  auth_dialog: z.string().check(z.minLength(1)),
})
const appkeysKeySchema = z.strictObject({
  api_key: z.string().check(z.minLength(1)),
})

function parseAppkeysBody<Shape extends z.ZodMiniType>(
  schema: Shape,
  body: unknown,
): z.infer<Shape> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new MachineError('machineResponse')
  return parsed.data
}

export interface OctoprintAppKeysDeps {
  /** Bound to the machine's endpoint through the LAN-checked target. No key is sent. */
  readonly http: MachineHttp
  /** The application name OctoPrint's approval dialog shows the person. */
  readonly app: string
  /** The OctoPrint user id the request is restricted to, when the person gave one. */
  readonly user?: string
  readonly pollIntervalMs: number
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  /** The auth-dialog URL, for the host to open once the request is polling. */
  readonly onAuthDialog?: (url: string) => void
}

export type OctoprintAppKeysResult =
  | { readonly status: 'granted'; readonly apiKey: string }
  | { readonly status: 'denied' | 'unsupported' | 'timeout' }

/**
OctoPrint's probe → request → poll flow, so the person approves in
OctoPrint's UI and never pastes a key. Denied, unsupported and timed-out
are explicit outcomes, never grants; transport failures rethrow.
*/
export async function requestOctoprintAppKey(
  deps: OctoprintAppKeysDeps,
): Promise<OctoprintAppKeysResult> {
  deps.signal?.throwIfAborted()
  try {
    const probe = await deps.http.request('GET', '/plugin/appkeys/probe', undefined, deps.signal)
    if (probe.status !== RUNTIME_MAKER_HTTP_NO_CONTENT) return { status: 'unsupported' }
  } catch (error: unknown) {
    if (error instanceof MachineError && error.code === 'machineHttpStatus')
      return { status: 'unsupported' }
    throw error
  }
  deps.signal?.throwIfAborted()
  // Enrollment reads skip the scrubber (it redacts `app_token` and
  // `api_key` by shape), so a malformed body becomes a typed refusal:
  // a zod error would carry the raw credential in its message.
  const authorization = parseAppkeysBody(
    appkeysAuthorizationSchema,
    await deps.http.json(
      'POST',
      '/plugin/appkeys/request',
      deps.user === undefined ? { app: deps.app } : { app: deps.app, user: deps.user },
      deps.signal,
      undefined,
      { scrub: false },
    ),
  )
  deps.onAuthDialog?.(authorization.auth_dialog)
  const pollPath = `/plugin/appkeys/request/${authorization.app_token}`
  const deadline = Date.now() + deps.timeoutMs
  for (;;) {
    deps.signal?.throwIfAborted()
    if (Date.now() >= deadline) return { status: 'timeout' }
    const reply = await deps.http.request('GET', pollPath, undefined, deps.signal, undefined, {
      acceptStatus: [HTTP_NOT_FOUND],
      scrub: false,
    })
    if (reply.status === HTTP_OK) {
      const key = parseAppkeysBody(appkeysKeySchema, reply.body)
      return { status: 'granted', apiKey: key.api_key }
    }
    if (reply.status === HTTP_NOT_FOUND) return { status: 'denied' }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, deps.pollIntervalMs)
    })
  }
}

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
