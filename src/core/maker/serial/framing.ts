/** Exact payload representation for the approval surface; no replacement chars. */
export function serialPayload(bytes: Uint8Array): {
  readonly encoding: 'text' | 'hex'
  readonly value: string
} {
  const buffer = Buffer.from(bytes)
  const text = buffer.toString('utf8')
  const isPrintable =
    Buffer.from(text, 'utf8').equals(buffer) && /^[ -~]*$/.test(text.replaceAll(/[\t\r\n]/g, ''))
  return isPrintable
    ? { encoding: 'text', value: text }
    : { encoding: 'hex', value: buffer.toString('hex') }
}

/** Byte framing preserves split UTF-8 and CRLF until a complete line arrives. */
export class SerialLineFramer {
  private pending = Buffer.alloc(0)
  constructor(private readonly maxFrameBytes: number) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0)
      throw new Error('serial-frame-limit-invalid')
  }

  push(chunk: Uint8Array): Buffer[] {
    const input = Buffer.concat([this.pending, chunk])
    const frames: Buffer[] = []
    let offset = 0
    let newline = input.indexOf('\n', offset)
    while (newline !== -1) {
      const end = newline + 1
      if (end - offset > this.maxFrameBytes) throw new Error('serial-frame-oversize')
      frames.push(input.subarray(offset, end))
      offset = end
      newline = input.indexOf('\n', offset)
    }
    if (input.length - offset > this.maxFrameBytes) throw new Error('serial-frame-oversize')
    this.pending = Buffer.from(input.subarray(offset))
    return frames
  }

  finish(): Buffer {
    const tail = this.pending
    this.pending = Buffer.alloc(0)
    return tail
  }
}
