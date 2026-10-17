// The user's check commands (M68, PLAN.md D49): `museSpark.checkCommands`,
// validated, and the command line each one runs with. A check that asks to
// be scoped gets files after `--`, each quoted as one argument for the shell
// the tool runs (PowerShell on Windows, bash elsewhere). A path is refused
// rather than passed when it could reach the program as anything but one
// file name (the M68 review):
//
// - it starts like an option (`-`) or a response file (`@`);
// - it holds a control character (a second line, an escape);
// - on Windows, it holds `"`, which Windows PowerShell 5.1 does not escape
//   when it quotes an argument with a space for a native program, or `&`,
//   `|`, `<`, `>`, `^`, `%` or `!`, which cmd.exe re-reads when the program
//   is a `.cmd` or `.bat` (`npm`, `yarn`, `gradlew.bat`, `mvnw.cmd`).
//
// The callers pass only files that exist in the workspace. The guidance Muse
// Code gets with each turn is built here too. Pure.

import * as z from 'zod/mini'
import {
  CHECK_COMMAND_MAX_CHARS,
  CHECK_COMMANDS_MAX,
  CHECK_DEFAULT_TIMEOUT_SECONDS,
  CHECK_MAX_TIMEOUT_SECONDS,
  CHECK_NAME_MAX_CHARS,
  CHECK_PATHS_SEPARATOR,
  type CheckCommandSetting,
  HARNESS_NOTE_TAG,
  MILLISECONDS_PER_SECOND,
  MODEL_TEXT,
  UNSAFE_ARGUMENT_START,
  WINDOWS_ARGUMENT_SYNTAX,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { posixQuoted, powerShellQuoted } from '../shellQuote'

export const checkCommandSchema = z.object({
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(CHECK_NAME_MAX_CHARS)),
  command: z.string().check(z.trim(), z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS)),
  changedFiles: z.optional(z.boolean()),
  timeoutSeconds: z.optional(z.int().check(z.positive(), z.lte(CHECK_MAX_TIMEOUT_SECONDS))),
})

/** The setting's whole list: at most CHECK_COMMANDS_MAX, each name once. */
export const checkCommandsSchema = z.array(checkCommandSchema).check(
  z.maxLength(CHECK_COMMANDS_MAX),
  z.refine((checks) => new Set(checks.map((check) => check.name)).size === checks.length, {
    message: 'each check needs a name of its own',
  }),
)

// A control character (a line break, a tab, an escape) in a path.
const CONTROL_CHARACTER = /\p{Cc}/u

export type CheckLine =
  { readonly ok: true; readonly line: string } | { readonly ok: false; readonly reason: string }

/** One path as one argument of the shell the tool runs. */
function shellArgument(text: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? powerShellQuoted(text) : posixQuoted(text)
}

/** Whether a path can follow `--` as one plain file name on this platform (see above). */
export function isSafeCheckPath(relativePath: string, platform: NodeJS.Platform): boolean {
  return (
    relativePath !== '' &&
    !UNSAFE_ARGUMENT_START.test(relativePath) &&
    !CONTROL_CHARACTER.test(relativePath) &&
    !(platform === 'win32' && WINDOWS_ARGUMENT_SYNTAX.test(relativePath))
  )
}

/**
 * The line a check runs: its command as the user wrote it, and for a scoped
 * check with files to check, `--` and each path quoted. A scoped check with
 * no files runs as written (the whole project).
 */
export function checkCommandLine(
  check: CheckCommandSetting,
  paths: readonly string[],
  platform: NodeJS.Platform,
): CheckLine {
  if (check.changedFiles !== true || paths.length === 0) {
    return { ok: true, line: check.command }
  }
  if (paths.some((relativePath) => !isSafeCheckPath(relativePath, platform))) {
    return { ok: false, reason: MODEL_TEXT.checkSkipUnsafePath }
  }
  const quoted = paths.map((relativePath) => shellArgument(relativePath, platform))
  return { ok: true, line: [check.command, CHECK_PATHS_SEPARATOR, ...quoted].join(' ') }
}

/** The check's time cap in milliseconds. */
export function checkTimeoutMs(check: CheckCommandSetting): number {
  return (check.timeoutSeconds ?? CHECK_DEFAULT_TIMEOUT_SECONDS) * MILLISECONDS_PER_SECOND
}

/** `name` (`command`), as the model reads a check. */
export function checkListText(checks: readonly CheckCommandSetting[]): string {
  return checks.map((check) => `${check.name} (\`${check.command}\`)`).join(', ')
}

/**
 * What Muse Code is told with each turn (M68): check the diagnostics of the
 * files it edits through the `ide` server (only when the session has it),
 * and run the user's checks. It reads them itself and runs the checks
 * through its own shell and approvals; undefined when there is nothing to
 * say.
 */
export function verifyGuidance(
  isDiagnosticsOn: boolean,
  checks: readonly CheckCommandSetting[],
): string | undefined {
  const sentences = [
    ...(isDiagnosticsOn ? [MODEL_TEXT.verifyGuidanceDiagnostics] : []),
    ...(checks.length === 0
      ? []
      : [fill(MODEL_TEXT.verifyGuidanceChecks, { checks: checkListText(checks) })]),
  ]
  return sentences.length === 0
    ? undefined
    : `<${HARNESS_NOTE_TAG}>${sentences.join(' ')}</${HARNESS_NOTE_TAG}>`
}
