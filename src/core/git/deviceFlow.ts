// GitHub's OAuth device flow for the runtime's own sign-in (M123, PLAN.md
// D104 source b). The project's OAuth App is a public client: every request
// carries the client id and nothing else of ours, never a secret.
//
// - The device code is asked for once; the user code and GitHub's own
//   verification address go to the caller's `present`, the only surface
//   that shows them. A reply naming any other address is refused.
// - The token endpoint is polled no faster than `interval`; `slow_down`
//   adds five seconds (or GitHub's new interval, whichever is longer), and
//   polling stops at `expires_in` or when the signal aborts, both checked
//   again after `present` and each wait, just before the poll goes out.
// - With expiring user tokens on, the refresh token is returned beside the
//   access token, and `refreshDeviceFlowToken` swaps both for new ones.
//   Only `bad_refresh_token` is a refusal of the pair; a 5xx or 429 reply
//   (whatever its body) is `network`, as a lost connection is.
//
// The reply shapes are GitHub's documented examples ("Authorizing OAuth
// apps", device flow, read 2026-10-17; not a capture, see
// docs/certification/msm71m123.md). Fields GitHub adds are let through, unread.
// A token is never put in an error, a log or the returned failure.

import * as z from 'zod/mini'
import {
  GITHUB_DEVICE_CODE_EXPIRES_S,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_GRANT_TYPE,
  GITHUB_DEVICE_POLL_INTERVAL_S,
  GITHUB_DEVICE_SLOW_DOWN_STEP_S,
  GITHUB_DEVICE_TOKEN_URL,
  GITHUB_DEVICE_VERIFICATION_URL,
  GITHUB_GIST_SCOPES,
  GITHUB_REFRESH_GRANT_TYPE,
  GITHUB_REQUEST_TIMEOUT_MS,
  GITHUB_USER_CODE_PATTERN,
  HTTP_TOO_MANY_REQUESTS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../shared/constants'
import {
  assertGistShareScopes,
  assertPermittedScopes,
  GitHubTokenSourceError,
  requireOAuthClientId,
} from './tokenSource'

export interface DeviceFlowDeps {
  readonly fetch: typeof fetch
  readonly now: () => number
  /** Resolves after `ms`; rejects with the signal's reason when it aborts. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
}

/** What the user is shown: the code to type, where, and until when. */
export interface DeviceCodePrompt {
  readonly userCode: string
  readonly verificationUri: string
  /** Epoch ms. */
  readonly expiresAt: number
}

export interface DeviceFlowTokens {
  readonly accessToken: string
  /** Present when the app has expiring user tokens on. */
  readonly refreshToken: string | undefined
  /** Epoch ms; undefined when the token does not expire. */
  readonly expiresAt: number | undefined
  readonly refreshExpiresAt: number | undefined
  /** The scopes GitHub granted, as it named them. */
  readonly scope: string
}

export type DeviceFlowFailureReason =
  | 'verificationAddress'
  | 'userCode'
  | 'expired'
  | 'denied'
  | 'disabled'
  | 'incorrectClient'
  | 'incorrectDeviceCode'
  | 'unsupportedGrant'
  | 'refreshRefused'
  | 'network'
  | 'reply'

/** A sign-in that did not finish; `reason` is a fixed word, safe to log. */
export class DeviceFlowFailure extends Error {
  public constructor(
    public readonly reason: DeviceFlowFailureReason,
    options?: ErrorOptions,
  ) {
    super(reason, options)
    this.name = 'DeviceFlowFailure'
  }
}

const seconds = z.number().check(z.int(), z.positive())
const deviceCodeReplySchema = z.looseObject({
  device_code: z.string().check(z.minLength(1)),
  user_code: z.string(),
  verification_uri: z.string(),
  expires_in: z.optional(seconds),
  interval: z.optional(seconds),
})
const tokenReplySchema = z.looseObject({
  access_token: z.string().check(z.minLength(1)),
  token_type: z.string(),
  scope: z.optional(z.string()),
  expires_in: z.optional(seconds),
  refresh_token: z.optional(z.string().check(z.minLength(1))),
  refresh_token_expires_in: z.optional(seconds),
})
const errorReplySchema = z.looseObject({
  error: z.string(),
  interval: z.optional(seconds),
})

const HTTP_SERVER_ERROR = 500
// GitHub's word for a refresh token it no longer takes ("Refreshing user
// access tokens"); any other refresh error leaves the pair as it is.
const BAD_REFRESH_TOKEN = 'bad_refresh_token'

// GitHub's "Authorizing OAuth apps" (read 2026-10-17) names the expiry both
// ways: `expired_token` in its error table, `token_expired` in its text.
const ERROR_REASONS: Readonly<Record<string, DeviceFlowFailureReason>> = {
  expired_token: 'expired',
  token_expired: 'expired',
  access_denied: 'denied',
  device_flow_disabled: 'disabled',
  incorrect_client_credentials: 'incorrectClient',
  incorrect_device_code: 'incorrectDeviceCode',
  unsupported_grant_type: 'unsupportedGrant',
}

/** POST a form with `Accept: application/json`; the reply's JSON, or a failure word. */
async function post(
  deps: DeviceFlowDeps,
  url: string,
  form: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response
  try {
    response = await deps.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)]),
    })
  } catch (error: unknown) {
    signal.throwIfAborted()
    throw new DeviceFlowFailure('network', { cause: error })
  }
  // An outage or a proxy, not GitHub's answer: its body is not read.
  if (response.status >= HTTP_SERVER_ERROR || response.status === HTTP_TOO_MANY_REQUESTS) {
    throw new DeviceFlowFailure('network')
  }
  try {
    return await response.json()
  } catch {
    throw new DeviceFlowFailure(response.ok ? 'reply' : 'network')
  }
}

