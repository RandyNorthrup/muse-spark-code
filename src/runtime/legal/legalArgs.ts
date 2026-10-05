// The headless `legal` command's arguments (M97 lane R, PLAN.md D76): pure
// validation in, options or the usage reason out. `parseArgs` stays in
// cliArgs.ts; this file decides what the values mean. The surface is exactly
// the brief's: `legal [--format text|json] [--out <file>] [--registry]`.

import { LEGAL_PATH_MAX_CHARS, UI_TEXT } from '../../shared/constants'

export type LegalFormat = 'text' | 'json'

export interface LegalOptions {
  readonly format: LegalFormat
  readonly out: string | undefined
  readonly registry: boolean
}

export type LegalArgs =
  | { readonly ok: true; readonly options: LegalOptions }
  | { readonly ok: false; readonly reason: string }

function isFormat(value: unknown): value is LegalFormat {
  return value === 'text' || value === 'json'
}

/**
 * What `legal`'s flags mean. No positional takes part: the scan covers the
 * workspace the command runs in, and anything else is a usage error.
 */
export function parseLegalArgs(
  values: Readonly<Record<string, unknown>>,
  positionals: readonly string[],
): LegalArgs {
  if (positionals.length > 0) return { ok: false, reason: UI_TEXT.legalUsage }
  const format = values['format'] ?? 'text'
  if (!isFormat(format)) return { ok: false, reason: UI_TEXT.legalFormatInvalid }
  const out = values['out']
  return out !== undefined &&
    (typeof out !== 'string' || out.length === 0 || out.length > LEGAL_PATH_MAX_CHARS)
    ? { ok: false, reason: UI_TEXT.legalUsage }
    : { ok: true, options: { format, out, registry: values['registry'] === true } }
}
