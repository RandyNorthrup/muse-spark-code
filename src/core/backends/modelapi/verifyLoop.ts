// The verify loop's pieces the Model API session puts together (M68, PLAN.md
// D49): what the host lends it (the settings, read at each use, and the
// editor's diagnostics and formatter), and how a finished check reads for
// the model and its row. The fix loop's rule and the state a user's input
// resets are the ledger's (verifyLedger.ts). The session itself asks the
// permission engine, runs the hooks and runs the commands. Pure.

import type { CheckSummary } from '../../../shared/agentEvents'
import {
  type CheckCommandSetting,
  type CheckOutcome,
  type CheckSkip,
  MODEL_TEXT,
  VERIFY_AUTHORIZE_ATTEMPTS,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { EditedFile, FileDiagnostics } from '../../verify/diagnosticsReport'
import { shellOutcome, type ShellResult } from './tools'

/** What the host lends the verify loop; undefined leaves it out. */
export interface VerifyHooks {
  /** `museSpark.diagnosticsAfterEdits`. */
  readonly isDiagnosticsOn: () => boolean
  /** `museSpark.checkCommands`, validated. */
  readonly checkCommands: () => readonly CheckCommandSetting[]
  /** `museSpark.formatOnEdit`. */
  readonly isFormatOnEdit: () => boolean
  /** Each file's diagnostics once its server settles, or why they were not read. */
  readonly diagnosticsAfterEdit: (
    files: readonly EditedFile[],
    signal: AbortSignal,
  ) => Promise<readonly FileDiagnostics[]>
  /** The text the file's formatter makes of what an edit wrote, or undefined. */
  readonly formatAfterEdit: (absolutePath: string, text: string) => Promise<string | undefined>
}

/** One check, finished or not run. */
export interface CheckRun {
  readonly summary: CheckSummary
  /** For the model and the row's body. */
  readonly text: string
}

const SKIP_REASONS: Readonly<Record<CheckSkip, string>> = {
  rejected: MODEL_TEXT.checkSkipRejected,
  hookDenied: MODEL_TEXT.checkSkipHookDenied,
  refused: MODEL_TEXT.checkSkipRefused,
  restricted: MODEL_TEXT.checkSkipRestricted,
  unsafePath: MODEL_TEXT.checkSkipUnsafePath,
  changed: MODEL_TEXT.checkSkipChanged,
  stopped: MODEL_TEXT.checkSkipStopped,
}

/** Why a command was not run, in the model's words, with the user's or the hook's own. */
export function skipReason(skip: CheckSkip, detail?: string): string {
  const reason = SKIP_REASONS[skip]
  return detail === undefined || detail.trim() === ''
    ? reason
    : fill(MODEL_TEXT.checkDetail, { reason, detail })
}

type FinishedOutcome = Exclude<CheckOutcome, 'notRun'>

/** How a finished command ended; one that could not start failed. */
export function outcomeOf(result: ShellResult): FinishedOutcome {
  if (result.isCancelled) {
    return 'cancelled'
  }
  if (result.isTimedOut) {
    return 'timedOut'
  }
  return result.exitCode === 0 ? 'passed' : 'failed'
}

const OUTCOME_LINES: Readonly<Record<FinishedOutcome, string>> = {
  passed: MODEL_TEXT.checkPassed,
  failed: MODEL_TEXT.checkFailed,
  timedOut: MODEL_TEXT.checkTimedOut,
  cancelled: MODEL_TEXT.checkCancelled,
}

/**
 * A check that ran: its line, the command, and what it printed with how it
 * ended, the output within `maxChars` (its share of the note's budget).
 */
export function finishedCheck(
  check: CheckCommandSetting,
  line: string,
  result: ShellResult,
  timeoutMs: number,
  maxChars: number,
): CheckRun {
  const outcome = outcomeOf(result)
  return {
    summary: { name: check.name, outcome },
    text: [
      fill(OUTCOME_LINES[outcome], { name: check.name }),
      `$ ${line}`,
      shellOutcome(result, timeoutMs, maxChars).output,
    ].join('\n'),
  }
}

/** A check that was not run, and why. */
export function skippedCheck(
  check: CheckCommandSetting,
  skip: CheckSkip,
  detail?: string,
): CheckRun {
  return {
    summary: {
      name: check.name,
      outcome: 'notRun',
      skip,
      ...(detail !== undefined && detail.trim() !== '' && { detail }),
    },
    text: fill(MODEL_TEXT.checkNotRun, { name: check.name, reason: skipReason(skip, detail) }),
  }
}

/** Why a verify command may not run. */
export interface Refusal {
  readonly skip: CheckSkip
  readonly detail?: string
}

/**
 * A verify command's permission, then its guard (then_run's: the file still
 * holds what the edit left), before it runs. A file that decides what the
 * command runs may be edited while this waits (a subagent's edit during the
 * guard's read): a session rule that answered then no longer holds, so the
 * command is authorized again, and guarded again (Grok's review of PR #54's
 * fourth round). The second time the rule no longer answers. Undefined when
 * the command may run, else why not.
 */
export async function authorizeThenGuard(steps: {
  /** Whether a file that decides what the command runs was edited since the user's message. */
  readonly isRuleLapsed: () => boolean
  readonly authorize: () => Promise<Refusal | undefined>
  readonly guard?: () => Promise<boolean>
}): Promise<Refusal | undefined> {
  for (let attempt = 0; attempt < VERIFY_AUTHORIZE_ATTEMPTS; attempt += 1) {
    const wasLapsed = steps.isRuleLapsed()
    const refusal = await steps.authorize()
    if (refusal !== undefined) {
      return refusal
    }
    if (steps.guard !== undefined && !(await steps.guard())) {
      return { skip: 'changed' }
    }
    if (wasLapsed || !steps.isRuleLapsed()) {
      return undefined
    }
  }
  return undefined
}

/** The checks' part of a message: a heading and each check. */
export function checksSection(runs: readonly CheckRun[]): string {
  return [MODEL_TEXT.verifyChecksHeading, ...runs.map((run) => run.text)].join('\n\n')
}
