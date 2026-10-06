import { TextDecoder } from 'node:util'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../shared/constants'
import { deviceFrameSchema, type DeviceFrame } from '../../shared/devices'

const headerSchema = z.object({
  version: z.int(),
  body: z.object({ kind: z.string() }),
})

// Scan keys before JSON.parse can discard duplicates. Escaped spellings have
// the same decoded identity. JSON.parse still validates the complete grammar.
function rejectDuplicateKeys(text: string): void {
  const objects: (Set<string> | undefined)[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      const start = index++
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index += 1
        index += 1
      }
      index += 1
      let next = index
      while (/\s/.test(text[next] ?? '') && next < text.length) next += 1
      if (text[next] === ':') {
        const key: unknown = JSON.parse(text.slice(start, index))
        const object = objects.at(-1)
        if (typeof key !== 'string' || object === undefined || object.has(key)) {
          throw new Error('invalid-frame')
        }
        object.add(key)
      }
      continue
    }
    if (char === '{' || char === '[') {
      if (objects.length >= DEVICE_LIMITS.queuedFrames) throw new Error('invalid-frame')
      objects.push(char === '{' ? new Set() : undefined)
    } else if (char === '}' || char === ']') objects.pop()
    index += 1
  }
}

export function encodeDeviceFrame(frame: DeviceFrame): Buffer {
  const parsed = deviceFrameSchema.safeParse(frame)
  if (!parsed.success) throw new Error('invalid-frame')
  const bytes = Buffer.from(JSON.stringify(parsed.data))
  if (bytes.length > DEVICE_LIMITS.frameBytes) throw new Error('invalid-frame')
  return Buffer.concat([bytes, Buffer.from('\n')])
}

// One incomplete line and a capped ready queue; oversize bytes are rejected
// before concatenation, UTF-8 decoding, JSON parsing or zod allocation.
export class DeviceFrameDecoder {
  private readonly pending: Buffer[] = []
  private pendingBytes = 0

  get incomplete(): boolean {
    return this.pendingBytes > 0
  }

  push(
    chunk: Buffer,
    data: { available: number; refuse(frame: DeviceFrame): void },
    control?: { available: number; receive(frame: DeviceFrame): void },
  ): DeviceFrame[] {
    const frames: DeviceFrame[] = []
    let controls = 0
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf('\n', offset)
      const end = newline === -1 ? chunk.length : newline
      const length = this.pendingBytes + end - offset
      if (
        length > DEVICE_LIMITS.frameBytes ||
        (end > offset && this.pending.length >= DEVICE_LIMITS.frameFragments)
      ) {
        throw new Error('invalid-frame')
      }
      if (end > offset) this.pending.push(chunk.subarray(offset, end))
      this.pendingBytes = length
      if (newline === -1) break
      const line = Buffer.concat(this.pending, length)
      this.pending.length = 0
      this.pendingBytes = 0
      const text = new TextDecoder('utf-8', { fatal: true }).decode(line)
      rejectDuplicateKeys(text)
      const input: unknown = JSON.parse(text)
      const header = headerSchema.safeParse(input)
      if (header.success && header.data.version !== DEVICE_LIMITS.protocolVersion)
        throw new Error('incompatible')
      const isControl =
        control !== undefined && header.success && header.data.body.kind === 'cancel'
      const result = deviceFrameSchema.safeParse(input)
      if (!result.success) throw new Error('invalid-frame')
      if (isControl) {
        if (controls >= control.available) throw new Error('invalid-frame')
        controls += 1
        // Deliver validated Stop independently of data admission anywhere in this chunk.
        control.receive(result.data)
      } else if (frames.length >= data.available) data.refuse(result.data)
      else frames.push(result.data)
      offset = end + 1
    }
    return frames
  }
}
