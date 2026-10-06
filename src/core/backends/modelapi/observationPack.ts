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
// The host builds this store only while its `observationPacking` dep is on,
// and never for a subagent. No `vscode` here.

import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  MODEL_API_MODEL_TEXT,
  MODEL_API_TOOLS,
  OBS_PACK_CHARS_PER_TOKEN,
  OBS_PACK_HEAD_LINES,
  OBS_PACK_MARKER_BYTES,
  OBS_PACK_PAGE_CHARS,
  OBS_PACK_RECALL_ID_LIMIT,
  OBS_PACK_TAIL_LINES,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { FunctionToolDefinition, InputItem } from './schemas'

const recallOutputArgs = z.object({
  id: z.string(),
  offset: z.optional(z.number()),
  search: z.optional(z.string().check(z.minLength(1), z.maxLength(OBS_PACK_PAGE_CHARS))),
})

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

/**
 * What a `recall_output` call returns; the host reports it as the tool
 * outcome. `output` is the model's (English, MODEL_API_MODEL_TEXT); `visibleOutput`
 * and `failureReason` are the row's, in the display language, with the
 * recalled text itself shown as it was.
 */
export interface RecallOutcome {
  readonly output: string
  readonly visibleOutput: string
  readonly failureReason?: string
}

function failure(modelReason: string, visibleReason: string): RecallOutcome {
  return {
    output: `Error: ${modelReason}`,
    visibleOutput: visibleReason,
    failureReason: visibleReason,
  }
}

/** Fresh random hexadecimal for one recalled page's markers. */
function newMarker(): string {
  return randomBytes(OBS_PACK_MARKER_BYTES).toString('hex')
}

/** Estimated tokens for `chars` characters (the ledger's rule of thumb). */
export function estimatePackTokens(chars: number): number {
  return Math.ceil(chars / OBS_PACK_CHARS_PER_TOKEN)
}

/** The text's lines, a trailing line break not counting as a line. */
function packLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** A code point past the Basic Multilingual Plane starts at `index - 1`. */
const LAST_BMP_CODE_POINT = 0xff_ff

/** `index` moved back off the middle of a surrogate pair, so no character is split. */
function packBoundary(text: string, index: number): number {
  const before = text.codePointAt(index - 1) ?? 0
  return before > LAST_BMP_CODE_POINT ? index - 1 : index
}

interface PackedOutput {
  readonly text: string
  readonly lineCount: number
  /** The tool that returned it, named by its call; undefined when that call is gone. */
  readonly tool: string | undefined
  sends: number
  isPacked: boolean
}

/** One session's packed outputs and its savings ledger. */
export class ObservationPack {
  private readonly outputs = new Map<string, PackedOutput>()
  /**
   * The outputs' ids in arrival order, for the unknown-id error: a list of
   * its own, as the Map's key iterator has no `toArray` on Node 20 (VS Code
   * 1.99's host).
   */
  private readonly ids: string[] = []
  private readonly placeholders = new WeakMap<InputItem, PackedOutput>()
  /**
   * The requests already counted: an HTTP retry sends the same input again,
   * and is still one request, so an output is not packed a request early.
   */
  private readonly counted = new WeakSet<readonly InputItem[]>()
  private tokensAvoided = 0

  private register(callId: string, text: string, tool: string | undefined): PackedOutput {
    const known = this.outputs.get(callId)
    if (known !== undefined) {
      return known
    }
    const entry: PackedOutput = {
      text,
      lineCount: packLines(text).length,
      tool,
      sends: 0,
      isPacked: false,
    }
    this.outputs.set(callId, entry)
    this.ids.push(callId)
    return entry
  }

