import { parseArgs } from 'node:util'
import { UI_TEXT } from '../../shared/constants'

export interface TuiOptions {
  screenReader: boolean
  noColor: boolean
  /** TD: absent unless the flag passed; capabilities default it to full motion. */
  reducedMotion?: boolean
  /** TD: absent unless the flag passed; capabilities default it to plain text. */
  nerdFont?: boolean
}

/** Option parsing fails with parseArgs TypeErrors. */
function isParseArgsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'TypeError' &&
    'code' in error &&
    typeof error.code === 'string'
  )
}

/** T-LAUNCH plugs this strict subcommand parser into cliArgs without altering ACP. */
export function parseTuiArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; options: TuiOptions } | { ok: false; reason: string } {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        'screen-reader': { type: 'boolean' },
        'no-color': { type: 'boolean' },
        'reduced-motion': { type: 'boolean' },
        'nerd-font': { type: 'boolean' },
      },
    })
    if (positionals.length > 0) return { ok: false, reason: UI_TEXT.tuiUsage }
    return {
      ok: true,
      options: {
        screenReader: values['screen-reader'] === true,
        noColor: values['no-color'] === true || env['NO_COLOR'] !== undefined,
        ...(values['reduced-motion'] === true && { reducedMotion: true }),
        ...(values['nerd-font'] === true && { nerdFont: true }),
      },
    }
  } catch (error: unknown) {
    // Option parsing only throws parseArgs Errors; anything else surfaces.
    if (!isParseArgsError(error)) throw error
    return { ok: false, reason: UI_TEXT.tuiUsage }
  }
}
