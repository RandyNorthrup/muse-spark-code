// Muse Code's experimental account methods on a short-lived `muse serve`
// that owns no conversation (M55; PLAN.md D26, 2026-09-27): the device
// sign-in, `account/read` (which credential the CLI would use) and
// `account/logout`. The chat host is not started with `experimentalApi`, so
// these always get a process of their own, closed when they finish. The
// extension never sends its Model API key to it, and never keeps, logs or
// shows the account's `label` (an e-mail address) or `avatarUrl`.

import { spawnMspConnection, type Connection } from '@muse-code/sdk'
import * as z from 'zod/mini'
import { wireWordForLog } from '../../core/logging'
import { unlessAborted, withDeadline } from '../../core/timeouts'
import {
  MSP_CLIENT_NAME,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MUSE_ACCOUNT_LOGOUT,
  MUSE_ACCOUNT_READ,
  MUSE_ACCOUNT_STATES,
} from '../../shared/constants'
import type { MuseCodeBackendManager } from '../backend/museCodeBackendManager'
import type { Logger } from '../logger'

// `AccountState` as captured (1.3.0 and 1.4.0): `label` and `avatarUrl` are
// not in the schema, so parsing drops them.
const accountStateSchema = z.object({
  state: z.string(),
  credentialRequired: z.boolean(),
})

export type AccountState = z.infer<typeof accountStateSchema>

export interface AccountSession {
  /** `closed` settles when the host's output ends: it exited or died. */
  readonly connection: Pick<Connection, 'request' | 'onNotification' | 'closed'>
  readonly close: () => Promise<unknown>
}

/** Starts one short-lived host; `signal` cancels the start. */
export type ConnectAccountHost = (signal: AbortSignal) => Promise<AccountSession>

const CANCELLED_CONNECT = Symbol('cancelled account host connection')

/** The error's name only: a CLI message can carry a path or an account. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error'
}

/** Whether a stored credential (a sign-in or a key the CLI saved) is the one in use. */
export function isStoredSignIn(account: AccountState): boolean {
  return (
    account.state === MUSE_ACCOUNT_STATES.accountLogin ||
    account.state === MUSE_ACCOUNT_STATES.apiKey
  )
}

/**
 * The answer every captured `account/read` after a sign-out gave
 * (docs/certification/sign-in-detection.md). Nothing else counts as signed
 * out: `envKey` masks the stored lane, and other answers were never
 * captured (AGENTS.md rule 13, the review of PR #49).
 */
export function isCapturedSignedOut(account: AccountState): boolean {
  return account.state === MUSE_ACCOUNT_STATES.loggedOut && account.credentialRequired
}

type AccountConnection = AccountSession['connection']