  private placeholder(callId: string, entry: PackedOutput, original: InputItem): InputItem {
    const all = packLines(entry.text)
    let head = all.slice(0, OBS_PACK_HEAD_LINES)
    // Past the head, never overlapping it.
    let tail = all.slice(Math.max(head.length, all.length - OBS_PACK_TAIL_LINES))
    let text = this.render(callId, entry, head, tail)
    while (text.length > OBS_PACK_THRESHOLD_CHARS && (head.length > 1 || tail.length > 0)) {
      if (tail.length > 0) {
        tail = tail.slice(0, -1)
      } else {
        head = head.slice(0, -1)
      }
      text = this.render(callId, entry, head, tail)
    }
    if (text.length > OBS_PACK_THRESHOLD_CHARS) {
      // Bound the complete placeholder, including its metadata and elision.
      const metadata = this.render(callId, entry, ['…'], [])
      const available = Math.max(0, OBS_PACK_THRESHOLD_CHARS - metadata.length)
      const first = head[0] ?? ''
      const cut = first.slice(0, packBoundary(first, Math.min(available, first.length)))
      head = [`${cut}…`]
      tail = []
      text = this.render(callId, entry, head, tail)
    }
    if (text.length > OBS_PACK_THRESHOLD_CHARS || text.length >= entry.text.length) {
      return original
    }
    const item: InputItem = { type: 'function_call_output', call_id: callId, output: text }
    this.placeholders.set(item, entry)
    return item
  }

  private render(
    callId: string,
    entry: PackedOutput,
    head: readonly string[],
    tail: readonly string[],
  ): string {
    return fill(MODEL_API_MODEL_TEXT.packPlaceholder, {
      id: callId,
      chars: String(entry.text.length),
      lines: String(entry.lineCount),
      tokens: String(estimatePackTokens(entry.text.length)),
      headCount: String(head.length),
      tailCount: String(tail.length),
      head: head.join('\n'),
      tail: tail.join('\n'),
    })
  }

  /**
   * The request's input with packable outputs projected: whole while an
   * output is still new, a placeholder once it packed. Registers outputs it
   * has not seen; counting happens in `noteSent`, once per request sent.
   */
  public project(input: readonly InputItem[]): InputItem[] {
    // Each output's tool, named by its call in the same request.
    const tools = new Map<string, string>()
    for (const item of input) {
      if (item.type === 'function_call') {
        tools.set(item.call_id, item.name)
      }
    }
    return input.map((item) => {
      if (item.type !== 'function_call_output' || typeof item.output !== 'string') {
        return item
      }
      if (item.output.length <= OBS_PACK_THRESHOLD_CHARS) {
        return item
      }
      const entry = this.register(item.call_id, item.output, tools.get(item.call_id))
      return entry.isPacked ? this.placeholder(item.call_id, entry, item) : item
    })
  }

  /**
   * Accounts one request actually sent, at the client's final send boundary:
   * whole sends count toward the swap, packed sends add what they left out
   * to the ledger. The ledger counts what the placeholder still costs out,
   * so it matches the tokens left out of the request. A retried attempt of
   * the same request is not counted again.
   */
  public noteSent(input: readonly InputItem[]): void {
    if (this.counted.has(input)) {
      return
    }
    this.counted.add(input)
    for (const item of input) {
      if (item.type !== 'function_call_output' || typeof item.output !== 'string') {
        continue
      }
      const packed = this.placeholders.get(item)
      if (packed !== undefined) {
        this.tokensAvoided +=
          estimatePackTokens(packed.text.length) - estimatePackTokens(item.output.length)
        continue
      }
      const entry = this.outputs.get(item.call_id)
      if (entry === undefined || entry.isPacked) {
        continue
      }
      entry.sends += 1
      if (entry.sends >= OBS_PACK_WHOLE_SENDS) {
        entry.isPacked = true
      }
    }
  }

  /** Whether the item is a placeholder this store made (kept out of the replay). */
  public isPlaceholder(item: InputItem): boolean {
    return this.placeholders.has(item)
  }

  /** The estimated tokens packed sends have left out this session. */
  public savings(): number {
    return this.tokensAvoided
  }

  /**
   * A resumed session's ledger (its stored total) carried on. Sticky ids
   * restore independently from the originals in its replay (M101).
   */
  public restoreSavings(total: number): void {
    this.tokensAvoided = total
  }

