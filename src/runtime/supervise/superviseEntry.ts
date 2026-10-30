// dist/supervise.js (M104 lane H): `supervise` and `stop`, and the language
// server's `muse.stop`, loaded only by those. Records live in the agent's
// owner-only `supervised` folder; a folder that is not private refuses both
// commands (`PrivateRootRefused`), with no other place to fall back to.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import type { Logger } from '../../host/logger'
import {
  CLI_EXIT,
  SUPERVISED_FOLDER,
  SUPERVISED_OWNER_VARIABLE,
  UI_TEXT,
} from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { plural, setUiText } from '../../shared/l10n/text'
import { openPrivateRoot, PrivateRootRefused } from '../privateDirectory'
import { stopSupervised, type StopOutcome } from './stop'
import { SuperviseEndpointError, superviseRuntime } from './supervisor'

const OWNER_DIRECTORY_MODE = 0o700

export interface SuperviseRuntimeDeps {
  /** The agent's data folder (dataFolder.ts). */
  readonly dataFolder: string
  /** The folder the run starts in, or whose runs stop; links resolved. */
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly table: UiText
  readonly locale: string
  readonly log: Logger
}

/**
The sentence for a refusal the person can act on: records that cannot be
kept private, or a data folder path too long for the control socket.
Anything else is not a refusal and keeps its own report.
*/
function refusalOf(error: unknown): string | undefined {
  if (error instanceof PrivateRootRefused) return UI_TEXT.supervision.recordsFolderNotPrivate
  return error instanceof SuperviseEndpointError
    ? UI_TEXT.supervision.endpointPathTooLong
    : undefined
}

async function supervisedRoot(dataFolder: string): Promise<string> {
  // A first command may come before anything made the data folder: made
  // owner-only, so the private folder's ancestor check holds.
  await mkdir(dataFolder, { recursive: true, mode: OWNER_DIRECTORY_MODE })
  const root = await openPrivateRoot(path.join(dataFolder, SUPERVISED_FOLDER))
  return root.path
}

/** `supervise <command>`: runs the runtime command as a child this process owns whole. */
export async function runSupervise(
  args: readonly string[],
  deps: SuperviseRuntimeDeps & {
    readonly entry: string
    readonly stdin: Readable
    readonly stdout: Writable
    readonly stderr: Writable
  },
): Promise<number> {
  setUiText(deps.table, deps.locale)
  try {
    return await superviseRuntime({
      args,
      entry: deps.entry,
      cwd: deps.cwd,
      env: deps.env,
      root: await supervisedRoot(deps.dataFolder),
      stdin: deps.stdin,
      stdout: deps.stdout,
      stderr: deps.stderr,
      log: deps.log,
    })
  } catch (error: unknown) {
    const refusal = refusalOf(error)
    if (refusal === undefined) throw error
    deps.log.error(refusal)
    return CLI_EXIT.failure
  }
}

/** Stops every supervised run started in the folder; the caller's own last. */
export async function stopWorkspace(deps: SuperviseRuntimeDeps): Promise<StopOutcome> {
  setUiText(deps.table, deps.locale)
  return await stopSupervised({
    root: await supervisedRoot(deps.dataFolder),
    cwd: deps.cwd,
    ownOwner: deps.env[SUPERVISED_OWNER_VARIABLE],
    log: deps.log,
  })
}

/** `stop`: the outcome in words, and exit 1 when nothing stopped or a run did not. */
export async function runStop(
  deps: SuperviseRuntimeDeps & { readonly print: (line: string) => void },
): Promise<number> {
  let outcome: StopOutcome
  try {
    outcome = await stopWorkspace(deps)
  } catch (error: unknown) {
    const refusal = refusalOf(error)
    if (refusal === undefined) throw error
    deps.print(refusal)
    return CLI_EXIT.failure
  }
  const { stopped, failed } = outcome
  if (stopped === 0 && failed === 0) {
    deps.print(UI_TEXT.supervision.stopNone)
    return CLI_EXIT.failure
  }
  if (stopped > 0) deps.print(plural(UI_TEXT.supervision.stopped, stopped))
  if (failed > 0) deps.print(plural(UI_TEXT.supervision.stopFailed, failed))
  return failed === 0 ? CLI_EXIT.ok : CLI_EXIT.failure
}
