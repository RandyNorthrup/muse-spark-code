// The packing store, deferred (D6 diet): `ObservationPack` and the recall
// argument parsing behind it load as `dist/modelApiTools.js` on the first
// turn of a session that packs, never at session start. The host keeps the
// packing helpers its every turn reads (`backgroundNoteId`,
// `pageRecalledText`, `RECALL_TOOL_DEFINITION`, `estimatePackTokens`) in
// `observationPack.ts`; this module holds only what a packing turn needs.
// A bundle that cannot load fails the turn that needed it, never a silent
// fallback and never a default value.
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'

import {
  PACK_MODEL_TEXT,
  OBS_PACK_PAGE_CHARS,
  OBS_PACK_RECALL_ID_LIMIT,
  OBS_PACK_SINGLE_LINE_EXCERPT_CHARS,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
  OBS_PACK_HEAD_LINES,
  OBS_PACK_MARKER_BYTES,
  OBS_PACK_TAIL_LINES,
  SHELL_PACKED_MAX_CHARS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { InputItem } from './schemas'
import { restoredToolText } from './schemas'
import { boundToolResultText, estimatePackTokens } from './toolResultBound'
import { backgroundNoteId } from './observationPack'

const recallOutputArgs = z.object({
  id: z.string(),
  offset: z.optional(z.number()),
  search: z.optional(z.string().check(z.minLength(1), z.maxLength(OBS_PACK_PAGE_CHARS))),
})

interface ParsedRecall {
  readonly id: string
  readonly offset: number
  readonly search: string | undefined
}

/**
The recall arguments, validated exactly as offered. Undefined when the
arguments are not JSON; an `outcome` when they parse but are invalid.
*/
function parseRecallArgs(
  argsJson: string,
): ParsedRecall | { readonly outcome: RecallOutcome } | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(argsJson)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = recallOutputArgs.safeParse(raw)
  if (!parsed.success) {
    return {
      outcome: failure(
        fill(PACK_MODEL_TEXT.packInvalidArguments, { detail: z.prettifyError(parsed.error) }),
        UI_TEXT.packRecallInvalid,
      ),
    }
  }
  return { id: parsed.data.id, offset: parsed.data.offset ?? 0, search: parsed.data.search }
}

