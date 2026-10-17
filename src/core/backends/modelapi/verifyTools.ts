// The verify loop's tool surface on the Model API backend (M68, PLAN.md
// D49): `run_checks`, offered while the user names check commands and the
// shell is available, and `then_run` on `write_file` and `edit_file`: one
// command run right after the edit, in the same call (SoL-Pi's Action
// Fusion, reimplemented here from its description, not ported).

import * as z from 'zod/mini'
import {
  type CheckCommandSetting,
  THEN_RUN_ARGUMENT,
  VERIFY_TOOLS,
} from '../../../shared/constants'
import { checkListText } from '../../verify/checkCommands'

const runChecksArgs = z.object({
  names: z.optional(z.array(z.string())),
  paths: z.optional(z.array(z.string())),
})

type RunChecksArgs = z.infer<typeof runChecksArgs>

/** A `run_checks` call's arguments, or why they are unusable. */
export function parseRunChecks(
  argsJson: string,
):
  | { readonly ok: true; readonly args: RunChecksArgs }
  | { readonly ok: false; readonly reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(argsJson)
  } catch {
    return { ok: false, reason: 'arguments are not valid JSON' }
  }
  const parsed = runChecksArgs.safeParse(raw)
  return parsed.success
    ? { ok: true, args: parsed.data }
    : { ok: false, reason: `invalid arguments: ${z.prettifyError(parsed.error)}` }
}

const thenRunArgs = z.object({ [THEN_RUN_ARGUMENT]: z.unknown() })

/** An edit call's `then_run`: absent, one command line, or present but unusable. */
export type ThenRunRequest =
  | { readonly kind: 'absent' }
  | { readonly kind: 'run'; readonly command: string }
  | { readonly kind: 'invalid' }

/**
 * The command an edit call's `then_run` names, trimmed (M101): a value that
 * is present but not a string is reported, never silently dropped. An empty
 * line is no command.
 */
export function thenRunOf(argsJson: string): ThenRunRequest {
  let raw: unknown
  try {
    raw = JSON.parse(argsJson)
  } catch {
    // The edit tool itself refuses arguments that are not JSON.
    return { kind: 'absent' }
  }
  const parsed = thenRunArgs.safeParse(raw)
  const value = parsed.success ? parsed.data[THEN_RUN_ARGUMENT] : undefined
  if (value === undefined) {
    return { kind: 'absent' }
  }
  if (typeof value !== 'string') {
    return { kind: 'invalid' }
  }
  const command = value.trim()
  return command === '' ? { kind: 'absent' } : { kind: 'run', command }
}

export const THEN_RUN_PROPERTY = {
  [THEN_RUN_ARGUMENT]: {
    type: 'string',
    description:
      'Optional: one shell command to run right after this edit, such as the test of the code you changed. It runs as the shell tool runs a command (asking the user where that would ask), only if the file still holds what this edit wrote, and its output comes back in this result.',
  },
} as const

export interface VerifyToolDefinition {
  readonly name: string
  readonly description: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly required: readonly string[]
}

/** `run_checks`, naming the checks the user configured. */
export function runChecksDefinition(checks: readonly CheckCommandSetting[]): VerifyToolDefinition {
  return {
    name: VERIFY_TOOLS.runChecks,
    description: `Run the user's check commands (lint, tests, type checks) and read their results. Each runs as the shell tool runs a command, asking the user where that would ask. The checks: ${checkListText(checks)}.`,
    properties: {
      names: {
        type: 'array',
        items: { type: 'string', enum: checks.map((check) => check.name) },
        description: 'The checks to run; all of them when omitted.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Workspace-relative files for the checks that check changed files only; the files you edited in this turn when omitted.',
      },
    },
    required: [],
  }
}