  /** Sticky swaps, kept with the replay's originals across resume and fork. */
  public packedCallIds(): string[] {
    return this.ids.filter((id) => this.outputs.get(id)?.isPacked === true)
  }

  /** Restore only ids whose packable original survives this replay or fork cut. */
  public restorePackedCallIds(ids: readonly string[], input: readonly InputItem[]): void {
    this.project(input)
    const kept = new Set(ids)
    for (const [id, entry] of this.outputs) {
      entry.isPacked = kept.has(id)
    }
  }

  /** A compaction dropped the originals from the replay: forget them, keep the ledger. */
  public reset(): void {
    this.outputs.clear()
    this.ids.length = 0
  }

  /** Pages a packed original back; the host reports the outcome as the call's result. */
  public recall(argsJson: string): RecallOutcome {
    let raw: unknown
    try {
      raw = JSON.parse(argsJson)
    } catch {
      return failure(MODEL_API_MODEL_TEXT.packInvalidJson, UI_TEXT.packRecallInvalid)
    }
    const parsed = recallOutputArgs.safeParse(raw)
    if (!parsed.success) {
      return failure(
        fill(MODEL_API_MODEL_TEXT.packInvalidArguments, { detail: z.prettifyError(parsed.error) }),
        UI_TEXT.packRecallInvalid,
      )
    }
    const { id } = parsed.data
    const entry = this.outputs.get(id)
    if (entry === undefined) {
      let known = this.ids.slice(-OBS_PACK_RECALL_ID_LIMIT).join(', ')
      const omitted = this.ids.length - OBS_PACK_RECALL_ID_LIMIT
      if (omitted > 0) {
        known = fill(MODEL_API_MODEL_TEXT.packKnownIdsMore, { known, count: String(omitted) })
      }
      return failure(
        fill(MODEL_API_MODEL_TEXT.packUnknownId, { id, known: known === '' ? 'none' : known }),
        fill(UI_TEXT.packRecallUnknownId, { id }),
      )
    }
    const offset = parsed.data.offset ?? 0
    const last = entry.text.length - 1
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > last ||
      packBoundary(entry.text, offset) !== offset
    ) {
      return failure(
        fill(MODEL_API_MODEL_TEXT.packBadOffset, { id, last: String(last) }),
        fill(UI_TEXT.packRecallBadOffset, { id, last }),
      )
    }
    const found =
      parsed.data.search === undefined ? offset : entry.text.indexOf(parsed.data.search, offset)
    if (found === -1) {
      return failure(
        fill(MODEL_API_MODEL_TEXT.packSearchNotFound, { id, offset: String(offset) }),
        fill(UI_TEXT.packRecallNotFound, { id, offset }),
      )
    }
    const start = packBoundary(entry.text, found)
    const total = entry.text.length
    const end = packBoundary(entry.text, Math.min(start + OBS_PACK_PAGE_CHARS, total))
    // The slice exactly as the tool returned it, never altered: the frame
    // around it is the store's own, its markers fresh for this page.
    const page = entry.text.slice(start, end)
    const pageFacts = {
      id,
      source:
        entry.tool === undefined
          ? MODEL_API_MODEL_TEXT.packSourceUnknown
          : fill(MODEL_API_MODEL_TEXT.packSourceTool, { tool: entry.tool }),
      start: String(start),
      end: String(end),
      total: String(total),
    }
    const lead =
      end >= total
        ? fill(MODEL_API_MODEL_TEXT.packPageLast, pageFacts)
        : fill(MODEL_API_MODEL_TEXT.packPage, { ...pageFacts, next: String(end) })
    const marker = newMarker()
    return {
      output: [
        lead,
        MODEL_API_MODEL_TEXT.packRecalledUntrusted,
        fill(MODEL_API_MODEL_TEXT.packRecalledOpen, { marker }),
        page,
        fill(MODEL_API_MODEL_TEXT.packRecalledClose, { marker }),
      ].join('\n'),
      visibleOutput: `${fill(UI_TEXT.packRecalled, { id, start, end, total })}\n${page}`,
    }
  }
}