/**
What a `recall_output` call returns; the host reports it as the tool
outcome. `output` is the model's (English, PACK_MODEL_TEXT); `visibleOutput`
and `failureReason` are the row's, in the display language, with the
recalled text itself shown as it was.
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

/**
TOOLCAP: one character page of a full result, framed exactly as a packed
page. The host serves spill files through this when the pack store holds
only the cut text (or nothing): every bounded piece stays reachable,
including inside megabyte lines that line-paged file reads cannot reach.
*/
export function pageRecalledText(
  text: string,
  tool: string | undefined,
  id: string,
  offset: number,
  search: string | undefined,
): RecallOutcome {
  const last = text.length - 1
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > last ||
    packBoundary(text, offset) !== offset
  ) {
    return failure(
      fill(PACK_MODEL_TEXT.packBadOffset, { id, last: String(last) }),
      fill(UI_TEXT.packRecallBadOffset, { id, last }),
    )
  }
  const found = search === undefined ? offset : text.indexOf(search, offset)
  if (found === -1) {
    return failure(
      fill(PACK_MODEL_TEXT.packSearchNotFound, { id, offset: String(offset) }),
      fill(UI_TEXT.packRecallNotFound, { id, offset }),
    )
  }
  const start = packBoundary(text, found)
  const total = text.length
  const end = packBoundary(text, Math.min(start + OBS_PACK_PAGE_CHARS, total))
  // The slice exactly as the tool returned it, never altered: the frame
  // around it is the store's own, its markers fresh for this page.
  const page = text.slice(start, end)
  const pageFacts = {
    id,
    source:
      tool === undefined
        ? PACK_MODEL_TEXT.packSourceUnknown
        : fill(PACK_MODEL_TEXT.packSourceTool, { tool }),
    start: String(start),
    end: String(end),
    total: String(total),
  }
  const lead =
    end >= total
      ? fill(PACK_MODEL_TEXT.packPageLast, pageFacts)
      : fill(PACK_MODEL_TEXT.packPage, { ...pageFacts, next: String(end) })
  const marker = newMarker()
  return {
    output: [
      lead,
      PACK_MODEL_TEXT.packRecalledUntrusted,
      fill(PACK_MODEL_TEXT.packRecalledOpen, { marker }),
      page,
      fill(PACK_MODEL_TEXT.packRecalledClose, { marker }),
    ].join('\n'),
    visibleOutput: `${fill(UI_TEXT.packRecalled, { id, start, end, total })}\n${page}`,
  }
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
  The outputs' ids in arrival order, for the unknown-id error: a list of
  its own, as the Map's key iterator has no `toArray` on Node 20 (VS Code
  1.99's host).
  */
  private readonly ids: string[] = []
  private readonly placeholders = new WeakMap<InputItem, PackedOutput>()
  private readonly wholeNotes = new WeakMap<InputItem, PackedOutput>()
  /**
  The requests already counted: an HTTP retry sends the same input again,
  and is still one request, so an output is not packed a request early.
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
    if (tail.length === 0 && head.length > 1) {
      tail = head.slice(-1)
      head = head.slice(0, -1)
    }
    let text = this.render(callId, entry, head, tail)
    // Trim the tail from its front, then the head from its back: the final
    // lines (a shell result's `[exit code N]`) stay while they fit (M101).
    // The final line is never trimmed here; the fallback below keeps it.
    while (text.length > OBS_PACK_THRESHOLD_CHARS && (head.length > 1 || tail.length > 1)) {
      if (tail.length > 1) {
        tail = tail.slice(1)
      } else {
        head = head.slice(0, -1)
      }
      text = this.render(callId, entry, head, tail)
    }
    if (text.length > OBS_PACK_THRESHOLD_CHARS) {
      // Still too long (one long line, or a long final one): an excerpt of
      // about OBS_PACK_SINGLE_LINE_EXCERPT_CHARS, keeping the final line
      // beside the first when they differ and it fits (M101).
      const last = all.at(-1) ?? ''
      const tailKept = last !== '' && all.length > 1 ? [last] : []
      const metadata = this.render(callId, entry, ['…'], tailKept)
      const available = Math.max(0, OBS_PACK_SINGLE_LINE_EXCERPT_CHARS - metadata.length)
      const first = head[0] ?? ''
      const cut = first.slice(0, packBoundary(first, Math.min(available, first.length)))
      head = [`${cut}…`]
      tail = tailKept
      text = this.render(callId, entry, head, tail)
    }
    // Packing that saves under half is not worth the recall round trip.
    if (text.length > OBS_PACK_THRESHOLD_CHARS || text.length * 2 > entry.text.length) {
      return original
    }
    // TOOLCAP: the placeholder carries at most OBS_PACK_THRESHOLD_CHARS
    // characters, so under no trimming of ours it passes the bound uncut
    // (D121). When a person's own guard would cut it, the current text rides
    // instead: it already passed the bound on entry, and the send-time
    // recovery still cuts whatever exceeds the bound on refusal.
    const branded = boundToolResultText(text, {
      maxBytes: Infinity,
      windowTokens: undefined,
    })
    if (branded.cut !== undefined) return original
    const item: InputItem = { type: 'function_call_output', call_id: callId, output: branded.text }
    this.placeholders.set(item, entry)
    return item
  }

  private render(
    callId: string,
    entry: PackedOutput,
    head: readonly string[],
    tail: readonly string[],
  ): string {
    return fill(PACK_MODEL_TEXT.packPlaceholder, {
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
  The request's input with packable outputs projected: whole while an
  output is still new, a placeholder once it packed. Registers outputs it
  has not seen; counting happens in `noteSent`, once per request sent.
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
      // Background completions are host-authored user notes, not tool
      // outputs. Keep the original note in replay and project only this
      // known kind; ordinary user messages are never packed.
      if (item.type === 'message' && item.role === 'user' && item.content.length === 1) {
        const part = item.content[0]
        if (
          part?.type === 'input_text' &&
          part.text.startsWith(PACK_MODEL_TEXT.backgroundEndedLead) &&
          part.text.length > OBS_PACK_THRESHOLD_CHARS
        ) {
          const id = backgroundNoteId(part.text)
          const entry = this.register(id, part.text, undefined)
          if (entry.isPacked || entry.text.length > SHELL_PACKED_MAX_CHARS) {
            // TOOLCAP: this note entered the replay through the session bound
            // (noteForModel binds every background note), so the brand only
            // restates what the choke measured (PLAN.md §8: TOOLCAP brand).
            const packed = this.placeholder(id, entry, {
              type: 'function_call_output',
              call_id: id,
              output: restoredToolText(part.text),
            })
            if (
              packed.type === 'function_call_output' &&
              typeof packed.output === 'string' &&
              this.placeholders.has(packed)
            ) {
              const note: InputItem = {
                ...item,
                content: [{ type: 'input_text', text: packed.output }],
              }
              this.placeholders.set(note, entry)
              return note
            }
          }
          this.wholeNotes.set(item, entry)
        }
        return item
      }
      if (item.type !== 'function_call_output' || typeof item.output !== 'string') {
        return item
      }
      if (item.output.length <= OBS_PACK_THRESHOLD_CHARS) {
        return item
      }
      const entry = this.register(item.call_id, item.output, tools.get(item.call_id))
      return entry.isPacked || entry.text.length > SHELL_PACKED_MAX_CHARS
        ? this.placeholder(item.call_id, entry, item)
        : item
    })
  }

  /**
  Accounts one request actually sent, at the client's final send boundary:
  whole sends count toward the swap, packed sends add what they left out
  to the ledger. The ledger counts what the placeholder still costs out,
  so it matches the tokens left out of the request. A retried attempt of
  the same request is not counted again.
  */
  public noteSent(input: readonly InputItem[]): void {
    if (this.counted.has(input)) {
      return
    }
    this.counted.add(input)
    for (const item of input) {
      const packed = this.placeholders.get(item)
      if (packed !== undefined) {
        let length = 0
        if (item.type === 'function_call_output' && typeof item.output === 'string') {
          length = item.output.length
        } else if (item.type === 'message' && item.content[0]?.type === 'input_text') {
          length = item.content[0].text.length
        }
        this.tokensAvoided += estimatePackTokens(packed.text.length) - estimatePackTokens(length)
        continue
      }
      const entry =
        this.wholeNotes.get(item) ??
        (item.type === 'function_call_output' ? this.outputs.get(item.call_id) : undefined)
      if (entry === undefined || entry.isPacked) continue
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
  A resumed session's ledger (its stored total) carried on. Sticky ids
  restore independently from the originals in its replay (M101).
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
    const parsed = parseRecallArgs(argsJson)
    if (parsed === undefined) {
      return failure(PACK_MODEL_TEXT.packInvalidJson, UI_TEXT.packRecallInvalid)
    }
    if ('outcome' in parsed) return parsed.outcome
    const entry = this.outputs.get(parsed.id)
    if (entry === undefined) {
      let known = this.ids.slice(-OBS_PACK_RECALL_ID_LIMIT).join(', ')
      const omitted = this.ids.length - OBS_PACK_RECALL_ID_LIMIT
      if (omitted > 0) {
        known = fill(PACK_MODEL_TEXT.packKnownIdsMore, { known, count: String(omitted) })
      }
      return failure(
        fill(PACK_MODEL_TEXT.packUnknownId, {
          id: parsed.id,
          known: known === '' ? 'none' : known,
        }),
        fill(UI_TEXT.packRecallUnknownId, { id: parsed.id }),
      )
    }
    return pageRecalledText(entry.text, entry.tool, parsed.id, parsed.offset, parsed.search)
  }
}
