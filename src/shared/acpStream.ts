// The one way this product opens an ACP NDJSON stream, in the stdio agent and
// in the team host's child connections, so both carry the same deliberate
// message bound instead of the SDK's option-free 32 MiB default.
import { ACP_MAX_MESSAGE_BYTES } from './constants'

/** The SDK's stream factory, passed in so callers keep their own lazy import. */
type NdJsonStreamFactory<stream> = (
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
  options: { readonly maxMessageBytes: number },
) => stream

export function boundedAcpStream<stream>(
  ndJsonStream: NdJsonStreamFactory<stream>,
  output: WritableStream<Uint8Array>,
  input: ReadableStream<Uint8Array>,
): stream {
  return ndJsonStream(output, input, { maxMessageBytes: ACP_MAX_MESSAGE_BYTES })
}
