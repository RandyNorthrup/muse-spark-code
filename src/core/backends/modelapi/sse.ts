// A server-sent-events reader for the Model API's `text/event-stream`
// responses (`POST /v1/responses` with `stream: true`). The wire is the
// WHATWG EventSource format: `event:` / `data:` / `id:` / `:comment` lines,
// events separated by a blank line, multi-line `data:` joined with `\n`.
// Pure over an async byte source so tests feed it recorded chunks.

import {
  PROVIDER_STREAM_FRAME_MAX_BYTES,
  PROVIDER_STREAM_MAX_BYTES,
  PROVIDER_STREAM_MAX_FRAMES,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'

export interface StreamLimits {
  readonly frameBytes?: number
  readonly totalBytes?: number
  readonly frames?: number
}

/** Fixed technical reason under the existing translated request-failure template. */
export function streamLimitError(reason: string): Error {
  return new Error(fill(UI_TEXT.webFetchNetwork, { detail: reason }))
}

/** Shared byte budget: checked before decoding, including comments and keep-alives. */
export async function* boundedChunks(
  chunks: AsyncIterable<Uint8Array>,
  limits: StreamLimits,
): AsyncGenerator<Uint8Array> {
  let total = 0
  for await (const chunk of chunks) {
    total += chunk.byteLength
    if (total > (limits.totalBytes ?? PROVIDER_STREAM_MAX_BYTES)) {
      throw streamLimitError('stream_limit')
    }
    yield chunk
  }
}

export interface SseEvent {
  readonly event: string | undefined
  readonly data: string
}

const FIELD_SEPARATOR = ':'
const LINE_BREAK = /(\r\n|\r|\n)/
const CARRIAGE_RETURN = '\r'

interface PendingEvent {
  event: string | undefined
  data: string[]
}

function emptyEvent(): PendingEvent {
  return { event: undefined, data: [] }
}

/** Applies one line to the pending event; true when the event is complete. */
function isBlockCompleteAfter(pending: PendingEvent, line: string): boolean {
  if (line === '') {
    return pending.data.length > 0
  }
  if (line.startsWith(FIELD_SEPARATOR)) {
    return false
  }
  const separator = line.indexOf(FIELD_SEPARATOR)
  const field = separator === -1 ? line : line.slice(0, separator)
  let value = separator === -1 ? '' : line.slice(separator + 1)
  if (value.startsWith(' ')) {
    value = value.slice(1)
  }
  if (field === 'event') {
    pending.event = value
  } else if (field === 'data') {
    pending.data.push(value)
  }
  return false
}

/**
 * Yields one event per blank-line-terminated block. A final block without
 * a trailing blank line is still delivered when the source ends.
 */
export async function* parseSse(
  chunks: AsyncIterable<Uint8Array>,
  limits: StreamLimits = {},
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  let buffered = ''
  let pending = emptyEvent()
  let frameBytes = 0
  let frames = 0
  const encoder = new TextEncoder()
  const isCompleteAfter = (line: string, terminatorBytes: number): boolean => {
    frameBytes += encoder.encode(line).byteLength + terminatorBytes
    if (frameBytes > (limits.frameBytes ?? PROVIDER_STREAM_FRAME_MAX_BYTES)) {
      throw streamLimitError('frame_limit')
    }
    const isComplete = isBlockCompleteAfter(pending, line)
    if (line === '') {
      frameBytes = 0
      if (!isComplete) {
        pending = emptyEvent()
      }
    }
    return isComplete
  }
  const flush = (): SseEvent => {
    frames += 1
    if (frames > (limits.frames ?? PROVIDER_STREAM_MAX_FRAMES)) {
      throw streamLimitError('frame_count_limit')
    }
    const event: SseEvent = { event: pending.event, data: pending.data.join('\n') }
    pending = emptyEvent()
    return event
  }
  for await (const chunk of boundedChunks(chunks, limits)) {
    buffered += decoder.decode(chunk, { stream: true })
    // A chunk that ends in `\r` may be half of a `\r\n` (D26): the `\n` in
    // the next chunk must not read as a second, blank line.
    const isCarriageReturnHeld = buffered.endsWith(CARRIAGE_RETURN)
    const lines = (isCarriageReturnHeld ? buffered.slice(0, -1) : buffered).split(LINE_BREAK)
    buffered = `${lines.pop() ?? ''}${isCarriageReturnHeld ? CARRIAGE_RETURN : ''}`
    for (let index = 0; index < lines.length; index += 2) {
      if (isCompleteAfter(lines[index] ?? '', (lines[index + 1] ?? '').length)) {
        yield flush()
      }
    }
    if (
      frameBytes + encoder.encode(buffered).byteLength >
      (limits.frameBytes ?? PROVIDER_STREAM_FRAME_MAX_BYTES)
    ) {
      throw streamLimitError('frame_limit')
    }
  }
  buffered += decoder.decode()
  const tail = buffered.split(LINE_BREAK)
  for (let index = 0; index < tail.length; index += 2) {
    if (isCompleteAfter(tail[index] ?? '', (tail[index + 1] ?? '').length)) {
      yield flush()
    }
  }
  if (pending.data.length > 0) {
    yield flush()
  }
}
