// A server-sent-events reader for the Model API's `text/event-stream`
// responses (`POST /v1/responses` with `stream: true`). The wire is the
// WHATWG EventSource format: `event:` / `data:` / `id:` / `:comment` lines,
// events separated by a blank line, multi-line `data:` joined with `\n`.
// Pure over an async byte source so tests feed it recorded chunks.

export interface SseEvent {
  readonly event: string | undefined
  readonly data: string
}

const FIELD_SEPARATOR = ':'
const LINE_BREAK = /\r\n|\r|\n/
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
export async function* parseSse(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  let buffered = ''
  let pending = emptyEvent()
  const flush = (): SseEvent => {
    const event: SseEvent = { event: pending.event, data: pending.data.join('\n') }
    pending = emptyEvent()
    return event
  }
  for await (const chunk of chunks) {
    buffered += decoder.decode(chunk, { stream: true })
    // A chunk that ends in `\r` may be half of a `\r\n` (D26): the `\n` in
    // the next chunk must not read as a second, blank line.
    const isCarriageReturnHeld = buffered.endsWith(CARRIAGE_RETURN)
    const lines = (isCarriageReturnHeld ? buffered.slice(0, -1) : buffered).split(LINE_BREAK)
    buffered = `${lines.pop() ?? ''}${isCarriageReturnHeld ? CARRIAGE_RETURN : ''}`
    for (const line of lines) {
      if (isBlockCompleteAfter(pending, line)) {
        yield flush()
      }
    }
  }
  buffered += decoder.decode()
  for (const line of buffered.split(LINE_BREAK)) {
    if (isBlockCompleteAfter(pending, line)) {
      yield flush()
    }
  }
  if (pending.data.length > 0) {
    yield flush()
  }
}
