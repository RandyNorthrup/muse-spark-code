// A `recall_output` result (M73) taken apart: the lead naming the packed
// output and its tool, the frame's fresh marker, and the slice between the
// markers exactly as the store returned it.

import { MODEL_API_MODEL_TEXT } from '../../../src/shared/constants'
import { fill } from '../../../src/shared/l10n/text'

const RECALLED_OPEN = /^<<<recalled output ([0-9a-f]+)>>>$/mu

export interface RecalledParts {
  /** Everything before the opening marker: the facts and the untrusted notice. */
  readonly lead: string
  readonly marker: string
  readonly page: string
}

/**
 * The page may hold any text, a marker-like line included; the frame is the
 * first opening marker and the closing marker that ends the output.
 */
export function recalledParts(text: string): RecalledParts {
  const open = RECALLED_OPEN.exec(text)
  const marker = open?.[1]
  if (open === null || marker === undefined) {
    throw new Error('the recalled output has no opening marker')
  }
  const close = `\n${fill(MODEL_API_MODEL_TEXT.packRecalledClose, { marker })}`
  if (!text.endsWith(close)) {
    throw new Error('the recalled output does not end with its closing marker')
  }
  return {
    lead: text.slice(0, open.index),
    marker,
    page: text.slice(open.index + open[0].length + 1, text.length - close.length),
  }
}
