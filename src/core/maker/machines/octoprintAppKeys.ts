// OctoPrint's application-keys enrollment (RLF-M103WIRE), split from the
// machine adapter: only the window engine enrolls (the person approves in
// OctoPrint's UI), so the runtime bundle keeps the adapter alone.
import * as z from 'zod/mini'
import { HTTP_NOT_FOUND, HTTP_OK, RUNTIME_MAKER_HTTP_NO_CONTENT } from '../../../shared/constants'
import { MachineError } from '../registry'
import type { MachineHttp } from './http'

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
  /**
  The auth-dialog URL, for the host to open once the request is polling.
  Awaited: a refused dialog refuses the enrollment before the first poll.
  */
  readonly onAuthDialog?: (url: string) => void | Promise<void>
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
  await deps.onAuthDialog?.(authorization.auth_dialog)
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
