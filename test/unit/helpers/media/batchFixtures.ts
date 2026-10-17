import type { AudioSource } from '../../../../src/core/voice/transcribeBatch'
import { expect } from 'vitest'
import type { TranscriptionPostDeps } from '../../../../src/core/voice/transcribeBatchHttp'
import { readFile } from 'node:fs/promises'

export function synthWav(
  seconds: number,
  format?: { readonly channels?: number; readonly sampleRate?: number },
): Uint8Array {
  const channels = format?.channels ?? 1
  const sampleRate = format?.sampleRate ?? 16_000
  const byteRate = sampleRate * channels * 2
  const dataBytes = Math.round(seconds * byteRate)
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(channels * 2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export async function collectTranscriptionBody(
  request: Parameters<TranscriptionPostDeps['postTranscription']>[0],
): Promise<Buffer> {
  request.dispatch()
  const chunks: Uint8Array[] = []
  const reader = request.body.getReader()
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    chunks.push(next.value)
  }
  return Buffer.concat(chunks)
}

export async function* attachedAudioBytes(paths: ReadonlyMap<string, string>, token: string) {
  const file = paths.get(token)
  if (file === undefined) throw new Error('not attached')
  yield new Uint8Array(await readFile(file))
}

export function expectTranscriptionPost<T extends { route: string; contentType: string }>(
  post: T | undefined,
) {
  if (post === undefined) throw new Error('expected one transcription POST')
  expect(post.route).toMatch(/^\/asr\/transcribe\?sessionId=/)
  expect(post.contentType).toMatch(/^multipart\/form-data; boundary=/)
  return post
}

export function stereoSource(sizeBytes: number): AudioSource {
  return {
    name: 'stereo.wav',
    pathToken: 'confined-stereo',
    info: { kind: 'audio', mediaType: 'audio/wav', sizeBytes, durationSeconds: 2 },
  }
}
