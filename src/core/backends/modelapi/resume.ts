// Resume a turn from the last consistent point of a cut stream (M110r Y1,
// PLAN.md D90.25). The point is the last complete, validated item: a
// finished message part or a complete tool call. Text after it is
// discarded, never shown as final; a tool call whose arguments arrived
// only in part is never run; tool calls that already ran keep their
// results in the carried history and are never run again. Where M95's
// capability record carries a provider cursor set after a capture the
// harness resumes from it; otherwise the request goes again from that
// point. Pure.

import {
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  type FunctionCallItem,
  type InputContentPart,
  type InputItem,
  type MessageItem,
  type OutputItem,
  type WebSearchCallInputItem,
} from './schemas'

/**
What the streaming layer confirms: item ids it saw a `.done` event for,
and the call ids whose tools already ran (their outputs are in the
carried history).
*/
export interface ResumeConfirmations {
  readonly completedIds: ReadonlySet<string>
  readonly ranCallIds: ReadonlySet<string>
}

/** A resumed request's history, and what the cut dropped. */
export interface ResumeCut {
  /** The carried history plus the kept streamed prefix, in order. */
  readonly history: readonly InputItem[]
  /** Trailing texts discarded, never shown as final. */
  readonly droppedTexts: number
  /** Call ids dropped (partial arguments or unconfirmed), never run. */
  readonly droppedCalls: readonly string[]
}

function hasCompleteArguments(item: FunctionCallItem): boolean {
  try {
    JSON.parse(item.arguments)
    return true
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return false
    throw error
  }
}

function messageParts(item: MessageItem): InputContentPart[] {
  const parts: InputContentPart[] = []
  for (const part of item.content) {
    if (part.type === 'output_text' && 'text' in part && typeof part.text === 'string') {
      const signature =
        'thoughtSignature' in part && typeof part.thoughtSignature === 'string'
          ? part.thoughtSignature
          : undefined
      parts.push({
        type: 'output_text',
        text: part.text,
        ...(typeof signature === 'string' && { thoughtSignature: signature }),
      })
    } else if (part.type === 'refusal' && 'refusal' in part) {
      parts.push({ type: 'input_text', text: part.refusal })
    }
  }
  return parts
}

function messageToInput(item: MessageItem): InputItem {
  return {
    type: 'message',
    role: 'assistant',
    ...(item.phase !== undefined && { phase: item.phase }),
    content: messageParts(item),
  }
}

function searchToInput(item: OutputItem): WebSearchCallInputItem {
  const status = 'status' in item && typeof item.status === 'string' ? item.status : 'completed'
  return {
    type: 'web_search_call',
    ...(item.id !== undefined && { id: item.id }),
    status,
    ...('action' in item && item.action !== undefined && { action: item.action }),
  }
}

/**
Resume from a cut: `carried` is the validated history the next request
already carries (ran tool results included); `streamed` is the cut
attempt's items in arrival order. Items complete in order, so the
consistent point is the longest confirmed prefix: the first item that is
not confirmed, or a tool call whose arguments do not parse, truncates
here and everything from it on is dropped.
*/
export function resumeFromCut(
  carried: readonly InputItem[],
  streamed: readonly OutputItem[],
  confirmations: ResumeConfirmations,
): ResumeCut {
  const kept: InputItem[] = [...carried]
  let droppedTexts = 0
  const droppedCalls: string[] = []
  const { completedIds, ranCallIds } = confirmations
  const countDroppedFrom = (index: number): void => {
    for (const item of streamed.slice(index)) {
      if (isMessageItem(item)) droppedTexts += 1
      else if (isFunctionCallItem(item)) droppedCalls.push(item.call_id)
    }
  }
  for (const [index, item] of streamed.entries()) {
    if (isMessageItem(item)) {
      if (item.id === undefined || !completedIds.has(item.id)) {
        countDroppedFrom(index)
        break
      }
      kept.push(messageToInput(item))
    } else if (isFunctionCallItem(item)) {
      if (!ranCallIds.has(item.call_id)) {
        const isConfirmed =
          (item.id !== undefined && completedIds.has(item.id)) || completedIds.has(item.call_id)
        if (!isConfirmed || !hasCompleteArguments(item)) {
          countDroppedFrom(index)
          break
        }
      }
      kept.push(item)
    } else if (isReasoningItem(item)) {
      if (item.id !== undefined && !completedIds.has(item.id)) {
        countDroppedFrom(index)
        break
      }
      kept.push(item)
    } else if (item.type === 'web_search_call') {
      if (item.id !== undefined && !completedIds.has(item.id)) {
        countDroppedFrom(index)
        break
      }
      kept.push(searchToInput(item))
    }
    // Unknown extension items stay on the transcript; they carry nothing
    // the replay shape can type, so they never re-enter a request.
  }
  return { history: kept, droppedTexts, droppedCalls }
}