/** An account method's `AccountState` answer; undefined when it failed or came in another shape. */
async function requestAccount(
  connection: AccountConnection,
  method: string,
): Promise<AccountState | undefined> {
  try {
    const result = accountStateSchema.safeParse(
      await withDeadline(
        connection.request(method, {}),
        MSP_HANDSHAKE_TIMEOUT_MS,
        `Muse Code did not answer ${method} in time`,
      ),
    )
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

/** `account/read` on an open host; undefined when the host cannot say. */
export async function readAccountState(
  connection: AccountConnection,
): Promise<AccountState | undefined> {
  return await requestAccount(connection, MUSE_ACCOUNT_READ)
}

/**
 * `use` on one short-lived host, closed afterwards; `fallback` when it
 * cannot start, or once `ended` aborts (the window closing), which closes
 * the host at once instead of waiting for its answer.
 */
async function onAccountHost<T>(
  connect: ConnectAccountHost,
  log: Logger,
  ended: AbortSignal,
  fallback: T,
  use: (connection: AccountConnection) => Promise<T>,
): Promise<T> {
  let session: AccountSession
  try {
    session = await connect(ended)
  } catch (error: unknown) {
    log.warn(`The Muse Code account host could not start: ${errorName(error)}`)
    return fallback
  }
  try {
    return (await unlessAborted(use(session.connection), ended)) ?? fallback
  } finally {
    try {
      await session.close()
    } catch (error: unknown) {
      log.warn(`The Muse Code account host did not close cleanly: ${errorName(error)}`)
    }
  }
}

/** One short-lived host asked `account/read`; undefined when it could not start or say. */
export async function probeAccount(
  connect: ConnectAccountHost,
  log: Logger,
  ended: AbortSignal,
): Promise<AccountState | undefined> {
  return await onAccountHost(connect, log, ended, undefined, readAccountState)
}

/**
 * MSP `account/logout` on a short-lived host, confirmed by `account/read`:
 * `confirmed` only on the captured signed-out answer; `unconfirmed` when the
 * host could not start or refused, or answered anything else: a stored
 * credential, `envKey` (`META_API_KEY`, which no logout can unset, masks
 * the stored lane), or a state never captured.
 */
export async function logOutAccount(
  connect: ConnectAccountHost,
  log: Logger,
  ended: AbortSignal,
): Promise<'confirmed' | 'unconfirmed'> {
  return await onAccountHost<'confirmed' | 'unconfirmed'>(
    connect,
    log,
    ended,
    'unconfirmed',
    async (connection) => {
      const answer = await requestAccount(connection, MUSE_ACCOUNT_LOGOUT)
      const after = answer === undefined ? undefined : await readAccountState(connection)
      // The state word only, and only in the shape of one: its vocabulary
      // is open (the review of PR #49).
      if (after === undefined || !isCapturedSignedOut(after)) {
        log.warn(
          after?.state === MUSE_ACCOUNT_STATES.envKey
            ? 'Muse Code runs on META_API_KEY, which hides whether account/logout cleared the stored sign-in'
            : `Muse Code did not confirm account/logout (${after === undefined ? 'no answer' : wireWordForLog(after.state)})`,
        )
        return 'unconfirmed'
      }
      log.info(`Muse Code signed out through account/logout (now ${after.state})`)
      return 'confirmed'
    },
  )
}

/**
 * The window's short-lived `account/read` and `account/logout` hosts, which
 * end together when it closes (the review of PR #49): a probe still waiting,
 * or one Cancel left behind, is closed rather than left running, and none
 * starts afterwards.
 */
export class AccountHosts {
  private readonly windowClosing = new AbortController()

  public constructor(
    private readonly connect: ConnectAccountHost,
    private readonly log: Logger,
  ) {}

  public async probe(): Promise<AccountState | undefined> {
    return await probeAccount(this.connect, this.log, this.windowClosing.signal)
  }

  public async logOut(): Promise<'confirmed' | 'unconfirmed'> {
    return await logOutAccount(this.connect, this.log, this.windowClosing.signal)
  }

  public close(): void {
    this.windowClosing.abort()
  }
}

/** Start a dedicated experimental MSP process. Keep it separate from chat. */
export async function connectAccountSession(
  backend: MuseCodeBackendManager,
  extensionVersion: string,
  log: Logger,
  workspaceRoot: string | undefined,
  signal: AbortSignal,
): Promise<AccountSession> {
  const isAborted = () => signal.aborted
  if (isAborted()) {
    throw new Error('The Muse Code account host was cancelled')
  }
  backend.invalidateLaunch()
  const resolution = backend.resolveLaunch()
  if (!resolution.ok) {
    throw new Error(resolution.reason)
  }
  let isStderrReported = false
  const handshake = spawnMspConnection({
    command: resolution.launch.command,
    args: resolution.launch.args,
    ...(workspaceRoot !== undefined && { cwd: workspaceRoot }),
    env: backend.childEnvironment(),
    onStderr: () => {
      if (isStderrReported) {
        return
      }

      log.warn('The Muse Code account host wrote to stderr')
      isStderrReported = true
    },
  })
  const cancelledConnect = Promise.withResolvers<typeof CANCELLED_CONNECT>()
  const onAbort = () => {
    cancelledConnect.resolve(CANCELLED_CONNECT)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (isAborted()) {
    onAbort()
  }
  try {
    const spawned = await Promise.race([
      withDeadline(
        handshake.initialize({
          clientInfo: { name: MSP_CLIENT_NAME, version: extensionVersion },
          capabilities: { experimentalApi: true, userInputDialogs: false },
        }),
        MSP_HANDSHAKE_TIMEOUT_MS,
        'The Muse Code account host did not start in time',
      ),
      cancelledConnect.promise,
    ])
    if (spawned === CANCELLED_CONNECT || isAborted()) {
      throw new Error('The Muse Code account host was cancelled')
    }
    if (!spawned.initializeResult.experimentalApi) {
      throw new Error('This Muse Code version does not offer its account methods')
    }
    return { connection: spawned.connection, close: () => spawned.close() }
  } catch (error: unknown) {
    await handshake.close()
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
