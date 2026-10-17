// M95-T: bounded native Ollama framing. The codec validates every parsed value.
import {
  PROVIDER_STREAM_FRAME_MAX_BYTES,
  PROVIDER_STREAM_MAX_FRAMES,
} from '../../../shared/constants'
import { boundedChunks, streamLimitError, type StreamLimits } from './sse'

/** UTF-8 across chunks, CRLF and final unterminated lines; blank keep-alives are ignored. */
export async function* parseNdjson(
  chunks: AsyncIterable<Uint8Array>,
  limits: StreamLimits = {},
): AsyncGenerator {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffered = ''
  let frames = 0
  const parse = (line: string): unknown => {
    if (encoder.encode(line).byteLength > (limits.frameBytes ?? PROVIDER_STREAM_FRAME_MAX_BYTES)) {
      throw streamLimitError('frame_limit')
    }
    frames += 1
    if (frames > (limits.frames ?? PROVIDER_STREAM_MAX_FRAMES)) {
      throw streamLimitError('frame_count_limit')
    }
    try {
      return JSON.parse(line)
    } catch {
      throw streamLimitError('malformed_ndjson')
    }
  }
  for await (const chunk of boundedChunks(chunks, limits)) {
    buffered += decoder.decode(chunk, { stream: true })
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (
        encoder.encode(line).byteLength > (limits.frameBytes ?? PROVIDER_STREAM_FRAME_MAX_BYTES)
      ) {
        throw streamLimitError('frame_limit')
      }
      if (line.trim() !== '') {
        yield parse(line)
      }
      newline = buffered.indexOf('\n')
    }
    if (
      encoder.encode(buffered).byteLength > (limits.frameBytes ?? PROVIDER_STREAM_FRAME_MAX_BYTES)
    ) {
      throw streamLimitError('frame_limit')
    }
  }
  buffered += decoder.decode()
  if (buffered.trim() !== '') {
    yield parse(buffered)
  }
}
