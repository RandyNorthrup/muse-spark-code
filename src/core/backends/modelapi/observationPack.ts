// Observation packing (M73, PLAN.md D49): a Model API implementation of
// NVIDIA SoL-Pi's ObservationPack design (upstream MIT). Design reference:
// https://github.com/NVlabs/SoL-Pi/tree/1559b5cb12c72da4a485bc50fe326586b216fb19/src/sol-pi/extensions/observation-pack
// This integration uses session call ids and character-based recall;
// SoL-Pi's Pi extension uses content-addressed disk objects and UTF-8 bytes.
// A tool result over `OBS_PACK_THRESHOLD_CHARS` rides whole
// for its first `OBS_PACK_WHOLE_SENDS` requests, then as a placeholder naming
// its id (the output's `call_id`), its size and its first and last lines.
// The swap is sticky: once packed, an output stays packed. `recall_output`
// pages the original back, each page framed as untrusted tool data between
// fresh markers and naming the tool that returned it; originals are kept
// with the session (this store, reset when a compaction drops them from the
// replay; the replay itself always keeps them). The ledger counts the
// estimated tokens each packed send leaves out, and a resumed session
// carries its total on.
//
// The packing store itself (`ObservationPack`, in `observationPacking.ts`)
// loads deferred with the Model API backend's per-call helpers, on the
// first turn of a session that packs; this module keeps the recall tool
// definition and the helpers every turn reads. No `vscode` here.

import { createHash } from 'node:crypto'
import { MODEL_API_TOOLS, OBS_PACK_PAGE_CHARS } from '../../../shared/constants'
import type { FunctionToolDefinition } from './schemas'

export { estimatePackTokens } from './toolResultBound'

/** `recall_output`, offered only while packing runs. */
export const RECALL_TOOL_DEFINITION: FunctionToolDefinition = {
  type: 'function',
  name: MODEL_API_TOOLS.recallOutput,
  description:
    'Read back a packed tool output by its id, one page at a time. A packed output names its id; pass it with a character offset (0 for the first page), or search for a case-sensitive literal string at or after that offset.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The packed output id from its placeholder' },
      offset: { type: 'integer', description: 'Characters to skip; 0 reads from the start' },
      search: {
        type: 'string',
        minLength: 1,
        maxLength: OBS_PACK_PAGE_CHARS,
        description:
          'Case-sensitive literal text to find at or after offset; the page starts at the first match',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  strict: false,
}

/** Estimated tokens for `chars` characters (the ledger's rule of thumb; lives in toolResultBound.ts, beside the bound). */

/**
TOOLCAP: a background completion note's recall id for its text. The host
registers cut notes under this id too, so their spills page back under
the same id the placeholder names.
*/
export function backgroundNoteId(text: string): string {
  return `background-${createHash('sha256').update(text).digest('hex')}`
}