function tokensOf(reply: z.infer<typeof tokenReplySchema>, now: number): DeviceFlowTokens {
  return {
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt:
      reply.expires_in === undefined ? undefined : now + reply.expires_in * MILLISECONDS_PER_SECOND,
    refreshExpiresAt:
      reply.refresh_token_expires_in === undefined
        ? undefined
        : now + reply.refresh_token_expires_in * MILLISECONDS_PER_SECOND,
    scope: reply.scope ?? '',
  }
}

/**
Sign in: ask for a device code, show it through `present`, and poll until
the user approves, denies, the code expires or `signal` aborts.
*/
export async function signInWithDeviceFlow(
  deps: DeviceFlowDeps,
  scopes: readonly string[],
  present: (prompt: DeviceCodePrompt) => Promise<void>,
  signal: AbortSignal,
): Promise<DeviceFlowTokens> {
  assertPermittedScopes(scopes)
  return await runDeviceFlow(deps, scopes, present, signal)
}

/**
D242's Share-time sign-in: the same flow, asking for `gist` alone, and
only callable from Share's consent. Sign-in itself never asks, and this
grant does not replace the repository token.
*/
export async function signInWithDeviceFlowForGistShare(
  deps: DeviceFlowDeps,
  present: (prompt: DeviceCodePrompt) => Promise<void>,
  signal: AbortSignal,
): Promise<DeviceFlowTokens> {
  assertGistShareScopes(GITHUB_GIST_SCOPES)
  return await runDeviceFlow(deps, GITHUB_GIST_SCOPES, present, signal)
}

