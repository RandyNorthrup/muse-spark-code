// `/legal …` typed in the prompt (M97, PLAN.md D76), and the scan input it
// becomes on the wire to the host:
//
//   /legal                 the whole workspace, under the configured header policy
//   /legal <path> …        an explicit file subset (workspace-relative)
//
// Words after `/legal` are paths, never options: a word starting with a dash
// is refused as command syntax; it never becomes a model request. Bounds
// come from lane 0's contract: a word too long for a
// path, or more words than a subset may name, is invalid command syntax.
// Pure; the webview posts the input instead of sending a message.

import { LEGAL_PATH_MAX_CHARS, LEGAL_SCAN_PATHS_MAX, LEGAL_SLASH_COMMAND } from './constants'
import { legalScanInputSchema, type LegalScanInput } from './legal'

const PROMPT = new RegExp(String.raw`^\/${LEGAL_SLASH_COMMAND}(?:\s+([\s\S]*))?$`)
const WORDS = /\s+/
const OPTION_DASH = '-'

/** Recognize the reserved command even when its arguments are invalid. */
export function isLegalPrompt(text: string): boolean {
  return PROMPT.test(text.trim())
}

/**
 * The scan a prompt asks for, or undefined for any other text. The result
 * always satisfies lane 0's input schema: bounds are checked here, so the
 * host is never sent more than the schema allows.
 */
export function parseLegalPrompt(text: string): LegalScanInput | undefined {
  const match = PROMPT.exec(text.trim())
  if (match === null) {
    return undefined
  }
  const rest = (match[1] ?? '').trim()
  if (rest === '') {
    return {}
  }
  const paths = rest.split(WORDS)
  if (
    paths.length > LEGAL_SCAN_PATHS_MAX ||
    paths.some((word) => word.length === 0 || word.length > LEGAL_PATH_MAX_CHARS)
  ) {
    return undefined
  }
  if (paths.some((word) => word.startsWith(OPTION_DASH))) {
    return undefined
  }
  const input: LegalScanInput = { paths }
  return legalScanInputSchema.safeParse(input).success ? input : undefined
}

/** The prompt that asks for `input`: what its palette row puts in the prompt. */
export function legalCommandText(input: LegalScanInput): string {
  const words: string[] = [`/${LEGAL_SLASH_COMMAND}`, ...(input.paths ?? [])]
  return words.join(' ')
}
