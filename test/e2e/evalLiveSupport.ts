// The live harnesses use the ACP agent's existing OS credential entry in
// this process. No key comes from arguments, environment or a fixture file.
// Native entry access is deferred until the owner enables the live test.

import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { EVAL_TASKS, type EvalTask } from '../../src/core/eval/tasks'
import { listWorkspaceFiles } from '../../src/core/eval/workspace'
import {
  CredentialStore,
  isValidModelApiKey,
  type SecretStore,
} from '../../src/host/auth/credentialStore'
import { createToolIo } from '../../src/host/backend/toolIo'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { keyringSecretStore } from '../../src/runtime/keyStore'
import { EVAL_TURN_TIMEOUT_MS, EVAL_VERIFY_TIMEOUT_MS } from '../../src/shared/constants'

const LEGACY_KEY_VARIABLE = 'MUSE_LIVE_MODEL_API_KEY'
const NOT_ENABLED = 'Live Model API tests are not enabled.'
const STORE_UNAVAILABLE =
  'No Model API key is available from the operating system credential store. Use muse-spark-code-acp auth set before enabling live tests.'

/**
 * Reject the old transport without reading, echoing or deleting its value.
 * Only an enabled run starts processes the model steers, so only it refuses:
 * a stale variable must not fail the default test run, which collects these files.
 */
export function assertNoLiveKeyEnvironment(env: NodeJS.ProcessEnv, isEnabled: boolean): void {
  if (isEnabled && Object.hasOwn(env, LEGACY_KEY_VARIABLE)) {
    throw new Error(
      'MUSE_LIVE_MODEL_API_KEY is not supported. Remove that environment variable and use muse-spark-code-acp auth set for the operating system credential store.',
    )
  }
}

export interface EvalLiveCredentials {
  readonly accountId: string
  readonly apiKey: () => Promise<string | undefined>
  readonly redact: (text: string) => string
  readonly contains: (value: string | Uint8Array) => boolean
}

async function liveSecretStore(): Promise<SecretStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  return keyringSecretStore(
    (service, account) => new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
  )
}

/** One live run stays bound to its initial stored account; replacement stops admission. */
export async function loadEvalLiveCredentials(
  isEnabled: boolean,
  secrets?: SecretStore,
): Promise<EvalLiveCredentials> {
  if (!isEnabled) {
    throw new Error(NOT_ENABLED)
  }
  let credentials: CredentialStore
  let key: string
  try {
    credentials = new CredentialStore(
      secrets ?? (await liveSecretStore()),
      () => {
        // Native error text is replaced by the fixed failure below, never logged.
      },
      'the operating system credential store',
    )
    const stored = await credentials.getApiKey()
    if (stored === undefined || !isValidModelApiKey(stored)) {
      throw new Error(STORE_UNAVAILABLE)
    }
    key = stored.trim()
  } catch {
    throw new Error(STORE_UNAVAILABLE)
  }
  const needle = Buffer.from(key)
  return {
    accountId: createHash('sha256').update(key).digest('hex'),
    apiKey: async () => {
      try {
        const current = await credentials.getApiKey()
        return current?.trim() === key ? key : undefined
      } catch {
        return undefined
      }
    },
    redact: (text) => text.replaceAll(key, '[key]'),
    contains: (value) =>
      typeof value === 'string' ? value.includes(key) : Buffer.from(value).includes(needle),
  }
}

export interface LiveToolIoOptions {
  readonly workspace: string
  /** The process's environment, read per command as the extension does. */
  readonly env: () => NodeJS.ProcessEnv
  /** The built search worker (`npm run build:dev`). */
  readonly searchWorkerPath: string
  readonly log: (message: string) => void
  /** Windows: the job helper's assembly (M27); undefined elsewhere. */
  readonly shellJobAssembly: (() => Promise<string | undefined>) | undefined
}

/**
 * The tools' file and shell access for a live harness. A shell command the
 * model asks for is allowed without a person reading it, so it gets the
 * environment without any credential variable (`*_API_KEY` and the named
 * ones), as every process the ACP agent starts does: another provider's key
 * the owner keeps in his shell must not reach a tool's output, Meta or the
 * report.
 */
export function liveToolIo(options: LiveToolIoOptions): ToolIo {
  return createToolIo({
    platform: process.platform,
    listFiles: () => listWorkspaceFiles(options.workspace),
    systemRoot: process.env['SystemRoot'],
    env: () => withoutCredentials(options.env()),
    searchWorkerPath: options.searchWorkerPath,
    log: options.log,
    unsavedFiles: () => [],
    shellJobAssembly: options.shellJobAssembly,
  })
}

const selectionSchema = z.object({
  MUSE_EVAL_TASKS: z.optional(z.string()),
  MUSE_EVAL_REPORT: z.optional(z.string()),
})

export interface LiveEvalSelection {
  /** The tasks MUSE_EVAL_TASKS names, in task-set order; every task when it is unset. */
  readonly tasks: readonly EvalTask[]
  /** MUSE_EVAL_REPORT: a path without extension for the report's .json and .md. */
  readonly reportPath: string | undefined
}

/**
 * What an enabled live run evaluates; an unknown task id stops it. Read only
 * inside the enabled test, never while the suite is skipped: a stale or
 * mistyped selection must not fail the default run, which collects this file.
 */
export function liveEvalSelection(env: NodeJS.ProcessEnv, isEnabled: boolean): LiveEvalSelection {
  if (!isEnabled) {
    throw new Error(NOT_ENABLED)
  }
  const selection = selectionSchema.parse({
    MUSE_EVAL_TASKS: env['MUSE_EVAL_TASKS'],
    MUSE_EVAL_REPORT: env['MUSE_EVAL_REPORT'],
  })
  const wanted = (selection.MUSE_EVAL_TASKS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const unknown = wanted.filter((id) => EVAL_TASKS.every((task) => task.id !== id))
  if (unknown.length > 0) {
    throw new Error(`unknown eval tasks: ${unknown.join(', ')}`)
  }
  return {
    tasks: wanted.length === 0 ? EVAL_TASKS : EVAL_TASKS.filter((task) => wanted.includes(task.id)),
    reportPath: selection.MUSE_EVAL_REPORT,
  }
}

/** Outer deadline covers every task/arm run; each turn and verifier keeps its own limit. */
export function evalRunTimeoutMs(taskCount: number, armCount: number, marginMs: number): number {
  const counts = [taskCount, armCount, marginMs]
  const deadline = taskCount * armCount * (EVAL_TURN_TIMEOUT_MS + EVAL_VERIFY_TIMEOUT_MS) + marginMs
  if (
    counts.some((count) => !Number.isSafeInteger(count)) ||
    taskCount < 1 ||
    armCount < 1 ||
    marginMs < 0 ||
    !Number.isSafeInteger(deadline)
  ) {
    throw new Error(
      'The live eval deadline requires valid task and arm counts and a finite margin.',
    )
  }
  return deadline
}