async function runDeviceFlow(
  deps: DeviceFlowDeps,
  scopes: readonly string[],
  present: (prompt: DeviceCodePrompt) => Promise<void>,
  signal: AbortSignal,
): Promise<DeviceFlowTokens> {
  const clientId = requireOAuthClientId()
  const raw = await post(
    deps,
    GITHUB_DEVICE_CODE_URL,
    { client_id: clientId, scope: scopes.join(' ') },
    signal,
  )
  const failed = errorReplySchema.safeParse(raw)
  if (failed.success) throw new DeviceFlowFailure(ERROR_REASONS[failed.data.error] ?? 'reply')
  const parsed = deviceCodeReplySchema.safeParse(raw)
  if (!parsed.success) throw new DeviceFlowFailure('reply')
  const code = parsed.data
  // Only GitHub's own page is ever shown or opened (device-flow phishing).
  if (code.verification_uri !== GITHUB_DEVICE_VERIFICATION_URL) {
    throw new DeviceFlowFailure('verificationAddress')
  }
  if (!GITHUB_USER_CODE_PATTERN.test(code.user_code)) throw new DeviceFlowFailure('userCode')
  const expiresAt =
    deps.now() + (code.expires_in ?? GITHUB_DEVICE_CODE_EXPIRES_S) * MILLISECONDS_PER_SECOND
  await present({ userCode: code.user_code, verificationUri: code.verification_uri, expiresAt })
  let intervalS = code.interval ?? GITHUB_DEVICE_POLL_INTERVAL_S
  for (;;) {
    if (deps.now() + intervalS * MILLISECONDS_PER_SECOND >= expiresAt)
      throw new DeviceFlowFailure('expired')
    await deps.sleep(intervalS * MILLISECONDS_PER_SECOND, signal)
    // A sleeping laptop or a late timer can wake past the deadline.
    signal.throwIfAborted()
    if (deps.now() >= expiresAt) throw new DeviceFlowFailure('expired')
    const reply = await post(
      deps,
      GITHUB_DEVICE_TOKEN_URL,
      { client_id: clientId, device_code: code.device_code, grant_type: GITHUB_DEVICE_GRANT_TYPE },
      signal,
    )
    const error = errorReplySchema.safeParse(reply)
    if (!error.success) {
      const tokens = tokenReplySchema.safeParse(reply)
      if (!tokens.success) throw new DeviceFlowFailure('reply')
      return tokensOf(tokens.data, deps.now())
    }
    if (error.data.error === 'slow_down') {
      intervalS = Math.max(intervalS + GITHUB_DEVICE_SLOW_DOWN_STEP_S, error.data.interval ?? 0)
    } else if (error.data.error !== 'authorization_pending') {
      throw new DeviceFlowFailure(ERROR_REASONS[error.data.error] ?? 'reply')
    }
  }
}

/** Swap a refresh token for a new pair; the old refresh token is spent either way. */
export async function refreshDeviceFlowToken(
  deps: DeviceFlowDeps,
  refreshToken: string,
  signal: AbortSignal,
): Promise<DeviceFlowTokens> {
  const clientId = requireOAuthClientId()
  const reply = await post(
    deps,
    GITHUB_DEVICE_TOKEN_URL,
    { client_id: clientId, grant_type: GITHUB_REFRESH_GRANT_TYPE, refresh_token: refreshToken },
    signal,
  )
  const error = errorReplySchema.safeParse(reply)
  if (error.success) {
    throw new DeviceFlowFailure(
      error.data.error === BAD_REFRESH_TOKEN
        ? 'refreshRefused'
        : (ERROR_REASONS[error.data.error] ?? 'reply'),
    )
  }
  const tokens = tokenReplySchema.safeParse(reply)
  if (!tokens.success) throw new DeviceFlowFailure('reply')
  return tokensOf(tokens.data, deps.now())
}

/**
A sign-in that did not finish, in the user's words: the fixed sentence
for its reason, never GitHub's text or a token. Undefined for anything
that is not a sign-in failure (the caller says that its own way).
*/
export function signInFailureText(error: unknown): string | undefined {
  if (error instanceof DeviceFlowFailure) return UI_TEXT.githubSignIn.failures[error.reason]
  return error instanceof GitHubTokenSourceError && error.reason === 'clientIdUnset'
    ? UI_TEXT.githubSignIn.failures.clientIdUnset
    : undefined
}
